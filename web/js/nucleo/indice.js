// Índice dos rótulos e revisões da pasta, com cache pela data de modificação e pelo tamanho.
//
// Não há banco de dados: a verdade são os arquivos na pasta sincronizada. O índice só evita reler o
// mesmo JSON a cada clique. Arquivos inválidos ficam em `invalidos` e não entram em nada.

import { PARTIDA_GABARITO, REF_PACOTE_GENERICO, RE_GABARITO } from "./convencoes.js";
import { validar } from "./formatos.js";
import { pacoteGenerico } from "./pacote.js";

const ms = (iso) => Date.parse(iso);

export class IndicePartida {
  constructor(partida) {
    this.partida = partida;
    this.rotulos = []; // [{caminho, nome, partida, quadro, pessoa, versao, dados}]
    this.revisoes = [];
    this.revisoesDe = new Map(); // nome do rótulo -> [revisão]
    this.invalidos = []; // [{caminho, erro}]
  }

  versoes(quadro, pessoa) {
    return this.rotulos.filter((a) => a.quadro === quadro && a.pessoa === pessoa).sort((a, b) => a.versao - b.versao);
  }

  /** Última versão de cada (quadro, pessoa), em Map com a chave "quadro|pessoa". */
  ultimos() {
    return this._ultimos(this.rotulos);
  }

  /** Como `ultimos`, mas só os rótulos da própria pessoa: sem as correções que ela fez revisando. */
  ultimosProprios() {
    return this._ultimos(this.rotulos.filter((a) => a.dados.corrige === null));
  }

  _ultimos(rotulos) {
    const out = new Map();
    for (const a of rotulos) {
      const k = `${a.quadro}|${a.pessoa}`;
      const atual = out.get(k);
      if (!atual || a.versao > atual.versao) out.set(k, a);
    }
    return out;
  }

  porQuadro() {
    const out = new Map();
    for (const a of this.rotulos) {
      if (!out.has(a.quadro)) out.set(a.quadro, []);
      out.get(a.quadro).push(a);
    }
    return out;
  }

  /** A revisão mais recente de um rótulo (pelo nome do arquivo), ou null. */
  ultimaRevisao(nomeRotulo) {
    const rs = this.revisoesDe.get(nomeRotulo) || [];
    let melhor = null;
    for (const r of rs) if (!melhor || ms(r.criado_em) > ms(melhor.criado_em)) melhor = r;
    return melhor;
  }
}

export class Indice {
  /** @param {import("./pasta.js").Pasta} pasta */
  constructor(pasta) {
    this.pasta = pasta;
    this._cache = new Map(); // caminho -> {assinatura, tipo, valor}
  }

  /** Lê e valida um arquivo; relê só quando ele muda. `arquivo` (File) evita uma consulta. */
  async ler(tipo, caminho, arquivo = null) {
    const f = arquivo ?? (await this.pasta.arquivo(caminho));
    if (!f) {
      const e = new Error(`arquivo não encontrado: ${caminho}`);
      e.name = "NotFoundError";
      throw e;
    }
    const assinatura = `${f.lastModified}|${f.size}`;
    const hit = this._cache.get(caminho);
    if (hit && hit.assinatura === assinatura && hit.tipo === tipo) return hit.valor;
    let obj;
    try {
      obj = JSON.parse(await f.text());
    } catch (e) {
      throw new Error(`JSON inválido (${e.message})`);
    }
    const valor = validar(tipo, obj);
    this._cache.set(caminho, { assinatura, tipo, valor });
    return valor;
  }

  /** Igual a `ler`, mas devolve null quando o arquivo não existe. */
  async lerSeExiste(tipo, caminho) {
    const f = await this.pasta.arquivo(caminho);
    return f ? this.ler(tipo, caminho, f) : null;
  }

  equipe() {
    return this.pasta.lerEquipe();
  }

  divisao() {
    return this.pasta.lerDivisao();
  }

