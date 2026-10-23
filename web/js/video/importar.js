// Importar uma partida no navegador: tudo roda na máquina de quem importa e só os quadros
// sorteados vão para a pasta de trabalho.
//
// 1. leitura do vídeo (uma passada): hash do arquivo, relógio de cada quadro (PTS) e descritores
//    de quadros reduzidos, com o decodificador do navegador (WebCodecs);
// 2. cortes e transições (regras do laboratório), só para organizar o sorteio;
// 3. agrupamento das tomadas por aparência e zoom;
// 4. sorteio de 1 ou 2 quadros por tomada e distribuição na equipe;
// 5. extração dos quadros sorteados em JPEG, na resolução original;
// 6. tomadas, fila e manifesto — o manifesto por último: partida sem manifesto não existe.

import { Aleatorio } from "../nucleo/aleatorio.js";
import { VERSAO, arredondarPar, idPartida, refPacote } from "../nucleo/convencoes.js";
import { arredondar, mediana } from "../nucleo/estatistica.js";
import { comPapel, validar } from "../nucleo/formatos.js";
import { Sha256 } from "../nucleo/hash.js";
import { agrupar, corrigirPts, detectarCortes, detectarGraduais, montarTomadas } from "./cortes.js";
import { ALTURA, LARGURA, descrever, distanciaEstrutura, qui2 } from "./descritores.js";
import { ErroVideo, abrirMp4, apresentacao, leitorDeArquivo } from "./mp4.js";
import { PARAMETROS, atribuir, sortear } from "./sorteio.js";

export class PartidaJaExiste extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "PartidaJaExiste";
  }
}

const BLOCO = 8 << 20;
const FILA_MAX = 12;
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
    this.d.decode(new EncodedVideoChunk({ type: amostra.sync ? "key" : "delta", timestamp: ts, data: dados }));
  }

  async esvaziar() {
    if (this.erro) throw this.erro;
    await this.d.flush();
    if (this.erro) throw this.erro;
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
 * 1ª passada: lê o arquivo em ordem, faz o hash e decodifica todos os quadros, guardando só os
 * descritores dos quadros reduzidos.
 */
async function analisar(leitor, faixa, ap, config, fps, { aoProgresso, sinal }) {
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
  const dec = new Decodificador(config, (quadro) => {
    const k = indiceDoTs.get(quadro.timestamp);
    if (k === undefined) return; // pré-rolagem
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
        let dados;
        if (a.offset < janelaInicio) dados = await leitor.ler(a.offset, a.tamanho); // fora de ordem no arquivo
        else if (a.offset + a.tamanho <= janelaFim) dados = janela.subarray(a.offset - janelaInicio, a.offset - janelaInicio + a.tamanho);
        else break;
        await dec.enviar(a, ap.tsUs[j], dados);
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
      await dec.enviar(a, ap.tsUs[j], await leitor.ler(a.offset, a.tamanho));
    }
    await dec.esvaziar();
  } finally {
    dec.fechar();
  }
  // quadros que o decodificador não entregou: repetem o anterior (diferença zero)
  let perdidos = 0;
  for (let k = 0; k < n; k++) {
    if (visto[k]) continue;
    perdidos += 1;
    if (k > 0) {
      gramado[k] = gramado[k - 1];
      bordas[k] = bordas[k - 1];
    }
  }
  if (perdidos > Math.max(10, 0.02 * n)) throw new ErroVideo(`${perdidos} de ${n} quadros não puderam ser decodificados`);
  if (!tamanho) throw new ErroVideo("nenhum quadro pôde ser decodificado");
  return { sha256: hash.hex(), dHist, dEstr, gramado, bordas, curtos, tamanho, perdidos };
}

/** Início do grupo de quadros (GOP) de onde dá para decodificar a amostra `si` (ordem de decodificação). */
function inicioDoGrupo(amostras, sincronos, si) {
  let p = sincronos.length - 1;
  while (p > 0 && sincronos[p] > si) p -= 1;
  // quadros B do começo do grupo podem depender do grupo anterior: começa um grupo antes
  if (p > 0 && amostras[si].cts < amostras[sincronos[p]].cts) p -= 1;
  return p;
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
  let feitos = 0;
  const tamanhos = new Map();
  for (const p of [...porGrupo.keys()].sort((a, b) => a - b)) {
    checarCancelamento(sinal);
    const g = porGrupo.get(p);
    const doTs = new Map(g.alvos.map((a) => [a.ts, a]));
    const inicio = sincronos[p];
    const proximo = sincronos.find((s) => s > g.ultimo);
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
    });
    try {
      const de = amostras[inicio].offset;
      let ate = de;
      for (let i = inicio; i < fim; i++) ate = Math.max(ate, amostras[i].offset + amostras[i].tamanho);
      const corrido = ate - de <= 256 * 2 ** 20 ? await leitor.ler(de, ate - de) : null;
      for (let i = inicio; i < fim; i++) {
        const a = amostras[i];
        const dados = corrido && a.offset >= de ? corrido.subarray(a.offset - de, a.offset - de + a.tamanho) : await leitor.ler(a.offset, a.tamanho);
        await dec.enviar(a, ap.tsUs[i], dados);
      }
      await dec.esvaziar();
    } finally {
      dec.fechar();
    }
    await Promise.all(pendentes);
    feitos += g.alvos.length;
    aoProgresso("extraindo os quadros sorteados", feitos / alvos.length);
  }
  const faltando = alvos.filter((a) => !tamanhos.has(a.quadro));
  if (faltando.length) throw new ErroVideo(`${faltando.length} quadros sorteados não puderam ser extraídos (ex.: ${faltando[0].quadro})`);
  return tamanhos;
}

