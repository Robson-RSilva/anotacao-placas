// Descritores de um quadro reduzido (160 x 90, RGBA) para achar cortes e agrupar tomadas — as mesmas
// contas da v0.1 em OpenCV (HSV de 8 bits, histogramas, estrutura 64 x 36 com desfoque, fração de
// gramado e densidade de bordas pelo Canny), feitas aqui à mão. tests/js/descritores.test.js
// compara com os valores do OpenCV guardados em tests/fixtures/cortes_referencia.json.

export const LARGURA = 160;
export const ALTURA = 90;
const EW = 64;
const EH = 36;

// ------------------------------------------------------------------ cor (OpenCV, 8 bits)
const DESLOC = 12;
const ARRED = 1 << (DESLOC - 1);
const arredPar = (x) => {
  const f = Math.floor(x);
  const d = x - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
};
const TAB_S = new Int32Array(256);
const TAB_H = new Int32Array(256);
for (let i = 1; i < 256; i++) {
  TAB_S[i] = arredPar((255 << DESLOC) / i);
  TAB_H[i] = arredPar((180 << DESLOC) / (6 * i));
}

/** RGBA -> planos H (0..179), S, V e cinza, como `cv2.cvtColor` (BGR2HSV e BGR2GRAY). */
export function planos(rgba, n = LARGURA * ALTURA) {
  const H = new Uint8Array(n);
  const S = new Uint8Array(n);
  const V = new Uint8Array(n);
  const G = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = rgba[j];
    const g = rgba[j + 1];
    const b = rgba[j + 2];
    let v = b;
    if (g > v) v = g;
    if (r > v) v = r;
    let vmin = b;
    if (g < vmin) vmin = g;
    if (r < vmin) vmin = r;
    const diff = v - vmin;
    const vr = v === r ? -1 : 0;
    const vg = v === g ? -1 : 0;
    const s = (diff * TAB_S[v] + ARRED) >> DESLOC;
    let h = (vr & (g - b)) + (~vr & ((vg & (b - r + 2 * diff)) + (~vg & (r - g + 4 * diff))));
    h = (h * TAB_H[diff] + ARRED) >> DESLOC;
    if (h < 0) h += 180;
    H[i] = h;
    S[i] = s;
    V[i] = v;
    G[i] = (r * 4899 + g * 9617 + b * 1868 + 8192) >> 14;
  }
  return { H, S, V, G };
}

const tabela = (n, bins, faixa) => Uint8Array.from({ length: n }, (_, v) => Math.floor((v * bins) / faixa));
const BINS = {
  16: { h: tabela(256, 16, 180), s: tabela(256, 8, 256), v: tabela(256, 8, 256), bs: 8, bv: 8 },
  8: { h: tabela(256, 8, 180), s: tabela(256, 4, 256), v: tabela(256, 4, 256), bs: 4, bv: 4 },
};

function histograma(H, S, V, bh) {
  const t = BINS[bh];
  const out = new Float64Array(bh * t.bs * t.bv);
  const n = H.length;
  for (let i = 0; i < n; i++) out[(t.h[H[i]] * t.bs + t.s[S[i]]) * t.bv + t.v[V[i]]] += 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

// ------------------------------------------------------------------ estrutura
/** Pesos da redução por área (INTER_AREA) de `n` para `m` amostras, como no OpenCV. */
function pesosArea(n, m) {
  const escala = n / m;
  const out = [];
  for (let d = 0; d < m; d++) {
    const f1 = d * escala;
    const f2 = f1 + escala;
    const s1 = Math.ceil(f1);
    const s2 = Math.floor(f2);
    const largura = Math.min(escala, n - f1);
    const w = [];
    if (s1 - f1 > 1e-3) w.push([s1 - 1, (s1 - f1) / largura]);
    for (let s = s1; s < s2; s++) w.push([s, 1 / largura]);
    if (f2 - s2 > 1e-3 && s2 < n) w.push([s2, Math.min(Math.min(f2 - s2, 1), n - s2) / largura]);
    out.push(w);
  }
  // achatado: inicio[d]..inicio[d+1] em idx/peso
  const inicio = new Int32Array(m + 1);
  const idx = [];
  const peso = [];
  out.forEach((w, d) => {
    inicio[d] = idx.length;
    for (const [i, p] of w) {
      idx.push(i);
      peso.push(p);
    }
  });
  inicio[m] = idx.length;
  return { inicio, idx: Int32Array.from(idx), peso: Float64Array.from(peso) };
}
const PX = pesosArea(LARGURA, EW);
const PY = pesosArea(ALTURA, EH);
const REFL_X = Int32Array.from({ length: EW + 8 }, (_, i) => refletirIdx(i - 4, EW));
const REFL_Y = Int32Array.from({ length: EH + 8 }, (_, i) => refletirIdx(i - 4, EH));
function refletirIdx(i, n) {
  return i < 0 ? -i : i >= n ? 2 * n - 2 - i : i;
}

const NUCLEO = (() => {
  const k = [];
  let soma = 0;
  for (let i = -4; i <= 4; i++) {
    const v = Math.exp(-(i * i) / 2);
    k.push(v);
    soma += v;
  }
  return k.map((v) => v / soma);
})();

/** Cinza 160x90 -> 64x36 por área, desfoque gaussiano (σ = 1), média zero e norma 1. */
export function estrutura(G) {
  const tmp = new Float64Array(LARGURA * EH);
  for (let y = 0; y < EH; y++) {
    const a = PY.inicio[y];
    const b = PY.inicio[y + 1];
    for (let x = 0; x < LARGURA; x++) {
      let s = 0;
      for (let k = a; k < b; k++) s += PY.peso[k] * G[PY.idx[k] * LARGURA + x];
      tmp[y * LARGURA + x] = s;
    }
  }
  const red = new Float64Array(EW * EH);
  for (let y = 0; y < EH; y++) {
    for (let x = 0; x < EW; x++) {
      let s = 0;
      for (let k = PX.inicio[x]; k < PX.inicio[x + 1]; k++) s += PX.peso[k] * tmp[y * LARGURA + PX.idx[k]];
      red[y * EW + x] = Math.min(255, Math.max(0, arredPar(s)));
    }
  }
  const h = new Float64Array(EW * EH);
  for (let y = 0; y < EH; y++) {
    const o = y * EW;
    for (let x = 0; x < EW; x++) {
      let s = 0;
      for (let k = 0; k < 9; k++) s += NUCLEO[k] * red[o + REFL_X[x + k]];
      h[o + x] = s;
    }
  }
  const out = new Float64Array(EW * EH);
  let media = 0;
  for (let y = 0; y < EH; y++) {
    for (let x = 0; x < EW; x++) {
      let s = 0;
      for (let k = 0; k < 9; k++) s += NUCLEO[k] * h[REFL_Y[y + k] * EW + x];
      out[y * EW + x] = s;
      media += s;
    }
  }
  media /= out.length;
  let norma = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] -= media;
    norma += out[i] * out[i];
  }
  norma = Math.sqrt(norma) + 1e-6;
  for (let i = 0; i < out.length; i++) out[i] /= norma;
  return out;
}

