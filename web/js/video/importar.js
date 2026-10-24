// Importar uma partida no navegador: tudo roda na máquina de quem importa e só os quadros
// sorteados vão para a pasta de trabalho.
//
// 1. leitura do vídeo (uma passada): hash do arquivo, relógio de cada quadro (PTS) e descritores
//    de quadros reduzidos, com o decodificador do navegador (WebCodecs) — só nos trechos
//    escolhidos, quando há;
// 2. cortes e transições (regras do laboratório), só para organizar o sorteio;
// 3. agrupamento das tomadas por aparência e zoom;
// 4. sorteio de 1 ou 2 quadros por tomada (a fila é aberta: quem anota pega o próximo);
// 5. extração dos quadros sorteados em JPEG, na resolução original;
// 6. tomadas, fila e manifesto — o manifesto por último: partida sem manifesto não existe.

import { Aleatorio } from "../nucleo/aleatorio.js";
import { REF_PACOTE_GENERICO, VERSAO, arredondarPar, idPartida, partesPacote } from "../nucleo/convencoes.js";
import { arredondar, mediana } from "../nucleo/estatistica.js";
import { validar } from "../nucleo/formatos.js";
import { Sha256 } from "../nucleo/hash.js";
import { formatarTempo } from "../nucleo/trechos.js";
import { agrupar, corrigirPts, detectarCortes, detectarGraduais, montarTomadas } from "./cortes.js";
import { ALTURA, LARGURA, descrever, distanciaEstrutura, qui2 } from "./descritores.js";
import { ErroVideo, abrirMp4, apresentacao, leitorDeArquivo } from "./mp4.js";
import { PARAMETROS, sortear } from "./sorteio.js";

export class PartidaJaExiste extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "PartidaJaExiste";
  }
}

/** O navegador não aceitou começar a decodificar nesta amostra: o MP4 a marca como chave, mas não é. */
export class ChaveRecusada extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "ChaveRecusada";
  }
}

/**
 * Marca "importando" na pasta da partida, renovada a cada minuto enquanto a importação anda: duas
 * pessoas não importam a mesma partida ao mesmo tempo (uma escreveria por cima das imagens da outra).
 * Uma marca sem renovação há 10 minutos é de uma importação que parou e não impede nada.
 */
export class MarcaDeImportacao {
  static VALIDADE_MS = 10 * 60_000;
  static RENOVAR_MS = 60_000;

  constructor(pasta, partida, arquivo, agora = () => Date.now()) {
    this.pasta = pasta;
    this.caminho = pasta.importando(partida);
    this.dados = { id: crypto.randomUUID(), nome_original: arquivo.name, bytes: arquivo.size };
    this.agora = agora;
    this.ultima = -Infinity;
  }

  async _ler() {
    try {
      return await this.pasta.lerJson(this.caminho);
    } catch {
      return null; // não existe, ou está sendo escrita
    }
  }

  /** Falha se outra importação desta partida está em andamento. */
  async conferir() {
    const outra = await this._ler();
    const idade = outra ? this.agora() - Date.parse(outra.atualizado_em) : Infinity;
    if (outra && outra.id !== this.dados.id && idade < MarcaDeImportacao.VALIDADE_MS) {
      const falta = Math.max(1, Math.ceil((MarcaDeImportacao.VALIDADE_MS - idade) / 60_000));
      throw new PartidaJaExiste(
        `esta partida está sendo importada agora (${outra.nome_original}): espere terminar; se essa importação foi interrompida, tente de novo daqui a ${falta} min`,
      );
    }
  }

  /** Grava ou renova a marca (no máximo uma vez por minuto, a não ser forçando). */
  async renovar(forcar = false) {
    if (this.tirada || (!forcar && this.agora() - this.ultima < MarcaDeImportacao.RENOVAR_MS)) return;
    this.ultima = this.agora();
    const marca = { ...this.dados, atualizado_em: new Date(this.agora()).toISOString() };
    this.gravando = this.pasta.escreverJson(this.caminho, marca, { sobrescrever: true });
    await this.gravando;
  }

  /** Tira a marca, se ainda for a desta importação (depois de qualquer renovação em andamento). */
  async tirar() {
    this.tirada = true;
    await this.gravando?.catch(() => {});
    if ((await this._ler())?.id === this.dados.id) await this.pasta.apagar(this.caminho).catch(() => {});
  }
}

