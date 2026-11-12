// A câmera dos rótulos: homografia, foco e pose, refino com o topo das traves, a conferência (deixando um
// ponto de fora, com o limite que cresce com a incerteza), o espelho, o giro de 180° e a medida do campo.
// Os quadros são sintéticos: câmeras de transmissão sorteadas, os pontos que caem na imagem e um ruído de
// clique (e, onde se diz, a distorção de uma lente aberta, que o modelo não tem).
import assert from "node:assert/strict";
import { test } from "node:test";

import { Molde, PONTOS_MARCAVEIS } from "../../web/js/nucleo/campo.js";
import {
  LIMITES,
  REF,
  ajustarCamera,
  aplicarH,
  conferirQuadro,
  emPosicaoGeral,
  focalDaHomografia,
  homografia,
  linhasDoCampo,
  medirCampo,
  projetar,
} from "../../web/js/nucleo/camera.js";

function sorteio(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const entre = (r, a, b) => a + (b - a) * r();

/** A câmera em C olhando para `alvo`, com o ângulo de visão horizontal `hfov` (graus). */
function olharPara(C, alvo, hfov, w = 1920, h = 1080) {
  const d = alvo.map((v, i) => v - C[i]);
  const n = Math.hypot(...d);
  const frente = d.map((v) => v / n);
  const nd = Math.hypot(frente[0], frente[1]);
  const direita = [frente[1] / nd, -frente[0] / nd, 0];
  const baixo = [frente[1] * direita[2] - frente[2] * direita[1], frente[2] * direita[0] - frente[0] * direita[2], frente[0] * direita[1] - frente[1] * direita[0]];
  return { f: w / 2 / Math.tan((hfov * Math.PI) / 360), R: [direita, baixo, frente], C, w, h, cx: w / 2, cy: h / 2 };
}

/** Os pontos do campo L × W que a câmera vê (com distorção radial k1 e ruído de clique `sigma`, px). */
function pontosVistos(cam, { L = 105, W = 68, k1 = 0, sigma = 0, r = null } = {}) {
  const molde = Molde.doCampo(L, W);
  const out = [];
  for (const nome of PONTOS_MARCAVEIS) {
    const X = molde.ponto(nome);
    const p = projetar(cam, X);
    if (!p || p[0] < 4 || p[1] < 4 || p[0] > cam.w - 4 || p[1] > cam.h - 4) continue;
    let [x, y] = p;
    if (k1) {
      const nx = (x - cam.cx) / cam.f;
      const ny = (y - cam.cy) / cam.f;
      const k = 1 + k1 * (nx * nx + ny * ny);
      x = cam.cx + cam.f * nx * k;
      y = cam.cy + cam.f * ny * k;
    }
    if (sigma && r) {
      x += sigma * normal(r);
      y += sigma * normal(r);
    }
    out.push({ ponto: nome, x, y });
  }
  return out;
}

/** Uma câmera de transmissão sorteada: a principal na maior parte, às vezes a do 16 m ou a de trás do gol. */
function cameraSorteada(r, L = 105, W = 68) {
  const t = r();
  let C;
  if (t < 0.7) C = [entre(r, -8, 8), -W / 2 - entre(r, 12, 40), entre(r, 12, 35)];
  else if (t < 0.85) C = [(r() < 0.5 ? -1 : 1) * (L / 2 - 16.5), -W / 2 - entre(r, 8, 25), entre(r, 6, 15)];
  else C = [(r() < 0.5 ? -1 : 1) * (L / 2 + entre(r, 8, 25)), entre(r, -6, 6), entre(r, 3, 12)];
  const alvo = [entre(r, -L / 2, L / 2), entre(r, -W / 2, W / 2), 0];
  const hfov = Math.exp(entre(r, Math.log(5), Math.log(55)));
  return { cam: olharPara(C, alvo, hfov), k1: hfov > 25 ? entre(r, -0.06, 0) : entre(r, -0.015, 0) };
}

/** Quadros sintéticos com pelo menos `minimo` pontos (ruído de 1 px em 1920, isto é, 0,5 px na referência). */
function quadros(n, { semente = 1, L = 105, W = 68, minimo = 6, distorcao = true } = {}) {
  const r = sorteio(semente);
  const out = [];
  while (out.length < n) {
    const { cam, k1 } = cameraSorteada(r, L, W);
    const pontos = pontosVistos(cam, { L, W, k1: distorcao ? k1 : 0, sigma: 1, r });
    if (pontos.length >= minimo) out.push({ cam, pontos, largura: cam.w, altura: cam.h });
  }
  return out;
}

const PRINCIPAL = olharPara([0, -60, 20], [-30, 0, 0], 40);

test("a homografia leva os pontos aonde devem ir, e só com pontos em posição geral", () => {
  const H0 = [
    [2, 0.3, 100],
    [-0.1, 1.5, 50],
    [0.001, 0.002, 1],
  ];
  const origem = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 3], [2, 8]];
  const destino = origem.map((p) => aplicarH(H0, p));
  const H = homografia(origem, destino);
  for (const [i, p] of origem.entries()) {
    const q = aplicarH(H, p);
    assert.ok(Math.hypot(q[0] - destino[i][0], q[1] - destino[i][1]) < 1e-6);
  }
  assert.equal(emPosicaoGeral([[0, 0], [1, 0], [2, 0], [3, 0]]), false); // todos numa reta
  assert.equal(emPosicaoGeral([[0, 0], [1, 0], [2, 0], [0, 1]]), false); // 4 pontos, 3 numa reta
  assert.equal(emPosicaoGeral([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]]), true);
  assert.equal(emPosicaoGeral([[0, 0], [1, 0], [1, 1]]), false);
});

