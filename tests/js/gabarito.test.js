// Gabarito: comparar os pontos e as pinturas com a resposta, e a liberação (K certos nos últimos N).
import assert from "node:assert/strict";
import { test } from "node:test";

import { Molde } from "../../web/js/nucleo/campo.js";
import {
  REGRA,
  bordaDosJogadores,
  compararJogadores,
  compararPontos,
  liberacao,
  motivoJogadores,
  motivoPontos,
  nTreino,
  resumo,
} from "../../web/js/nucleo/gabarito.js";
import { mascaraVerdadeira, pontosVerdadeiros } from "./apoio.js";

const ITEM = { largura: 640, altura: 360, pontos: pontosVerdadeiros() }; // 5 que aparecem e 1 coberto
const comoMarcou = (desvio = 0, nomes = null) =>
  ITEM.pontos.filter((p) => p.visivel && (!nomes || nomes.includes(p.ponto))).map((p) => ({ ponto: p.ponto, x: p.x + desvio, y: p.y }));

test("pontos: no lugar dá certo; o coberto é opcional; 1,5 px de erro na referência 960", () => {
  const r = compararPontos(comoMarcou(), ITEM);
  assert.equal(r.acerto, true);
  assert.equal(r.erro_mediano_px, 0);
  assert.deepEqual([r.visiveis, r.achados, r.faltaram, r.errados, r.girado], [5, 5, [], [], false]);
  assert.ok(r.pontos.every((p) => p.estado === "certo"));
  // 1 px na imagem de 640 = 1,5 px na referência 960
  const r1 = compararPontos(comoMarcou(1), ITEM);
  assert.ok(Math.abs(r1.erro_mediano_px - 1.5) < 1e-9 && r1.acerto);
  const r2 = compararPontos(comoMarcou(2), ITEM); // 3 px: longe da meta (2 px)
  assert.equal(r2.acerto, false);
  assert.match(motivoPontos(r2), /erro mediano de 3,0 px/);
  // marcar o coberto (perto do lugar) não atrapalha, nem entra no erro mediano
  const coberto = ITEM.pontos[5];
  const r3 = compararPontos([...comoMarcou(), { ponto: coberto.ponto, x: coberto.x + 3, y: coberto.y }], ITEM);
  assert.equal(r3.acerto, true);
  assert.equal(r3.erro_mediano_px, 0);
});

test("pontos: faltar mais de 20% ou trocar um nome dá errado", () => {
  const faltando = compararPontos(comoMarcou(0, ["centro", "meio_cab", "meio_opo"]), ITEM); // 3 de 5
  assert.equal(faltando.acerto, false);
  assert.deepEqual(faltando.faltaram, ["circ_meio_cab", "circ_meio_opo"]);
  assert.match(motivoPontos(faltando), /faltaram 2 dos 5/);
  assert.equal(compararPontos(comoMarcou(0, ["centro", "meio_cab", "meio_opo", "circ_meio_cab"]), ITEM).acerto, true); // 4 de 5
  const trocado = comoMarcou();
  trocado[1] = { ...trocado[1], ponto: "meio_opo" };
  trocado[2] = { ...trocado[2], ponto: "meio_cab" };
  const r = compararPontos(trocado, ITEM);
  assert.equal(r.acerto, false);
  assert.deepEqual(r.errados.sort(), ["meio_cab", "meio_opo"]);
  assert.match(resumo("pontos", r), /2 errado/);
  // um ponto que não está na imagem
  const fora = compararPontos([...comoMarcou(), { ponto: "penalti_dir", x: 600, y: 200 }], ITEM);
  assert.deepEqual(fora.errados, ["penalti_dir"]);
});

test("pontos: a marcação vista do outro lado do campo (girada 180°) também vale", () => {
  const campo = Molde.doCampo();
  const girada = comoMarcou().map((p) => ({ ...p, ponto: campo.espelharPonto(p.ponto) }));
  const r = compararPontos(girada, ITEM);
  assert.equal(r.girado, true);
  assert.equal(r.acerto, true);
  // as faltas vêm com os nomes que a pessoa usou
  const r2 = compararPontos(girada.filter((p) => p.ponto !== "centro" && p.ponto !== campo.espelharPonto("meio_cab")), ITEM);
  assert.deepEqual(r2.faltaram.sort(), ["centro", campo.espelharPonto("meio_cab")].sort());
});

