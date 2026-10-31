// Apoio aos testes do JavaScript no Node: uma pasta em memória com a mesma interface da
// File System Access API, os esquemas carregados do disco e uma pasta de trabalho de exemplo.

import { readFileSync } from "node:fs";

import { carregarEsquemas } from "../../web/js/nucleo/formatos.js";
import { Indice } from "../../web/js/nucleo/indice.js";
import { Pasta } from "../../web/js/nucleo/pasta.js";
import { codificarPng } from "../../web/js/nucleo/png.js";

export const WEB = new URL("../../web/", import.meta.url);
export const FIXTURES = new URL("../fixtures/", import.meta.url);

export const lerJson = (url) => JSON.parse(readFileSync(url, "utf-8"));

let relogio = 1_700_000_000_000;

class ErroDom extends Error {
  constructor(name, mensagem) {
    super(mensagem);
    this.name = name;
  }
}

export class ArquivoMemoria {
  constructor(name) {
    this.kind = "file";
    this.name = name;
    this.conteudo = new Uint8Array(0);
    this.modificado = ++relogio;
  }

  async getFile() {
    return new File([this.conteudo], this.name, { lastModified: this.modificado });
  }

  async createWritable() {
    const partes = [];
    return {
      write: async (d) => {
        if (typeof d === "string") partes.push(new TextEncoder().encode(d));
        else if (d instanceof Blob) partes.push(new Uint8Array(await d.arrayBuffer()));
        else if (d instanceof ArrayBuffer) partes.push(new Uint8Array(d));
        else partes.push(new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
      },
      close: async () => {
        const total = partes.reduce((s, p) => s + p.length, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const p of partes) {
          out.set(p, o);
          o += p.length;
        }
        this.conteudo = out;
        this.modificado = ++relogio;
      },
      abort: async () => {},
    };
  }
}

export class PastaMemoria {
  constructor(name = "trabalho") {
    this.kind = "directory";
    this.name = name;
    this.filhos = new Map();
  }

  async getDirectoryHandle(nome, { create = false } = {}) {
    const f = this.filhos.get(nome);
    if (f) {
      if (f.kind !== "directory") throw new ErroDom("TypeMismatchError", nome);
      return f;
    }
    if (!create) throw new ErroDom("NotFoundError", nome);
    const d = new PastaMemoria(nome);
    this.filhos.set(nome, d);
    return d;
  }

  async getFileHandle(nome, { create = false } = {}) {
    const f = this.filhos.get(nome);
    if (f) {
      if (f.kind !== "file") throw new ErroDom("TypeMismatchError", nome);
      return f;
    }
    if (!create) throw new ErroDom("NotFoundError", nome);
    const a = new ArquivoMemoria(nome);
    this.filhos.set(nome, a);
    return a;
  }

  async *entries() {
    for (const par of [...this.filhos.entries()]) yield par;
  }

  async removeEntry(nome, { recursive = false } = {}) {
    const f = this.filhos.get(nome);
    if (!f) throw new ErroDom("NotFoundError", nome);
    if (f.kind === "directory" && f.filhos.size && !recursive) throw new ErroDom("InvalidModificationError", nome);
    this.filhos.delete(nome);
  }

  async queryPermission() {
    return "granted";
  }

