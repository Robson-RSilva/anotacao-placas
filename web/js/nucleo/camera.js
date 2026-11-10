// A câmera de um quadro a partir dos pontos marcados (a "câmera dos rótulos"), e a conferência que ela
// permite: um ponto fora do lugar ou com o nome trocado não bate com a câmera que os outros pontos dão.
//
// O modelo é o do laboratório (exposure/core/camera.py), sem a distorção: pinhole, pixel quadrado e ponto
// principal no centro da imagem. Mundo: origem no centro do gramado, x no comprimento, y na largura, z
// para cima, em metros; o lado das cabines é y < 0. R leva do mundo para a câmera e tem nas linhas os
// eixos dela (direita, baixo, frente): X_c = R (X − C), e o pixel é f · (x_c, y_c) / z_c + (cx, cy).
//
// Como se calcula: a homografia do gramado (z = 0) pelos pontos no chão (DLT normalizada) dá a distância
// focal e a pose (o método de Zhang com o ponto principal conhecido); um Levenberg–Marquardt refina f, R e
// C com todos os pontos, o topo das traves junto. A conferência refaz a câmera sem cada ponto e mede onde
// ela põe esse ponto ("deixando um de fora"): assim um ponto errado não se esconde puxando a câmera para
// si. As distâncias saem em px na largura de referência (960), como no gabarito.

import { Molde } from "./campo.js";

export const REF = 960;

/**
 * Limites da conferência, em px na largura de referência (960). Calibrados com quadros sintéticos de
 * transmissão (ruído de clique de 0,5 px e a distorção de uma lente aberta): ver tests/js/camera.test.js.
 */
export const LIMITES = Object.freeze({
  atencao: 5, // um ponto a mais que isso de onde os outros dizem: vale olhar
  conferir: 10, // a mais que isso: quase sempre ponto fora do lugar ou com o nome trocado
  folga: 6, // com menos pontos não dá para deixar um de fora: a câmera sai, mas a conferência é fraca
});

/** O que se considera câmera possível numa transmissão (como `plausible` no laboratório). */
const PLAUSIVEL = Object.freeze({ fMin: 0.15, fMax: 50, alturaMin: 0.5, alturaMax: 120, distanciaMax: 250 });

// ------------------------------------------------------------------------------- álgebra pequena
const mul3 = (A, B) => A.map((l) => [0, 1, 2].map((j) => l[0] * B[0][j] + l[1] * B[1][j] + l[2] * B[2][j]));
const transp = (A) => [0, 1, 2].map((j) => [A[0][j], A[1][j], A[2][j]]);
const mulV = (A, v) => A.map((l) => l[0] * v[0] + l[1] * v[1] + l[2] * v[2]);
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (v) => Math.hypot(v[0], v[1], v[2]);

function det3(A) {
  return (
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
  );
}

function inv3(A) {
  const d = det3(A);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-300) return null;
  const c = (i, j) => {
    const l = [0, 1, 2].filter((k) => k !== i);
    const m = [0, 1, 2].filter((k) => k !== j);
    return ((i + j) % 2 ? -1 : 1) * (A[l[0]][m[0]] * A[l[1]][m[1]] - A[l[0]][m[1]] * A[l[1]][m[0]]);
  };
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => c(j, i) / d));
}

