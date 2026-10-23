// A pasta de trabalho no navegador: layout igual ao do Python, escrita que nunca sobrescreve.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Indice } from "../../web/js/nucleo/indice.js";
import { ArquivoExiste, Pasta, partes } from "../../web/js/nucleo/pasta.js";
import {
  ArquivoMemoria,
  PARTIDA,
  PastaMemoria,
  criarPartida,
  esquemas,
  gravarRevisao,
  gravarRotulo,
  pastaExemplo,
} from "./apoio.js";

await esquemas();

test("caminhos validados e com o layout do Python", () => {
  const p = new Pasta(new PastaMemoria());
  assert.equal(p.pacote("arena-x", "1.0"), "estadios/arena-x/pacote-1.0/pacote.json");
  assert.equal(p.pacoteRef("arena-x/pacote-2.1"), "estadios/arena-x/pacote-2.1/pacote.json");
  assert.equal(p.quadro(PARTIDA, "t0000001000"), `partidas/${PARTIDA}/quadros/t0000001000.jpg`);
  assert.equal(p.quadro("gabarito", "g0001"), "gabarito/itens/g0001.jpg");
  assert.equal(p.rotulos("gabarito"), "gabarito/rotulos/camera");
  assert.equal(p.revisoes(PARTIDA), `partidas/${PARTIDA}/revisoes/camera`);
  assert.equal(p.previsao(PARTIDA, "t0000001000"), `partidas/${PARTIDA}/previsoes/t0000001000.json`);
  assert.throws(() => p.partida("../fora"));
  assert.throws(() => p.quadro(PARTIDA, "g0001"));
  assert.throws(() => p.rotulos(PARTIDA, "oclusao"));
  assert.throws(() => partes("a/../b"));
  assert.throws(() => partes("a//b"));
});

test("escrita nunca sobrescreve sem pedir, e o índice vê a mudança", async () => {
  const p = new Pasta(new PastaMemoria());
  await p.escreverJson("a/b.json", { x: 1 });
  await assert.rejects(p.escreverJson("a/b.json", { x: 2 }), ArquivoExiste);
  assert.deepEqual(await p.lerJson("a/b.json"), { x: 1 });
  await p.escreverJson("a/b.json", { x: 3 }, { sobrescrever: true });
  assert.deepEqual(await p.lerJson("a/b.json"), { x: 3 });
  assert.equal(await p.existe("a/c.json"), false);
  assert.equal(await p.arquivo("nada/c.json"), null);
  await assert.rejects(p.lerTexto("a/c.json"), /não encontrado/);
  assert.equal(await p.apagar("a/b.json"), true);
  assert.equal(await p.existe("a/b.json"), false);
});

test("criar, listar partidas e pacotes, próxima versão", async () => {
  const { pasta, indice } = await pastaExemplo();
  assert.ok(await pasta.ehPastaDeTrabalho());
  assert.deepEqual(await pasta.listarPacotes(), ["estadio-sintetico/pacote-1.0"]);
  assert.deepEqual(await pasta.listarPartidas(), []);
  await pasta.diretorio(`partidas/${PARTIDA.replace("time-a", "time-c")}`, { criar: true }); // sem manifesto: não conta
  await criarPartida(pasta, [{}, {}]);
  assert.deepEqual(await pasta.listarPartidas(), [PARTIDA]);
  const dir = pasta.rotulos(PARTIDA);
  assert.equal(await pasta.proximaVersao(dir, "t0000001000", "A01"), 1);
  await gravarRotulo(pasta, { quadro: "t0000001000", pessoa: "A01" });
  await gravarRotulo(pasta, { quadro: "t0000001000", pessoa: "A01", versao: 2 });
  await gravarRotulo(pasta, { quadro: "t0000001000", pessoa: "A02" });
  assert.equal(await pasta.proximaVersao(dir, "t0000001000", "A01"), 3);
  await pasta.escrever(`${dir}/t0000001000__A01__v9.json.crswap`, "lixo");
  await pasta.escrever(`${dir}/desktop.ini`, "lixo");
  assert.equal((await pasta.listarArquivos(dir)).length, 3);
  const ip = await indice.partida(PARTIDA);
  assert.equal(ip.rotulos.length, 3);
  assert.equal(ip.ultimos().get("t0000001000|A01").versao, 2);
  assert.deepEqual(ip.versoes("t0000001000", "A01").map((a) => a.versao), [1, 2]);
});

test("arquivos inválidos ou com nome que não bate ficam de fora do índice", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}]);
  const dir = pasta.rotulos(PARTIDA);
  await pasta.escrever(`${dir}/t0000001000__A01__v1.json`, "{ quebrado");
  const nome = await gravarRotulo(pasta, { quadro: "t0000001000", pessoa: "A02" });
  const conteudo = await pasta.lerTexto(`${dir}/${nome}`);
  await pasta.escrever(`${dir}/t0000001000__A03__v1.json`, conteudo); // cópia com outro autor no nome
  await gravarRevisao(pasta, { quadro: "t0000001000", rotulo: nome, revisor: "A01" });
  const ip = await indice.partida(PARTIDA);
  assert.deepEqual(ip.rotulos.map((a) => a.nome), [nome]);
  assert.equal(ip.invalidos.length, 2);
  assert.equal(ip.ultimaRevisao(nome).revisor, "A01");
});

test("o índice relê só o que mudou", async () => {
  const { pasta } = await pastaExemplo();
  const indice = new Indice(pasta);
  const e1 = await indice.equipe();
  assert.equal(e1.membros.length, 2);
  await criarPartida(pasta, [{}]);
  const m1 = await indice.manifesto(PARTIDA);
  const m2 = await indice.manifesto(PARTIDA);
  assert.equal(m1, m2); // mesmo objeto: veio do cache
  const novo = { ...m1, cadastro: { ...m1.cadastro, chuva: true } };
  await pasta.gravar("manifesto", pasta.manifesto(PARTIDA), novo, { sobrescrever: true });
  assert.equal((await indice.manifesto(PARTIDA)).cadastro.chuva, true);
});

test("escrita que falha não deixa arquivo vazio para trás", async () => {
  const p = new Pasta(new PastaMemoria());
  const original = ArquivoMemoria.prototype.createWritable;
  ArquivoMemoria.prototype.createWritable = async () => {
    throw Object.assign(new Error("sem espaço"), { name: "QuotaExceededError" });
  };
  try {
    await assert.rejects(p.escreverJson("a/b.json", { x: 1 }), /sem espaço/);
    assert.equal(await p.existe("a/b.json"), false);
  } finally {
    ArquivoMemoria.prototype.createWritable = original;
  }
  await p.escreverJson("a/b.json", { x: 1 });
  assert.deepEqual(await p.lerJson("a/b.json"), { x: 1 });
});

test("arquivo vazio (escrita interrompida ou sincronizando) conta como ausente e pode ser regravado", async () => {
  const p = new Pasta(new PastaMemoria());
  await p.escrever("a/b.json", ""); // o navegador cria o arquivo vazio antes de gravar o conteúdo
  assert.equal(await p.existe("a/b.json"), false);
  assert.equal(await p.arquivo("a/b.json"), null);
  await p.escreverJson("a/b.json", { x: 1 }); // sem pedir para sobrescrever
  assert.deepEqual(await p.lerJson("a/b.json"), { x: 1 });
  await assert.rejects(p.escreverJson("a/b.json", { x: 2 }), ArquivoExiste);
});