const BLOCO = 8 << 20;
const FILA_MAX = 12;
const DICA = "converta o vídeo para MP4 com H.264 (no HandBrake ou no ffmpeg) e tente de novo";
const VOLTAS_MAX = 600; // quadros-chave para trás, procurando um começo aceito para o trecho
const PERTO_US = 30e6; // grupos a menos de 30 s um do outro vão na mesma passada, depois de voltar
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function checarCancelamento(sinal) {
  if (sinal?.aborted) throw new DOMException("importação cancelada", "AbortError");
}

/** Configuração do decodificador, conferida com o navegador. */
export async function configuracaoDecodificador(faixa) {
  if (typeof VideoDecoder === "undefined") {
    throw new ErroVideo("este navegador não decodifica vídeo aqui: use o Chrome ou o Edge atualizados");
  }
  const config = { codec: faixa.codec, codedWidth: faixa.largura, codedHeight: faixa.altura };
  if (faixa.descricao) config.description = faixa.descricao;
  const r = await VideoDecoder.isConfigSupported(config);
  if (!r.supported) {
    const nome = { avc1: "H.264", avc3: "H.264", hvc1: "H.265", hev1: "H.265", vp09: "VP9", av01: "AV1" }[faixa.codec.slice(0, 4)];
    throw new ErroVideo(
      faixa.codec.startsWith("avc")
        ? `este navegador não decodifica H.264 (${faixa.codec}): use o Chrome ou o Edge atualizados`
        : `este navegador não decodifica ${nome || faixa.codec} (${faixa.codec}): converta o vídeo para H.264 ou use o Chrome ou o Edge`,
    );
  }
  return config;
}

/** Decodificador com limite de fila e erro repassado para quem envia. */
class Decodificador {
  constructor(config, aoQuadro) {
    this.erro = null;
    this.precisaChave = true; // o primeiro trecho depois do configure() tem de ser um quadro-chave
    this.d = new VideoDecoder({
      output: (quadro) => {
        try {
          aoQuadro(quadro);
        } catch (e) {
          this.erro ??= e;
        } finally {
          quadro.close();
        }
      },
      error: (e) => {
        this.erro ??= new ErroVideo(`falha ao decodificar o vídeo: ${e.message}`);
      },
    });
    this.d.configure(config);
  }

  async enviar(amostra, ts, dados) {
    while (this.d.decodeQueueSize > FILA_MAX && !this.erro) {
      await Promise.race([new Promise((r) => this.d.addEventListener("dequeue", r, { once: true })), pausa(20)]);
    }
    if (this.erro) throw this.erro;
    const trecho = new EncodedVideoChunk({ type: amostra.sync ? "key" : "delta", timestamp: ts, data: dados });
    try {
      this.d.decode(trecho);
    } catch (e) {
      // o navegador confere o primeiro quadro-chave e recusa (DataError) o que o MP4 marca como chave
      // sem ser — por exemplo, um quadro I de H.264 que não é IDR
      if (this.precisaChave && e?.name === "DataError") throw new ChaveRecusada(e.message);
      throw e;
    }
    this.precisaChave = false;
  }

  async esvaziar() {
    if (this.erro) throw this.erro;
    await this.d.flush();
    if (this.erro) throw this.erro;
    this.precisaChave = true; // depois do flush(), o próximo trecho tem de ser um quadro-chave de novo
  }

  fechar() {
    if (this.d.state !== "closed") this.d.close();
  }
}

function estimarFps(ptsMs) {
  const d = [];
  for (let i = 1; i < Math.min(ptsMs.length, 2000); i++) d.push(ptsMs[i] - ptsMs[i - 1]);
  const m = mediana(d.filter((x) => x > 0));
  return m ? arredondar(1000 / m, 3) : 25;
}

/**
 * Trechos do vídeo (segundos desde o primeiro quadro; o início entra, o fim não) -> os quadros que
 * entram (`dentro`, na ordem de apresentação), as amostras a decodificar (`precisa`, na ordem do
 * arquivo: do quadro-chave antes de cada trecho até o seguinte ao fim dele) e os limites dos trechos
 * (índices de quadro, para nenhuma tomada atravessar um pedaço pulado).
 */
