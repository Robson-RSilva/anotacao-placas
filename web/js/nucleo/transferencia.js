// Levar arquivos de uma pasta de trabalho para outra em .zip: para quem guarda no navegador (sem
// pasta sincronizada) mandar o que fez, e para quem coordena trazer de volta. Nada é sobrescrito.

import { RE_ARQUIVO, RE_DISPOSITIVO, RE_GABARITO, RE_LOTE, RE_MASCARA, RE_PARTIDA, RE_PESSOA, RE_QUADRO, RE_RECORTE, TAREFAS } from "./convencoes.js";
import { TIPOS_DA_TAREFA, tipoDoItem, validar } from "./formatos.js";
import { ArquivoExiste } from "./pasta.js";
import { ehPng } from "./png.js";
import { criarZip, lerZip } from "./zip.js";

const TOPO = new Set(["equipe.json", "divisao.json", "projeto.json", "partidas", "gabarito", "pessoas"]);

/** Um rótulo, uma revisão ou uma máscara numa pasta de tarefa (rotulos/<tarefa> ou revisoes/<tarefa>). */
function daTarefa(pasta, tarefa, nome, prefixo) {
  if (!TAREFAS.includes(tarefa) || !nome.startsWith(prefixo)) return null;
  if (RE_ARQUIVO.test(nome)) return pasta === "rotulos" ? TIPOS_DA_TAREFA[tarefa].rotulo : pasta === "revisoes" ? TIPOS_DA_TAREFA[tarefa].revisao : null;
  if (pasta === "rotulos" && tarefa === "placas" && RE_MASCARA.test(nome)) return "png";
  return null;
}

/** Um arquivo de `recortes/` da partida: um lote (`<lote>.json`) ou a imagem de um recorte. */
function daPastaDeRecortes(nome) {
  if (nome.endsWith(".json")) return RE_LOTE.test(nome.slice(0, -5)) ? "lote_recortes" : null;
  if (nome.endsWith(".jpg")) return RE_RECORTE.test(nome.slice(0, -4)) ? "jpg" : null;
  return null;
}

/**
 * Tipo de arquivo (formatos.js) pelo caminho; "jpg" e "png" para imagens e máscaras; null quando não é
 * da pasta de trabalho (ou é das tarefas das versões anteriores: câmera, oclusão, jogadores e pessoas).
 * Um item do gabarito é "gabarito" pelo caminho; o formato dentro dele diz a tarefa.
 */
export function tipoDoCaminho(caminho) {
  const p = caminho.split("/");
  if (p.length === 1) return { "equipe.json": "equipe", "divisao.json": "divisao", "projeto.json": "projeto" }[p[0]] ?? null;
  if (p[0] === "gabarito") {
    if (p.length === 3 && p[1] === "itens") {
      const m = /^(g\d{4})\.(json|jpg|png)$/.exec(p[2]);
      if (m && RE_GABARITO.test(m[1])) return { json: "gabarito", jpg: "jpg", png: "png" }[m[2]];
      return null;
    }
    if (p.length === 4 && p[1] === "rotulos") return daTarefa("rotulos", p[2], p[3], "g");
    return null;
  }
  if (p[0] === "pessoas") {
    return p.length === 3 && RE_PESSOA.test(p[1]) && p[2].endsWith(".json") && RE_DISPOSITIVO.test(p[2].slice(0, -5)) ? "dispositivo" : null;
  }
  if (p[0] === "partidas" && p.length >= 3 && RE_PARTIDA.test(p[1])) {
    if (p.length === 3) return { "manifesto.json": "manifesto", "fila.json": "fila", "tomadas.json": "tomadas" }[p[2]] ?? null;
    if (p.length === 4 && p[2] === "quadros") return /^t\d{10}\.jpg$/.test(p[3]) ? "jpg" : null;
    if (p.length === 4 && p[2] === "recortes") return daPastaDeRecortes(p[3]);
    if (p.length === 5 && p[2] === "previsoes") {
      if (p[3] === "pontos") return /^t\d{10}\.json$/.test(p[4]) && RE_QUADRO.test(p[4].slice(0, -5)) ? "previsao_pontos" : null;
      if (p[3] === "placas") return p[4].endsWith(".png") && RE_RECORTE.test(p[4].slice(0, -4)) ? "png" : null;
      return null;
    }
    if (p.length === 5 && (p[2] === "rotulos" || p[2] === "revisoes")) return daTarefa(p[2], p[3], p[4], "t");
  }
  return null;
}

