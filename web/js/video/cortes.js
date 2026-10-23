// Cortes, transições e agrupamento das tomadas — só para organizar o sorteio. Nada aqui é rótulo:
// são as mesmas regras do laboratório (sem rede), usadas para escolher 1 ou 2 quadros por tomada e
// equilibrar o sorteio por aparência e zoom. tests/js/cortes.test.js confere com a v0.1 em Python.
//
// * Cortes: duas pistas com limiar adaptativo (quanto o quadro foge da vizinhança): qui-quadrado
//   entre histogramas HSV de quadros vizinhos (cor) e 1 - correlação de quadros reduzidos (estrutura).
// * Transições graduais: diferenças moderadas que se acumulam.
// * Grupo e zoom: k-médias sobre um descritor simples por tomada (histograma, fração de gramado e
//   densidade de bordas). É aproximado; depois da anotação, o tipo de câmera sai da própria câmera.

import { desvio, media, mediana } from "../nucleo/estatistica.js";

/**
 * (d_i - mediana local) / (MAD local + piso): quantos "desvios" o quadro foge da vizinhança. A
 * vizinhança de i são os `janela` quadros de cada lado, sem o próprio i e sem o quadro 0.
 */
export function razaoAdaptativa(d, janela = 15) {
  const n = d.length;
  const r = new Float64Array(n);
  if (n < 2) return r;
  const viz = [];
  const abs = [];
  for (let i = 0; i < n; i++) {
    viz.length = 0;
    for (let j = Math.max(1, i - janela); j <= Math.min(n - 1, i + janela); j++) if (j !== i) viz.push(d[j]);
    if (!viz.length) continue;
    const med = mediana(viz);
    abs.length = 0;
    for (const v of viz) abs.push(Math.abs(v - med));
    const mad = 1.4826 * mediana(abs);
    r[i] = (d[i] - med) / (mad + 1e-3 + 0.1 * med);
  }
  r[0] = 0;
  return r;
}

/** Índices i com corte entre i-1 e i (os mesmos limiares do laboratório). */
export function detectarCortes(dHist, dEstr, { janela = 15, rHist = 12, rEstr = 30, minHist = 0.03, minEstr = 0.05, intervaloMin = 3 } = {}) {
  const r1 = razaoAdaptativa(dHist, janela);
  const r2 = razaoAdaptativa(dEstr, janela);
  const cortes = [];
  for (let i = 1; i < dHist.length; i++) {
    const hit = (r1[i] > rHist && dHist[i] > minHist) || (r2[i] > rEstr && dEstr[i] > minEstr);
    if (hit && (!cortes.length || i - cortes[cortes.length - 1] >= intervaloMin)) cortes.push(i);
  }
  return cortes;
}