export function planejarTrechos(trechos, faixa, ap) {
  const n = ap.ordem.length;
  const amostras = faixa.amostras;
  const dentro = new Uint8Array(n);
  const precisa = new Uint8Array(amostras.length);
  const sincronos = [];
  amostras.forEach((a, i) => a.sync && sincronos.push(i));
  const limites = [];
  for (const [ini, fim] of trechos) {
    const iniMs = Math.round(ini * 1000); // em ms inteiros: 3,8 s é 3800 ms, sem erro de arredondamento
    const fimMs = Math.round(fim * 1000);
    let k0 = -1;
    let k1 = -1;
    for (let k = 0; k < n; k++) {
      if (ap.ptsMs[k] < iniMs || ap.ptsMs[k] >= fimMs) continue;
      dentro[k] = 1;
      if (k0 < 0) k0 = k;
      k1 = k;
    }
    if (k0 < 0) continue;
    let siMin = Infinity;
    let siMax = -1;
    for (let k = k0; k <= k1; k++) {
      siMin = Math.min(siMin, ap.ordem[k]);
      siMax = Math.max(siMax, ap.ordem[k]);
    }
    const de = sincronos.length ? sincronos[inicioDoGrupo(amostras, sincronos, siMin)] : 0;
    const proximo = sincronos.find((x) => x > siMax);
    precisa.fill(1, Math.min(de, siMin), proximo === undefined ? amostras.length : proximo);
    limites.push(k0, k1 + 1);
  }
  return { dentro, precisa, limites, n_dentro: dentro.reduce((a, b) => a + b, 0) };
}

/**
 * 1ª passada: lê o arquivo em ordem, faz o hash e decodifica os quadros (só os dos trechos, quando
 * há `plano`), guardando só os descritores dos quadros reduzidos.
 */