  async requestPermission() {
    return "granted";
  }
}

/** Carrega os esquemas de web/esquemas (uma vez). */
export async function esquemas() {
  await carregarEsquemas(async (nome) => lerJson(new URL(`esquemas/${nome}`, WEB)));
}

export const AGORA = new Date("2026-11-03T15:00:00Z");
export const minutos = (m) => new Date(AGORA.getTime() + m * 60_000);
export const PARTIDA = "2026-11-02_estadio-sintetico_time-a-time-b";
export const W = 640;
export const H = 360;

const EQUIPE = [
  { codigo: "A01", nome: "Anotador 1", papeis: ["anotador", "revisor"] },
  { codigo: "A02", nome: "Anotador 2", papeis: ["anotador", "revisor"] },
];

/** Pasta de trabalho de exemplo em memória, com nomes para A01 e A02. */
export async function pastaExemplo({ membros = EQUIPE } = {}) {
  await esquemas();
  const pasta = new Pasta(new PastaMemoria());
  await pasta.criar();
  await pasta.gravar("equipe", "equipe.json", { formato: "equipe/1", membros }, { sobrescrever: true });
  return { pasta, indice: new Indice(pasta) };
}

/** Uma partida importada (manifesto, tomadas e fila aberta), sem imagens: `itens` são {quadro, tomada, dupla, ...}. */
export async function criarPartida(pasta, itens, { partida = PARTIDA, largura = W, altura = H, pacote = undefined } = {}) {
  const fila = {
    formato: "fila.partida/1",
    partida,
    criado_em: AGORA.toISOString(),
    equipe: [],
    itens: itens.map((it, k) => ({
      quadro: it.quadro ?? `t${String(1000 * (k + 1)).padStart(10, "0")}`,
      tomada: it.tomada ?? 0,
      i: it.i ?? k,
      pts_ms: it.pts_ms ?? 1000 * (k + 1),
      atribuido_a: it.atribuido_a ?? [], // fila aberta (as da 0.2 atribuíam a pessoas)
      dupla: it.dupla ?? false,
      sem_previsao: it.sem_previsao ?? false,
    })),
  };
  await pasta.gravar("tomadas", pasta.tomadas(partida), {
    formato: "tomadas.partida/1",
    partida,
    cortes: [],
    transicoes: [],
    tomadas: [{ id: 0, i0: 0, i1: 100, inicio_ms: 0, fim_ms: 4000, replay: null, zoom: "aberto", grupo: 0 }],
  });
  await pasta.gravar("fila", pasta.fila(partida), fila);
  await pasta.gravar("manifesto", pasta.manifesto(partida), {
    formato: "manifesto.partida/1",
    partida,
    ...(pacote ? { pacote } : {}), // as importadas até a 0.7 têm o pacote do estádio
    cadastro: {
      estadio: "estadio-sintetico",
      emissora: "Emissora X",
      competicao: "Estadual",
      data_hora: "2026-11-02T16:00:00-03:00",
      mandante: "Time A",
      visitante: "Time B",
      iluminacao: "dia",
      chuva: false,
      observacoes: "",
    },
    video: { nome_original: "jogo.mp4", sha256: "0".repeat(64), bytes: 1000, duracao_s: 4, fps: 25, largura, altura, n_quadros: 100 },
    pre_processamento: { ferramenta: "0.10.0", criado_em: AGORA.toISOString(), segundos: 1, parametros: {}, previsor: null },
  });
  return fila;
}

/** O tamanho dos recortes de exemplo e a região da placa neles (a placa com 8 px em volta). */
export const RW = 64;
export const RH = 48;
export const REGIAO = Object.freeze([[8, 8], [56, 8], [56, 40], [8, 40]]);

/**
 * Um lote de recortes na partida (sem as imagens): `itens` são {recorte, dupla, sem_previsao, ...}; o
 * recorte k é `t<1000(k+1)>_p<k>` se não vier. Devolve o lote.
 */
export async function criarRecortes(pasta, itens, { partida = PARTIDA, lote = "r1" } = {}) {
  const l = {
    formato: "recortes.lote/1",
    partida,
    lote,
    criado_em: AGORA.toISOString(),
    origem: "simulador",
    gerador: "testes",
    itens: itens.map((it, k) => ({
      recorte: it.recorte ?? `t${String(1000 * (k + 1)).padStart(10, "0")}_p${k}`,
      largura: it.largura ?? RW,
      altura: it.altura ?? RH,
      regiao: it.regiao ?? REGIAO.map((p) => [...p]),
      placa: REGIAO.map((p) => [...p]),
      no_quadro: REGIAO.map(([x, y]) => [100 + 2 * x, 50 + 2 * y]),
      dupla: it.dupla ?? false,
      sem_previsao: it.sem_previsao ?? false,
    })),
  };
  await pasta.gravar("lote_recortes", pasta.loteRecortes(partida, lote), l);
  return l;
}

/** Os pontos verdadeiros de exemplo de um item: alguns pontos do campo em lugares diferentes. */
export function pontosVerdadeiros(k = 0) {
  return [
    { ponto: "centro", x: 320 + k, y: 180, visivel: true },
    { ponto: "meio_cab", x: 330 + k, y: 340, visivel: true },
    { ponto: "meio_opo", x: 300 + k, y: 40, visivel: true },
    { ponto: "circ_meio_cab", x: 325 + k, y: 230, visivel: true },
    { ponto: "circ_meio_opo", x: 315 + k, y: 130, visivel: true },
    { ponto: "ga_esq_frente_cab", x: 60 + k, y: 300, visivel: false },
  ];
}

/** Itens do gabarito dos pontos (sem imagem): g1001, g1002… */
export async function criarGabaritoPontos(pasta, n = 12, { lote = "P1-treino", primeiro = 1001, foraDe = [] } = {}) {
  const itens = {};
  for (let k = 0; k < n; k++) {
    const id = `g${primeiro + k}`;
    itens[id] = { formato: "gabarito.pontos/1", id, lote, imagem: `${id}.jpg`, largura: W, altura: H, pontos: pontosVerdadeiros(k), origem: foraDe.length ? "arbitrado" : "simulador", observacao: "", fora_de: foraDe };
    await pasta.gravar("gabarito_pontos", pasta.itemGabarito(id), itens[id]);
  }
  return itens;
}

/** A máscara verdadeira de exemplo: três coisas na frente da placa (1 e 2: jogadores; 3: a trave), dentro da região. */
export function mascaraVerdadeira(w = RW, h = RH) {
  const m = new Uint8Array(w * h);
  const ret = (x0, y0, x1, y1, v) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = v;
  };
  ret(10, 10, 18, 30, 1);
  ret(30, 12, 36, 28, 2);
  ret(48, 20, 54, 34, 3);
  return m;
}