test("a câmera sai certa dos pontos de um quadro, com o topo das traves junto", () => {
  const pontos = pontosVistos(PRINCIPAL);
  assert.ok(pontos.some((p) => p.ponto.includes("topo")), "o quadro tem o topo de uma trave");
  const c = conferirQuadro(pontos, PRINCIPAL.w, PRINCIPAL.h);
  assert.equal(c.nivel, "ok");
  assert.ok(Math.hypot(...c.cam.C.map((v, i) => v - PRINCIPAL.C[i])) < 1e-3);
  assert.ok(Math.abs(c.cam.f / PRINCIPAL.f - 1) < 1e-5);
  assert.ok(c.rms < 1e-3 && c.residuos.every((x) => x.loo < 1e-2));
  // a focal da homografia do gramado, sozinha, também confere
  const molde = Molde.doCampo();
  const chao = pontos.filter((p) => molde.ponto(p.ponto)[2] === 0);
  const H = homografia(chao.map((p) => molde.ponto(p.ponto).slice(0, 2)), chao.map((p) => [p.x, p.y]));
  assert.ok(Math.abs(focalDaHomografia(H, 960, 540) / PRINCIPAL.f - 1) < 1e-6);
  // as linhas do campo vistas pela câmera caem na imagem
  const linhas = linhasDoCampo(c.cam);
  assert.ok(linhas.length > 5 && linhas.every((l) => l.length > 1));
});

test("com poucos pontos, ou todos numa linha, não há câmera; com 4 ou 5, a conferência é fraca", () => {
  const pontos = pontosVistos(PRINCIPAL);
  assert.equal(conferirQuadro(pontos.slice(0, 3), 1920, 1080).nivel, "sem_camera");
  const linha = pontos.filter((p) => /^(canto_esq|ga_esq_fundo|pa_esq_fundo|gol_esq_pe)/.test(p.ponto));
  assert.ok(linha.length >= 4);
  const c = conferirQuadro(linha, 1920, 1080);
  assert.equal(c.nivel, "sem_camera");
  assert.equal(c.avisos[0].codigo, "poucos_no_chao");
  const quatro = pontos.filter((p) => ["ga_esq_frente_cab", "ga_esq_frente_opo", "pa_esq_frente_cab", "penalti_esq"].includes(p.ponto));
  assert.equal(quatro.length, 4);
  assert.equal(conferirQuadro(quatro, 1920, 1080).nivel, "sem_folga");
});