async function analisar(leitor, faixa, ap, config, fps, { aoProgresso, sinal, plano = null }) {
  const n = ap.ordem.length;
  const indiceDoTs = new Map();
  ap.ordem.forEach((i, k) => indiceDoTs.set(ap.tsUs[i], k));
  const dHist = new Float64Array(n);
  const dEstr = new Float64Array(n);
  const gramado = new Float64Array(n);
  const bordas = new Float64Array(n);
  const visto = new Uint8Array(n);
  const curtos = new Map();
  const passoCurto = Math.max(1, Math.round(fps / 5));
  const tela = new OffscreenCanvas(LARGURA, ALTURA);
  const ctx = tela.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  let anterior = null;
  let tamanho = null;
  const dentro = plano?.dentro ?? null;
  const precisa = plano?.precisa ?? null;
  const dec = new Decodificador(config, (quadro) => {
    const k = indiceDoTs.get(quadro.timestamp);
    if (k === undefined || (dentro && !dentro[k])) return; // pré-rolagem, ou fora dos trechos
    tamanho ??= [quadro.displayWidth, quadro.displayHeight];
    ctx.drawImage(quadro, 0, 0, LARGURA, ALTURA);
    const d = descrever(ctx.getImageData(0, 0, LARGURA, ALTURA).data);
    if (anterior) {
      dHist[k] = qui2(anterior.hist, d.hist);
      dEstr[k] = distanciaEstrutura(anterior.estrutura, d.estrutura);
    }
    gramado[k] = d.gramado;
    bordas[k] = d.bordas;
    visto[k] = 1;
    if (k % passoCurto === 0) curtos.set(k, d.histCurto);
    anterior = d;
  });
  const hash = new Sha256();
  const amostras = faixa.amostras;
  const sincronos = [];
  amostras.forEach((a, i) => a.sync && sincronos.push(i));
  let esperandoChave = true; // até o navegador aceitar o primeiro quadro-chave
  let emTrecho = false;
  let voltou = false; // já tentou voltar a um começo aceito neste trecho

  // Começo de trecho que o navegador recusa (um quadro I que não é IDR, marcado como chave): volta de
  // quadro-chave em quadro-chave até um que ele aceite e decodifica dali até o trecho. Os quadros de
  // antes do trecho só servem de base e não são descritos.
  const voltarAteUmComeco = async (j) => {
    let p = sincronos.indexOf(j);
    const limite = Math.max(0, p - VOLTAS_MAX);
    while (p > limite) {
      p -= 1;
      const s = sincronos[p];
      checarCancelamento(sinal);
      try {
        await dec.enviar(amostras[s], ap.tsUs[s], await leitor.ler(amostras[s].offset, amostras[s].tamanho));
      } catch (e) {
        if (e instanceof ChaveRecusada) continue;
        throw e;
      }
      const ler = leituraEmBlocos(leitor);
      for (let i = s + 1; i < j; i++) {
        if (i % 200 === 0) checarCancelamento(sinal);
        await dec.enviar(amostras[i], ap.tsUs[i], await ler(amostras[i].offset, amostras[i].tamanho));
      }
      return true;
    }
    return false;
  };
  const alimentar = async (a, j, dados) => {
    if (esperandoChave && !a.sync) return; // antes de um quadro-chave não há como decodificar
    try {
      await dec.enviar(a, ap.tsUs[j], dados);
    } catch (e) {
      if (!(e instanceof ChaveRecusada)) throw e;
      // não serve de começo. Sem trechos, os quadros-chave de antes já foram tentados: vale o próximo.
      // Num trecho, volta uma vez até um começo aceito; se não houver, também vale o próximo.
      if (!plano || voltou) return;
      voltou = true;
      if (!(await voltarAteUmComeco(j))) return;
      await dec.enviar(a, ap.tsUs[j], dados); // agora no meio da decodificação, que o navegador aceita
    }
    esperandoChave = false;
    emTrecho = true;
  };
  // fim de um trecho: entrega os quadros dele; o próximo recomeça num quadro-chave, e a diferença
  // entre quadros não atravessa o pedaço pulado
  const fecharTrecho = async () => {
    if (!emTrecho) return;
    emTrecho = false;
    await dec.esvaziar();
    anterior = null;
    esperandoChave = true;
    voltou = false;
  };
  let j = 0;
  let cauda = new Uint8Array(0);
  let caudaInicio = 0;
  try {
    for (let pos = 0; pos < leitor.tamanho; pos += BLOCO) {
      checarCancelamento(sinal);
      const bloco = await leitor.ler(pos, Math.min(BLOCO, leitor.tamanho - pos));
      hash.update(bloco);
      let janela = bloco;
      let janelaInicio = pos;
      if (cauda.length) {
        janela = new Uint8Array(cauda.length + bloco.length);
        janela.set(cauda, 0);
        janela.set(bloco, cauda.length);
        janelaInicio = caudaInicio;
      }
      const janelaFim = pos + bloco.length;
      while (j < amostras.length) {
        const a = amostras[j];
        if (precisa && !precisa[j]) {
          await fecharTrecho(); // fora dos trechos: nem lê a amostra
          j += 1;
          continue;
        }
        let dados;
        if (a.offset < janelaInicio) dados = await leitor.ler(a.offset, a.tamanho); // fora de ordem no arquivo
        else if (a.offset + a.tamanho <= janelaFim) dados = janela.subarray(a.offset - janelaInicio, a.offset - janelaInicio + a.tamanho);
        else break;
        await alimentar(a, j, dados);
        j += 1;
      }
      if (j < amostras.length && amostras[j].offset >= janelaInicio && amostras[j].offset < janelaFim) {
        cauda = janela.slice(amostras[j].offset - janelaInicio);
        caudaInicio = amostras[j].offset;
      } else {
        cauda = new Uint8Array(0);
        caudaInicio = janelaFim;
      }
      aoProgresso("lendo o vídeo", janelaFim / leitor.tamanho);
    }
    for (; j < amostras.length; j++) {
      const a = amostras[j];
      if (precisa && !precisa[j]) await fecharTrecho();
      else await alimentar(a, j, await leitor.ler(a.offset, a.tamanho));
    }
    await dec.esvaziar();
  } finally {
    dec.fechar();
  }
  // Quadros que o decodificador não entregou. Os do começo, antes do primeiro quadro-chave aceito,
  // não têm como ser decodificados; os do meio repetem o anterior (diferença zero). Os de fora dos
  // trechos nem foram lidos. Nenhum deles é sorteado.
  const conta = (k) => !dentro || dentro[k] === 1;
  let inicio = 0;
  while (inicio < n && !visto[inicio]) inicio += 1;
  if (inicio === n || !tamanho) throw new ErroVideo(`nenhum quadro pôde ser decodificado; ${DICA}`);
  let considerados = 0;
  let antes = 0;
  for (let k = 0; k < n; k++) {
    if (!conta(k)) continue;
    considerados += 1;
    if (k < inicio) antes += 1;
  }
  if (antes > considerados / 2) throw new ErroVideo(`o navegador só conseguiu decodificar a partir do quadro ${inicio} de ${n}; ${DICA}`);
  for (let k = 0; k < inicio; k++) {
    gramado[k] = gramado[inicio];
    bordas[k] = bordas[inicio];
  }
  let perdidos = 0;
  for (let k = inicio + 1; k < n; k++) {
    if (visto[k]) continue;
    if (conta(k)) perdidos += 1;
    gramado[k] = gramado[k - 1];
    bordas[k] = bordas[k - 1];
  }
  if (perdidos > Math.max(10, 0.02 * considerados)) {
    throw new ErroVideo(`${perdidos} de ${considerados} quadros não puderam ser decodificados; ${DICA}`);
  }
  // sem chave no início: só os quadros que contam (com trechos, os do começo do primeiro trecho)
  return { sha256: hash.hex(), dHist, dEstr, gramado, bordas, curtos, tamanho, visto, inicio, semChave: antes, perdidos };
}

