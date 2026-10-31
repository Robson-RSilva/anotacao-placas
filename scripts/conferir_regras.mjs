// As marcações e pinturas simuladas de scripts/conferir_regras.py, contadas com as regras da própria
// página (web/js/nucleo/gabarito.js): quantos itens cada perfil acerta, por lote, e — nos lotes de
// treino das placas — a chance de estar liberado ao fim do lote, com os itens numa ordem sorteada (como
// cada pessoa recebe a sua), com o mínimo de itens da regra e sem ele.
//
//   node scripts/conferir_regras.mjs <pasta dos rótulos simulados>

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REGRA, compararPlacas, compararPontos, nTreino } from "../web/js/nucleo/gabarito.js";

const pasta = process.argv[2];
if (!pasta) {
  console.error("uso: node scripts/conferir_regras.mjs <pasta dos rótulos simulados>");
  process.exit(2);
}

const contas = new Map();
function contar(tarefa, perfil, lote, acerto, medida) {
  for (const chave of [`${tarefa}|${perfil}|${lote}`, `${tarefa}|${perfil}|(todos)`]) {
    if (!contas.has(chave)) contas.set(chave, { n: 0, certos: 0, medidas: [] });
    const c = contas.get(chave);
    c.n += 1;
    c.certos += acerto ? 1 : 0;
    if (medida !== null && Number.isFinite(medida)) c.medidas.push(medida);
  }
}
const mediana = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

for (const c of JSON.parse(readFileSync(join(pasta, "pontos.json"), "utf8"))) {
  const r = compararPontos(c.marcados, c.item);
  contar("pontos", c.perfil, c.lote, r.acerto, r.erro_mediano_px);
}
// por perfil e lote de treino: os acertos de cada item, em cada repetição (para sortear a liberação)
const treino = new Map();
for (const c of JSON.parse(readFileSync(join(pasta, "placas.json"), "utf8"))) {
  let acerto;
  let medida = null;
  if (c.resposta === "descartar") acerto = c.descartou;
  else if (c.descartou) acerto = false;
  else {
    const verdade = new Uint8Array(readFileSync(join(pasta, "placas", c.verdade)));
    const pintura = new Uint8Array(readFileSync(join(pasta, "placas", c.pintura)));
    const regiao = new Uint8Array(readFileSync(join(pasta, "placas", c.regiao)));
    const r = compararPlacas(pintura, verdade, c.largura, c.altura, c.n, regiao);
    acerto = r.acerto;
    medida = r.iou;
  }
  contar("placas", c.perfil, c.lote, acerto, medida);
  if (/treino/i.test(c.lote)) {
    const chave = `${c.perfil}|${c.lote}`;
    if (!treino.has(chave)) treino.set(chave, new Map());
    const porItem = treino.get(chave);
    if (!porItem.has(c.id)) porItem.set(c.id, []);
    porItem.get(c.id).push(acerto);
  }
}

console.log(`regras: ${JSON.stringify(REGRA)}\n`);
console.log("tarefa     perfil             lote          itens  certos  mediana (erro em px ref. 960 | IoU)");
for (const [chave, c] of [...contas.entries()].sort()) {
  const [tarefa, perfil, lote] = chave.split("|");
  const pct = `${Math.round((100 * c.certos) / c.n)}%`;
  console.log(`${tarefa.padEnd(10)} ${perfil.padEnd(18)} ${lote.padEnd(13)} ${String(c.n).padStart(5)}  ${pct.padStart(6)}  ${mediana(c.medidas).toFixed(3)}`);
}

// a liberação no lote de treino: os itens numa ordem sorteada, cada um com uma das repetições do perfil,
// contada como na página (nTreino: o primeiro ponto em que a pessoa estaria liberada)
let semente = 7; // mulberry32: o mesmo sorteio a cada vez
const aleatorio = () => {
  semente = (semente + 0x6d2b79f5) | 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const regra = REGRA.placas;
const semMinimo = { ...regra, minimo: 0 };
console.log(`\nplacas: liberado ao fim do lote de treino (meta: ${regra.meta}; sem o mínimo, só ${regra.k} dos últimos ${regra.n})`);
console.log("perfil             lote          liberado  sem o mínimo (itens até liberar, mediana)");
for (const [chave, porItem] of [...treino.entries()].sort()) {
  const [perfil, lote] = chave.split("|");
  const itens = [...porItem.values()];
  let liberados = 0;
  let semMin = 0;
  const ate = [];
  const vezes = 4000;
  for (let t = 0; t < vezes; t++) {
    const ordem = itens.map((v) => ({ v, s: aleatorio() })).sort((a, b) => a.s - b.s).map((x) => x.v);
    const res = ordem.map((v) => ({ acerto: v[Math.floor(aleatorio() * v.length)] }));
    if (nTreino(res, regra) !== -1) liberados += 1;
    const k = nTreino(res, semMinimo);
    if (k !== -1) {
      semMin += 1;
      ate.push(k);
    }
  }
  const pct = (x) => `${Math.round((100 * x) / vezes)}%`;
  console.log(`${perfil.padEnd(18)} ${lote.padEnd(13)} ${pct(liberados).padStart(8)}  ${pct(semMin).padStart(12)} (${mediana(ate)})`);
}