// ------------------------------------------------------------------ bordas (Canny 80/160, L1)
const TG22 = 13573; // tan(22,5°) em ponto fixo (2^15), como no OpenCV

/** Fração de pixels de borda pelo Canny (abertura 3, norma L1), como `cv2.Canny(g, 80, 160)`. */
export function densidadeBordas(G, w = LARGURA, h = ALTURA, baixo = 80, alto = 160) {
  const W2 = w + 2;
  // cinza com a borda replicada, para o Sobel 3x3
  const P = new Int32Array(W2 * (h + 2));
  for (let y = -1; y <= h; y++) {
    const yy = Math.min(h - 1, Math.max(0, y));
    for (let x = -1; x <= w; x++) P[(y + 1) * W2 + x + 1] = G[yy * w + Math.min(w - 1, Math.max(0, x))];
  }
  const dx = new Int32Array(w * h);
  const dy = new Int32Array(w * h);
  const mag = new Int32Array(W2 * (h + 2)); // borda de zeros em volta
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y + 1) * W2 + x + 1;
      const a = P[j - W2 - 1];
      const b = P[j - W2];
      const c = P[j - W2 + 1];
      const d = P[j - 1];
      const f = P[j + 1];
      const g = P[j + W2 - 1];
      const hh = P[j + W2];
      const k = P[j + W2 + 1];
      const gx = c + 2 * f + k - (a + 2 * d + g);
      const gy = g + 2 * hh + k - (a + 2 * b + c);
      dx[y * w + x] = gx;
      dy[y * w + x] = gy;
      mag[j] = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
    }
  }
  // 0: pode ser borda; 1: não é; 2: é borda
  const mapa = new Uint8Array(W2 * (h + 2)).fill(1);
  const pilha = new Int32Array(w * h);
  let topo = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y + 1) * W2 + x + 1;
      const m = mag[j];
      if (m <= baixo) continue;
      const xs = dx[y * w + x];
      const ys = dy[y * w + x];
      const ax = xs < 0 ? -xs : xs;
      const ay = (ys < 0 ? -ys : ys) * 32768;
      const tg22x = ax * TG22;
      let maximo;
      if (ay < tg22x) {
        maximo = m > mag[j - 1] && m >= mag[j + 1];
      } else if (ay > tg22x + ax * 65536) {
        maximo = m > mag[j - W2] && m >= mag[j + W2];
      } else {
        const s = (xs ^ ys) < 0 ? -1 : 1;
        maximo = m > mag[j - W2 - s] && m > mag[j + W2 + s];
      }
      if (!maximo) continue;
      if (m > alto) {
        mapa[j] = 2;
        pilha[topo++] = j;
      } else {
        mapa[j] = 0;
      }
    }
  }
  const passo = W2;
  while (topo > 0) {
    const j = pilha[--topo];
    for (const d of [-passo - 1, -passo, -passo + 1, -1, 1, passo - 1, passo, passo + 1]) {
      if (mapa[j + d] === 0) {
        mapa[j + d] = 2;
        pilha[topo++] = j + d;
      }
    }
  }
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mapa[(y + 1) * passo + x + 1] === 2) n += 1;
  return n / (w * h);
}

/** Tudo o que o sorteio precisa de um quadro 160 x 90 RGBA. */
export function descrever(rgba) {
  const { H, S, V, G } = planos(rgba);
  let gramado = 0;
  for (let i = 0; i < H.length; i++) if (H[i] > 30 && H[i] < 90 && S[i] > 50 && V[i] > 35) gramado += 1;
  return {
    hist: histograma(H, S, V, 16),
    histCurto: Float32Array.from(histograma(H, S, V, 8)),
    estrutura: estrutura(G),
    gramado: gramado / H.length,
    bordas: densidadeBordas(G),
  };
}

/** Qui-quadrado entre histogramas (a mesma conta da v0.1). */
export function qui2(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += (d * d) / (a[i] + b[i] + 1e-12);
  }
  return 0.5 * s;
}

/** 1 - correlação entre as estruturas (já normalizadas). */
export function distanciaEstrutura(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return 1 - s;
}
