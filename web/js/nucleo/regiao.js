// Polígonos em pixels: o laço do pintor e a região da placa no recorte (o que se pinta). Vale o centro
// do pixel, linha a linha, com a regra par-ímpar — as mesmas contas, na mesma ordem, do `rasterizar`
// de src/anotacao/mascara.py: a região dá os mesmos pixels nas páginas e no Python
// (tests/js/regiao.test.js confere com tests/fixtures/regioes.json, gerado pelo Python).

/** Preenche um polígono (px da imagem): o centro do pixel decide; chama `aoTrecho(y, x0, x1)` com [x0, x1). */
export function rasterizar(pol, w, h, aoTrecho) {
  if (!pol || pol.length < 3) return;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const p of pol) {
    if (p[1] < ymin) ymin = p[1];
    if (p[1] > ymax) ymax = p[1];
  }
  const y0 = Math.max(0, Math.ceil(ymin - 0.5));
  const y1 = Math.min(h - 1, Math.ceil(ymax - 0.5) - 1);
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const Y = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
      const ya = pol[j][1];
      const yb = pol[i][1];
      if ((ya <= Y && Y < yb) || (yb <= Y && Y < ya)) xs.push(pol[j][0] + ((Y - ya) / (yb - ya)) * (pol[i][0] - pol[j][0]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xi = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xf = Math.min(w, Math.ceil(xs[k + 1] - 0.5));
      if (xf > xi) aoTrecho(y, xi, xf);
    }
  }
}

const _cache = new WeakMap(); // polígono (o array do item) -> {w, h, mascara}

/** Os pixels dentro do polígono (Uint8Array w * h: 1 dentro, 0 fora), guardados por polígono. */
export function mascaraDaRegiao(pol, w, h) {
  const hit = _cache.get(pol);
  if (hit && hit.w === w && hit.h === h) return hit.mascara;
  const m = new Uint8Array(w * h);
  rasterizar(pol, w, h, (y, a, b) => m.fill(1, y * w + a, y * w + b));
  if (pol && typeof pol === "object") _cache.set(pol, { w, h, mascara: m });
  return m;
}

/** Os pixels de uma máscara (diferentes de 0) fora da região. */
export function foraDaRegiao(mascara, regiao) {
  let n = 0;
  for (let i = 0; i < mascara.length; i++) if (mascara[i] && !regiao[i]) n += 1;
  return n;
}
