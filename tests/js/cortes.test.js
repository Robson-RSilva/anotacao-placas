// Descritores, cortes e sorteio no navegador, comparados com a implementação de referência da v0.1
// (Python + OpenCV) em tests/fixtures/cortes_referencia.json.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Aleatorio } from "../../web/js/nucleo/aleatorio.js";
import {
  agrupar,
  corrigirPts,
  detectarCortes,
  detectarGraduais,
  kMedias,
  montarTomadas,
  razaoAdaptativa,
} from "../../web/js/video/cortes.js";
import { descrever, distanciaEstrutura, qui2 } from "../../web/js/video/descritores.js";
import { atribuir, elegiveis, repartir, sortear } from "../../web/js/video/sorteio.js";
import { FIXTURES, lerJson } from "./apoio.js";

const ref = lerJson(new URL("cortes_referencia.json", FIXTURES));

test("descritores iguais aos do OpenCV", () => {
  for (const q of ref.quadros) {
    const rgba = new Uint8ClampedArray(Buffer.from(q.rgba_b64, "base64"));
    const d = descrever(rgba);
    const difHist = d.hist.reduce((s, v, i) => s + Math.abs(v - q.hist16[i]), 0);
    assert.ok(difHist < 1e-6, `${q.nome}: histograma ${difHist}`);
    const difCurto = d.histCurto.reduce((s, v, i) => s + Math.abs(v - q.hist8[i]), 0);
    assert.ok(difCurto < 1e-5, `${q.nome}: histograma curto ${difCurto}`);
    assert.equal(d.gramado, q.gramado, `${q.nome}: gramado`);
    assert.ok(Math.abs(d.bordas - q.bordas) < 2e-3, `${q.nome}: bordas ${d.bordas} x ${q.bordas}`);
    const corr = d.estrutura.reduce((s, v, i) => s + v * q.estrutura[i], 0);
    assert.ok(corr > 0.9999, `${q.nome}: estrutura ${corr}`);
  }
  const [a, b] = ref.quadros.map((q) => descrever(new Uint8ClampedArray(Buffer.from(q.rgba_b64, "base64"))));
  assert.ok(qui2(a.hist, a.hist) === 0 && qui2(a.hist, b.hist) > 0);
  assert.ok(Math.abs(distanciaEstrutura(a.estrutura, a.estrutura)) < 1e-5); // norma com +1e-6, como na v0.1
});

test("razão adaptativa, cortes e fusões iguais aos da v0.1", () => {
  const t = ref.transmissao;
  const r1 = razaoAdaptativa(t.d_hist);
  const r2 = razaoAdaptativa(t.d_estr);
  r1.forEach((v, i) => assert.ok(Math.abs(v - t.r_hist[i]) <= 1e-9 * Math.max(1, Math.abs(v)), `r_hist ${i}`));
  r2.forEach((v, i) => assert.ok(Math.abs(v - t.r_estr[i]) <= 1e-9 * Math.max(1, Math.abs(v)), `r_estr ${i}`));
  const cortes = detectarCortes(t.d_hist, t.d_estr);
  assert.deepEqual(cortes, t.cortes);
  assert.deepEqual(detectarGraduais(t.d_hist, cortes), t.graduais);
  const s = ref.serie_com_fusao;
  const c2 = detectarCortes(s.d_hist, s.d_estr);
  assert.deepEqual(c2, s.cortes);
  assert.deepEqual(detectarGraduais(s.d_hist, c2), s.graduais);
});

test("tomadas, grupos e zoom", () => {
  const tomadas = montarTomadas(10, [3, 3, 7, 0, 10]);
  assert.deepEqual(tomadas.map((x) => [x.i0, x.i1]), [[0, 3], [3, 7], [7, 10]]);
  const curtos = new Map([[0, [1, 0, 0]], [2, [0.9, 0.1, 0]], [4, [0, 1, 0]], [6, [0, 0.9, 0.1]], [8, [1, 0, 0]]]);
  const gramado = [0.8, 0.8, 0.8, 0.1, 0.1, 0.1, 0.1, 0.8, 0.8, 0.8];
  const bordas = [0.1, 0.1, 0.1, 0.01, 0.01, 0.01, 0.01, 0.1, 0.1, 0.1];
  agrupar(tomadas, curtos, gramado, bordas, new Aleatorio("x"), 2);
  assert.equal(tomadas[0].grupo, tomadas[2].grupo);
  assert.notEqual(tomadas[0].grupo, tomadas[1].grupo);
  assert.equal(tomadas[0].grupo, 0); // rótulos em ordem de aparição
  assert.equal(tomadas[1].zoom, "fechado");
  assert.equal(tomadas[0].zoom, "aberto");
  const rot = kMedias([[0], [0.1], [10], [10.2], [0.05]], 2, new Aleatorio("k"));
  assert.deepEqual(rot, [0, 0, 1, 1, 0]);
});