  async pacote(ref) {
    if (ref === REF_PACOTE_GENERICO && !(await this.pasta.existe(this.pasta.pacoteRef(ref)))) {
      this._generico ??= validar("pacote", pacoteGenerico()); // pasta criada antes do campo genérico
      return this._generico;
    }
    return this.ler("pacote", this.pasta.pacoteRef(ref));
  }

  manifesto(partida) {
    return this.ler("manifesto", this.pasta.manifesto(partida));
  }

  fila(partida) {
    return this.ler("fila", this.pasta.fila(partida));
  }

  tomadas(partida) {
    return this.ler("tomadas", this.pasta.tomadas(partida));
  }

  previsao(partida, quadro) {
    return this.lerSeExiste("previsao", this.pasta.previsao(partida, quadro));
  }

  listarPartidas() {
    return this.pasta.listarPartidas();
  }

  /**
   * As partidas que dá para usar, com manifesto, fila, pacote e rótulos lidos. Uma partida
   * incompleta (a fila ainda sincronizando) ou com arquivo inválido vai para `problemas` e não trava
   * as outras.
   */
  async partidasProntas() {
    const prontas = [];
    const problemas = [];
    for (const partida of await this.listarPartidas()) {
      try {
        const manifesto = await this.manifesto(partida);
        const fila = await this.fila(partida);
        const pacote = await this.pacote(manifesto.pacote);
        prontas.push({ partida, manifesto, fila, pacote, ip: await this.partida(partida) });
      } catch (e) {
        problemas.push({ partida, erro: e.message || String(e) });
      }
    }
    return { prontas, problemas };
  }

  /** Itens do gabarito válidos, em ordem de ID. */
  async itensGabarito() {
    const out = [];
    for (const item of await this.pasta.listar("gabarito/itens")) {
      if (item.tipo !== "arquivo" || !item.nome.endsWith(".json") || !RE_GABARITO.test(item.nome.slice(0, -5))) continue;
      try {
        const g = await this.ler("gabarito", `gabarito/itens/${item.nome}`, await item.alca.getFile());
        if (g.id === item.nome.slice(0, -5)) out.push(g);
      } catch {
        // item inválido não entra (o `anotacao validar` mostra)
      }
    }
    return out;
  }

  /** Rótulos e revisões válidos da partida (ou do gabarito). */
  async partida(partida, tarefa = "camera") {
    const ip = new IndicePartida(partida);
    for (const a of await this.pasta.listarArquivos(this.pasta.rotulos(partida, tarefa))) {
      try {
        const dados = await this.ler("rotulo", a.caminho, await a.alca.getFile());
        if (dados.quadro !== a.quadro || dados.anotador !== a.pessoa || dados.versao !== a.versao || dados.partida !== partida) {
          throw new Error("o conteúdo não bate com o nome do arquivo");
        }
        ip.rotulos.push({ caminho: a.caminho, nome: a.nome, partida, quadro: a.quadro, pessoa: a.pessoa, versao: a.versao, dados });
      } catch (e) {
        ip.invalidos.push({ caminho: a.caminho, erro: e.message });
      }
    }
    if (partida === PARTIDA_GABARITO) return ip;
    for (const a of await this.pasta.listarArquivos(this.pasta.revisoes(partida, tarefa))) {
      try {
        const r = await this.ler("revisao", a.caminho, await a.alca.getFile());
        if (r.quadro !== a.quadro || r.revisor !== a.pessoa || r.versao !== a.versao || r.partida !== partida) {
          throw new Error("o conteúdo não bate com o nome do arquivo");
        }
        ip.revisoes.push({ caminho: a.caminho, nome: a.nome, partida, quadro: a.quadro, pessoa: a.pessoa, versao: a.versao, dados: r });
        if (!ip.revisoesDe.has(r.rotulo)) ip.revisoesDe.set(r.rotulo, []);
        ip.revisoesDe.get(r.rotulo).push(r);
      } catch (e) {
        ip.invalidos.push({ caminho: a.caminho, erro: e.message });
      }
    }
    return ip;
  }
}
