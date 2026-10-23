// Medidas de qualidade dos rótulos, sempre em pixels na referência 960 (ADR-0001).

import { Camera } from "./camera.js";
import { comprimento, linspace, pontoNaFracao } from "./campo.js";
import { REF_W } from "./convencoes.js";
import { mediana, percentil } from "./estatistica.js";
import { amostrasPlacas } from "./pacote.js";

/** Menor distância de um ponto [x, y] a uma polilinha (pontos nulos quebram a linha). */
export function distanciaPolilinha(p, pts) {
  let melhor = Infinity;
  let algum = false;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    algum = true;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const den = Math.max(abx * abx + aby * aby, 1e-12);
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / den));
    melhor = Math.min(melhor, Math.hypot(a[0] + t * abx - p[0], a[1] + t * aby - p[1]));
  }
  if (!algum) {
    for (const q of pts) if (q) melhor = Math.min(melhor, Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  return melhor;
}

/** Distância (ref. 960) de cada ponto e linha travados até o molde desenhado pela câmera do rótulo. */
export function residuos(rotulo, molde, w, h) {
  if (!rotulo.camera) return [];
  const cam = Camera.deRotulo(rotulo.camera, w, h);
  const escala = REF_W / w;
  const out = [];
  for (const pino of rotulo.pontos_travados || []) {
    const px = cam.projetar(molde.ponto(pino.ponto));
    out.push(px ? Math.hypot(px[0] - pino.x, px[1] - pino.y) * escala : Infinity);
  }
  for (const pino of rotulo.linhas_travadas || []) {
    const pts = molde.amostras(pino.elemento, 0.25).map((X) => cam.projetar(X));
    out.push(distanciaPolilinha([pino.x, pino.y], pts) * escala);
  }
  return out;
}

export function residuoMediano(rotulo, molde, w, h) {
  return mediana(residuos(rotulo, molde, w, h).filter(Number.isFinite));
}

/** As mesmas marcações nos dois moldes (pontos nas mesmas frações de cada elemento, a cada ~`passo` m). */
function marcacoesCorrespondentes(moldeA, moldeB, passo = 1.0) {
  const pa = [];
  const pb = [];
  for (const ea of moldeA.elementos) {
    const eb = moldeB.elemento(ea.nome);
    for (const s of linspace(0, 1, Math.max(Math.ceil(comprimento(ea) / passo), 1) + 1)) {
      pa.push(pontoNaFracao(ea, s));
      pb.push(pontoNaFracao(eb, s));
    }
  }
  return [pa, pb];
}

/**
 * Mediana e p90 da distância (ref. 960) entre as placas desenhadas pelas duas câmeras.
 *
 * Usa os pontos das placas que a câmera `a` põe dentro da imagem; sem placas no quadro (ou no
 * molde, como no campo genérico), usa as marcações do campo, cada câmera com o molde do seu rótulo —
 * duas pessoas que esticaram o campo de jeitos diferentes desenham marcações diferentes. Devolve null
 * quando nem isso aparece.
 */
export function distanciaCameras(a, b, pacote, moldeA, w, h, moldeB = moldeA) {
  const ca = Camera.deRotulo(a, w, h);
  const cb = Camera.deRotulo(b, w, h);
  const placas = amostrasPlacas(pacote);
  for (const [PA, PB] of [[placas, placas], marcacoesCorrespondentes(moldeA, moldeB)]) {
    if (!PA.length) continue;
    const d = [];
    for (let i = 0; i < PA.length; i++) {
      const pa = ca.projetar(PA[i]);
      const pb = cb.projetar(PB[i]);
      if (!pa || !pb) continue;
      if (pa[0] < 0 || pa[0] >= w || pa[1] < 0 || pa[1] >= h) continue;
      d.push(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) * (REF_W / w));
    }
    if (d.length >= 4) return [mediana(d), percentil(d, 90)];
  }
  return null;
}
