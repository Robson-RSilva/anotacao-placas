// Placar de cada tarefa: aprovados, devolvidos, descartes, concordância dos rótulos às cegas, gabarito
// e progresso das partidas.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Molde } from "../../web/js/nucleo/campo.js";
import { calcularPlacar, concordanciaPessoas, concordanciaPontos } from "../../web/js/nucleo/placar.js";
import { formatarDuracao } from "../../web/js/ui/util.js";
import { AGORA, criarGabaritoPontos, criarPartida, esquemas, gravarPessoas, gravarPontos, gravarRevisao, pastaExemplo } from "./apoio.js";

await esquemas();

const quadro = (k) => `t${String(1000 * (k + 1)).padStart(10, "0")}`;
const P = [{ ponto: "centro", x: 320, y: 180 }, { ponto: "meio_cab", x: 330, y: 340 }, { ponto: "meio_opo", x: 300, y: 40 }];

test("concordância dos pontos: a distância mediana dos que os dois marcaram, de qualquer lado do campo", () => {
  const r1 = { largura: 640, pontos: P };
  const r2 = { largura: 640, pontos: P.map((p, k) => ({ ...p, x: p.x + k })) }; // 0, 1 e 2 px
  assert.equal(concordanciaPontos(r1, r2), 1.5); // 1 px de 640 = 1,5 px na referência 960
  const campo = Molde.doCampo();
  const girado = { largura: 640, pontos: P.map((p) => ({ ...p, ponto: campo.espelharPonto(p.ponto) })) };
  assert.equal(concordanciaPontos(r1, girado), 0);
  assert.equal(concordanciaPontos(r1, { largura: 640, pontos: [{ ponto: "penalti_dir", x: 1, y: 1 }] }), null);
});

test("concordância das pessoas: a sobreposição, sem a borda de 1 px", () => {
  const w = 20;
  const h = 10;
  const a = new Uint8Array(w * h);
  const b = new Uint8Array(w * h);
  for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) a[y * w + x] = 1;
  for (let y = 2; y < 8; y++) for (let x = 3; x < 9; x++) b[y * w + x] = 1; // 1 px ao lado
  assert.equal(concordanciaPessoas(a, a, w, h), 1);
  assert.equal(concordanciaPessoas(a, b, w, h), 1); // 1 px de diferença na borda não conta
  const c = new Uint8Array(w * h);
  for (let y = 2; y < 8; y++) for (let x = 12; x < 18; x++) c[y * w + x] = 1;
  assert.equal(concordanciaPessoas(a, c, w, h), 0);
  assert.equal(concordanciaPessoas(new Uint8Array(w * h), new Uint8Array(w * h), w, h), 1);
});

test("placar: aprovados, devolvidos, descartes, concordância dos cegos e progresso das partidas", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{ dupla: true }, {}, {}, {}]);
  const n1 = await gravarPontos(pasta, { quadro: quadro(0), pessoa: "A01", pontos: P });
  const n2 = await gravarPontos(pasta, { quadro: quadro(0), pessoa: "A02", pontos: P.map((p) => ({ ...p, x: p.x + 2 })), m: 5 });
  const n3 = await gravarPontos(pasta, { quadro: quadro(1), pessoa: "A01", pontos: P, m: 6 });
  await gravarPontos(pasta, { quadro: quadro(2), pessoa: "A01", pontos: P, m: 7 });
  const n4 = await gravarPontos(pasta, { quadro: quadro(3), pessoa: "A01", pontos: null, m: 8 }); // descartada
  await gravarRevisao(pasta, { quadro: quadro(0), rotulo: n1, revisor: "A02", m: 10 });
  await gravarRevisao(pasta, { quadro: quadro(0), rotulo: n2, revisor: "A01", m: 30 });
  await gravarRevisao(pasta, { quadro: quadro(1), rotulo: n3, revisor: "A02", decisao: "devolver", m: 31 });
  await gravarRevisao(pasta, { quadro: quadro(3), rotulo: n4, revisor: "A02", m: 32 });
  await gravarPessoas(pasta, { quadro: quadro(0), pessoa: "A02", mascara: new Uint8Array(640 * 360) });
  await criarGabaritoPontos(pasta, 2);
  const pl = await calcularPlacar(indice, new Date(AGORA.getTime() + 3_600_000));
  const a01 = pl.pontos.equipe.find((p) => p.pessoa === "A01");
  const a02 = pl.pontos.equipe.find((p) => p.pessoa === "A02");
  assert.equal(a01.rotulos, 4);
  assert.equal(a01.descartadas, 1);
  assert.equal(a01.aprovados, 2);
  assert.equal(a01.devolvidos, 1);
  assert.equal(a01.taxa_aprovacao, 0.667);
  assert.equal(a01.tempo_mediano_s, 20);
  assert.equal(a01.concordancia, 3); // 2 px de 640 = 3 px na referência 960
  assert.equal(a01.concordancia, a02.concordancia);
  assert.equal(a02.revisoes_feitas, 3);
  assert.equal(a01.liberado, false); // há gabarito, e A01 ainda não fez
  assert.deepEqual([a01.gabarito_n, a01.gabarito_acertos], [0, 0]);
  assert.ok(a01.dias_seguidos >= 1);
  assert.deepEqual(pl.pontos.partidas[0], {
    partida: pl.pontos.partidas[0].partida,
    sorteados: 4,
    anotados: 4,
    aprovados: 2,
    descartados: 1,
    pendentes_revisao: 1,
  });
  assert.deepEqual(pl.pontos.total, { sorteados: 4, anotados: 4, aprovados: 2, descartados: 1, pendentes_revisao: 1 });
  assert.equal(pl.pontos.equipe[0].pessoa, "A01"); // mais aprovados na semana
  // a pintura das pessoas tem o placar dela
  assert.deepEqual(pl.pessoas.total, { sorteados: 4, anotados: 1, aprovados: 0, descartados: 0, pendentes_revisao: 1 });
  assert.equal(pl.pessoas.equipe.find((p) => p.pessoa === "A02").rotulos, 1);
  assert.equal(pl.pessoas.gabarito_importado, false);
});

