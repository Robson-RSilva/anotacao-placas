// Pequenas contas de estatística com a mesma definição do NumPy (mediana e percentil linear).

/** Mediana como `np.median`: com quantidade par, a média dos dois do meio. Lista vazia -> null. */
export function mediana(valores) {
  const v = Array.from(valores).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return null;
  const m = n >> 1;
  return n % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Percentil como `np.percentile` (interpolação linear). Lista vazia -> null. */
export function percentil(valores, p) {
  const v = Array.from(valores).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return null;
  const pos = (p / 100) * (n - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < n ? v[i] + f * (v[i + 1] - v[i]) : v[n - 1];
}

/** Média de uma lista (vazia -> NaN, como no NumPy). */
export function media(valores) {
  let s = 0;
  let n = 0;
  for (const x of valores) {
    s += x;
    n += 1;
  }
  return n ? s / n : NaN;
}

/** Desvio-padrão populacional (`np.std`). */
export function desvio(valores) {
  const m = media(valores);
  let s = 0;
  let n = 0;
  for (const x of valores) {
    s += (x - m) ** 2;
    n += 1;
  }
  return n ? Math.sqrt(s / n) : NaN;
}

/** Arredonda para `casas` casas decimais (para exibir e gravar números curtos). */
export function arredondar(x, casas = 2) {
  if (x === null || x === undefined || !Number.isFinite(x)) return x;
  const f = 10 ** casas;
  return Math.round(x * f) / f;
}
