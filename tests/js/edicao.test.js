// Editar pela página da partida: a correção do aprovado o substitui; partindo do rótulo de outra
// pessoa, é a correção dele (com a revisão "corrigir"); senão, é um rótulo da própria pessoa.
import assert from "node:assert/strict";
import { test } from "node:test";

import { aprovado, pendentesRevisao, proximo, rotuloAprovado } from "../../web/js/nucleo/filas.js";
import { salvarEdicao } from "../../web/js/nucleo/rotulos.js";
import { PARTIDA, criarPartida, gravarPontos, gravarRevisao, minutos, pastaExemplo } from "./apoio.js";

const quadro = (k) => `t${String(1000 * (k + 1)).padStart(10, "0")}`;
const P = (x) => [{ ponto: "centro", x, y: 180 }];
const dados = (q, x, extra = {}) => ({
  partida: PARTIDA,
  quadro: q,
  largura: 640,
  altura: 360,
  pontos: P(x),
  situacao: "ok",
  motivo_descarte: null,
  comentario: "",
  segundos_ativos: 12,
  partiu_de: { fonte: "nenhuma" },
  ...extra,
});

test("a regra do aprovado: a correção do próprio aprovado o substitui, e de correção em correção vale a última", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{ dupla: true }, {}]);
  const [q0, q1] = [quadro(0), quadro(1)];
  // dupla com os dois aprovados: vale o aprovado primeiro (A02, aos 10 min)
  const a1 = await gravarPontos(pasta, { quadro: q0, pessoa: "A01", pontos: P(1) });
  const a2 = await gravarPontos(pasta, { quadro: q0, pessoa: "A02", pontos: P(2), m: 1 });
  await gravarRevisao(pasta, { quadro: q0, rotulo: a1, revisor: "A02", m: 30 });
  await gravarRevisao(pasta, { quadro: q0, rotulo: a2, revisor: "A01", m: 10 });
  let ip = await indice.partida(PARTIDA, "pontos");
  assert.equal(rotuloAprovado(ip, q0).nome, a2);
  // uma correção do aprovado (aos 60 min) o substitui, mesmo sendo mais nova
  const e1 = await gravarPontos(pasta, { quadro: q0, pessoa: "A03", pontos: P(3), m: 60, corrige: a2 });
  ip = await indice.partida(PARTIDA, "pontos");
  assert.deepEqual([rotuloAprovado(ip, q0).nome, aprovado(ip, q0).decisao, aprovado(ip, q0).revisor], [e1, "corrigir", "A03"]);
  // de correção em correção: vale a última
  const e2 = await gravarPontos(pasta, { quadro: q0, pessoa: "A01", pontos: P(4), versao: 2, m: 70, corrige: e1 });
  ip = await indice.partida(PARTIDA, "pontos");
  assert.equal(rotuloAprovado(ip, q0).nome, e2);
  // a correção de um rótulo que não é o aprovado não muda nada (vale o aprovado primeiro, como antes)
  await gravarPontos(pasta, { quadro: q0, pessoa: "A03", pontos: P(5), versao: 2, m: 80, corrige: a1 });
  ip = await indice.partida(PARTIDA, "pontos");
  assert.equal(rotuloAprovado(ip, q0).nome, e2);
  // a correção feita revisando (o rótulo corrigido não estava aprovado) vale como antes
  const b = await gravarPontos(pasta, { quadro: q1, pessoa: "A01", pontos: P(6) });
  const c = await gravarPontos(pasta, { quadro: q1, pessoa: "A02", pontos: P(7), m: 5, corrige: b });
  await gravarRevisao(pasta, { quadro: q1, rotulo: b, revisor: "A02", decisao: "corrigir", nova_versao: c, m: 5 });
  ip = await indice.partida(PARTIDA, "pontos");
  assert.equal(rotuloAprovado(ip, q1).nome, c);
});

test("editar: corrige o aprovado; corrige o rótulo de outra pessoa (com a revisão); ou vira rótulo da pessoa", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}, {}, {}]);
  const q = [0, 1, 2, 3].map(quadro);
  // q0: aprovado (de A01, aprovado por A02): a edição de A01 mesmo é a correção do aprovado
  const a = await gravarPontos(pasta, { quadro: q[0], pessoa: "A01", pontos: P(10) });
  await gravarRevisao(pasta, { quadro: q[0], rotulo: a, revisor: "A02", m: 5 });
  const r0 = await salvarEdicao(indice, "pontos", "A01", dados(q[0], 11), { base: a, agora: minutos(20) });
  assert.deepEqual([r0.como, r0.corrigido, r0.rotulo.corrige, r0.rotulo.versao], ["corrige_aprovado", a, a, 2]);
  assert.deepEqual(r0.rotulo.partiu_de, { fonte: "rotulo_revisado", versao: null, referencia: a });
  let ip = await indice.partida(PARTIDA, "pontos");
  assert.equal(rotuloAprovado(ip, q[0]).nome, r0.nome);
  assert.equal(rotuloAprovado(ip, q[0]).dados.pontos[0].x, 11);

  // q1: rótulo de A02 esperando revisão (e devolvido antes): A01 edita partindo dele -> correção + revisão
  const b = await gravarPontos(pasta, { quadro: q[1], pessoa: "A02", pontos: P(20) });
  await gravarRevisao(pasta, { quadro: q[1], rotulo: b, revisor: "A03", decisao: "devolver", m: 2 });
  const r1 = await salvarEdicao(indice, "pontos", "A01", dados(q[1], 21), { base: b, agora: minutos(30) });
  assert.deepEqual([r1.como, r1.corrigido, r1.rotulo.corrige], ["corrige", b, b]);
  ip = await indice.partida(PARTIDA, "pontos");
  assert.equal(rotuloAprovado(ip, q[1]).nome, r1.nome);
  const rev = ip.ultimaRevisao(b);
  assert.deepEqual([rev.decisao, rev.revisor, rev.nova_versao, rev.comentario], ["corrigir", "A01", r1.nome, "corrigido pela página da partida"]);
  // o rótulo devolvido não volta mais para A02, nem fica esperando revisão
  const prox = await proximo(indice, "pontos", "A02");
  assert.notEqual(prox?.quadro, q[1]);
  assert.ok(!(await pendentesRevisao(indice, "pontos", "A03")).some((p) => p.arquivo.nome === b));

  // q2: o próprio rótulo, esperando revisão: versão nova, que vai para a revisão
  const c = await gravarPontos(pasta, { quadro: q[2], pessoa: "A01", pontos: P(30) });
  const r2 = await salvarEdicao(indice, "pontos", "A01", dados(q[2], 31), { base: c, agora: minutos(40) });
  assert.deepEqual([r2.como, r2.rotulo.corrige, r2.rotulo.versao], ["rotulo", null, 2]);
  assert.deepEqual(r2.rotulo.partiu_de, { fonte: "rotulo_anterior", versao: null, referencia: c });
  ip = await indice.partida(PARTIDA, "pontos");
  assert.equal(rotuloAprovado(ip, q[2]), null);
  assert.ok((await pendentesRevisao(indice, "pontos", "A02")).some((p) => p.arquivo.nome === r2.nome));

  // q3: sem rótulo, partindo da previsão: um rótulo da pessoa
  const r3 = await salvarEdicao(indice, "pontos", "A01", dados(q[3], 41, { partiu_de: { fonte: "modelo", versao: "m@1" } }), { agora: minutos(50) });
  assert.deepEqual([r3.como, r3.rotulo.partiu_de.fonte, r3.rotulo.partiu_de.versao], ["rotulo", "modelo", "m@1"]);
});