test("placar: o tempo por imagem é o dos rótulos da própria pessoa, sem descartes nem correções", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}, {}, {}]);
  // A01 anota três imagens (30, 45 e 70 s) e descarta uma (2 s)
  const n0 = await gravarPontos(pasta, { quadro: quadro(0), pessoa: "A01", pontos: P, segundos_ativos: 30 });
  const n1 = await gravarPontos(pasta, { quadro: quadro(1), pessoa: "A01", pontos: P, segundos_ativos: 45, m: 1 });
  const n2 = await gravarPontos(pasta, { quadro: quadro(2), pessoa: "A01", pontos: P, segundos_ativos: 70, m: 2 });
  await gravarPontos(pasta, { quadro: quadro(3), pessoa: "A01", pontos: null, segundos_ativos: 2, m: 3 });
  // A02 revisa: corrige a primeira (95 s: a correção é um rótulo novo, com o tempo da revisão), aprova a
  // segunda (6 s) e devolve a terceira (20 s)
  await gravarPontos(pasta, { quadro: quadro(0), pessoa: "A02", pontos: P, corrige: n0, segundos_ativos: 95, m: 10 });
  await gravarRevisao(pasta, { quadro: quadro(0), rotulo: n0, revisor: "A02", decisao: "corrigir", nova_versao: `${quadro(0)}__A02__v1.json`, segundos_ativos: 95, m: 10 });
  await gravarRevisao(pasta, { quadro: quadro(1), rotulo: n1, revisor: "A02", segundos_ativos: 6, m: 11 });
  await gravarRevisao(pasta, { quadro: quadro(2), rotulo: n2, revisor: "A02", decisao: "devolver", segundos_ativos: 20, m: 12 });
  const pl = await calcularPlacar(indice, new Date(AGORA.getTime() + 3_600_000));
  const a01 = pl.pontos.equipe.find((p) => p.pessoa === "A01");
  const a02 = pl.pontos.equipe.find((p) => p.pessoa === "A02");
  assert.equal(a01.tempo_mediano_s, 45); // o descarte (2 s) não entra
  assert.deepEqual([a01.rotulos, a01.descartadas], [4, 1]);
  assert.equal(a01.tempo_mediano_revisao_s, null);
  assert.equal(a02.tempo_mediano_s, null); // a correção não é imagem anotada por A02
  assert.equal(a02.rotulos, 0);
  assert.equal(a02.revisoes_feitas, 3);
  assert.equal(a02.tempo_mediano_revisao_s, 20); // 6, 20 e 95 s
  assert.deepEqual([45, 95, 754, 3725].map(formatarDuracao), ["45 s", "1 min 35 s", "12 min 34 s", "1 h 2 min"]);
});
