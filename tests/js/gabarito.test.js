// Gabarito: comparar os pontos e as pinturas com a resposta, e a liberação (K certos nos últimos N).
import assert from "node:assert/strict";
import { test } from "node:test";

import { Molde } from "../../web/js/nucleo/campo.js";
import {
  REGRA,
  bordaDasPessoas,
  compararPessoas,
  compararPontos,
  liberacao,
  motivoPessoas,
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

test("pessoas: a borda de 1 px não conta", () => {
  const v = mascaraVerdadeira();
  const borda = bordaDasPessoas(v, 64, 48, 3);
  assert.equal(borda[10 * 64 + 10], 1); // canto da pessoa 1
  assert.equal(borda[9 * 64 + 10], 1); // fora, colado nela
  assert.equal(borda[20 * 64 + 14], 0); // dentro
  assert.equal(borda[20 * 64 + 48], 1); // o árbitro (3) também é pessoa: tem borda
  // a pintura certa, e a mesma 1 px maior: as duas dão certo, com 100%
  const certa = v.map((x) => (x ? 1 : 0));
  const maior = new Uint8Array(64 * 48);
  for (let y = 9; y < 31; y++) for (let x = 9; x < 19; x++) maior[y * 64 + x] = 1;
  for (let y = 11; y < 29; y++) for (let x = 29; x < 37; x++) maior[y * 64 + x] = 1;
  for (let y = 19; y < 35; y++) for (let x = 47; x < 55; x++) maior[y * 64 + x] = 1;
  for (const p of [certa, maior]) {
    const r = compararPessoas(p, v, 64, 48, 3);
    assert.equal(r.acerto, true);
    assert.equal(r.iou, 1);
    assert.deepEqual(r.faltaram, []);
    assert.equal(r.a_mais, 0);
  }
  assert.match(resumo("pessoas", compararPessoas(certa, v, 64, 48, 3)), /^3 de 3 pessoas · 100%$/);
});

test("pessoas: esquecer alguém (o árbitro também) ou pintar demais dá errado", () => {
  const v = mascaraVerdadeira();
  const semArbitro = v.map((x) => (x === 1 || x === 2 ? 1 : 0)); // pintou só os jogadores
  const r = compararPessoas(semArbitro, v, 64, 48, 3);
  assert.equal(r.acerto, false);
  assert.deepEqual(r.faltaram, [3]);
  assert.match(motivoPessoas(r), /^faltou pintar 1 pessoa/);
  assert.match(resumo("pessoas", r), /^2 de 3 pessoas/);
  const borrada = v.map((x) => (x ? 1 : 0));
  for (let y = 0; y < 48; y++) for (let x = 0; x < 8; x++) borrada[y * 64 + x] = 1; // uma faixa pintada à toa (a torcida)
  const r2 = compararPessoas(borrada, v, 64, 48, 3);
  assert.equal(r2.acerto, false);
  assert.ok(r2.iou < REGRA.pessoas.iou && r2.a_mais > 0.5 && r2.sem_pintar === 0);
  assert.deepEqual(r2.faltaram, []);
  assert.match(motivoPessoas(r2), /sobreposição de \d+% \(a meta é 80%\): pintou \d+% além das pessoas/);
  // pintar só metade de cada um: cobre a metade (passa no por pessoa), mas a sobreposição não chega lá
  const metade = v.map((x, i) => (x && Math.floor(i / 64) < 20 ? 1 : 0));
  const r3 = compararPessoas(metade, v, 64, 48, 3);
  assert.equal(r3.acerto, false);
  assert.match(motivoPessoas(r3), /das pessoas sem pintar/);
  // imagem sem ninguém: nada pintado dá certo; algo pintado, errado
  const vazio = new Uint8Array(64 * 48);
  assert.equal(compararPessoas(vazio, vazio, 64, 48, 0).acerto, true);
  const r4 = compararPessoas(borrada, vazio, 64, 48, 0);
  assert.equal(r4.acerto, false);
  assert.match(motivoPessoas(r4), /não havia ninguém para pintar/);
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
  assert.equal(liberacao(Array(5).fill(r(true)), true, REGRA.pessoas).liberado, true);
});
