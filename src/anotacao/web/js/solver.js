// Ajuste da câmera ao que o anotador arrasta e trava (Levenberg–Marquardt em 8 parâmetros).
//
// Parâmetros: [pan, tilt, roll, log f, k1, Cx, Cy, Cz]. Os resíduos são em pixels na referência
// 960. A âncora em torno da câmera de partida decide o que se mexe: com um ponto só, giram pan e
// tilt; com dois, entram zoom e roll; com quatro, a posição; com cinco, a distorção. Assim o molde
// anda de um jeito previsível enquanto há poucas pistas.

import { Camera } from "./camera.js";

const N = 8;
const PASSOS = [1e-4, 1e-4, 1e-4, 1e-6, 1e-6, 1e-4, 1e-4, 1e-4];
const GRANDE = 1e3;

export function paramsDe(cam) {
  const [pan, tilt, roll] = cam.ptr;
  return [pan, tilt, roll, Math.log(cam.f), cam.k1, cam.C[0], cam.C[1], cam.C[2]];
}

export function cameraDe(p, w, h) {
  return Camera.dePtr(Math.exp(p[3]), p[0], p[1], p[2], [p[5], p[6], p[7]], w, h, p[4]);
}

/** Graus de liberdade das restrições: ponto vale 2, linha vale 1. */
export function grausDeLiberdade(restricoes) {
  return restricoes.reduce((s, r) => s + (r.tipo === "ponto" ? 2 : 1), 0);
}

/** Desvios da âncora (em torno da câmera de partida), conforme as pistas disponíveis. */
export function sigmasPadrao(restricoes) {
  const g = grausDeLiberdade(restricoes);
  const c = g >= 8 ? 4 : 0.01;
  return [30, 30, g >= 4 ? 3 : 0.02, g >= 4 ? 0.5 : 0.002, g >= 10 ? 0.05 : 0.0005, c, c, c];
}

/** Distância com sinal de um ponto à polilinha projetada (pedaços nulos quebram a linha). */
export function distanciaPolilinha(p, pts) {
  let melhor = Infinity;
  let sinal = 1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const apx = p[0] - a[0];
    const apy = p[1] - a[1];
    const den = abx * abx + aby * aby;
    const t = den > 1e-12 ? Math.min(1, Math.max(0, (apx * abx + apy * aby) / den)) : 0;
    const dx = a[0] + t * abx - p[0];
    const dy = a[1] + t * aby - p[1];
    const d = Math.hypot(dx, dy);
    if (d < melhor) {
      melhor = d;
      sinal = abx * apy - aby * apx >= 0 ? 1 : -1;
    }
  }
  return melhor === Infinity ? Infinity : sinal * melhor;
}

function residuos(p, restricoes, w, h, centro, sigmas) {
  const cam = cameraDe(p, w, h);
  const s = 960 / w;
  const r = [];
  for (const q of restricoes) {
    if (q.tipo === "ponto") {
      const px = cam.projetar(q.X);
      if (!px) {
        r.push(GRANDE, GRANDE);
      } else {
        r.push(((px[0] - q.alvo[0]) * s) / q.sigma, ((px[1] - q.alvo[1]) * s) / q.sigma);
      }
    } else {
      const d = distanciaPolilinha(q.alvo, q.amostras.map((X) => cam.projetar(X)));
      r.push(Number.isFinite(d) ? (d * s) / q.sigma : GRANDE);
    }
  }
  for (let i = 0; i < N; i++) r.push((p[i] - centro[i]) / sigmas[i]);
  r.push(p[2] / 5); // roll perto de zero
  r.push(p[4] / 0.15); // distorção perto de zero
  return r;
}

const soma2 = (r) => r.reduce((s, v) => s + v * v, 0);

function resolver(A, b) {
  const n = b.length;
  const M = A.map((linha, i) => [...linha, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[piv][c])) piv = i;
    if (Math.abs(M[piv][c]) < 1e-15) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let i = c + 1; i < n; i++) {
      const f = M[i][c] / M[c][c];
      for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Ajusta a câmera às restrições.
 * restricoes: [{tipo: "ponto", X, alvo: [u, v], sigma}, {tipo: "linha", amostras: [X...], alvo, sigma}]
 * ancora: câmera em torno da qual ficam as âncoras (padrão: a de partida).
 */
export function ajustar(partida, restricoes, { ancora = partida, iteracoes = 15, sigmas = null } = {}) {
  const w = partida.w;
  const h = partida.h;
  const centro = paramsDe(ancora);
  const sig = sigmas ?? sigmasPadrao(restricoes);
  let p = paramsDe(partida);
  let r = residuos(p, restricoes, w, h, centro, sig);
  let custo = soma2(r);
  let lambda = 1e-3;
  for (let it = 0; it < iteracoes; it++) {
    const m = r.length;
    const J = Array.from({ length: m }, () => new Array(N).fill(0));
    for (let k = 0; k < N; k++) {
      const pa = p.slice();
      const pb = p.slice();
      pa[k] += PASSOS[k];
      pb[k] -= PASSOS[k];
      const ra = residuos(pa, restricoes, w, h, centro, sig);
      const rb = residuos(pb, restricoes, w, h, centro, sig);
      for (let i = 0; i < m; i++) J[i][k] = (ra[i] - rb[i]) / (2 * PASSOS[k]);
    }
    const A = Array.from({ length: N }, () => new Array(N).fill(0));
    const g = new Array(N).fill(0);
    for (let i = 0; i < m; i++) {
      for (let a = 0; a < N; a++) {
        g[a] += J[i][a] * r[i];
        for (let b = a; b < N; b++) A[a][b] += J[i][a] * J[i][b];
      }
    }
    for (let a = 0; a < N; a++) for (let b = 0; b < a; b++) A[a][b] = A[b][a];
    let aceito = false;
    let passo = null;
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      const Ad = A.map((linha, i) => linha.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      passo = resolver(Ad, g.map((v) => -v));
      if (!passo) {
        lambda *= 10;
        continue;
      }
      const pn = p.map((v, i) => v + passo[i]);
      const rn = residuos(pn, restricoes, w, h, centro, sig);
      const cn = soma2(rn);
      if (cn < custo) {
        p = pn;
        r = rn;
        custo = cn;
        lambda = Math.max(lambda / 3, 1e-7);
        aceito = true;
        break;
      }
      lambda *= 4;
    }
    if (!aceito) break;
    if (Math.max(...passo.map((v, i) => Math.abs(v) / PASSOS[i])) < 10) break;
  }
  return cameraDe(p, w, h);
}