test("um ponto fora do lugar ou com o nome trocado é apontado; o espelho e o giro de 180° também", () => {
  const pontos = pontosVistos(PRINCIPAL);
  const i = pontos.findIndex((p) => p.ponto === "ga_esq_frente_opo");
  const px = (20 * PRINCIPAL.w) / REF;
  const fora = pontos.map((p, k) => (k === i ? { ...p, x: p.x + px } : p));
  let c = conferirQuadro(fora, PRINCIPAL.w, PRINCIPAL.h);
  assert.equal(c.nivel, "conferir");
  assert.equal(c.avisos[0].codigo, "ponto_fora");
  assert.equal(c.avisos[0].ponto, "ga_esq_frente_opo");
  assert.ok(Math.abs(c.avisos[0].px - 20) < 2);

  const j = pontos.findIndex((p) => p.ponto === "pa_esq_frente_cab");
  const trocados = pontos.map((p, k) => (k === i ? { ...p, ponto: pontos[j].ponto } : k === j ? { ...p, ponto: pontos[i].ponto } : p));
  assert.equal(conferirQuadro(trocados, PRINCIPAL.w, PRINCIPAL.h).nivel, "conferir");

  const molde = Molde.doCampo();
  const girados = pontos.map((p) => ({ ...p, ponto: molde.espelharPonto(p.ponto) }));
  c = conferirQuadro(girados, PRINCIPAL.w, PRINCIPAL.h);
  assert.deepEqual(c.avisos.map((a) => a.codigo), ["lado_oposto"]);
  assert.equal(c.nivel, "atencao");
  assert.ok(c.cam.C[1] > 34);

  const espelhados = pontos.map((p) => ({ ...p, ponto: p.ponto.replace(/esq|dir/g, (m) => (m === "esq" ? "dir" : "esq")) }));
  c = conferirQuadro(espelhados, PRINCIPAL.w, PRINCIPAL.h);
  assert.deepEqual(c.avisos.map((a) => a.codigo), ["espelhado"]);
  assert.ok(c.cam.C[2] < 0, "com os nomes espelhados, a câmera que fecha fica embaixo do gramado");
});

test("em quadros limpos (clique e lente aberta), quase nunca há aviso; os erros são pegos", () => {
  const qs = quadros(250, { semente: 3 });
  let atencao = 0;
  let conferir = 0;
  let semCamera = 0;
  for (const q of qs) {
    const c = conferirQuadro(q.pontos, q.largura, q.altura);
    if (c.nivel === "atencao") atencao++;
    if (c.nivel === "conferir") conferir++;
    if (!c.cam) semCamera++; // pontos no gramado todos numa linha (o resto no topo das traves)
  }
  assert.equal(conferir, 0);
  assert.ok(atencao <= 3, `${atencao} quadros limpos com atenção`);
  assert.ok(semCamera <= 0.05 * qs.length, `${semCamera} sem câmera`);
  // um ponto 15 px fora (na referência) é pego quase sempre, e apontado
  const r = sorteio(9);
  let pegos = 0;
  let apontados = 0;
  for (const q of qs) {
    const i = Math.floor(r() * q.pontos.length);
    const a = r() * 2 * Math.PI;
    const d = (15 * q.largura) / REF;
    const pts = q.pontos.map((p, k) => (k === i ? { ...p, x: Math.min(q.largura, Math.max(0, p.x + d * Math.cos(a))), y: Math.min(q.altura, Math.max(0, p.y + d * Math.sin(a))) } : p));
    const c = conferirQuadro(pts, q.largura, q.altura);
    if (c.nivel === "conferir" || c.nivel === "atencao") pegos++;
    if (c.avisos.some((x) => x.ponto === q.pontos[i].ponto)) apontados++;
  }
  assert.ok(pegos >= 0.93 * qs.length, `pegou ${pegos} de ${qs.length}`);
  assert.ok(apontados >= 0.9 * pegos);
});