/** Resolve A x = b (Gauss com pivotamento parcial); null se A for singular. */
export function resolver(A, b) {
  const n = b.length;
  const M = A.map((l, i) => [...l, b[i]]);
  let maior = 0;
  for (const l of A) for (const v of l) maior = Math.max(maior, Math.abs(v));
  const tol = Math.max(maior, 1e-300) * 1e-13;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (!(Math.abs(M[p][c]) > tol)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let i = c + 1; i < n; i++) {
      const k = M[i][c] / M[c][c];
      if (k === 0) continue;
      for (let j = c; j <= n; j++) M[i][j] -= k * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x.every(Number.isFinite) ? x : null;
}

/** Matriz de rotação do vetor de Rodrigues `w` (eixo × ângulo, em radianos). */
export function rodrigues(w) {
  const t = Math.hypot(w[0], w[1], w[2]);
  const K = [
    [0, -w[2], w[1]],
    [w[2], 0, -w[0]],
    [-w[1], w[0], 0],
  ];
  const a = t < 1e-9 ? 1 - (t * t) / 6 : Math.sin(t) / t;
  const b = t < 1e-9 ? 0.5 - (t * t) / 24 : (1 - Math.cos(t)) / (t * t);
  const K2 = mul3(K, K);
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) + a * K[i][j] + b * K2[i][j]));
}

/** A rotação mais próxima de M (fator polar, pela iteração de Newton); null se M for singular. */
function rotacaoMaisProxima(M) {
  let X = M.map((l) => [...l]);
  for (let k = 0; k < 50; k++) {
    const I = inv3(X);
    if (!I) return null;
    const iT = transp(I);
    let dif = 0;
    const N = X.map((l, i) =>
      l.map((v, j) => {
        const nv = (v + iT[i][j]) / 2;
        dif = Math.max(dif, Math.abs(nv - v));
        return nv;
      }),
    );
    X = N;
    if (dif < 1e-14) break;
  }
  return det3(X) > 0 ? X : null;
}

// ------------------------------------------------------------------------------- projeção
/** Projeta o ponto 3D X (mundo) na imagem: [u, v] em px, ou null atrás da câmera. */
export function projetar(cam, X) {
  const R = cam.R;
  const d0 = X[0] - cam.C[0];
  const d1 = X[1] - cam.C[1];
  const d2 = X[2] - cam.C[2];
  const z = R[2][0] * d0 + R[2][1] * d1 + R[2][2] * d2;
  if (!(z > 1e-6)) return null;
  const x = R[0][0] * d0 + R[0][1] * d1 + R[0][2] * d2;
  const y = R[1][0] * d0 + R[1][1] * d1 + R[1][2] * d2;
  return [(cam.f * x) / z + cam.cx, (cam.f * y) / z + cam.cy];
}

/** Ângulo de visão horizontal da câmera, em graus. */
export const anguloDeVisao = (cam) => (2 * Math.atan(cam.w / 2 / cam.f) * 180) / Math.PI;

/** A câmera é possível numa transmissão? (|altura| porque a espelhada fica embaixo do gramado.) */
export function plausivel(cam) {
  if (!cam || !Number.isFinite(cam.f) || !cam.C.every(Number.isFinite)) return false;
  const h = Math.abs(cam.C[2]);
  return (
    cam.f > PLAUSIVEL.fMin * cam.w * 0.999 &&
    cam.f < PLAUSIVEL.fMax * cam.w * 1.001 &&
    h > PLAUSIVEL.alturaMin &&
    h < PLAUSIVEL.alturaMax &&
    Math.hypot(cam.C[0], cam.C[1]) < PLAUSIVEL.distanciaMax
  );
}

// ------------------------------------------------------------------------------- homografia
/** Transformação de Hartley: centróide na origem e distância média √2. */
function normalizacao(P) {
  let mx = 0;
  let my = 0;
  for (const [x, y] of P) {
    mx += x;
    my += y;
  }
  mx /= P.length;
  my /= P.length;
  let d = 0;
  for (const [x, y] of P) d += Math.hypot(x - mx, y - my);
  d /= P.length;
  const s = d > 1e-12 ? Math.SQRT2 / d : 1;
  return [
    [s, 0, -s * mx],
    [0, s, -s * my],
    [0, 0, 1],
  ];
}

/** Aplica a homografia H ao ponto [x, y]. */
export function aplicarH(H, [x, y]) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