/** Todos os arquivos da pasta de trabalho (caminhos relativos), recursivamente. */
export async function listarTudo(pasta, base = "") {
  const out = [];
  for (const item of await pasta.listar(base)) {
    if (item.nome.startsWith(".") || item.nome.endsWith(".crswap")) continue;
    const caminho = base ? `${base}/${item.nome}` : item.nome;
    if (item.tipo === "pasta") out.push(...(await listarTudo(pasta, caminho)));
    else out.push({ caminho, alca: item.alca });
  }
  return out;
}

/**
 * .zip com os arquivos da pasta de trabalho (os de `conjuntos/` ficam de fora). `filtro(caminho)`
 * escolhe quais (por exemplo, só os rótulos e revisões de uma pessoa).
 */
export async function exportarZip(pasta, filtro = () => true, aoProgresso = () => {}) {
  const todos = (await listarTudo(pasta)).filter((a) => tipoDoCaminho(a.caminho) && filtro(a.caminho));
  const entradas = [];
  for (const [k, a] of todos.entries()) {
    const f = await a.alca.getFile();
    entradas.push({ caminho: a.caminho, dados: f, data: new Date(f.lastModified) });
    aoProgresso((k + 1) / todos.length);
  }
  return { blob: await criarZip(entradas), n: entradas.length };
}

/** Os arquivos de uma pessoa: rótulos e revisões com o código dela no nome, e os registros do código. */
export function soDaPessoa(pessoa) {
  if (!RE_PESSOA.test(pessoa)) throw new Error(`código de pessoa inválido: ${pessoa}`);
  const re = new RegExp(`__${pessoa}__v\\d+\\.(json|png)$`); // rótulos, revisões e as máscaras ao lado
  return (caminho) => re.test(caminho) || caminho.startsWith(`pessoas/${pessoa}/`);
}

/** O arquivo da pasta tem exatamente estes bytes? */
async function mesmoConteudo(pasta, caminho, dados) {
  const f = await pasta.arquivo(caminho);
  if (!f || f.size !== dados.length) return false;
  const atual = new Uint8Array(await f.arrayBuffer());
  for (let i = 0; i < atual.length; i++) if (atual[i] !== dados[i]) return false;
  return true;
}

/**
 * Traz para a pasta os arquivos de um .zip. Aceita só arquivos da pasta de trabalho, valida os
 * JSON e nunca sobrescreve. Uma pasta-mãe única no .zip (ex.: "trabalho/") é ignorada.
 * Devolve {gravados, existentes, conflitos, recusados: [{caminho, motivo}]}: `conflitos` são os
 * arquivos que já existiam com outro conteúdo (ficou o que estava na pasta).
 */
export async function importarZip(pasta, blob, aoProgresso = () => {}) {
  const entradas = [];
  for await (const e of lerZip(blob)) {
    const p = e.caminho.split("/");
    if (p[0] === "__MACOSX" || p.some((s) => s.startsWith(".")) || e.caminho.endsWith(".crswap")) continue;
    entradas.push(e);
  }
  const primeiros = new Set(entradas.map((e) => e.caminho.split("/")[0]));
  const prefixo = primeiros.size === 1 && !TOPO.has([...primeiros][0]) && entradas.every((e) => e.caminho.includes("/"))
    ? `${[...primeiros][0]}/`
    : "";
  const out = { gravados: 0, existentes: 0, conflitos: [], recusados: [] };
  const decodificador = new TextDecoder();
  for (const [k, e] of entradas.entries()) {
    const caminho = e.caminho.slice(prefixo.length);
    const tipo = tipoDoCaminho(caminho);
    aoProgresso((k + 1) / entradas.length);
    if (!tipo) {
      out.recusados.push({ caminho, motivo: "não é um arquivo da pasta de trabalho" });
      continue;
    }
    try {
      if (tipo === "jpg") {
        if (!(e.dados[0] === 0xff && e.dados[1] === 0xd8)) throw new Error("não é um JPEG");
      } else if (tipo === "png") {
        if (!ehPng(e.dados)) throw new Error("não é um PNG");
      } else {
        const obj = JSON.parse(decodificador.decode(e.dados));
        if (tipo === "gabarito") {
          const doItem = tipoDoItem(obj);
          if (!doItem) throw new Error("item do gabarito de uma versão anterior (câmera, oclusão, jogadores ou pessoas): esta versão não usa");
          validar(doItem.tipo, obj);
        } else {
          validar(tipo, obj);
        }
      }
      await pasta.escrever(caminho, e.dados);
      out.gravados += 1;
    } catch (erro) {
      if (!(erro instanceof ArquivoExiste)) out.recusados.push({ caminho, motivo: erro.message });
      else if (await mesmoConteudo(pasta, caminho, e.dados)) out.existentes += 1;
      else out.conflitos.push(caminho); // por exemplo, a mesma pessoa anotou o quadro em dois computadores
    }
  }
  return out;
}
