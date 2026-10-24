// As convenções do JavaScript são as mesmas do Python (tests/fixtures/convencoes.json é gerado dele).
import assert from "node:assert/strict";
import { test } from "node:test";

import * as c from "../../web/js/nucleo/convencoes.js";
import { FIXTURES, lerJson } from "./apoio.js";

const ref = lerJson(new URL("convencoes.json", FIXTURES));

test("versão, referência, manual e regex iguais aos do Python", () => {
  assert.equal(c.VERSAO, ref.versao);
  assert.deepEqual([c.REF_W, c.REF_H], ref.ref);
  assert.deepEqual({ ...c.MANUAL }, ref.manual);
  assert.equal(c.PARTIDA_GABARITO, ref.partida_gabarito);
  assert.equal(c.REF_PACOTE_GENERICO, ref.ref_pacote_generico);
  for (const [nome, padrao] of Object.entries(ref.regex)) assert.equal(c[nome].source, padrao.replaceAll("/", "\\/"), nome);
});

test("slug, ID do quadro e ID da partida dão o mesmo que no Python", () => {
  for (const [entrada, saida] of ref.slug) assert.equal(c.slug(entrada), saida, entrada);
  for (const [pts, id] of ref.id_quadro) assert.equal(c.idQuadro(pts), id, String(pts));
  for (const [data, estadio, mandante, visitante, id] of ref.id_partida) {
    assert.equal(c.idPartida(data, estadio, mandante, visitante), id);
  }
  assert.throws(() => c.idQuadro(-1));
  assert.throws(() => c.idPartida("02/11/2026", "a", "b", "c"));
});

test("nomes de arquivo por pessoa e versão", () => {
  assert.equal(c.nomeArquivo("t0000001000", "A01", 2), "t0000001000__A01__v2.json");
  assert.deepEqual(c.lerNome("g0003__B12__v10.json"), { quadro: "g0003", pessoa: "B12", versao: 10 });
  assert.equal(c.lerNome("t0000001000__A01__v2.json.crswap"), null);
  assert.equal(c.lerNome("desktop.ini"), null);
  assert.throws(() => c.nomeArquivo("t1", "A01", 1));
  assert.throws(() => c.nomeArquivo("t0000001000", "a01", 1));
  assert.throws(() => c.nomeArquivo("t0000001000", "A01", 0));
  assert.deepEqual(c.partesPacote("arena-x/pacote-1.10"), ["arena-x", "1.10"]);
});

test("código da pessoa: o que ela digitar, em maiúsculas, sem acento nem espaço", () => {
  assert.equal(c.codigoPessoa("rs"), "RS");
  assert.equal(c.codigoPessoa(" Ana Clara "), "ANACLARA");
  assert.equal(c.codigoPessoa("joão-2"), "JOAO2");
  assert.equal(c.codigoPessoa("A01"), "A01");
  assert.equal(c.codigoPessoa("Maximiliano Souza"), "MAXIMILIAN"); // até 10 caracteres
  for (const ruim of ["", "a", "1AB", "ç", "  ", null, undefined]) assert.equal(c.codigoPessoa(ruim), null, String(ruim));
  assert.equal(c.lerNome("t0000001000__ANACLARA__v1.json").pessoa, "ANACLARA");
  assert.equal(c.nomeArquivo("g0001", "RS", 1), "g0001__RS__v1.json");
});

test("data e hora do formulário guardam o fuso local (o dia da partida não muda)", () => {
  const d = new Date(2026, 10, 2, 22, 30);
  const iso = c.isoComFuso("2026-11-02T22:30", d);
  assert.ok(iso.startsWith("2026-11-02T22:30:00"), iso);
  assert.equal(Date.parse(iso), d.getTime());
  assert.equal(c.idPartida(iso, "Arena", "A", "B"), "2026-11-02_arena_a-b");
});