/**
 * Importa um vídeo (File) para a pasta. `cadastro`: estádio, versão do pacote, emissora, competição,
 * data e hora (ISO com fuso), mandante, visitante, iluminação, chuva e observações.
 */
export async function importarVideo({ pasta, arquivo, cadastro, alvo = PARAMETROS.alvo, aoProgresso = () => {}, sinal = null }) {
  const t0 = performance.now();
  const ref = refPacote(cadastro.estadio, cadastro.pacote_versao);
  if (!(await pasta.existe(pasta.pacoteRef(ref)))) throw new Error(`não há o pacote ${ref} na pasta de trabalho`);
  await pasta.lerPacote(ref);
  const pid = idPartida(cadastro.data_hora, cadastro.estadio, cadastro.mandante, cadastro.visitante);
  if (await pasta.existe(pasta.manifesto(pid))) throw new PartidaJaExiste(`a partida ${pid} já foi importada`);
  const equipe = await pasta.lerEquipe();
  const anotadores = comPapel(equipe, "anotador");
  if (!anotadores.length) throw new Error("a equipe não tem ninguém com o papel de anotador");

  // confere o cadastro antes de ler o vídeo inteiro
  const provisorio = {
    formato: "manifesto.partida/1",
    partida: pid,
    pacote: ref,
    cadastro: { ...cadastro },
    video: { nome_original: arquivo.name, sha256: "0".repeat(64), bytes: arquivo.size, duracao_s: 0, fps: 1, largura: 1, altura: 1, n_quadros: 0 },
    pre_processamento: { ferramenta: VERSAO, criado_em: new Date().toISOString(), segundos: 0, parametros: {}, previsor: null },
  };
  validar("manifesto", provisorio);

  aoProgresso("abrindo o vídeo", 0);
  const leitor = leitorDeArquivo(arquivo);
  const faixa = await abrirMp4(leitor);
  const ap = apresentacao(faixa);
  const n = ap.ordem.length;
  const config = await configuracaoDecodificador(faixa);
  const fps = estimarFps(ap.ptsMs);
  const params = { ...PARAMETROS, alvo: Math.max(1, Math.min(Math.round(alvo), 5000)) };

  const lido = await analisar(leitor, faixa, ap, config, fps, { aoProgresso, sinal });
  for (const outra of await pasta.listarPartidas()) {
    if ((await pasta.lerManifesto(outra)).video.sha256 === lido.sha256) throw new PartidaJaExiste(`este vídeo já foi importado como ${outra}`);
  }

  aoProgresso("achando cortes e sorteando", 0);
  const { pts, fonte } = corrigirPts(ap.ptsMs, fps);
  const cortes = detectarCortes(lido.dHist, lido.dEstr);
  const graduais = detectarGraduais(lido.dHist, cortes);
  const transicao = new Uint8Array(n);
  for (const [a, b] of graduais) transicao.fill(1, a, b);
  const tomadas = montarTomadas(n, cortes);
  const aleatorio = new Aleatorio(pid);
  agrupar(tomadas, lido.curtos, lido.gramado, lido.bordas, aleatorio);
  const sorteados = sortear(tomadas, pts, transicao, params, aleatorio);
  const atribuicoes = atribuir(sorteados, anotadores, new Aleatorio(`${pid}:equipe`));
  aoProgresso("achando cortes e sorteando", 1);

  const tamanhos = await extrair(
    leitor,
    faixa,
    ap,
    config,
    sorteados.map((s) => ({ k: s.i, quadro: s.quadro })),
    (quadro, blob) => pasta.escrever(pasta.quadro(pid, quadro), blob, { sobrescrever: true }),
    { aoProgresso, sinal },
  );
  const [largura, altura] = tamanhos.size ? [...tamanhos.values()][0] : lido.tamanho;

  aoProgresso("gravando a partida", 0);
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
      equipe: anotadores,
      itens: sorteados.map((s, k) => ({
        quadro: s.quadro,
        tomada: s.tomada,
        i: s.i,
        pts_ms: s.pts_ms,
        atribuido_a: atribuicoes[k],
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
  });
  await pasta.gravar("manifesto", pasta.manifesto(pid), {
    formato: "manifesto.partida/1",
    partida: pid,
    pacote: ref,
    cadastro: { ...cadastro },
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
  return { partida: pid, n_quadros_video: n, n_tomadas: tomadas.length, n_sorteados: sorteados.length, segundos };
}
