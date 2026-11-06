// Descritores, cortes e sorteio no navegador, comparados com a implementação de referência da v0.1
// (Python + OpenCV) em tests/fixtures/cortes_referencia.json.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Aleatorio } from "../../web/js/nucleo/aleatorio.js";
import {
  agrupar,
  colapsarRajadas,
  corrigirPts,
  detectarCortes,
  detectarGraduais,
  juntarIntervalos,
  kMedias,
  montarTomadas,
  razaoAdaptativa,
} from "../../web/js/video/cortes.js";
import { descrever, distanciaEstrutura, qui2 } from "../../web/js/video/descritores.js";
import { duracaoMs, elegiveis, repartir, sortear } from "../../web/js/video/sorteio.js";
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

test("tomada com menos de 1 s não dá quadro; sem quadro longe das bordas, vale o do meio", () => {
  const pts = Float64Array.from({ length: 100 }, (_, i) => i * 40); // 25 q/s
  const nada = new Uint8Array(100);
  assert.equal(duracaoMs({ i0: 0, i1: 25 }, pts), 1000); // até o começo da tomada seguinte
  assert.equal(duracaoMs({ i0: 75, i1: 100 }, pts), 1000); // a última: conta o último quadro
  assert.deepEqual(elegiveis({ i0: 0, i1: 5 }, pts, nada, 400), []); // 0,2 s: sobra, não plano
  assert.deepEqual(elegiveis({ i0: 0, i1: 24 }, pts, nada, 400), []); // 0,96 s
  assert.deepEqual(elegiveis({ i0: 0, i1: 25 }, pts, nada, 400), [10, 11, 12, 13, 14]); // 1 s
  assert.deepEqual(elegiveis({ i0: 75, i1: 100 }, pts, nada, 400), [85, 86, 87, 88, 89]);
  assert.deepEqual(elegiveis({ i0: 0, i1: 25 }, pts, nada, 600), [12]); // margem maior que a tomada
  const meio = new Uint8Array(100);
  meio[12] = 1;
  assert.deepEqual(elegiveis({ i0: 0, i1: 25 }, pts, meio, 600), []);
  assert.deepEqual(elegiveis({ i0: 0, i1: 5 }, pts, nada, 0, 0), [0, 1, 2, 3, 4]); // sem mínimo
  const cota = repartir(10, new Map([[0, 3], [1, 1]]), new Map([[0, 100], [1, 2]]));
  assert.deepEqual([cota.get(0), cota.get(1)], [8, 2]);
});

test("rajada de cortes vira uma transição, com corte só nas pontas", () => {
  const pts = Float64Array.from({ length: 600 }, (_, i) => (i * 1000) / 60); // 10 s a 60 q/s
  // corte em 120; vinheta animada a 15 q/s de 300 a 364 (um "corte" a cada 4 quadros); corte em 480
  const vinheta = Array.from({ length: 17 }, (_, j) => 300 + 4 * j);
  assert.deepEqual(colapsarRajadas([120, ...vinheta, 480], pts, 1000), { cortes: [120, 300, 364, 480], rajadas: [[300, 364]] });
  // a vinheta que para meio segundo no meio (dois trens de passos) é uma rajada só
  const parada = [...Array.from({ length: 5 }, (_, j) => 300 + 4 * j), ...Array.from({ length: 12 }, (_, j) => 348 + 4 * j)];
  assert.deepEqual(colapsarRajadas(parada, pts, 1000).rajadas, [[300, 392]]);
  // dois cortes a menos de 1 s: o pedaço entre eles também é transição
  assert.deepEqual(colapsarRajadas([120, 150, 480], pts, 1000), { cortes: [120, 150, 480], rajadas: [[120, 150]] });
  // a 1 s ou mais um do outro: nada muda (repetidos e fora de ordem também servem)
  assert.deepEqual(colapsarRajadas([480, 120, 120, 180], pts, 1000), { cortes: [120, 180, 480], rajadas: [] });
  assert.deepEqual(colapsarRajadas([], pts, 1000), { cortes: [], rajadas: [] });
  assert.deepEqual(
    juntarIntervalos([
      [5, 9],
      [1, 3],
      [2, 4],
      [9, 12],
      [20, 20],
    ]),
    [
      [1, 4],
      [5, 12],
    ],
  );
});