/** Lê amostras em sequência aproveitando blocos grandes do arquivo, em vez de uma leitura por amostra. */
function leituraEmBlocos(leitor, bloco = 32 << 20) {
  let ini = 0;
  let buf = new Uint8Array(0);
  return async (offset, n) => {
    if (offset < ini || offset + n > ini + buf.length) {
      if (n >= bloco) return leitor.ler(offset, n);
      ini = offset;
      buf = await leitor.ler(offset, Math.min(bloco, leitor.tamanho - offset));
    }
    return buf.subarray(offset - ini, offset - ini + n);
  };
}

/** Início do grupo de quadros (GOP) de onde dá para decodificar a amostra `si` (ordem de decodificação). */
function inicioDoGrupo(amostras, sincronos, si) {
  let p = sincronos.length - 1;
  while (p > 0 && sincronos[p] > si) p -= 1;
  // quadros B do começo do grupo podem depender do grupo anterior: começa um grupo antes
  if (p > 0 && amostras[si].cts < amostras[sincronos[p]].cts) p -= 1;
  return p;
}

/**
 * Depois de voltar a um quadro-chave aceito, quantos grupos com alvos vão na mesma passada: os
 * seguintes enquanto cada um começa a até `pertoUs` do último alvo do anterior (voltar de novo
 * custaria mais que decodificar o meio); os de longe, como os de outro trecho, recomeçam no
 * quadro-chave deles. `grupos`: [{p, ultimo}] em ordem — `p` indexa `sincronos`, e `ultimo` é a
 * última amostra com alvo.
 */
export function gruposDaPassada(grupos, sincronos, tsUs, pertoUs = PERTO_US) {
  let fim = tsUs[grupos[0].ultimo];
  let n = 1;
  while (n < grupos.length && tsUs[sincronos[grupos[n].p]] - fim <= pertoUs) {
    fim = Math.max(fim, tsUs[grupos[n].ultimo]);
    n += 1;
  }
  return n;
}

