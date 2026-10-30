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
//     partidas/<partida>/
//       manifesto.json, tomadas.json, fila.json
//       quadros/<quadro>.jpg
//       previsoes/pontos/<quadro>.json      pontos de um modelo (opcional)
//       previsoes/pessoas/<quadro>.png      pré-pintura de um modelo (opcional)
//       rotulos/<tarefa>/<quadro>__<anotador>__v<n>.json   nas pessoas, com o .png da máscara ao lado
//       revisoes/<tarefa>/<quadro>__<revisor>__v<n>.json
//     gabarito/itens/<g1001>.json|.jpg (|.png nas pessoas), gabarito/rotulos/<tarefa>/...
//     pessoas/<codigo>/<dispositivo>.json   em que computadores cada código é usado
//     conjuntos/<data-hora>/            saída do unificar (Python)
//
// As tarefas são `pontos` e `pessoas`. As pastas das versões anteriores (rotulos/camera,
// rotulos/oclusao e estadios/, até a 0.7; rotulos/jogadores, da 0.8) ficam onde estão e não entram
// em nada.

import {
  PARTIDA_GABARITO,
  RE_DISPOSITIVO,
  RE_GABARITO,
  RE_PARTIDA,
  RE_PESSOA,
  RE_QUADRO,
  TAREFAS,
  lerNome,
  lerNomeMascara,
} from "./convencoes.js";
import { validar } from "./formatos.js";

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

  /** Registro de um código num navegador (um arquivo por computador: o Drive nunca entra em conflito). */
  dispositivo(codigo, dispositivo) {
    return `pessoas/${checar(RE_PESSOA, codigo, "código")}/${checar(RE_DISPOSITIVO, dispositivo, "dispositivo")}.json`;
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

  /** Os pontos de um modelo para o quadro, quando há. */
  previsaoPontos(partida, quadro) {
    return `${this.partida(partida)}/previsoes/pontos/${checar(RE_QUADRO, quadro, "quadro")}.json`;
  }

  /** A pré-pintura de um modelo para as pessoas (PNG: 1 onde há pessoa), quando há. */
  previsaoPessoas(partida, quadro) {
    return `${this.partida(partida)}/previsoes/pessoas/${checar(RE_QUADRO, quadro, "quadro")}.png`;
  }

  /** A máscara verdadeira de um item do gabarito das pessoas. */
  mascaraGabarito(id) {
    return `gabarito/itens/${checar(RE_GABARITO, id, "item do gabarito")}.png`;
  }

  rotulos(partida, tarefa) {
    if (!TAREFAS.includes(tarefa)) throw new Error(`tarefa desconhecida: ${tarefa}`);
    return `${this.partida(partida)}/rotulos/${tarefa}`;
  }

  revisoes(partida, tarefa) {
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
    for (const p of ["partidas", "gabarito/itens", "conjuntos"]) await this.diretorio(p, { criar: true });
    if (!(await this.existe(Pasta.EQUIPE))) await this.gravar("equipe", Pasta.EQUIPE, { formato: "equipe/1", membros: [] });
    if (!(await this.existe(Pasta.DIVISAO))) {
      await this.gravar("divisao", Pasta.DIVISAO, { formato: "divisao/1", validacao: [], teste_congelado: [], teste_externo: [] });
    }
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

  /**
   * A versão seguinte à maior da pessoa no quadro. Conta também as máscaras das pessoas sem rótulo
   * (uma gravação interrompida entre a máscara e o rótulo): o nome nunca se repete.
   */
  async proximaVersao(diretorio, quadro, pessoa) {
    let maior = 0;
    for (const item of await this.listar(diretorio)) {
      const a = item.tipo === "arquivo" ? lerNome(item.nome) ?? lerNomeMascara(item.nome) : null;
      if (a && a.quadro === quadro && a.pessoa === pessoa) maior = Math.max(maior, a.versao);
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

  /** Os navegadores em que o código já foi usado: [{dispositivo, criado_em}] (os registros inválidos ficam de fora). */
  async dispositivosDoCodigo(codigo) {
    const out = [];
    for (const item of await this.listar(`pessoas/${checar(RE_PESSOA, codigo, "código")}`)) {
      const id = item.nome.slice(0, -5);
      if (item.tipo !== "arquivo" || !item.nome.endsWith(".json") || !RE_DISPOSITIVO.test(id)) continue;
      try {
        const d = await this.ler("dispositivo", `pessoas/${codigo}/${item.nome}`);
        if (d.codigo === codigo && d.dispositivo === id) out.push(d);
      } catch {
        // registro quebrado (ou ainda sincronizando): não conta
      }
    }
    return out;
  }

  /** Registra que o código é usado neste navegador (uma vez; o arquivo nunca muda depois). */
  async registrarDispositivo(codigo, dispositivo, agora = new Date()) {
    const caminho = this.dispositivo(codigo, dispositivo);
    if (await this.existe(caminho)) return false;
    await this.gravar("dispositivo", caminho, { formato: "pessoa.dispositivo/1", codigo, dispositivo, criado_em: agora.toISOString() });
    return true;
  }

  async lerDivisao() {
    return (await this.existe(Pasta.DIVISAO))
      ? this.ler("divisao", Pasta.DIVISAO)
      : { formato: "divisao/1", validacao: [], teste_congelado: [], teste_externo: [] };
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
