// O detector de pontos rodando no navegador, na CPU: o ONNX Runtime Web, em WebAssembly, vem junto com a
// página (web/vendor/onnxruntime-web) e nada vai para a rede. Roda num worker — o da importação e o do botão
// da página da partida — para não travar a página. O modelo vem de `modelos/<nome>/` da pasta da equipe; os
// pontos de cada quadro vão para `previsoes/pontos/<quadro>.json`, e quem anota começa deles (ADR-0017).
//
// A imagem que a rede vê é o JPEG gravado na pasta, decodificado pelo navegador, sem conversão de cor —
// o mesmo arquivo que o laboratório lê no treino.

import { CORTE_ESCORE, decodificar, pontosParaGravar, prepararEntrada } from "../nucleo/detector.js";
import { Sha256 } from "../nucleo/hash.js";
import { conferirCartao, idDoModelo, pedePrevisao, versaoDoModelo } from "../nucleo/modelos.js";
import { conferirImportacao } from "../nucleo/partida.js";

const ORT = new URL("../../vendor/onnxruntime-web/ort.wasm.bundle.min.js", import.meta.url);
let ort = null;
let binario = null;

/** Os bytes do motor (.wasm), para quem não busca arquivos com o fetch (os testes no Node). */
export function usarWasm(bytes) {
  binario = bytes;
}

async function carregarOrt() {
  if (!ort) {
    const m = await import(ORT.href); // o motor (.wasm) vem da mesma pasta, buscado pelo próprio ONNX Runtime
    m.env.wasm.numThreads = 1; // sem o isolamento entre origens (o GitHub Pages não manda), não há threads
    m.env.wasm.proxy = false;
    if (binario) m.env.wasm.wasmBinary = binario;
    m.env.logLevel = "error";
    ort = m;
  }
  return ort;
}

/** O modelo não pôde ser aberto (cartão, arquivo, ONNX Runtime): a mensagem diz o que fazer. */
export class ErroDetector extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "ErroDetector";
  }
}

function checarCancelamento(sinal) {
  if (sinal?.aborted) throw new DOMException("cancelado", "AbortError");
}

/**
 * Os pixels de um quadro (o Blob do JPEG), decodificado pelo navegador sem conversão de cor:
 * {rgba (Uint8ClampedArray), largura, altura}. O mesmo JPEG que o laboratório lê no treino.
 */
export async function pixelsDoQuadro(blob) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  try {
    const tela = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = tela.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return { rgba: ctx.getImageData(0, 0, bmp.width, bmp.height).data, largura: bmp.width, altura: bmp.height };
  } finally {
    bmp.close();
  }
}

/**
 * Abre o modelo `modelos/<nome>/` da pasta: confere o cartão e o sha256 do ONNX e prepara a sessão.
 * Devolve {nome, cartao, id, fonte, versao, prever(blob), fechar()}.
 */
export async function abrirDetector(pasta, nome) {
  const onde = `modelos/${nome}`;
  let cartao;
  try {
    cartao = await pasta.lerJson(pasta.cartaoModelo(nome));
  } catch (e) {
    throw new ErroDetector(`${onde}: ${e?.name === "NotFoundError" ? "falta o cartao.json" : e.message}`);
  }
  const erros = conferirCartao(cartao);
  if (erros.length) throw new ErroDetector(`${onde}: ${erros.join("; ")}`);
  const arquivo = await pasta.arquivo(pasta.arquivoModelo(nome, cartao.arquivos.onnx));
  if (!arquivo) throw new ErroDetector(`${onde}: falta o ${cartao.arquivos.onnx} (ou ainda está sincronizando)`);
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (new Sha256().update(bytes).hex() !== cartao.arquivos.sha256_onnx) {
    throw new ErroDetector(`${onde}: o ${cartao.arquivos.onnx} não é o do cartão (o sha256 não bate) — copie a pasta exportada de novo`);
  }
  let o;
  let sessao;
  try {
    o = await carregarOrt();
    sessao = await o.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  } catch (e) {
    throw new ErroDetector(`o ONNX Runtime não abriu o modelo neste navegador: ${e?.message || e}`);
  }
  const k = cartao.contrato;
  const entrada = k.onnx.entrada.nome;
  if (!sessao.inputNames.includes(entrada) || !["kp", "off"].every((s) => sessao.outputNames.includes(s))) {
    await sessao.release();
    throw new ErroDetector(`${onde}: o ONNX não tem a entrada ${entrada} e as saídas kp e off que o cartão diz`);
  }
  const [, , IH, IW] = k.onnx.entrada.forma;
  return {
    nome,
    cartao,
    id: idDoModelo(cartao),
    fonte: cartao.nome,
    versao: versaoDoModelo(cartao),
    /** Os pontos de um quadro (o Blob do JPEG): {pontos: [{ponto, x, y}], largura, altura}. */
    async prever(blob) {
      const { rgba, largura: W, altura: H } = await pixelsDoQuadro(blob);
      const { tensor, janela } = prepararEntrada(rgba, W, H, IW, IH);
      const r = await sessao.run({ [entrada]: new o.Tensor("float32", tensor, [1, 3, IH, IW]) });
      const saidas = { kp: r.kp.data, off: r.off.data, altura: r.kp.dims[2], largura: r.kp.dims[3] };
      return { pontos: pontosParaGravar(decodificar(saidas, k, janela, CORTE_ESCORE), W, H), largura: W, altura: H };
    },
    async fechar() {
      await sessao.release();
    },
  };
}