/** 2ª passada: decodifica só os grupos que têm quadros sorteados e grava cada um em JPEG. */
async function extrair(leitor, faixa, ap, config, alvos, gravar, { aoProgresso, sinal, qualidade = 0.95 }) {
  const amostras = faixa.amostras;
  const sincronos = [];
  amostras.forEach((a, i) => a.sync && sincronos.push(i));
  const porGrupo = new Map();
  for (const alvo of alvos) {
    const si = ap.ordem[alvo.k];
    const p = inicioDoGrupo(amostras, sincronos, si);
    if (!porGrupo.has(p)) porGrupo.set(p, { ultimo: si, alvos: [] });
    const g = porGrupo.get(p);
    g.ultimo = Math.max(g.ultimo, si);
    g.alvos.push({ ...alvo, ts: ap.tsUs[si] });
  }
  const tamanhos = new Map();

  // decodifica de sincronos[p] até o fim do grupo do último alvo e grava os alvos em JPEG
  async function decodificar(p, grupos) {
    const doTs = new Map(grupos.flatMap((g) => g.alvos.map((a) => [a.ts, a])));
    const ultimo = Math.max(...grupos.map((g) => g.ultimo));
    const proximo = sincronos.find((s) => s > ultimo);
    const fim = proximo === undefined ? amostras.length : proximo;
    const pendentes = [];
    const dec = new Decodificador(config, (quadro) => {
      const alvo = doTs.get(quadro.timestamp);
      if (!alvo) return;
      const w = quadro.displayWidth;
      const h = quadro.displayHeight;
      const tela = new OffscreenCanvas(w, h);
      tela.getContext("2d").drawImage(quadro, 0, 0, w, h);
      tamanhos.set(alvo.quadro, [w, h]);
      pendentes.push(tela.convertToBlob({ type: "image/jpeg", quality: qualidade }).then((blob) => gravar(alvo.quadro, blob)));
      aoProgresso("extraindo os quadros sorteados", tamanhos.size / alvos.length);
    });
    const ler = leituraEmBlocos(leitor);
    try {
      for (let i = sincronos[p]; i < fim; i++) {
        checarCancelamento(sinal);
        if (i % 500 === 0) aoProgresso("extraindo os quadros sorteados", tamanhos.size / alvos.length); // trechos longos sem alvo
        const a = amostras[i];
        await dec.enviar(a, ap.tsUs[i], await ler(a.offset, a.tamanho));
        if (pendentes.length >= 4) await Promise.all(pendentes.splice(0)); // poucas imagens grandes na memória
      }
      await dec.esvaziar();
    } finally {
      dec.fechar();
    }
    await Promise.all(pendentes);
  }

  const ordem = [...porGrupo.keys()].sort((a, b) => a - b);
  const lista = ordem.map((p) => ({ p, ultimo: porGrupo.get(p).ultimo }));
  for (let gi = 0; gi < ordem.length; ) {
    let p = ordem[gi];
    let grupos = [porGrupo.get(p)];
    for (;;) {
      try {
        await decodificar(p, grupos);
        break;
      } catch (e) {
        if (!(e instanceof ChaveRecusada)) throw e;
        if (p === 0) break; // nem o começo do vídeo serve: esses alvos ficam de fora
        // o navegador não aceita começar aqui: começa um grupo antes e, para não voltar de novo a cada
        // grupo seguinte, segue na mesma passada pelos grupos próximos (os de longe, como os do outro
        // trecho, recomeçam no quadro-chave deles)
        p -= 1;
        const n = gruposDaPassada(lista.slice(gi), sincronos, ap.tsUs);
        grupos = ordem.slice(gi, gi + n).map((q) => porGrupo.get(q));
      }
    }
    gi += grupos.length;
  }
  return tamanhos;
}

/**
 * Importa um vídeo (File) para a pasta. `cadastro`: estádio (o nome, que entra no ID da partida),
 * emissora, competição, data e hora (ISO com fuso), mandante, visitante, iluminação, chuva e
 * observações. `pacote`: o molde do campo — o genérico, ou o de um estádio levantado. `trechos`:
 * [[início, fim], ...] em segundos, ou null para o vídeo inteiro.
 */
