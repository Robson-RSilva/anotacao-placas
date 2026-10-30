// As marcações e pinturas simuladas de scripts/conferir_regras.py, contadas com as regras da própria
// página (web/js/nucleo/gabarito.js): quantos itens cada perfil acerta, por lote.
//
//   node scripts/conferir_regras.mjs <pasta dos rótulos simulados>

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REGRA, compararPessoas, compararPontos } from "../web/js/nucleo/gabarito.js";

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
for (const c of JSON.parse(readFileSync(join(pasta, "pessoas.json"), "utf8"))) {
  const verdade = new Uint8Array(readFileSync(join(pasta, "pessoas", c.verdade)));
  const pintura = new Uint8Array(readFileSync(join(pasta, "pessoas", c.pintura)));
  const r = compararPessoas(pintura, verdade, c.largura, c.altura, c.n);
  contar("pessoas", c.perfil, c.lote, r.acerto, r.iou);
}

console.log(`regras: ${JSON.stringify(REGRA)}\n`);
console.log("tarefa     perfil             lote          itens  certos  mediana (erro em px ref. 960 | IoU)");
for (const [chave, c] of [...contas.entries()].sort()) {
  const [tarefa, perfil, lote] = chave.split("|");
  const pct = `${Math.round((100 * c.certos) / c.n)}%`;
  console.log(`${tarefa.padEnd(10)} ${perfil.padEnd(18)} ${lote.padEnd(13)} ${String(c.n).padStart(5)}  ${pct.padStart(6)}  ${mediana(c.medidas).toFixed(3)}`);
}
