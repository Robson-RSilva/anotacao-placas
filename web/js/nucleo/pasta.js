// Pasta de trabalho: layout, nomes de arquivo e escrita segura — espelho de src/anotacao/pasta.py,
// sobre a File System Access API (a pasta que a pessoa escolhe, sincronizada com o Drive, ou o
// armazenamento do próprio navegador). Regras que evitam conflito na sincronização (ADR-0002):
//
// * um arquivo por pessoa e por versão (`<quadro>__<pessoa>__v<n>.json`);
// * escrita atômica: `createWritable` grava num temporário e só troca o arquivo ao fechar;
// * um arquivo que já existe nunca é sobrescrito, a não ser quando quem chama pede.
//
//   trabalho/
//     equipe.json (opcional: nomes), divisao.json, projeto.json (opcional: nome e link do Manual)
//     estadios/<estadio>/pacote-<versao>/pacote.json      generico/pacote-1.0: o campo genérico
//     partidas/<partida>/
//       manifesto.json, tomadas.json, fila.json
//       quadros/<quadro>.jpg
//       previsoes/<quadro>.json
//       rotulos/<tarefa>/<quadro>__<anotador>__v<n>.json
//       revisoes/<tarefa>/<quadro>__<revisor>__v<n>.json
//     gabarito/itens/<g0001>.json|.jpg, gabarito/rotulos/<tarefa>/...
//     conjuntos/<data-hora>/            saída do unificar (Python)

import {
  PARTIDA_GABARITO,
  REF_PACOTE_GENERICO,
  RE_ESTADIO,
  RE_GABARITO,
  RE_PARTIDA,
  RE_QUADRO,
  RE_VERSAO_PACOTE,
  TAREFAS,
  lerNome,
  partesPacote,
} from "./convencoes.js";
import { validar } from "./formatos.js";
import { pacoteGenerico } from "./pacote.js";

export class ArquivoExiste extends Error {
  constructor(caminho) {
    super(`o arquivo já existe: ${caminho}`);
    this.name = "ArquivoExiste";
    this.caminho = caminho;
  }
}

function checar(regex, valor, oque) {
  if (typeof valor !== "string" || !regex.test(valor)) throw new Error(`${oque} inválido: ${valor}`);
  return valor;
}

/** "a/b/c.json" -> ["a", "b", "c.json"], recusando "..", "." e partes vazias. */
export function partes(caminho) {
  const p = String(caminho).split("/");
  for (const s of p) {
    if (!s || s === "." || s === ".." || s.includes("\\") || s.includes("\0")) throw new Error(`caminho inválido: ${caminho}`);
  }
  return p;
}

const naoAchou = (e) => e && (e.name === "NotFoundError" || e.name === "TypeMismatchError");

/** Executa `fn` com uma trava exclusiva entre as abas deste navegador (quando há Web Locks). */
async function comTrava(nome, fn) {
  const travas = globalThis.navigator?.locks;
  if (travas?.request) return travas.request(nome, fn);
  return fn();
}

export class Pasta {
  /** @param {FileSystemDirectoryHandle} raiz */
  constructor(raiz) {
    this.raiz = raiz;
    this.nome = raiz.name || "pasta";
  }

  // ------------------------------------------------------------------ layout
  static EQUIPE = "equipe.json";
  static DIVISAO = "divisao.json";
  static PROJETO = "projeto.json";

  pacote(estadio, versao) {
    checar(RE_ESTADIO, estadio, "estádio");
    checar(RE_VERSAO_PACOTE, versao, "versão do pacote");
    return `estadios/${estadio}/pacote-${versao}/pacote.json`;
  }

  pacoteRef(ref) {
    const [estadio, versao] = partesPacote(ref);
    return this.pacote(estadio, versao);
  }

  partida(partida) {
    if (partida === PARTIDA_GABARITO) return "gabarito";
    return `partidas/${checar(RE_PARTIDA, partida, "partida")}`;
  }

  manifesto(partida) {
    return `${this.partida(partida)}/manifesto.json`;
  }

  tomadas(partida) {
    return `${this.partida(partida)}/tomadas.json`;
  }

  fila(partida) {
    return `${this.partida(partida)}/fila.json`;
  }

  /** Marca de importação em andamento (some quando a importação termina). */
  importando(partida) {
    return `${this.partida(partida)}/importando.json`;
  }

  quadros(partida) {
    return partida === PARTIDA_GABARITO ? "gabarito/itens" : `${this.partida(partida)}/quadros`;
  }

  quadro(partida, quadro) {
    const regex = partida === PARTIDA_GABARITO ? RE_GABARITO : RE_QUADRO;
    return `${this.quadros(partida)}/${checar(regex, quadro, "quadro")}.jpg`;
  }

