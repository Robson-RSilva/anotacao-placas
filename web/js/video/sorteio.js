// Sorteio dos quadros para anotar e distribuição na equipe.
//
// Variedade vem da amostragem, não do volume: no máximo 1 ou 2 quadros por tomada (quadros vizinhos
// são quase iguais), longe dos cortes e fora das transições, com a cota dividida entre os grupos de
// aparência para que tomadas raras (câmera atrás do gol, close) não sumam no meio das da principal.
//
// Cerca de 10% dos quadros vão em dupla às cegas (duas pessoas anotam do zero, para medir a
// concordância) e outros ~10% começam sem previsão (para medir o viés de ancoragem). Tudo é
// determinístico pela semente da partida: sortear de novo dá o mesmo resultado.

import { arredondarPar, idQuadro } from "../nucleo/convencoes.js";

export const PARAMETROS = Object.freeze({
  alvo: 100,
  margem_s: 0.4,
  max_por_tomada: 2,
  tomada_longa_s: 6.0,
  frac_dupla: 0.1,
  frac_sem_previsao: 0.1,
});

/** Quadros elegíveis de uma tomada: longe das bordas e fora das transições. */
export function elegiveis(t, pts, transicao, margemMs) {
  const out = [];
  for (let i = t.i0; i < t.i1; i++) {
    if (!transicao[i] && pts[i] >= pts[t.i0] + margemMs && pts[i] <= pts[t.i1 - 1] - margemMs) out.push(i);
  }
  if (!out.length && t.i1 - t.i0 >= 3) {
    const meio = (t.i0 + t.i1) >> 1;
    if (!transicao[meio]) out.push(meio);
  }
  return out;
}

/** Divide `alvo` entre grupos na proporção dos pesos, sem passar da capacidade de cada um. */
export function repartir(alvo, pesos, capacidade) {
  const grupos = [...pesos.keys()];
  const cota = new Map(grupos.map((g) => [g, 0]));
  let restante = Math.min(alvo, [...capacidade.values()].reduce((s, v) => s + v, 0));
  let abertos = grupos.filter((g) => capacidade.get(g) > 0);
  while (restante > 0 && abertos.length) {
    const soma = abertos.reduce((s, g) => s + pesos.get(g), 0);
    const ideal = new Map(abertos.map((g) => [g, (restante * pesos.get(g)) / soma]));
    let dado = 0;
    for (const g of [...abertos].sort((a, b) => ideal.get(b) - ideal.get(a) || a - b)) {
      const q = Math.min(capacidade.get(g) - cota.get(g), Math.max(1, arredondarPar(ideal.get(g))), restante - dado);
      if (q <= 0) continue;
      cota.set(g, cota.get(g) + q);
      dado += q;
    }
    restante -= dado;
    abertos = abertos.filter((g) => cota.get(g) < capacidade.get(g));
    if (dado === 0) break;
  }
  return cota;
}

/**
 * Sorteia os quadros: [{quadro, tomada, i, pts_ms, dupla, sem_previsao}], em ordem de tempo.
 * `params`: os de PARAMETROS; `aleatorio`: o gerador da partida.
 */
export function sortear(tomadas, pts, transicao, params, aleatorio) {
  const p = { ...PARAMETROS, ...params };
  const eleg = new Map();
  tomadas.forEach((t, k) => {
    const e = elegiveis(t, pts, transicao, p.margem_s * 1000);
    if (e.length) eleg.set(k, e);
  });
  if (!eleg.size) return [];
  const capacidadeTomada = (k) => {
    const t = tomadas[k];
    const longa = pts[t.i1 - 1] - pts[t.i0] >= p.tomada_longa_s * 1000;
    return Math.min(eleg.get(k).length, longa ? p.max_por_tomada : 1);
  };
  const porGrupo = new Map();
  for (const k of eleg.keys()) {
    const g = tomadas[k].grupo;
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g).push(k);
  }
  const pesos = new Map([...porGrupo].map(([g, ks]) => [g, Math.sqrt(ks.length)]));
  const cap = new Map([...porGrupo].map(([g, ks]) => [g, ks.reduce((s, k) => s + capacidadeTomada(k), 0)]));
  const cota = repartir(p.alvo, pesos, cap);

  const escolhidos = [];
  for (const g of [...porGrupo.keys()].sort((a, b) => a - b)) {
    const ks = porGrupo.get(g);
    const q = cota.get(g);
    if (q <= 0) continue;
    const ordem = aleatorio.permutacao(ks.length).map((j) => ks[j]);
    const primeira = ordem.slice(0, Math.min(q, ordem.length));
    for (const k of primeira) {
      const e = eleg.get(k);
      escolhidos.push([k, e[aleatorio.inteiro(e.length)]]);
    }
    let faltam = q - primeira.length;
    for (const k of ordem) {
      if (faltam <= 0) break;
      if (capacidadeTomada(k) < 2) continue;
      const e = eleg.get(k);
      const ja = escolhidos.find(([kk]) => kk === k)[1];
      const minimo = Math.max(1, Math.floor((e[e.length - 1] - e[0]) / 3));
      const longe = e.filter((i) => Math.abs(i - ja) >= minimo);
      if (longe.length) {
        escolhidos.push([k, longe[aleatorio.inteiro(longe.length)]]);
        faltam -= 1;
      }
    }
  }
  const vistos = new Map();
  for (const [k, i] of escolhidos.sort((a, b) => a[1] - b[1])) {
    const q = idQuadro(pts[i]);
    if (!vistos.has(q)) vistos.set(q, { quadro: q, tomada: k, i, pts_ms: arredondarPar(pts[i]), dupla: false, sem_previsao: false });
  }
  const out = [...vistos.values()];
  const n = out.length;
  for (const [frac, campo] of [[p.frac_dupla, "dupla"], [p.frac_sem_previsao, "sem_previsao"]]) {
    const m = arredondarPar(frac * n);
    if (m) for (const j of aleatorio.amostra(n, Math.min(m, n))) out[j][campo] = true;
  }
  return out;
}

/** Quem anota cada quadro: rodízio embaralhado; quadro em dupla vai para duas pessoas diferentes. */
export function atribuir(sorteados, anotadores, aleatorio) {
  if (!anotadores.length) return sorteados.map(() => []);
  const ordem = aleatorio.permutacao(anotadores.length).map((j) => anotadores[j]);
  return sorteados.map((s, k) => {
    const a = ordem[k % ordem.length];
    return s.dupla && ordem.length > 1 ? [a, ordem[(k + 1) % ordem.length]] : [a];
  });
}