/** Fusões: sequências de diferenças moderadas cuja soma passa `tAlto` -> [[i0, i1)]. */
export function detectarGraduais(dHist, cortes = [], { tBaixo = 0.04, tAlto = 0.35, maxLen = 25 } = {}) {
  const out = [];
  const n = dHist.length;
  const c = new Set(cortes);
  let i = 1;
  while (i < n) {
    if (dHist[i] > tBaixo && !c.has(i)) {
      let j = i;
      let acc = 0;
      while (j < n && dHist[j] > tBaixo && j - i < maxLen && !c.has(j)) {
        acc += dHist[j];
        j += 1;
      }
      if (acc > tAlto && j - i >= 3) out.push([i, j]);
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out;
}

/** Tomadas entre os cortes: [{i0, i1, replay: null, zoom, grupo}]. */
export function montarTomadas(n, cortes) {
  const bordas = [0, ...[...new Set(cortes)].filter((b) => b > 0 && b < n).sort((a, b) => a - b), n];
  const out = [];
  for (let k = 0; k + 1 < bordas.length; k++) {
    if (bordas[k + 1] > bordas[k]) out.push({ i0: bordas[k], i1: bordas[k + 1], replay: null, zoom: "medio", grupo: 0 });
  }
  return out;
}

const dist2 = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
};

/** k-médias com inicialização k-means++ (determinística pelo gerador). Rótulos em ordem de aparição. */
export function kMedias(X, k, aleatorio, iteracoes = 30) {
  const n = X.length;
  const kk = Math.max(1, Math.min(k, n));
  const centros = [Float64Array.from(X[aleatorio.inteiro(n)])];
  for (let c = 1; c < kk; c++) {
    const d2 = X.map((x) => Math.min(...centros.map((ct) => dist2(x, ct))));
    centros.push(Float64Array.from(X[aleatorio.ponderado(d2)]));
  }
  let rot = new Int32Array(n).fill(-1);
  for (let it = 0; it < iteracoes; it++) {
    const novo = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let melhor = 0;
      let dm = Infinity;
      for (let c = 0; c < centros.length; c++) {
        const d = dist2(X[i], centros[c]);
        if (d < dm) {
          dm = d;
          melhor = c;
        }
      }
      novo[i] = melhor;
    }
    if (novo.every((v, i) => v === rot[i])) break;
    rot = novo;
    for (let c = 0; c < centros.length; c++) {
      const membros = X.filter((_, i) => rot[i] === c);
      if (!membros.length) continue;
      centros[c] = Float64Array.from(centros[c].map((_, j) => membros.reduce((s, x) => s + x[j], 0) / membros.length));
    }
  }
  const ordem = new Map();
  for (const v of rot) if (!ordem.has(v)) ordem.set(v, ordem.size);
  return Array.from(rot, (v) => ordem.get(v));
}

/**
 * Preenche `grupo` e `zoom` de cada tomada. `curtos`: Map índice do quadro -> histograma curto
 * (alguns quadros por segundo); `gramado` e `bordas`: um valor por quadro.
 */
export function agrupar(tomadas, curtos, gramado, bordas, aleatorio, k = 6) {
  if (!tomadas.length) return;
  const indices = [...curtos.keys()].sort((a, b) => a - b);
  const feats = [];
  const G = [];
  const B = [];
  for (const t of tomadas) {
    let idx = indices.filter((i) => i >= t.i0 && i < t.i1);
    if (!idx.length) idx = [indices.reduce((m, i) => (Math.abs(i - t.i0) < Math.abs(m - t.i0) ? i : m), indices[0])];
    const dim = curtos.get(idx[0]).length;
    const f = new Float64Array(dim);
    for (const i of idx) {
      const h = curtos.get(i);
      for (let j = 0; j < dim; j++) f[j] += h[j] / idx.length;
    }
    const norma = Math.sqrt(f.reduce((s, v) => s + v * v, 0)) + 1e-9;
    feats.push(f.map((v) => (2 * v) / norma));
    G.push(media(gramado.slice(t.i0, t.i1)));
    B.push(media(bordas.slice(t.i0, t.i1)));
  }
  const z = (v) => {
    const m = media(v);
    const s = desvio(v) + 1e-9;
    return v.map((x) => (x - m) / s);
  };
  const zg = z(G);
  const zb = z(B);
  const X = feats.map((f, i) => [...f, zg[i], zb[i]]);
  const rot = kMedias(X, k, aleatorio);
  const mb = mediana(B) ?? 0;
  tomadas.forEach((t, i) => {
    t.grupo = rot[i];
    if (G[i] < 0.25 || B[i] < 0.5 * mb) t.zoom = "fechado";
    else if (G[i] >= 0.5 && B[i] >= mb) t.zoom = "aberto";
    else t.zoom = "medio";
  });
}

/** PTS crescente garantido: os do contêiner, ou índice / fps quando não dá para confiar neles. */
export function corrigirPts(pts, fps) {
  const n = pts.length;
  const porIndice = () => Float64Array.from({ length: n }, (_, i) => (i * 1000) / fps);
  if (n < 2) return { pts: porIndice(), fonte: "indice" };
  for (let i = 1; i < n; i++) if (!(Math.round(pts[i]) > Math.round(pts[i - 1]))) return { pts: porIndice(), fonte: "indice" };
  return { pts: Float64Array.from(pts), fonte: "conteiner" };
}