  itemGabarito(id) {
    return `gabarito/itens/${checar(RE_GABARITO, id, "item do gabarito")}.json`;
  }

  previsao(partida, quadro) {
    return `${this.partida(partida)}/previsoes/${checar(RE_QUADRO, quadro, "quadro")}.json`;
  }

  rotulos(partida, tarefa = "camera") {
    if (!TAREFAS.includes(tarefa)) throw new Error(`tarefa desconhecida: ${tarefa}`);
    return `${this.partida(partida)}/rotulos/${tarefa}`;
  }

  revisoes(partida, tarefa = "camera") {
    if (!TAREFAS.includes(tarefa)) throw new Error(`tarefa desconhecida: ${tarefa}`);
    return `${this.partida(partida)}/revisoes/${tarefa}`;
  }

  // ------------------------------------------------------------------ operações básicas
  /** Alça da pasta no caminho (null se não existe e `criar` é falso). */
  async diretorio(caminho, { criar = false } = {}) {
    let d = this.raiz;
    if (!caminho) return d;
    for (const p of partes(caminho)) {
      try {
        d = await d.getDirectoryHandle(p, { create: criar });
      } catch (e) {
        if (naoAchou(e)) return null;
        throw e;
      }
    }
    return d;
  }

  async _alcaArquivo(caminho, { criar = false } = {}) {
    const p = partes(caminho);
    const dir = await this.diretorio(p.slice(0, -1).join("/"), { criar });
    if (!dir) return null;
    try {
      return await dir.getFileHandle(p[p.length - 1], { create: criar });
    } catch (e) {
      if (naoAchou(e)) return null;
      throw e;
    }
  }

  /** O arquivo (File, com lastModified e size) ou null. */
  /**
   * O arquivo (File), ou null. Um arquivo vazio conta como ausente: é uma escrita interrompida (o
   * navegador cria o arquivo antes de gravar o conteúdo) ou que o Drive ainda está sincronizando.
   */
  async arquivo(caminho) {
    const h = await this._alcaArquivo(caminho);
    if (!h) return null;
    const f = await h.getFile();
    return f.size ? f : null;
  }

  async existe(caminho) {
    return (await this.arquivo(caminho)) !== null;
  }

  async lerTexto(caminho) {
    const f = await this.arquivo(caminho);
    if (!f) {
      const e = new Error(`arquivo não encontrado: ${caminho}`);
      e.name = "NotFoundError";
      throw e;
    }
    return f.text();
  }

  async lerJson(caminho) {
    const texto = await this.lerTexto(caminho);
    try {
      return JSON.parse(texto);
    } catch (e) {
      throw new Error(`${caminho}: JSON inválido (${e.message})`);
    }
  }

  /** Lê e valida um arquivo de um tipo (ver formatos.js). */
  async ler(tipo, caminho) {
    return validar(tipo, await this.lerJson(caminho));
  }

  /** Itens de uma pasta: [{nome, tipo: "arquivo" | "pasta", alca}], em ordem de nome. */
  async listar(caminho) {
    const d = await this.diretorio(caminho);
    if (!d) return [];
    const out = [];
    for await (const [nome, alca] of d.entries()) {
      out.push({ nome, tipo: alca.kind === "directory" ? "pasta" : "arquivo", alca });
    }
    return out.sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
  }

  /** Grava bytes, texto ou Blob. Sem `sobrescrever`, recusa um arquivo que já existe (ArquivoExiste). */
  async escrever(caminho, dados, { sobrescrever = false } = {}) {
    return comTrava(`anotacao:${this.nome}`, async () => {
      const existia = await this.existe(caminho);
      if (existia && !sobrescrever) throw new ArquivoExiste(caminho);
      const h = await this._alcaArquivo(caminho, { criar: true });
      let w = null;
      try {
        w = await h.createWritable(); // grava num temporário; o arquivo só muda no close()
        await w.write(dados);
        await w.close();
      } catch (e) {
        await w?.abort?.().catch(() => {});
        if (!existia) await this.apagar(caminho).catch(() => {}); // não deixa um arquivo vazio para trás
        throw e;
      }
      return caminho;
    });
  }

  async escreverJson(caminho, obj, opcoes = {}) {
    return this.escrever(caminho, `${JSON.stringify(obj, null, 2)}\n`, opcoes);
  }

  /** Valida e grava um arquivo de um tipo. */
  async gravar(tipo, caminho, obj, opcoes = {}) {
    return this.escreverJson(caminho, validar(tipo, obj), opcoes);
  }

  /** Apaga um arquivo (só para arquivos da própria ferramenta, como uma importação interrompida). */
  async apagar(caminho, { recursivo = false } = {}) {
    const p = partes(caminho);
    const dir = await this.diretorio(p.slice(0, -1).join("/"));
    if (!dir) return false;
    try {
      await dir.removeEntry(p[p.length - 1], { recursive: recursivo });
      return true;
    } catch (e) {
      if (naoAchou(e)) return false;
      throw e;
    }
  }