/**
 * Grava a previsão dos quadros da fila (`itens`) que começam da previsão (não os "sem previsão" nem os da
 * dupla às cegas). `pular`: quadros que não são para prever (os que já têm rótulo, no botão da página da
 * partida). `manter(quadro)`: se a previsão que já existe fica (por padrão, nenhuma). `antesDeGravar`:
 * conferência antes de cada arquivo (a importação confere que ninguém importou a partida enquanto isso).
 * Um quadro que falha fica sem previsão; três falhas seguidas, sem nenhum acerto, param tudo.
 * Devolve {previstos, pontos, ficaram_do_zero, pulados, mantidos, sem_imagem, falhas, segundos}.
 */
export async function preverQuadros(pasta, partida, itens, detector, opcoes = {}) {
  const { aoProgresso = () => {}, sinal = null, antesDeGravar = async () => {}, pular = new Set(), manter = async () => false } = opcoes;
  const t0 = performance.now();
  const out = { previstos: 0, pontos: 0, ficaram_do_zero: 0, pulados: 0, mantidos: 0, sem_imagem: 0, falhas: 0, segundos: 0, erro: null };
  const fazer = [];
  for (const it of itens) {
    if (!pedePrevisao(it)) out.ficaram_do_zero += 1;
    else if (pular.has(it.quadro)) out.pulados += 1;
    else if (await manter(it.quadro)) out.mantidos += 1;
    else fazer.push(it);
  }
  let seguidas = 0;
  aoProgresso(0);
  for (let i = 0; i < fazer.length; i++) {
    checarCancelamento(sinal);
    const q = fazer[i].quadro;
    const blob = await pasta.arquivo(pasta.quadro(partida, q));
    if (!blob) {
      out.sem_imagem += 1; // ainda sincronizando: fica para a próxima vez
    } else {
      let r = null;
      try {
        r = await detector.prever(blob);
      } catch (e) {
        out.falhas += 1;
        out.erro = e?.message || String(e);
        seguidas += 1;
        if (seguidas >= 3 && !out.previstos) throw new ErroDetector(`a detecção falhou nos primeiros quadros: ${out.erro}`);
      }
      if (r) {
        seguidas = 0;
        checarCancelamento(sinal);
        await antesDeGravar();
        const previsao = { formato: "previsao.pontos/1", partida, quadro: q, fonte: detector.fonte, versao: detector.versao, pontos: r.pontos };
        await pasta.gravar("previsao_pontos", pasta.previsaoPontos(partida, q), previsao, { sobrescrever: true });
        out.previstos += 1;
        out.pontos += r.pontos.length;
      }
    }
    aoProgresso((i + 1) / fazer.length);
  }
  out.segundos = (performance.now() - t0) / 1000;
  return out;
}

/**
 * O botão da página da partida: as previsões do modelo `modelo` (a pasta em `modelos/`) para os quadros da
 * partida que ainda não têm rótulo. A previsão que já é deste modelo fica; a de outro modelo é refeita.
 */
export async function preverPartida({ pasta, partida, modelo, aoProgresso = () => {}, sinal = null }) {
  await conferirImportacao(pasta, partida);
  const fila = await pasta.lerFila(partida);
  const comRotulo = new Set((await pasta.listarArquivos(pasta.rotulos(partida, "pontos"))).map((a) => a.quadro));
  aoProgresso("preparando a detecção", 0);
  const detector = await abrirDetector(pasta, modelo);
  try {
    const manter = async (q) => {
      try {
        const p = await pasta.lerJson(pasta.previsaoPontos(partida, q));
        return p.fonte === detector.fonte && p.versao === detector.versao;
      } catch {
        return false; // sem previsão, ou uma quebrada: faz de novo
      }
    };
    const r = await preverQuadros(pasta, partida, fila.itens, detector, {
      aoProgresso: (f) => aoProgresso("prevendo os pontos", f),
      sinal,
      pular: comRotulo,
      manter,
      antesDeGravar: () => conferirImportacao(pasta, partida),
    });
    return { partida, modelo: detector.id, ...r };
  } finally {
    await detector.fechar().catch(() => {});
  }
}