test("um ponto que os outros mal determinam precisa estar mais longe para acusar", () => {
  // de trás do gol, fechado: um ponto do outro lado do campo fica isolado
  const cam = olharPara([-70, 2, 8], [-40, 0, 0], 30);
  const pontos = pontosVistos(cam);
  const c = conferirQuadro(pontos, cam.w, cam.h);
  const incertezas = c.residuos.map((x) => x.incerteza);
  assert.ok(Math.max(...incertezas) > 1.5 * Math.min(...incertezas), "a incerteza varia de ponto para ponto");
  assert.equal(c.nivel, "ok");
  assert.ok(LIMITES.atencao < LIMITES.conferir);
});

test("a medida do campo sai dos rótulos de uma partida, e só muda quando explica melhor", () => {
  for (const [L, W] of [
    [100, 64],
    [110, 75],
  ]) {
    const qs = quadros(120, { semente: L + W, L, W, minimo: 4 });
    const m = medirCampo(qs);
    assert.ok(Math.abs(m.L - L) <= 0.3 && Math.abs(m.W - W) <= 0.3, `${L}×${W} medido ${m.L}×${m.W}`);
    assert.ok(m.depois < m.antes);
    // com a medida certa, a conferência fica limpa; com 105 × 68, acusaria quase tudo
    const limpos = qs.filter((q) => conferirQuadro(q.pontos, q.largura, q.altura, { L: m.L, W: m.W }).nivel !== "conferir").length;
    const errados = qs.filter((q) => conferirQuadro(q.pontos, q.largura, q.altura).nivel === "conferir").length;
    assert.ok(limpos >= qs.length - 1 && errados > qs.length / 3);
  }
  // 105 × 68 de verdade: fica
  const m = medirCampo(quadros(80, { semente: 5, minimo: 4 }));
  assert.deepEqual([m.L, m.W], [105, 68]);
  // nenhum quadro diz nada da medida: fica a inicial
  assert.deepEqual(medirCampo([]), { L: 105, W: 68, quadrosL: 0, quadrosW: 0, antes: 0, depois: 0 });
});

test("a medida do campo não se deixa levar por rótulos errados", () => {
  const qs = quadros(120, { semente: 21, L: 101, W: 66, minimo: 5 });
  const r = sorteio(4);
  for (const q of qs) {
    if (r() > 0.25) continue;
    const i = Math.floor(r() * q.pontos.length);
    const usados = new Set(q.pontos.map((p) => p.ponto));
    const livres = PONTOS_MARCAVEIS.filter((n) => !usados.has(n));
    q.pontos[i] = { ...q.pontos[i], ponto: livres[Math.floor(r() * livres.length)] };
  }
  const m = medirCampo(qs);
  assert.ok(Math.abs(m.L - 101) <= 0.4 && Math.abs(m.W - 66) <= 0.4, `medido ${m.L}×${m.W}`);
});

test("a câmera de um close (teleobjetiva, pouca perspectiva) sai mesmo com o ruído do clique", () => {
  const cam = olharPara([0, -60, 20], [-47, 0, 0], 10);
  const r = sorteio(12);
  const pontos = pontosVistos(cam, { sigma: 1, r });
  assert.ok(pontos.length >= 6);
  const molde = Molde.doCampo();
  const aj = ajustarCamera(pontos.map((p) => ({ X: molde.ponto(p.ponto), u: p.x, v: p.y })), cam.w, cam.h);
  assert.ok(!aj.erro);
  assert.ok((Math.sqrt(aj.custo / pontos.length) * REF) / cam.w < 1, "os pontos batem com a câmera");
  const c = conferirQuadro(pontos, cam.w, cam.h);
  assert.ok(["ok", "sem_folga"].includes(c.nivel), c.nivel);
});
