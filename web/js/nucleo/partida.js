// A página de uma partida: o que ela tem (quadros, recortes, rótulos, revisões, arquivos), a situação de
// cada item, e excluir — um quadro, recortes, um lote de recortes ou a partida inteira.
//
// Excluir apaga de verdade (no Drive, os arquivos vão para a lixeira dele). Um quadro sai da fila e leva
// junto o que saiu dele: os rótulos e revisões dos pontos, a previsão e os recortes das placas tirados
// dele. Um recorte sai do lote (o lote que fica vazio sai inteiro) e leva a pintura, as revisões e a
// pré-pintura. A fila e os lotes são reescritos; o resto são arquivos de cada pessoa, que só se apagam.

import { lerNome, lerNomeMascara } from "./convencoes.js";
import { aprovado, quemAnotou } from "./filas.js";
import { tipoDoCaminho } from "./transferencia.js";

/** O que se mostra da situação de um item. */
export const ESTADOS = Object.freeze({
  sem_rotulo: "sem rótulo",
  esperando: "esperando revisão",
  devolvido: "devolvido",
  aprovado: "aprovado",
  descartado: "descartado",
});

const ms = (iso) => Date.parse(iso);

/** Uma importação desta partida em andamento (a marca renovada há menos de 10 minutos). */
export class ImportacaoEmAndamento extends Error {
  constructor() {
    super("esta partida está sendo importada agora: espere a importação terminar");
    this.name = "ImportacaoEmAndamento";
  }
}

/**
 * Tudo o que a página mostra de uma partida, lido de uma vez: {partida, manifesto, tomadas, fila, lotes
 * (Map lote -> lote), recortes (Map recorte -> {lote, item}), ip: {pontos, placas}, erros}. O que não
 * dá para ler vai para `erros` ([{oque, erro}]) sem parar o resto: a página ainda mostra os arquivos e
 * deixa excluir.
 */
export async function carregarPartida(indice, partida) {
  const out = { partida, manifesto: null, tomadas: null, fila: null, lotes: new Map(), recortes: new Map(), ip: { pontos: null, placas: null }, erros: [] };
  const tentar = async (oque, f) => {
    try {
      return await f();
    } catch (e) {
      out.erros.push({ oque, erro: e.message || String(e) });
      return null;
    }
  };
  out.manifesto = await tentar("manifesto.json", () => indice.manifesto(partida));
  out.tomadas = await tentar("tomadas.json", () => indice.tomadas(partida));
  out.fila = await tentar("fila.json", () => indice.fila(partida));
  const rec = await tentar("recortes", () => indice.recortes(partida));
  if (rec) {
    out.recortes = rec.itens;
    for (const { lote } of rec.itens.values()) out.lotes.set(lote, (out.lotes.get(lote) ?? 0) + 1);
    for (const inv of rec.invalidos) out.erros.push({ oque: inv.caminho, erro: inv.erro });
  }
  for (const tarefa of ["pontos", "placas"]) {
    const ip = await tentar(`rótulos (${tarefa})`, () => indice.partida(partida, tarefa));
    out.ip[tarefa] = ip;
    for (const inv of ip?.invalidos ?? []) out.erros.push({ oque: inv.caminho, erro: inv.erro });
  }
  return out;
}

/**
 * A situação de um item (o quadro nos pontos, o recorte nas placas): {estado (uma chave de ESTADOS),
 * aprovado ({a, revisor, decisao, quando} ou null), rotulos (todas as versões, da mais antiga para a mais
 * nova), pessoas (os códigos de quem anotou ou corrigiu), falta (nos itens em dupla, quantas pessoas
 * ainda faltam)}.
 */