/**
 * Pontos do gramado em posição geral: pelo menos 4, e nenhuma reta com todos menos um (com 4 pontos,
 * três numa reta já deixam a homografia indeterminada). As coordenadas do mundo são exatas (do molde).
 */
export function emPosicaoGeral(P) {
  const n = P.length;
  if (n < 4) return false;
  let maior = 2;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [ax, ay] = P[i];
      const dx = P[j][0] - ax;
      const dy = P[j][1] - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return false;
      let k = 0;
      for (const [x, y] of P) if (Math.abs((x - ax) * dy - (y - ay) * dx) / len < 1e-6) k++;
      maior = Math.max(maior, k);
    }
  }
  return maior <= n - 2;
}

/** Homografia (DLT normalizada) que leva `origem` ([[x, y]]) a `destino` ([[u, v]]); null se não der. */
export function homografia(origem, destino) {
  const n = origem.length;
  if (n < 4 || destino.length !== n) return null;
  const Ts = normalizacao(origem);
  const Td = normalizacao(destino);
  const A = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const b = new Array(8).fill(0);
  const somar = (r, y) => {
    for (let i = 0; i < 8; i++) {
      if (r[i] === 0) continue;
      b[i] += r[i] * y;
      for (let j = 0; j < 8; j++) A[i][j] += r[i] * r[j];
    }
  };
  for (let i = 0; i < n; i++) {
    const x = Ts[0][0] * origem[i][0] + Ts[0][2];
    const y = Ts[1][1] * origem[i][1] + Ts[1][2];
    const u = Td[0][0] * destino[i][0] + Td[0][2];
    const v = Td[1][1] * destino[i][1] + Td[1][2];
    somar([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    somar([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = resolver(A, b);
  if (!h) return null;
  const Hn = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
  const iTd = inv3(Td);
  if (!iTd) return null;
  const H = mul3(iTd, mul3(Hn, Ts));
  const s = Math.hypot(...H.flat());
  return s > 0 && Number.isFinite(s) ? H.map((l) => l.map((v) => v / s)) : null;
}

/**
 * Distância focal a partir da homografia do gramado, com o ponto principal (cx, cy) conhecido e pixel
 * quadrado (como `focal_from_homography` no laboratório); null quando a perspectiva não a determina.
 */
export function focalDaHomografia(H, cx, cy) {
  const h = mul3(
    [
      [1, 0, -cx],
      [0, 1, -cy],
      [0, 0, 1],
    ],
    H,
  );
  const a = h[0][0] * h[0][1] + h[1][0] * h[1][1];
  const b = h[2][0] * h[2][1];
  const c = h[0][0] ** 2 + h[1][0] ** 2 - h[0][1] ** 2 - h[1][1] ** 2;
  const d = h[2][0] ** 2 - h[2][1] ** 2;
  const den = a * a + c * c;
  if (!(den > 0)) return null;
  const u = -(a * b + c * d) / den;
  if (!Number.isFinite(u) || u <= 0) return null;
  return 1 / Math.sqrt(u);
}

/**
 * A câmera da homografia H (gramado -> imagem). O sinal sai dos pontos observados (`chao`, [[x, y]]): eles
 * ficam na frente da câmera. Com os nomes espelhados (esquerda e direita trocados), a câmera que fecha fica
 * embaixo do gramado (C_z < 0) — é assim que a conferência percebe o espelho. null se não der.
 */
export function decompor(H, largura, altura, chao, f = null) {
  const cx = largura / 2;
  const cy = altura / 2;
  const foco = f ?? focalDaHomografia(H, cx, cy);
  if (!foco) return null;
  const A = mul3(
    [
      [1 / foco, 0, -cx / foco],
      [0, 1 / foco, -cy / foco],
      [0, 0, 1],
    ],
    H,
  );
  const a1 = [A[0][0], A[1][0], A[2][0]];
  const a2 = [A[0][1], A[1][1], A[2][1]];
  const a3 = [A[0][2], A[1][2], A[2][2]];
  const lam = 1 / Math.sqrt(norma(a1) * norma(a2));
  if (!Number.isFinite(lam)) return null;
  let frente = 0;
  for (const [x, y] of chao) frente += A[2][0] * x + A[2][1] * y + A[2][2];
  const s = (frente >= 0 ? 1 : -1) * lam;
  const c1 = a1.map((v) => s * v);
  const c2 = a2.map((v) => s * v);
  const t = a3.map((v) => s * v);
  const c3 = cruz(c1, c2);
  const R = rotacaoMaisProxima([
    [c1[0], c2[0], c3[0]],
    [c1[1], c2[1], c3[1]],
    [c1[2], c2[2], c3[2]],
  ]);
  if (!R) return null;
  const C = mulV(transp(R), t).map((v) => -v);
  return { f: foco, R, C, w: largura, h: altura, cx, cy };
}

// ------------------------------------------------------------------------------- refino
const PASSOS = [1e-6, 1e-7, 1e-7, 1e-7, 1e-5, 1e-5, 1e-5];

function moverCamera(cam, d, lnfMin, lnfMax) {
  const lnf = Math.min(lnfMax, Math.max(lnfMin, Math.log(cam.f) + d[0]));
  return { ...cam, f: Math.exp(lnf), R: mul3(rodrigues([d[1], d[2], d[3]]), cam.R), C: [cam.C[0] + d[4], cam.C[1] + d[5], cam.C[2] + d[6]] };
}

function residuosDe(cam, pares, out) {
  for (let i = 0; i < pares.length; i++) {
    const p = projetar(cam, pares[i].X);
    if (!p) {
      out[2 * i] = 1e4;
      out[2 * i + 1] = 1e4;
    } else {
      out[2 * i] = p[0] - pares[i].u;
      out[2 * i + 1] = p[1] - pares[i].v;
    }
  }
  return out;
}

const somaQuadrados = (r) => {
  let s = 0;
  for (const v of r) s += v * v;
  return s;
};

/**
 * Refina f, R e C (Levenberg–Marquardt; f em log, R por incrementos de Rodrigues) para os pares
 * [{X, u, v}]; o ponto principal fica no centro. Devolve {cam, custo (soma dos quadrados, px²), residuos}.
 */
export function refinar(cam0, pares, { iteracoes = 40 } = {}) {
  const lnfMin = Math.log(PLAUSIVEL.fMin * cam0.w);
  const lnfMax = Math.log(PLAUSIVEL.fMax * cam0.w);
  let cam = { ...cam0, R: cam0.R.map((l) => [...l]), C: [...cam0.C] };
  const m = 2 * pares.length;
  let r = residuosDe(cam, pares, new Array(m));
  let E = somaQuadrados(r);
  let lambda = 1e-3;
  const rj = new Array(m);
  for (let it = 0; it < iteracoes && E > 1e-18; it++) {
    const J = [];
    for (let j = 0; j < 7; j++) {
      const d = [0, 0, 0, 0, 0, 0, 0];
      d[j] = PASSOS[j];
      residuosDe(moverCamera(cam, d, -Infinity, Infinity), pares, rj);
      J.push(rj.map((v, k) => (v - r[k]) / PASSOS[j]));
    }
    const JtJ = J.map((a) => J.map((b) => a.reduce((s, v, k) => s + v * b[k], 0)));
    const g = J.map((a) => -a.reduce((s, v, k) => s + v * r[k], 0));
    let andou = false;
    for (let tentativa = 0; tentativa < 12; tentativa++) {
      const A = JtJ.map((l, i) => l.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const d = resolver(A, g);
      if (!d) {
        lambda *= 10;
        continue;
      }
      const nova = moverCamera(cam, d, lnfMin, lnfMax);
      const rn = residuosDe(nova, pares, new Array(m));
      const En = somaQuadrados(rn);
      if (En < E) {
        const ganho = (E - En) / E;
        cam = nova;
        r = rn;
        E = En;
        lambda = Math.max(lambda / 3, 1e-10);
        andou = ganho > 1e-12;
        break;
      }
      lambda *= 4;
    }
    if (!andou) break;
  }
  return { cam, custo: E, residuos: r };
}

/** O espalhamento de um ponto bem marcado (px, ref. 960): o clique mais o que o modelo sem distorção não explica. */
const SIGMA_CLIQUE = 1.0;

/**
 * Para cada ponto, o menor autovalor de I − H_ii, com H a matriz chapéu do ajuste (o bloco 2×2 do ponto):
 * perto de 1, os outros pontos determinam bem onde ele fica; perto de 0, quase só ele determina a câmera
 * naquela direção, e o resíduo "deixando um de fora" dele varia muito mesmo com o rótulo certo.
 */
function alavancas(cam, pares) {
  const m = 2 * pares.length;
  const r0 = residuosDe(cam, pares, new Array(m));
  const rj = new Array(m);
  const J = [];
  for (let j = 0; j < 7; j++) {
    const d = [0, 0, 0, 0, 0, 0, 0];
    d[j] = PASSOS[j];
    residuosDe(moverCamera(cam, d, -Infinity, Infinity), pares, rj);
    const col = rj.map((v, k) => (v - r0[k]) / PASSOS[j]);
    const nc = Math.hypot(...col) || 1; // colunas de norma 1: a matriz chapéu não muda e a conta fica estável
    J.push(col.map((v) => v / nc));
  }
  const JtJ = J.map((a, i) => J.map((b, j) => a.reduce((s, v, k) => s + v * b[k], 0) + (i === j ? 1e-10 : 0)));
  const inv = [];
  for (let j = 0; j < 7; j++) {
    const e = [0, 0, 0, 0, 0, 0, 0];
    e[j] = 1;
    const c = resolver(JtJ, e);
    if (!c) return null;
    inv.push(c);
  }
  const forma = (x, y) => {
    let s = 0;
    for (let p = 0; p < 7; p++) for (let t = 0; t < 7; t++) s += x[p] * inv[t][p] * y[t];
    return s;
  };
  return pares.map((_, i) => {
    const a = J.map((col) => col[2 * i]);
    const b = J.map((col) => col[2 * i + 1]);
    const m11 = 1 - forma(a, a);
    const m12 = -forma(a, b);
    const m22 = 1 - forma(b, b);
    const meio = (m11 + m22) / 2;
    return meio - Math.sqrt(Math.max(0, meio * meio - (m11 * m22 - m12 * m12)));
  });
}

/** Ordem de grandeza da distância focal para quando a homografia não a dá (um close, por exemplo). */
const GRADE_F = [0.4, 0.6, 0.9, 1.3, 1.9, 2.8, 4, 6, 9, 13, 20, 30];

/**
 * A câmera que melhor explica os pares [{X (mundo), u, v (px)}]: {cam, custo, residuos, via} ou {erro}
 * ("poucos": menos de 4 pontos no gramado em posição geral; "degenerado": a homografia não sai).
 */
export function ajustarCamera(pares, largura, altura) {
  const chao = pares.filter((p) => Math.abs(p.X[2]) < 1e-9);
  const mundo = chao.map((p) => [p.X[0], p.X[1]]);
  if (!emPosicaoGeral(mundo)) return { erro: "poucos" };
  const H = homografia(
    mundo,
    chao.map((p) => [p.u, p.v]),
  );
  if (!H) return { erro: "degenerado" };
  const escala = REF / largura;
  const candidatos = [];
  const tentar = (f, via) => {
    const c = decompor(H, largura, altura, mundo, f);
    if (c) candidatos.push({ ...refinar(c, pares), via });
  };
  tentar(null, "homografia");
  const rms = (x) => Math.sqrt(x.custo / pares.length) * escala;
  const bom = (x) => plausivel(x.cam) && rms(x) <= LIMITES.atencao;
  if (!candidatos.some(bom)) for (const k of GRADE_F) tentar(k * largura, "grade");
  if (!candidatos.length) return { erro: "degenerado" };
  const ordem = [...candidatos].sort((a, b) => Number(plausivel(b.cam)) - Number(plausivel(a.cam)) || a.custo - b.custo);
  return ordem[0];
}

// ------------------------------------------------------------------------------- a conferência
/**
 * Confere os pontos de um quadro: [{ponto, x, y}] na imagem largura × altura, num campo L × W (m). Devolve
 * {n, nChao, campo, cam, rms, residuos: [{ponto, x, y, px, loo, previsto, incerteza}], pior, nivel, avisos}:
 *  - px: distância (ref. 960) do ponto à projeção da câmera com todos os pontos;
 *  - loo: a mesma distância com a câmera refeita sem esse ponto (só com `LIMITES.folga` pontos ou mais);
 *    `previsto` é onde essa câmera põe o ponto, e `incerteza` o quanto os outros pontos o determinam (1:
 *    tanto quanto um clique; quanto maior, menos — o limite para acusar cresce junto);
 *  - nivel: "sem_camera", "sem_folga" (a câmera sai, mas a conferência é fraca), "ok", "atencao" ou
 *    "conferir"; avisos: [{codigo, nivel, ponto?, px?}].
 */
export function conferirQuadro(pontos, largura, altura, campo = { L: 105, W: 68 }) {
  const molde = Molde.doCampo(campo.L, campo.W);
  const pares = pontos.map((p) => ({ ponto: p.ponto, X: molde.ponto(p.ponto), u: p.x, v: p.y }));
  const n = pares.length;
  const nChao = pares.filter((p) => p.X[2] === 0).length;
  const escala = REF / largura;
  const base = { n, nChao, campo, cam: null, rms: null, residuos: [], pior: null };
  if (n < 4) return { ...base, nivel: "sem_camera", avisos: [{ codigo: "poucos_pontos", nivel: "info" }] };
  const aj = ajustarCamera(pares, largura, altura);
  if (aj.erro) return { ...base, nivel: "sem_camera", avisos: [{ codigo: aj.erro === "poucos" ? "poucos_no_chao" : "degenerado", nivel: "info" }] };
  const cam = aj.cam;
  const residuos = pares.map((p, i) => ({ ponto: p.ponto, x: p.u, y: p.v, px: Math.hypot(aj.residuos[2 * i], aj.residuos[2 * i + 1]) * escala, loo: null, previsto: null, incerteza: null }));
  const alavanca = alavancas(cam, pares);
  if (n >= LIMITES.folga) {
    for (let i = 0; i < n; i++) {
      const r = refinar(
        cam,
        pares.filter((_, j) => j !== i),
        { iteracoes: 20 },
      );
      const pr = projetar(r.cam, pares[i].X);
      residuos[i].previsto = pr;
      residuos[i].loo = pr ? Math.hypot(pr[0] - pares[i].u, pr[1] - pares[i].v) * escala : Infinity;
      // o quanto os outros pontos sabem dizer onde este fica (1 = tanto quanto o clique; ∞ = nada)
      residuos[i].incerteza = alavanca ? 1 / Math.sqrt(Math.max(alavanca[i], 1e-12)) : null;
    }
  }
  const rms = Math.sqrt(aj.custo / n) * escala;
  const avisos = [];
  if (!plausivel(cam)) avisos.push({ codigo: "impossivel", nivel: "conferir" });
  else if (cam.C[2] < 0) avisos.push({ codigo: "espelhado", nivel: "conferir" });
  else if (cam.C[1] > campo.W / 2) avisos.push({ codigo: "lado_oposto", nivel: "atencao" });
  // Um ponto conta contra o rótulo quando está longe (em px) E longe para o que os outros pontos sabem
  // dizer dele: o limite cresce com a incerteza da previsão (um ponto isolado num canto da imagem, que os
  // outros mal determinam, precisa estar bem mais longe para acusar).
  const forte = n >= LIMITES.folga;
  const limite = (x, k) => {
    if (n < 5) return Infinity; // com 4 pontos a câmera fecha quase sempre: não dá para acusar um ponto
    if (!forte) return k === "conferir" ? LIMITES.conferir / 2 : LIMITES.atencao / 2;
    if (x.incerteza === null || x.incerteza > 8) return Infinity; // os outros não dizem onde ele fica
    return Math.max(LIMITES[k], (k === "conferir" ? 4.5 : 3.5) * SIGMA_CLIQUE * x.incerteza);
  };
  const medida = (x) => (forte ? x.loo : x.px);
  const folgaDe = (x, k) => medida(x) / limite(x, k);
  let pior = null;
  for (const x of residuos) if (!pior || folgaDe(x, "atencao") > folgaDe(pior, "atencao")) pior = x;
  if (pior && avisos.every((a) => a.codigo !== "impossivel" && a.codigo !== "espelhado")) {
    if (folgaDe(pior, "conferir") > 1) avisos.push({ codigo: "ponto_fora", nivel: "conferir", ponto: pior.ponto, px: medida(pior) });
    else if (folgaDe(pior, "atencao") > 1) avisos.push({ codigo: "ponto_duvidoso", nivel: "atencao", ponto: pior.ponto, px: medida(pior) });
  }
  const nivel = avisos.some((a) => a.nivel === "conferir") ? "conferir" : avisos.some((a) => a.nivel === "atencao") ? "atencao" : n >= LIMITES.folga ? "ok" : "sem_folga";
  return { ...base, cam, rms, residuos, pior, nivel, avisos };
}

// ------------------------------------------------------------------------------- a medida do campo
/** As coordenadas de cada ponto como função afim de L e W: X = X0 + (L − 105) dX, Y = Y0 + (W − 68) dY. */
const AFIM = (() => {
  const a = Molde.doCampo(105, 68);
  const bL = Molde.doCampo(106, 68);
  const bW = Molde.doCampo(105, 69);
  return new Map(a.pontos.map((p) => [p.nome, { X: p.X, dX: bL.ponto(p.nome)[0] - p.X[0], dY: bW.ponto(p.nome)[1] - p.X[1] }]));
})();

const TETO = 8; // px (ref. 960): um quadro com rótulo errado não puxa a medida mais do que isto

/**
 * Mede o campo (comprimento L e largura W, em metros) pelos rótulos de uma partida: os quadros
 * [{pontos, largura, altura}] com 5 pontos ou mais no gramado em posição geral; a medida é a que deixa a
 * homografia de cada quadro mais justa (o erro de cada quadro tem teto, para um rótulo errado não puxar).
 * Só um quadro com pontos das duas metades, ou da lateral e da área, diz algo de L ou de W; sem nenhum,
 * fica a medida inicial. Devolve {L, W, quadrosL, quadrosW, antes, depois} (antes/depois: o erro médio).
 */
export function medirCampo(quadros, inicial = { L: 105, W: 68 }) {
  const uteis = [];
  for (const q of quadros) {
    const chao = q.pontos.filter((p) => AFIM.has(p.ponto) && AFIM.get(p.ponto).X[2] === 0);
    if (chao.length < 5) continue;
    const coef = chao.map((p) => AFIM.get(p.ponto));
    if (!emPosicaoGeral(coef.map((c) => [c.X[0], c.X[1]]))) continue;
    const variaL = new Set(coef.map((c) => c.dX.toFixed(6))).size > 1;
    const variaW = new Set(coef.map((c) => c.dY.toFixed(6))).size > 1;
    if (!variaL && !variaW) continue;
    uteis.push({ coef, destino: chao.map((p) => [p.x, p.y]), escala: REF / q.largura, variaL, variaW });
  }
  /** O erro quadrático (px², ref. 960, com teto) de cada quadro útil com o campo L × W. */
  const erros = (L, W, so = null) => {
    const out = [];
    for (const q of uteis) {
      if (so === "L" && !q.variaL) continue;
      if (so === "W" && !q.variaW) continue;
      const origem = q.coef.map((c) => [c.X[0] + (L - 105) * c.dX, c.X[1] + (W - 68) * c.dY]);
      const H = homografia(origem, q.destino);
      let e2 = TETO * TETO;
      if (H) {
        let soma = 0;
        origem.forEach((o, i) => {
          const p = aplicarH(H, o);
          soma += (p[0] - q.destino[i][0]) ** 2 + (p[1] - q.destino[i][1]) ** 2;
        });
        e2 = Math.min(e2, (soma / origem.length) * q.escala * q.escala);
      }
      out.push(e2);
    }
    return out;
  };
  const erro = (L, W, so = null) => {
    const e = erros(L, W, so);
    return e.length ? e.reduce((s, v) => s + v, 0) / e.length : 0;
  };
  const mediana = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const quadrosL = uteis.filter((q) => q.variaL).length;
  const quadrosW = uteis.filter((q) => q.variaW).length;
  let { L, W } = inicial;
  const buscar = (de, ate, passo, f) => {
    let melhor = de;
    let em = Infinity;
    for (let v = de; v <= ate + 1e-9; v += passo) {
      const e = f(v);
      if (e < em) {
        em = e;
        melhor = v;
      }
    }
    return melhor;
  };
  for (let volta = 0; volta < 2; volta++) {
    if (quadrosL) {
      L = buscar(90, 120, 0.5, (v) => erro(v, W, "L"));
      L = buscar(L - 0.5, L + 0.5, 0.05, (v) => erro(v, W, "L"));
    }
    if (quadrosW) {
      W = buscar(45, 90, 0.5, (v) => erro(L, v, "W"));
      W = buscar(W - 0.5, W + 0.5, 0.05, (v) => erro(L, v, "W"));
    }
  }
  // Só troca a medida quando ela explica claramente melhor o quadro típico (a mediana não se deixa levar
  // pelos rótulos errados, que ficam no teto com qualquer medida); o resto é ruído do clique.
  const antes = mediana(erros(inicial.L, inicial.W));
  const depois = mediana(erros(L, W));
  const troca = depois < 0.64 * antes && (Math.abs(L - inicial.L) >= 0.3 || Math.abs(W - inicial.W) >= 0.3);
  if (!troca) {
    L = inicial.L;
    W = inicial.W;
  }
  const arred = (v) => Math.round(v * 10) / 10;
  return { L: arred(L), W: arred(W), quadrosL, quadrosW, antes: Math.sqrt(antes), depois: Math.sqrt(troca ? depois : antes) };
}

// ------------------------------------------------------------------------------- para desenhar
/** As linhas do campo L × W vistas pela câmera: polilinhas [[u, v], ...] em px (só o que cai perto da imagem). */
export function linhasDoCampo(cam, campo = { L: 105, W: 68 }, passo = 0.5) {
  const molde = Molde.doCampo(campo.L, campo.W);
  const linhas = [];
  for (const el of molde.elementos) {
    let atual = [];
    for (const X of molde.amostras(el.nome, passo)) {
      const p = projetar(cam, X);
      const perto = p && p[0] > -cam.w && p[0] < 2 * cam.w && p[1] > -cam.h && p[1] < 2 * cam.h;
      if (perto) atual.push(p);
      else {
        if (atual.length > 1) linhas.push(atual);
        atual = [];
      }
    }
    if (atual.length > 1) linhas.push(atual);
  }
  return linhas;
}
