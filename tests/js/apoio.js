// Apoio aos testes do JavaScript no Node: uma pasta em memória com a mesma interface da
// File System Access API, os esquemas carregados do disco e uma pasta de trabalho de exemplo.

import { readFileSync } from "node:fs";

import { Camera } from "../../web/js/nucleo/camera.js";
import { carregarEsquemas } from "../../web/js/nucleo/formatos.js";
import { Indice } from "../../web/js/nucleo/indice.js";
import { Pasta } from "../../web/js/nucleo/pasta.js";

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
export const PACOTE = () => lerJson(new URL("exemplo/pacote.json", WEB));
export const REF_PACOTE = "estadio-sintetico/pacote-1.0";
export const PARTIDA = "2026-11-02_estadio-sintetico_time-a-time-b";

/** Pasta de trabalho de exemplo em memória: equipe A01/A02 (anotam e revisam) e o pacote sintético. */
export async function pastaExemplo({ membros = null } = {}) {
  await esquemas();
  const pasta = new Pasta(new PastaMemoria());
  await pasta.criar();
  await pasta.gravar("equipe", "equipe.json", membros ? { formato: "equipe/1", membros } : lerJson(new URL("exemplo/equipe.json", WEB)), {
    sobrescrever: true,
  });
  await pasta.gravar("pacote", pasta.pacote("estadio-sintetico", "1.0"), PACOTE());
  return { pasta, indice: new Indice(pasta) };
}

/** Uma partida importada (manifesto, tomadas e fila aberta), sem imagens: `itens` são {quadro, tomada, dupla, ...}. */
export async function criarPartida(pasta, itens, { partida = PARTIDA, largura = 640, altura = 360 } = {}) {
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
    pacote: REF_PACOTE,
    cadastro: {
      estadio: "estadio-sintetico",
      pacote_versao: "1.0",
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
    pre_processamento: { ferramenta: "0.2.0", criado_em: AGORA.toISOString(), segundos: 1, parametros: {}, previsor: null },
  });
  return fila;
}

/** Câmera verdadeira de exemplo, olhando para `alvo` da posição da câmera principal. */
export function cameraExemplo(alvo = [-8, 0, 0], hfov = 38, w = 640, h = 360) {
  const T = PACOTE().cameras[0].T;
  return Camera.olharPara(T, alvo, hfov, w, h);
}

/** Itens do gabarito (sem imagem) com câmeras conhecidas. */
export async function criarGabarito(pasta, n = 14, w = 640, h = 360) {
  const cams = {};
  for (let k = 0; k < n; k++) {
    const cam = cameraExemplo([-25 + 4 * k, 3, 0], 30, w, h);
    const id = `g${String(k + 1).padStart(4, "0")}`;
    await pasta.gravar("gabarito", pasta.itemGabarito(id), {
      formato: "gabarito.camera/1",
      id,
      pacote: REF_PACOTE,
      imagem: `${id}.jpg`,
      largura: w,
      altura: h,
      camera: cam.paraRotulo(),
      origem: "simulador",
      observacao: "",
    });
    cams[id] = cam;
  }
  return cams;
}

/** Grava um rótulo direto na pasta (sem passar pela tela). */
export async function gravarRotulo(pasta, { partida = PARTIDA, quadro, pessoa, cam = null, versao = 1, m = 0, ...extra }) {
  const r = {
    formato: "rotulo.camera/1",
    partida,
    pacote: REF_PACOTE,
    quadro,
    anotador: pessoa,
    versao,
    ferramenta: "0.2.0",
    manual: "camera-0.1",
    criado_em: minutos(m).toISOString(),
    segundos_ativos: 20,
    partiu_de: { fonte: "registro", versao: null, referencia: null },
    camera: cam ? cam.paraRotulo() : null,
    lado: cam ? (Math.sin(Math.PI / 4) * cam.C[0] - Math.cos(Math.PI / 4) * cam.C[1] >= 0 ? "canonico" : "espelhado") : null,
    pontos_travados: [],
    linhas_travadas: [],
    situacao: cam ? "ok" : "sem_marcacoes",
    comentario: "",
    residuo_mediano_px: null,
    corrige: null,
    ...extra,
  };
  const nome = `${quadro}__${pessoa}__v${versao}.json`;
  await pasta.gravar("rotulo", `${pasta.rotulos(partida)}/${nome}`, r);
  return nome;
}

/** Grava uma revisão direto na pasta. */
export async function gravarRevisao(pasta, { partida = PARTIDA, quadro, rotulo, revisor, decisao = "aprovar", versao = 1, m = 0, ...extra }) {
  const r = {
    formato: "revisao.camera/1",
    partida,
    quadro,
    rotulo,
    revisor,
    versao,
    decisao,
    motivo: decisao === "devolver" ? "lado_trocado" : null,
    comentario: "",
    nova_versao: null,
    ferramenta: "0.2.0",
    manual: "revisao-0.1",
    criado_em: minutos(m).toISOString(),
    segundos_ativos: 4,
    ...extra,
  };
  await pasta.gravar("revisao", `${pasta.revisoes(partida)}/${quadro}__${revisor}__v${versao}.json`, r);
}