export function situacaoDoItem(ip, quadro, item = null) {
  const rotulos = (ip?.rotulos ?? []).filter((a) => a.quadro === quadro).sort((x, y) => ms(x.dados.criado_em) - ms(y.dados.criado_em));
  const ap = ip ? aprovado(ip, quadro) : null;
  const ultimos = new Map();
  for (const a of rotulos) if (a.dados.corrige === null && (!ultimos.has(a.pessoa) || a.versao > ultimos.get(a.pessoa).versao)) ultimos.set(a.pessoa, a);
  let estado;
  if (ap) estado = ap.a.dados.situacao === "descartada" ? "descartado" : "aprovado";
  else if (!rotulos.length) estado = "sem_rotulo";
  else if ([...ultimos.values()].some((a) => ip.ultimaRevisao(a.nome)?.decisao === "devolver") && ![...ultimos.values()].some((a) => !ip.ultimaRevisao(a.nome))) estado = "devolvido";
  else estado = "esperando";
  const falta = item?.dupla && ip ? Math.max(0, 2 - quemAnotou(ip, quadro).size) : 0;
  return { estado, aprovado: ap, rotulos, pessoas: [...new Set(rotulos.map((a) => a.pessoa))].sort(), falta };
}

/** Os recortes que saíram dos quadros (o recorte é `<quadro>_<placa>`). */
export function recortesDosQuadros(recortes, quadros) {
  const qs = new Set(quadros);
  return [...recortes.keys()].filter((r) => qs.has(r.split("_", 1)[0]));
}

/**
 * O que sai junto ao excluir itens de uma tarefa (para a página confirmar antes): {itens, rotulos,
 * revisoes, recortes} — nos pontos, `recortes` são os das placas tirados dos quadros, contados com os
 * rótulos e revisões deles.
 */
export function oQueSaiJunto(dados, tarefa, itens) {
  const conta = (ip, ids) => {
    const s = new Set(ids);
    return {
      rotulos: (ip?.rotulos ?? []).filter((a) => s.has(a.quadro)).length,
      revisoes: (ip?.revisoes ?? []).filter((r) => s.has(r.quadro)).length,
    };
  };
  if (tarefa === "placas") return { itens: itens.length, ...conta(dados.ip.placas, itens), recortes: 0 };
  const recortes = recortesDosQuadros(dados.recortes, itens);
  const p = conta(dados.ip.pontos, itens);
  const r = conta(dados.ip.placas, recortes);
  return { itens: itens.length, rotulos: p.rotulos + r.rotulos, revisoes: p.revisoes + r.revisoes, recortes: recortes.length };
}

/** Falha se a partida está sendo importada agora (alguém pode estar gravando os quadros dela). */
async function conferirImportacao(pasta, partida, agora = Date.now()) {
  try {
    const marca = await pasta.lerJson(pasta.importando(partida));
    if (agora - Date.parse(marca.atualizado_em) < 10 * 60_000) throw new ImportacaoEmAndamento();
  } catch (e) {
    if (e instanceof ImportacaoEmAndamento) throw e;
    // sem marca (ou ilegível, de uma importação interrompida): segue
  }
}

/** Apaga, numa pasta de rótulos ou revisões, os arquivos dos itens (e as máscaras ao lado). Conta os JSON. */
async function apagarDosItens(pasta, dir, itens) {
  let n = 0;
  for (const e of await pasta.listar(dir)) {
    if (e.tipo !== "arquivo") continue;
    const a = lerNome(e.nome) ?? lerNomeMascara(e.nome);
    if (!a || !itens.has(a.quadro)) continue;
    await pasta.apagar(`${dir}/${e.nome}`);
    if (e.nome.endsWith(".json")) n += 1;
  }
  return n;
}

/**
 * Exclui recortes da partida: tira dos lotes (o lote vazio sai inteiro) e apaga a imagem, a pintura de
 * cada pessoa (rótulo e máscara), as revisões e a pré-pintura. Devolve {recortes, rotulos, revisoes,
 * lotes_apagados}.
 */