  // ------------------------------------------------------------------ criação
  /** Pastas básicas e equipe/divisão vazias, sem mexer no que já existe. */
  async criar() {
    for (const p of ["estadios", "partidas", "gabarito/itens", "conjuntos"]) await this.diretorio(p, { criar: true });
    if (!(await this.existe(Pasta.EQUIPE))) await this.gravar("equipe", Pasta.EQUIPE, { formato: "equipe/1", membros: [] });
    if (!(await this.existe(Pasta.DIVISAO))) {
      await this.gravar("divisao", Pasta.DIVISAO, { formato: "divisao/1", validacao: [], teste_congelado: [], teste_externo: [] });
    }
    await this.garantirPacoteGenerico();
  }

  /** O campo genérico na pasta (para o Python e para quem abrir a pasta saber o molde usado). */
  async garantirPacoteGenerico() {
    const caminho = this.pacoteRef(REF_PACOTE_GENERICO);
    if (!(await this.existe(caminho))) await this.gravar("pacote", caminho, pacoteGenerico(), { sobrescrever: true });
  }

  /** É uma pasta de trabalho? (tem equipe.json) */
  async ehPastaDeTrabalho() {
    return this.existe(Pasta.EQUIPE);
  }

  // ------------------------------------------------------------------ listas
  /** Partidas completas (com manifesto), da mais antiga para a mais nova. */
  async listarPartidas() {
    const out = [];
    for (const item of await this.listar("partidas")) {
      if (item.tipo !== "pasta" || !RE_PARTIDA.test(item.nome)) continue;
      try {
        const manifesto = await (await item.alca.getFileHandle("manifesto.json")).getFile();
        if (manifesto.size) out.push(item.nome); // vazio: importação interrompida ou ainda sincronizando
      } catch (e) {
        if (!naoAchou(e)) throw e;
      }
    }
    return out.sort();
  }

  async listarPacotes() {
    const refs = [];
    for (const e of await this.listar("estadios")) {
      if (e.tipo !== "pasta" || !RE_ESTADIO.test(e.nome)) continue;
      for (const v of await this.listar(`estadios/${e.nome}`)) {
        const versao = v.nome.startsWith("pacote-") ? v.nome.slice(7) : "";
        if (v.tipo === "pasta" && RE_VERSAO_PACOTE.test(versao) && (await this.existe(`estadios/${e.nome}/${v.nome}/pacote.json`))) {
          refs.push(`${e.nome}/pacote-${versao}`);
        }
      }
    }
    return refs.sort();
  }

  /** Arquivos de rótulo ou revisão de uma pasta: [{caminho, nome, quadro, pessoa, versao, alca}]. */
  async listarArquivos(diretorio) {
    const out = [];
    for (const item of await this.listar(diretorio)) {
      if (item.tipo !== "arquivo") continue;
      const r = lerNome(item.nome);
      if (r) out.push({ caminho: `${diretorio}/${item.nome}`, nome: item.nome, ...r, alca: item.alca });
    }
    return out;
  }

  async proximaVersao(diretorio, quadro, pessoa) {
    let maior = 0;
    for (const a of await this.listarArquivos(diretorio)) {
      if (a.quadro === quadro && a.pessoa === pessoa) maior = Math.max(maior, a.versao);
    }
    return maior + 1;
  }

  // ------------------------------------------------------------------ leitura tipada
  async lerEquipe() {
    return (await this.existe(Pasta.EQUIPE)) ? this.ler("equipe", Pasta.EQUIPE) : { formato: "equipe/1", membros: [] };
  }

  async lerProjeto() {
    return (await this.existe(Pasta.PROJETO)) ? this.ler("projeto", Pasta.PROJETO) : { formato: "projeto/1", nome: "", manual_url: "" };
  }

  async lerDivisao() {
    return (await this.existe(Pasta.DIVISAO))
      ? this.ler("divisao", Pasta.DIVISAO)
      : { formato: "divisao/1", validacao: [], teste_congelado: [], teste_externo: [] };
  }

  async lerPacote(ref) {
    if (ref === REF_PACOTE_GENERICO && !(await this.existe(this.pacoteRef(ref)))) return validar("pacote", pacoteGenerico());
    return this.ler("pacote", this.pacoteRef(ref));
  }

  async lerManifesto(partida) {
    return this.ler("manifesto", this.manifesto(partida));
  }

  async lerFila(partida) {
    return this.ler("fila", this.fila(partida));
  }

  async lerTomadas(partida) {
    return this.ler("tomadas", this.tomadas(partida));
  }
}