/**
 * Itens do gabarito das placas com a máscara verdadeira: g4001, g4002… (64 x 48, a região da placa com 8 px
 * em volta). `descartar`: os índices dos itens cuja resposta é descartar (o recorte não está na placa).
 */
export async function criarGabaritoPlacas(pasta, n = 6, { lote = "PL1-treino", primeiro = 4001, descartar = [] } = {}) {
  const itens = {};
  for (let k = 0; k < n; k++) {
    const id = `g${primeiro + k}`;
    const fora = descartar.includes(k);
    itens[id] = {
      formato: "gabarito.placas/1",
      id,
      lote,
      imagem: `${id}.jpg`,
      mascara: fora ? null : `${id}.png`,
      largura: RW,
      altura: RH,
      regiao: REGIAO.map((p) => [...p]),
      oclusores: fora ? 0 : 3,
      resposta: fora ? "descartar" : "pintar",
      origem: "simulador",
      observacao: "",
    };
    if (!fora) await pasta.escrever(pasta.mascaraGabarito(id), await codificarPng(mascaraVerdadeira(), RW, RH, Array.from({ length: 256 }, (_, v) => [v, v, v])));
    await pasta.gravar("gabarito_placas", pasta.itemGabarito(id), itens[id]);
  }
  return itens;
}

const COMUM = (partida, campo, quadro, pessoa, versao, m, manual, largura, altura) => ({
  partida,
  [campo]: quadro,
  anotador: pessoa,
  versao,
  ferramenta: "0.10.0",
  manual,
  criado_em: minutos(m).toISOString(),
  segundos_ativos: 20,
  largura,
  altura,
  partiu_de: { fonte: "nenhuma", versao: null, referencia: null },
});

/** Grava um rótulo de pontos direto na pasta (sem passar pela tela); `pontos` null é a imagem descartada. */
export async function gravarPontos(pasta, { partida = PARTIDA, quadro, pessoa, pontos = [], versao = 1, m = 0, largura = W, altura = H, ...extra }) {
  const r = {
    formato: "rotulo.pontos/1",
    ...COMUM(partida, "quadro", quadro, pessoa, versao, m, "pontos-0.1", largura, altura),
    pontos: pontos ?? [],
    situacao: pontos ? "ok" : "descartada",
    motivo_descarte: pontos ? null : "transicao",
    comentario: "",
    corrige: null,
    ...extra,
  };
  const nome = `${quadro}__${pessoa}__v${versao}.json`;
  await pasta.gravar("rotulo_pontos", `${pasta.rotulos(partida, "pontos")}/${nome}`, r);
  return nome;
}

/**
 * Grava um rótulo das placas (a máscara e o rótulo); `quadro` é o recorte; `mascara` null é o recorte
 * descartado (com `motivo`).
 */
export async function gravarPlacas(pasta, { partida = PARTIDA, quadro, pessoa, mascara = null, versao = 1, m = 0, largura = RW, altura = RH, motivo = "borrao", ...extra }) {
  const nome = `${quadro}__${pessoa}__v${versao}.json`;
  const dir = pasta.rotulos(partida, "placas");
  let pixels = 0;
  if (mascara) {
    await pasta.escrever(`${dir}/${nome.replace(/\.json$/, ".png")}`, await codificarPng(mascara, largura, altura, [[0, 0, 0], [255, 64, 129]]));
    pixels = mascara.reduce((s, v) => s + (v ? 1 : 0), 0);
  }
  const r = {
    formato: "rotulo.placas/1",
    ...COMUM(partida, "recorte", quadro, pessoa, versao, m, "placas-0.1", largura, altura),
    mascara: mascara ? nome.replace(/\.json$/, ".png") : null,
    pixels,
    situacao: mascara ? "ok" : "descartada",
    motivo_descarte: mascara ? null : motivo,
    comentario: "",
    corrige: null,
    ...extra,
  };
  await pasta.gravar("rotulo_placas", `${dir}/${nome}`, r);
  return nome;
}

/** Grava uma revisão direto na pasta (`quadro` é o item: nas placas, o recorte). */
export async function gravarRevisao(pasta, { tarefa = "pontos", partida = PARTIDA, quadro, rotulo, revisor, decisao = "aprovar", versao = 1, m = 0, ...extra }) {
  const r = {
    formato: `revisao.${tarefa}/1`,
    partida,
    [tarefa === "pontos" ? "quadro" : "recorte"]: quadro,
    rotulo,
    revisor,
    versao,
    decisao,
    motivo: decisao === "devolver" ? (tarefa === "pontos" ? "ponto_fora_do_lugar" : "faltou_pintar") : null,
    comentario: "",
    nova_versao: null,
    ferramenta: "0.10.0",
    manual: "revisao-0.4",
    criado_em: minutos(m).toISOString(),
    segundos_ativos: 4,
    ...extra,
  };
  await pasta.gravar(`revisao_${tarefa}`, `${pasta.revisoes(partida, tarefa)}/${quadro}__${revisor}__v${versao}.json`, r);
}