export async function excluirRecortes(pasta, partida, recortes) {
  const ids = new Set(recortes);
  const out = { recortes: 0, rotulos: 0, revisoes: 0, lotes_apagados: 0 };
  if (!ids.size) return out;
  await conferirImportacao(pasta, partida);
  const tirados = new Set();
  for (const l of await pasta.listarLotes(partida)) {
    let lote;
    try {
      lote = await pasta.ler("lote_recortes", l.caminho);
    } catch {
      continue; // lote inválido (ou sincronizando): fica como está — o `anotacao validar` mostra
    }
    const itens = lote.itens.filter((it) => !ids.has(it.recorte));
    if (itens.length === lote.itens.length) continue;
    for (const it of lote.itens) if (ids.has(it.recorte)) tirados.add(it.recorte);
    if (itens.length) {
      await pasta.gravar("lote_recortes", l.caminho, { ...lote, itens }, { sobrescrever: true });
    } else {
      await pasta.apagar(l.caminho);
      out.lotes_apagados += 1;
    }
  }
  for (const r of ids) {
    if (await pasta.apagar(pasta.recorte(partida, r))) tirados.add(r);
    await pasta.apagar(pasta.previsaoPlacas(partida, r));
  }
  out.recortes = tirados.size;
  out.rotulos = await apagarDosItens(pasta, pasta.rotulos(partida, "placas"), ids);
  out.revisoes = await apagarDosItens(pasta, pasta.revisoes(partida, "placas"), ids);
  return out;
}

/** Exclui um lote de recortes inteiro (os recortes dele, com tudo o que tinham). */
export async function excluirLote(pasta, partida, lote) {
  const l = await pasta.ler("lote_recortes", pasta.loteRecortes(partida, lote));
  const r = await excluirRecortes(pasta, partida, l.itens.map((it) => it.recorte));
  await pasta.apagar(pasta.loteRecortes(partida, lote)); // se ainda sobrou (um recorte repetido em outro lote)
  return r;
}

/**
 * Exclui quadros da partida: tira da fila (ninguém pega mais) e apaga a imagem, os rótulos e revisões
 * dos pontos, a previsão e os recortes das placas tirados deles. Devolve {quadros, rotulos, revisoes,
 * recortes}: as contagens dos pontos, e `recortes` com as dos recortes.
 */
export async function excluirQuadros(pasta, partida, quadros) {
  const qs = new Set(quadros);
  const out = { quadros: 0, rotulos: 0, revisoes: 0, recortes: null };
  if (!qs.size) return out;
  await conferirImportacao(pasta, partida);
  const fila = await pasta.lerFila(partida);
  const itens = fila.itens.filter((it) => !qs.has(it.quadro));
  if (itens.length !== fila.itens.length) await pasta.gravar("fila", pasta.fila(partida), { ...fila, itens }, { sobrescrever: true });
  out.quadros = fila.itens.length - itens.length;
  const doLote = [];
  for (const l of await pasta.listarLotes(partida)) {
    try {
      const lote = await pasta.ler("lote_recortes", l.caminho);
      for (const it of lote.itens) if (qs.has(it.recorte.split("_", 1)[0])) doLote.push(it.recorte);
    } catch {
      // lote inválido: fica como está
    }
  }
  out.recortes = await excluirRecortes(pasta, partida, doLote);
  for (const q of qs) {
    await pasta.apagar(pasta.quadro(partida, q));
    await pasta.apagar(pasta.previsaoPontos(partida, q));
  }
  out.rotulos = await apagarDosItens(pasta, pasta.rotulos(partida, "pontos"), qs);
  out.revisoes = await apagarDosItens(pasta, pasta.revisoes(partida, "pontos"), qs);
  return out;
}

/** Exclui a partida inteira: a pasta dela, com tudo o que tem. */
export async function excluirPartida(pasta, partida) {
  await conferirImportacao(pasta, partida);
  return pasta.apagar(pasta.partida(partida), { recursivo: true });
}

/**
 * Os arquivos da partida, recursivamente: [{caminho, relativo (a partir da pasta da partida), bytes,
 * modificado (ms), tipo (o de tipoDoCaminho, ou null para um arquivo que a pasta de trabalho não usa)}],
 * em ordem de caminho.
 */
export async function arquivosDaPartida(pasta, partida) {
  const base = pasta.partida(partida);
  const out = [];
  const visitar = async (dir) => {
    for (const e of await pasta.listar(dir)) {
      const caminho = `${dir}/${e.nome}`;
      if (e.tipo === "pasta") {
        await visitar(caminho);
        continue;
      }
      const f = await e.alca.getFile();
      out.push({ caminho, relativo: caminho.slice(base.length + 1), bytes: f.size, modificado: f.lastModified, tipo: tipoDoCaminho(caminho), alca: e.alca });
    }
  };
  await visitar(base);
  return out.sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
}