test("só as tomadas aproveitáveis formam os grupos; as outras ficam no grupo mais parecido", () => {
  // aberta, vinheta (não pode dar quadro), fechada, fora do trecho (não lida), aberta
  const tomadas = montarTomadas(20, [4, 6, 10, 12, 16]).slice(0, 5);
  assert.deepEqual(tomadas.map((t) => [t.i0, t.i1]), [[0, 4], [4, 6], [6, 10], [10, 12], [12, 16]]);
  const curtos = new Map([[0, [1, 0, 0]], [2, [0.95, 0.05, 0]], [4, [0, 0, 1]], [6, [0, 1, 0]], [8, [0.05, 0.95, 0]], [12, [1, 0, 0]], [14, [0.9, 0.1, 0]]]);
  const gramado = [0.8, 0.8, 0.8, 0.8, 0.02, 0.02, 0.1, 0.1, 0.1, 0.1, 0, 0, 0.75, 0.75, 0.75, 0.75];
  const bordas = [0.1, 0.1, 0.1, 0.1, 0.6, 0.6, 0.02, 0.02, 0.02, 0.02, 0, 0, 0.1, 0.1, 0.1, 0.1];
  for (const semente of ["a", "b", "c", "d", "e"]) {
    const ts = tomadas.map((t) => ({ ...t }));
    agrupar(ts, curtos, gramado, bordas, new Aleatorio(semente), 2, [true, false, true, false, true]);
    assert.equal(ts[0].grupo, ts[4].grupo, semente);
    assert.notEqual(ts[0].grupo, ts[2].grupo, semente); // a vinheta e o pedaço não lido não tomam um grupo
    assert.ok([ts[0].grupo, ts[2].grupo].includes(ts[1].grupo) && [ts[0].grupo, ts[2].grupo].includes(ts[3].grupo));
    assert.equal(ts[0].zoom, "aberto");
    assert.equal(ts[2].zoom, "fechado");
  }
});

test("vinhetas animadas num vídeo a 60 q/s não viram tomadas nem quadros quase iguais", () => {
  // 2 min a 60 q/s: um corte de verdade a cada 8 s e 4 vinhetas de 1 s com um passo de animação a cada
  // 4 quadros (o caso de uma partida de verdade: 53 dos 100 quadros saíam de 4 s de vinhetas)
  const n = 7200;
  const pts = Float64Array.from({ length: n }, (_, i) => (i * 1000) / 60);
  const al = new Aleatorio("ruído");
  const dHist = Float64Array.from({ length: n }, (_, i) => (i ? 0.002 + 0.002 * al.real() : 0));
  const dEstr = Float64Array.from({ length: n }, (_, i) => (i ? 0.004 + 0.004 * al.real() : 0));
  const verdadeiros = Array.from({ length: 14 }, (_, k) => 480 * (k + 1));
  for (const c of verdadeiros) [dHist[c], dEstr[c]] = [0.8, 0.6];
  const vinhetas = [1700, 3500, 5400, 6800];
  for (const v of vinhetas) for (let j = 0; j <= 15; j++) [dHist[v + 4 * j], dEstr[v + 4 * j]] = [0.3, 0.25];
  const detectados = detectarCortes(dHist, dEstr);
  assert.equal(detectados.length, verdadeiros.length + 16 * vinhetas.length); // cada passo parece um corte

  const { cortes, rajadas } = colapsarRajadas(detectados, pts, 1000);
  assert.deepEqual(rajadas, vinhetas.map((v) => [v, v + 60]));
  assert.deepEqual(cortes, [...verdadeiros, ...vinhetas.flatMap((v) => [v, v + 60])].sort((a, b) => a - b));
  const transicao = new Uint8Array(n);
  for (const [a, b] of juntarIntervalos(rajadas)) transicao.fill(1, a, b);
  const tomadas = montarTomadas(n, cortes);
  const aproveitaveis = tomadas.map((t) => elegiveis(t, pts, transicao, 400).length > 0);
  assert.equal(aproveitaveis.filter(Boolean).length, tomadas.length - vinhetas.length);

  // descritores: as vinhetas são grafismo (sem gramado, muita borda), o resto é jogo
  const naVinheta = (i) => vinhetas.some((v) => i >= v && i < v + 60);
  const curtos = new Map();
  const gramado = new Float64Array(n);
  const bordas = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const fechada = Math.floor(i / 480) % 3 === 2;
    gramado[i] = naVinheta(i) ? 0.02 : fechada ? 0.15 : 0.7;
    bordas[i] = naVinheta(i) ? 0.5 : fechada ? 0.03 : 0.1;
    if (i % 12 === 0) curtos.set(i, naVinheta(i) ? [0, 0, 1] : fechada ? [0.2, 0.8, 0] : [0.9, 0.1, 0]);
  }
  agrupar(tomadas, curtos, gramado, bordas, new Aleatorio("partida"), 6, aproveitaveis);
  const gruposAproveitaveis = new Set(tomadas.filter((_, k) => aproveitaveis[k]).map((t) => t.grupo));
  for (const t of tomadas) assert.ok(gruposAproveitaveis.has(t.grupo), "nenhum grupo só de vinheta");

  const s = sortear(tomadas, pts, transicao, { alvo: 100 }, new Aleatorio("partida"));
  for (const x of s) assert.ok(!naVinheta(x.i), `quadro ${x.i} dentro de uma vinheta`);
  const porTomada = new Map();
  for (const x of s) porTomada.set(x.tomada, (porTomada.get(x.tomada) || 0) + 1);
  assert.ok(Math.max(...porTomada.values()) <= 2);
  assert.equal(porTomada.size, aproveitaveis.filter(Boolean).length); // pedido maior que o vídeo: todas dão quadro
  const longas = tomadas.filter((t, k) => aproveitaveis[k] && pts[t.i1 - 1] - pts[t.i0] >= 6000).length;
  assert.equal(s.length, porTomada.size + longas); // e saem menos que os 100 pedidos
});
