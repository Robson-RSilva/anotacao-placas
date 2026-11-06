// A página da partida: a situação de cada item, o que sai junto, excluir quadros, recortes, um lote e a
// partida inteira, e a lista de arquivos.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ImportacaoEmAndamento,
  arquivosDaPartida,
  carregarPartida,
  excluirLote,
  excluirPartida,
  excluirQuadros,
  excluirRecortes,
  oQueSaiJunto,
  situacaoDoItem,
} from "../../web/js/nucleo/partida.js";
import { PARTIDA, criarPartida, criarRecortes, gravarPlacas, gravarPontos, gravarRevisao, mascaraVerdadeira, pastaExemplo } from "./apoio.js";

const quadro = (k) => `t${String(1000 * (k + 1)).padStart(10, "0")}`;
const P = [{ ponto: "centro", x: 320, y: 180 }];

async function cenario() {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{ dupla: true }, {}, {}, {}, {}]);
  const q = [0, 1, 2, 3, 4].map(quadro);
  for (const x of q) await pasta.escrever(pasta.quadro(PARTIDA, x), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  // q0: dupla com um rótulo só; q1: aprovado; q2: devolvido; q3: aprovado e descartado; q4: sem rótulo
  await gravarPontos(pasta, { quadro: q[0], pessoa: "A01", pontos: P });
  const b = await gravarPontos(pasta, { quadro: q[1], pessoa: "A01", pontos: P });
  await gravarRevisao(pasta, { quadro: q[1], rotulo: b, revisor: "A02", m: 2 });
  const c = await gravarPontos(pasta, { quadro: q[2], pessoa: "A02", pontos: P });
  await gravarRevisao(pasta, { quadro: q[2], rotulo: c, revisor: "A01", decisao: "devolver", m: 3 });
  const d = await gravarPontos(pasta, { quadro: q[3], pessoa: "A01", pontos: null });
  await gravarRevisao(pasta, { quadro: q[3], rotulo: d, revisor: "A02", m: 4 });
  await pasta.escreverJson(pasta.previsaoPontos(PARTIDA, q[1]), { formato: "previsao.pontos/1", partida: PARTIDA, quadro: q[1], fonte: "m", versao: "1", pontos: [] });
  // recortes: dois de q1 (lote r1) e um de q2 (lote r2)
  const r = [`${q[1]}_p1`, `${q[1]}_p2`, `${q[2]}_p1`];
  await criarRecortes(pasta, [{ recorte: r[0] }, { recorte: r[1] }], { lote: "r1" });
  await criarRecortes(pasta, [{ recorte: r[2] }], { lote: "r2" });
  for (const x of r) await pasta.escrever(pasta.recorte(PARTIDA, x), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  const pr = await gravarPlacas(pasta, { quadro: r[0], pessoa: "A01", mascara: mascaraVerdadeira().map((v) => (v ? 1 : 0)) });
  await gravarRevisao(pasta, { tarefa: "placas", quadro: r[0], rotulo: pr, revisor: "A02", m: 5 });
  await gravarPlacas(pasta, { quadro: r[2], pessoa: "A02", mascara: null });
  return { pasta, indice, q, r };
}

test("a situação de cada item e o que sai junto ao excluir", async () => {
  const { indice, q, r } = await cenario();
  const dados = await carregarPartida(indice, PARTIDA);
  assert.deepEqual(dados.erros, []);
  assert.equal(dados.fila.itens.length, 5);
  assert.deepEqual([...dados.lotes], [["r1", 2], ["r2", 1]]);
  const s = (x) => situacaoDoItem(dados.ip.pontos, x, dados.fila.itens.find((it) => it.quadro === x));
  assert.deepEqual([s(q[0]).estado, s(q[0]).falta, s(q[0]).pessoas], ["esperando", 1, ["A01"]]);
  assert.deepEqual([s(q[1]).estado, s(q[1]).aprovado.revisor], ["aprovado", "A02"]);
  assert.equal(s(q[2]).estado, "devolvido");
  assert.equal(s(q[3]).estado, "descartado");
  assert.deepEqual([s(q[4]).estado, s(q[4]).rotulos], ["sem_rotulo", []]);
  assert.equal(situacaoDoItem(dados.ip.placas, r[0]).estado, "aprovado");
  assert.equal(situacaoDoItem(dados.ip.placas, r[1]).estado, "sem_rotulo");
  // excluir q1 e q2: os rótulos e revisões deles e os 3 recortes (com uma pintura revisada e uma descartada)
  assert.deepEqual(oQueSaiJunto(dados, "pontos", [q[1], q[2]]), { itens: 2, rotulos: 4, revisoes: 3, recortes: 3 });
  assert.deepEqual(oQueSaiJunto(dados, "placas", [r[0]]), { itens: 1, rotulos: 1, revisoes: 1, recortes: 0 });
});

test("excluir quadros: saem da fila, com a imagem, os rótulos, as revisões, a previsão e os recortes deles", async () => {
  const { pasta, indice, q, r } = await cenario();
  const res = await excluirQuadros(pasta, PARTIDA, [q[1], q[2]]);
  assert.deepEqual(res, { quadros: 2, rotulos: 2, revisoes: 2, recortes: { recortes: 3, rotulos: 2, revisoes: 1, lotes_apagados: 2 } });
  const fila = await pasta.lerFila(PARTIDA);
  assert.deepEqual(fila.itens.map((it) => it.quadro), [q[0], q[3], q[4]]);
  for (const x of [q[1], q[2]]) assert.equal(await pasta.existe(pasta.quadro(PARTIDA, x)), false);
  assert.equal(await pasta.existe(pasta.quadro(PARTIDA, q[0])), true);
  assert.equal(await pasta.existe(pasta.previsaoPontos(PARTIDA, q[1])), false);
  const nomes = async (d) => (await pasta.listar(d)).map((e) => e.nome);
  assert.deepEqual(await nomes(pasta.rotulos(PARTIDA, "pontos")), [`${q[0]}__A01__v1.json`, `${q[3]}__A01__v1.json`]);
  assert.deepEqual(await nomes(pasta.revisoes(PARTIDA, "pontos")), [`${q[3]}__A02__v1.json`]);
  assert.deepEqual(await nomes(pasta.rotulos(PARTIDA, "placas")), []); // rótulos e máscaras
  assert.deepEqual(await pasta.listarLotes(PARTIDA), []); // os dois lotes ficaram vazios
  for (const x of r) assert.equal(await pasta.existe(pasta.recorte(PARTIDA, x)), false);
  const dados = await carregarPartida(indice, PARTIDA);
  assert.deepEqual(dados.erros, []);
  assert.equal(dados.recortes.size, 0);
});

test("excluir um recorte (o lote continua com os outros) e um lote inteiro", async () => {
  const { pasta, q, r } = await cenario();
  const um = await excluirRecortes(pasta, PARTIDA, [r[0]]);
  assert.deepEqual(um, { recortes: 1, rotulos: 1, revisoes: 1, lotes_apagados: 0 });
  const r1 = await pasta.ler("lote_recortes", pasta.loteRecortes(PARTIDA, "r1"));
  assert.deepEqual(r1.itens.map((it) => it.recorte), [r[1]]);
  assert.equal(await pasta.existe(pasta.recorte(PARTIDA, r[1])), true);
  const lote = await excluirLote(pasta, PARTIDA, "r2");
  assert.deepEqual(lote, { recortes: 1, rotulos: 1, revisoes: 0, lotes_apagados: 1 });
  assert.deepEqual((await pasta.listarLotes(PARTIDA)).map((l) => l.lote), ["r1"]);
  assert.equal((await pasta.lerFila(PARTIDA)).itens.length, 5); // os quadros ficam
  assert.equal(await pasta.existe(pasta.quadro(PARTIDA, q[2])), true);
});

test("excluir a partida inteira; não enquanto ela é importada", async () => {
  const { pasta } = await cenario();
  const arquivos = await arquivosDaPartida(pasta, PARTIDA);
  const rel = arquivos.map((a) => a.relativo);
  assert.ok(rel.includes("manifesto.json") && rel.includes("fila.json") && rel.includes(`quadros/${quadro(0)}.jpg`));
  assert.ok(rel.includes(`recortes/r1.json`) && rel.some((x) => x.startsWith("rotulos/placas/") && x.endsWith(".png")));
  assert.equal(arquivos.find((a) => a.relativo === "fila.json").tipo, "fila");
  assert.ok(arquivos.every((a) => a.bytes > 0 && a.caminho.startsWith(`partidas/${PARTIDA}/`)));
  await pasta.escreverJson(pasta.importando(PARTIDA), { id: "x", nome_original: "jogo.mp4", bytes: 1, atualizado_em: new Date().toISOString() });
  await assert.rejects(excluirPartida(pasta, PARTIDA), ImportacaoEmAndamento);
  await pasta.escreverJson(pasta.importando(PARTIDA), { id: "x", nome_original: "jogo.mp4", bytes: 1, atualizado_em: "2026-01-01T00:00:00Z" }, { sobrescrever: true });
  assert.equal(await excluirPartida(pasta, PARTIDA), true);
  assert.deepEqual(await pasta.listarPartidas(), []);
});