export async function importarVideo({
  pasta,
  arquivo,
  cadastro: dados,
  pacote = REF_PACOTE_GENERICO,
  trechos = null,
  alvo = PARAMETROS.alvo,
  aoProgresso = () => {},
  sinal = null,
}) {
  const t0 = performance.now();
  const ref = pacote;
  if (ref === REF_PACOTE_GENERICO) await pasta.garantirPacoteGenerico();
  else if (!(await pasta.existe(pasta.pacoteRef(ref)))) throw new Error(`não há o pacote ${ref} na pasta de trabalho`);
  await pasta.lerPacote(ref);
  const cadastro = { ...dados, pacote_versao: ref === REF_PACOTE_GENERICO ? null : partesPacote(ref)[1] };
  const pid = idPartida(cadastro.data_hora, cadastro.estadio, cadastro.mandante, cadastro.visitante);
  if (await pasta.existe(pasta.manifesto(pid))) throw new PartidaJaExiste(`a partida ${pid} já foi importada`);

  // confere o cadastro antes de ler o vídeo inteiro
  const provisorio = {
    formato: "manifesto.partida/1",
    partida: pid,
    pacote: ref,
    cadastro,
    video: { nome_original: arquivo.name, sha256: "0".repeat(64), bytes: arquivo.size, duracao_s: 0, fps: 1, largura: 1, altura: 1, n_quadros: 0 },
    pre_processamento: { ferramenta: VERSAO, criado_em: new Date().toISOString(), segundos: 0, parametros: {}, previsor: null },
  };
  validar("manifesto", provisorio);

  const marca = new MarcaDeImportacao(pasta, pid, arquivo);
  await marca.conferir();
  await marca.renovar(true);
  try {
    return await importarComMarca({ pasta, arquivo, cadastro, trechos, alvo, aoProgresso, sinal, t0, ref, pid, marca });
  } finally {
    await marca.tirar();
  }
}