test("PTS do contêiner, ou índice / fps quando não cresce", () => {
  assert.equal(corrigirPts([0, 40, 80], 25).fonte, "conteiner");
  const r = corrigirPts([0, 40, 40.2, 80], 25);
  assert.equal(r.fonte, "indice");
  assert.deepEqual(Array.from(r.pts), [0, 40, 80, 120]);
});

function cenario(nTomadas = 30, quadrosPorTomada = 200, fps = 25) {
  const n = nTomadas * quadrosPorTomada;
  const pts = Float64Array.from({ length: n }, (_, i) => (i * 1000) / fps);
  const cortes = Array.from({ length: nTomadas - 1 }, (_, k) => (k + 1) * quadrosPorTomada);
  const tomadas = montarTomadas(n, cortes);
  tomadas.forEach((t, k) => {
    t.grupo = k % 5 === 0 ? 1 : 0; // grupo 1 é raro
  });
  const transicao = new Uint8Array(n);
  transicao.fill(1, 1000, 1050);
  return { n, pts, tomadas, transicao };
}

test("sorteio: longe dos cortes, fora das transições, até 2 por tomada longa, cota dos grupos raros", () => {
  const { pts, tomadas, transicao } = cenario();
  const s = sortear(tomadas, pts, transicao, { alvo: 40 }, new Aleatorio("partida"));
  assert.equal(s.length, 40);
  const porTomada = new Map();
  for (const x of s) {
    const t = tomadas[x.tomada];
    assert.ok(pts[x.i] - pts[t.i0] >= 400 && pts[t.i1 - 1] - pts[x.i] >= 400, "margem de 0,4 s dos cortes");
    assert.equal(transicao[x.i], 0);
    assert.equal(x.quadro, `t${String(Math.round(pts[x.i])).padStart(10, "0")}`);
    porTomada.set(x.tomada, (porTomada.get(x.tomada) || 0) + 1);
  }
  assert.ok(Math.max(...porTomada.values()) <= 2);
  const raros = s.filter((x) => tomadas[x.tomada].grupo === 1).length;
  assert.ok(raros >= 10, `grupo raro com ${raros} de 40 (peso pela raiz)`);
  assert.equal(s.filter((x) => x.dupla).length, 4);
  assert.equal(s.filter((x) => x.sem_previsao).length, 4);
  assert.deepEqual(s.map((x) => x.i), [...s.map((x) => x.i)].sort((a, b) => a - b));
  // reprodutível
  const deNovo = sortear(tomadas, pts, transicao, { alvo: 40 }, new Aleatorio("partida"));
  assert.deepEqual(deNovo, s);
});

test("tomada curta dá 1 quadro (o do meio), longa até 2", () => {
  const pts = Float64Array.from({ length: 30 }, (_, i) => i * 40);
  assert.deepEqual(elegiveis({ i0: 0, i1: 5 }, pts, new Uint8Array(30), 400), [2]);
  assert.deepEqual(elegiveis({ i0: 0, i1: 2 }, pts, new Uint8Array(30), 400), []);
  const cota = repartir(10, new Map([[0, 3], [1, 1]]), new Map([[0, 100], [1, 2]]));
  assert.deepEqual([cota.get(0), cota.get(1)], [8, 2]);
});

test("distribuição: rodízio, dupla com duas pessoas diferentes", () => {
  const s = Array.from({ length: 10 }, (_, k) => ({ dupla: k === 3 }));
  const a = atribuir(s, ["A01", "A02", "A03"], new Aleatorio("x"));
  assert.equal(a[3].length, 2);
  assert.notEqual(a[3][0], a[3][1]);
  const cont = {};
  for (const lista of a) for (const p of lista) cont[p] = (cont[p] || 0) + 1;
  assert.ok(Object.values(cont).every((v) => v >= 3));
  assert.deepEqual(atribuir(s, [], new Aleatorio("x")), s.map(() => []));
});