test("jogadores: a borda de 1 px não conta", () => {
  const v = mascaraVerdadeira();
  const borda = bordaDosJogadores(v, 64, 48, 2);
  assert.equal(borda[10 * 64 + 10], 1); // canto do jogador 1
  assert.equal(borda[9 * 64 + 10], 1); // fora, colado nele
  assert.equal(borda[20 * 64 + 14], 0); // dentro
  assert.equal(borda[25 * 64 + 50], 0); // a outra pessoa não tem borda tolerada
  // a pintura certa, e a mesma 1 px maior: as duas dão certo, com 100%
  const certa = v.map((x) => (x === 1 || x === 2 ? 1 : 0));
  const maior = new Uint8Array(64 * 48);
  for (let y = 9; y < 31; y++) for (let x = 9; x < 19; x++) maior[y * 64 + x] = 1;
  for (let y = 11; y < 29; y++) for (let x = 29; x < 37; x++) maior[y * 64 + x] = 1;
  for (const p of [certa, maior]) {
    const r = compararJogadores(p, v, 64, 48, 2);
    assert.equal(r.acerto, true);
    assert.equal(r.iou, 1);
    assert.deepEqual(r.faltaram, []);
  }
});

test("jogadores: esquecer um jogador, pintar o árbitro ou borrar demais dá errado", () => {
  const v = mascaraVerdadeira();
  const so1 = v.map((x) => (x === 1 ? 1 : 0));
  const r = compararJogadores(so1, v, 64, 48, 2);
  assert.equal(r.acerto, false);
  assert.deepEqual(r.faltaram, [2]);
  assert.match(motivoJogadores(r), /faltou pintar 1 jogador/);
  const comArbitro = v.map((x) => (x ? 1 : 0));
  const r2 = compararJogadores(comArbitro, v, 64, 48, 2);
  assert.deepEqual(r2.outras, [255]);
  assert.match(motivoJogadores(r2), /pintou 1 pessoa/);
  assert.match(resumo("jogadores", r2), /2 de 2 jogadores · \d+% · 1 a mais/);
  const borrada = v.map((x) => (x === 1 || x === 2 ? 1 : 0));
  for (let y = 0; y < 48; y++) for (let x = 0; x < 8; x++) borrada[y * 64 + x] = 1; // uma faixa pintada à toa
  const r3 = compararJogadores(borrada, v, 64, 48, 2);
  assert.equal(r3.acerto, false);
  assert.ok(r3.iou < REGRA.jogadores.iou && r3.fora_px > 0);
  assert.deepEqual(r3.faltaram, []);
});

test("liberação: acertar K dos últimos N; e quando liberou", () => {
  const regra = REGRA.pontos;
  const r = (acerto) => ({ acerto });
  assert.equal(liberacao([], false, regra).liberado, true); // sem gabarito, sem bloqueio
  assert.equal(liberacao(Array(9).fill(r(true)), true, regra).liberado, false); // faltam itens
  assert.match(liberacao(Array(9).fill(r(true)), true, regra).motivo, /9 de 10 feitos, 9 certo/);
  const oito = [r(false), r(false), r(false), ...Array(8).fill(r(true))];
  assert.equal(liberacao(oito, true, regra).liberado, true);
  assert.equal(nTreino(oito, regra), 11); // nos 10 primeiros, só 7 certos
  const ruim = [...Array(10).fill(r(true)), r(false), r(false), r(false)]; // errou 3 dos últimos 10 depois
  assert.equal(liberacao(ruim, true, regra).liberado, false);
  assert.equal(nTreino(ruim, regra), 10);
  assert.equal(nTreino(Array(9).fill(r(true)), regra), -1);
  assert.equal(liberacao(Array(5).fill(r(true)), true, REGRA.jogadores).liberado, true);
});