async function importarComMarca({ pasta, arquivo, cadastro, trechos, alvo, aoProgresso: avisar, sinal, t0, ref, pid, marca }) {
  const aoProgresso = (etapa, frac) => {
    avisar(etapa, frac);
    marca.renovar().catch(() => {}); // no máximo uma vez por minuto; se falhar, tenta na próxima
  };
  aoProgresso("abrindo o vídeo", 0);
  const leitor = leitorDeArquivo(arquivo);
  const faixa = await abrirMp4(leitor);
  const ap = apresentacao(faixa);
  const n = ap.ordem.length;
  const config = await configuracaoDecodificador(faixa);
  const fps = estimarFps(ap.ptsMs);
  const params = { ...PARAMETROS, alvo: Math.max(1, Math.min(Math.round(alvo), 5000)) };
  const plano = trechos?.length ? planejarTrechos(trechos, faixa, ap) : null;
  if (plano && !plano.n_dentro) {
    throw new ErroVideo(`nenhum trecho cai dentro do vídeo, que tem ${formatarTempo(ap.ptsMs[n - 1] / 1000)}`);
  }

  const lido = await analisar(leitor, faixa, ap, config, fps, { aoProgresso, sinal, plano });
  // a leitura demora: outra pessoa pode ter importado a mesma partida enquanto isso
  const conferirQueNinguemImportou = async () => {
    if (await pasta.existe(pasta.manifesto(pid))) throw new PartidaJaExiste(`a partida ${pid} foi importada por outra pessoa enquanto este vídeo era lido`);
    await marca.conferir();
  };
  await conferirQueNinguemImportou();
  for (const outra of await pasta.listarPartidas()) {
    let sha = null;
    try {
      sha = (await pasta.lerManifesto(outra)).video.sha256;
    } catch {
      continue; // manifesto inválido de outra partida não impede esta importação
    }
    if (sha === lido.sha256) throw new PartidaJaExiste(`este vídeo já foi importado como ${outra}`);
  }

  aoProgresso("achando cortes e sorteando", 0);
  const { pts, fonte } = corrigirPts(ap.ptsMs, fps);
  const detectados = detectarCortes(lido.dHist, lido.dEstr);
  const graduais = detectarGraduais(lido.dHist, detectados);
  // os limites dos trechos também cortam: nenhuma tomada atravessa um pedaço que não foi lido
  const limites = (plano?.limites ?? []).filter((k) => k > 0 && k < n);
  const cortes = [...new Set([...detectados, ...limites])].sort((a, b) => a - b);
  const transicao = new Uint8Array(n);
  for (const [a, b] of graduais) transicao.fill(1, a, b);
  for (let k = 0; k < n; k++) if (!lido.visto[k]) transicao[k] = 1; // o que não foi decodificado não é sorteado
  const tomadas = montarTomadas(n, cortes);
  const aleatorio = new Aleatorio(pid);
  agrupar(tomadas, lido.curtos, lido.gramado, lido.bordas, aleatorio);
  const sorteados = sortear(tomadas, pts, transicao, params, aleatorio);
  aoProgresso("achando cortes e sorteando", 1);

  const tamanhos = await extrair(
    leitor,
    faixa,
    ap,
    config,
    sorteados.map((s) => ({ k: s.i, quadro: s.quadro })),
    async (quadro, blob) => {
      await conferirQueNinguemImportou(); // nunca troca as imagens de uma partida que já existe
      return pasta.escrever(pasta.quadro(pid, quadro), blob, { sobrescrever: true });
    },
    { aoProgresso, sinal },
  );
  // um quadro que não deu para extrair (o navegador recusou todos os começos possíveis) fica de fora
  const itens = sorteados.filter((s) => tamanhos.has(s.quadro));
  const naoExtraidos = sorteados.length - itens.length;
  if (naoExtraidos > Math.max(2, 0.05 * sorteados.length) || (sorteados.length && !itens.length)) {
    throw new ErroVideo(`${naoExtraidos} de ${sorteados.length} quadros sorteados não puderam ser extraídos; ${DICA}`);
  }
  const [largura, altura] = tamanhos.size ? [...tamanhos.values()][0] : lido.tamanho;

  aoProgresso("gravando a partida", 0);
  await conferirQueNinguemImportou();
  const agora = new Date().toISOString();
  await pasta.gravar(
    "tomadas",
    pasta.tomadas(pid),
    {
      formato: "tomadas.partida/1",
      partida: pid,
      cortes,
      transicoes: graduais,
      tomadas: tomadas.map((t, k) => ({
        id: k,
        i0: t.i0,
        i1: t.i1,
        inicio_ms: arredondarPar(pts[t.i0]),
        fim_ms: arredondarPar(pts[t.i1 - 1]),
        replay: null,
        zoom: t.zoom,
        grupo: t.grupo,
      })),
    },
    { sobrescrever: true },
  );
  await pasta.gravar(
    "fila",
    pasta.fila(pid),
    {
      formato: "fila.partida/1",
      partida: pid,
      criado_em: agora,
      equipe: [],
      itens: itens.map((s) => ({
        quadro: s.quadro,
        tomada: s.tomada,
        i: s.i,
        pts_ms: s.pts_ms,
        atribuido_a: [], // fila aberta: quem anota pega o próximo
        dupla: s.dupla,
        sem_previsao: s.sem_previsao,
      })),
    },
    { sobrescrever: true },
  );
  const segundos = (performance.now() - t0) / 1000;
  const parametros = Object.fromEntries(Object.entries(params).map(([k, v]) => [`sorteio_${k}`, v]));
  Object.assign(parametros, {
    pts: fonte,
    cortes: cortes.length,
    transicoes: graduais.length,
    vinheta: false,
    analise: `${LARGURA}x${ALTURA}`,
    codec: faixa.codec,
    decodificador: "webcodecs",
    quadros_perdidos: lido.perdidos,
    quadros_sem_chave_no_inicio: lido.semChave,
    quadros_nao_extraidos: naoExtraidos,
    amostras_alem_do_fim: faixa.cortadas,
  });
  if (plano) {
    parametros.trechos = trechos.map(([a, b]) => `${arredondar(a, 1)}-${arredondar(b, 1)}`).join(";");
    parametros.quadros_nos_trechos = plano.n_dentro;
  }
  await pasta.gravar("manifesto", pasta.manifesto(pid), {
    formato: "manifesto.partida/1",
    partida: pid,
    pacote: ref,
    cadastro,
    video: {
      nome_original: arquivo.name,
      sha256: lido.sha256,
      bytes: arquivo.size,
      duracao_s: arredondar((pts[n - 1] - pts[0]) / 1000 + 1 / fps, 3),
      fps,
      largura,
      altura,
      n_quadros: n,
    },
    pre_processamento: { ferramenta: VERSAO, criado_em: agora, segundos: arredondar(segundos, 2), parametros, previsor: null },
  });
  aoProgresso("pronto", 1);
  return {
    partida: pid,
    n_quadros_video: n,
    n_tomadas: tomadas.length,
    n_sorteados: itens.length,
    segundos,
    // com trechos: só o que foi lido
    n_nos_trechos: plano ? plano.n_dentro : null,
    n_tomadas_nos_trechos: plano ? tomadas.filter((t) => lido.visto.subarray(t.i0, t.i1).some(Boolean)).length : null,
  };
}
