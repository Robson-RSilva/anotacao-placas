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
  gravarPessoas,
  gravarPontos,
  gravarRevisao,
  pastaExemplo,
} from "./apoio.js";

await esquemas();

test("caminhos validados e com o layout do Python", () => {
  const p = new Pasta(new PastaMemoria());
  assert.equal(p.quadro(PARTIDA, "t0000001000"), `partidas/${PARTIDA}/quadros/t0000001000.jpg`);
  assert.equal(p.quadro("gabarito", "g1001"), "gabarito/itens/g1001.jpg");
  assert.equal(p.rotulos("gabarito", "pontos"), "gabarito/rotulos/pontos");
  assert.equal(p.revisoes(PARTIDA, "pessoas"), `partidas/${PARTIDA}/revisoes/pessoas`);
  assert.throws(() => p.rotulos(PARTIDA, "jogadores"), /tarefa/); // a tarefa da 0.8 (só os jogadores)
  assert.equal(p.previsaoPontos(PARTIDA, "t0000001000"), `partidas/${PARTIDA}/previsoes/pontos/t0000001000.json`);
  assert.equal(p.previsaoPessoas(PARTIDA, "t0000001000"), `partidas/${PARTIDA}/previsoes/pessoas/t0000001000.png`);
  assert.equal(p.mascaraGabarito("g3001"), "gabarito/itens/g3001.png");
  assert.equal(p.itemGabarito("g3001"), "gabarito/itens/g3001.json");
  assert.throws(() => p.partida("../fora"));
  assert.throws(() => p.quadro(PARTIDA, "g0001"));
  assert.throws(() => p.rotulos(PARTIDA, "camera")); // as tarefas das versões até a 0.7
  assert.throws(() => p.rotulos(PARTIDA));
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

test("criar, listar partidas, próxima versão", async () => {
  const { pasta, indice } = await pastaExemplo();
  assert.ok(await pasta.ehPastaDeTrabalho());
  assert.deepEqual((await pasta.listar("")).map((i) => i.nome), ["conjuntos", "divisao.json", "equipe.json", "gabarito", "partidas"]);
  assert.deepEqual(await pasta.listarPartidas(), []);
  await pasta.diretorio(`partidas/${PARTIDA.replace("time-a", "time-c")}`, { criar: true }); // sem manifesto: não conta
  await criarPartida(pasta, [{}, {}]);
  assert.deepEqual(await pasta.listarPartidas(), [PARTIDA]);
  const dir = pasta.rotulos(PARTIDA, "pontos");
  assert.equal(await pasta.proximaVersao(dir, "t0000001000", "A01"), 1);
  await gravarPontos(pasta, { quadro: "t0000001000", pessoa: "A01" });
  await gravarPontos(pasta, { quadro: "t0000001000", pessoa: "A01", versao: 2 });
  await gravarPontos(pasta, { quadro: "t0000001000", pessoa: "A02" });
  assert.equal(await pasta.proximaVersao(dir, "t0000001000", "A01"), 3);
  await pasta.escrever(`${dir}/t0000001000__A01__v9.json.crswap`, "lixo");
  await pasta.escrever(`${dir}/desktop.ini`, "lixo");
  assert.equal((await pasta.listarArquivos(dir)).length, 3);
  const ip = await indice.partida(PARTIDA, "pontos");
  assert.equal(ip.rotulos.length, 3);
  assert.equal(ip.ultimos().get("t0000001000|A01").versao, 2);
  assert.deepEqual(ip.versoes("t0000001000", "A01").map((a) => a.versao), [1, 2]);
  // a máscara de uma gravação interrompida (sem o rótulo) conta: o nome nunca se repete
  const dirJ = pasta.rotulos(PARTIDA, "pessoas");
  await pasta.escrever(`${dirJ}/t0000001000__A01__v4.png`, Uint8Array.of(137, 80, 78, 71));
  assert.equal(await pasta.proximaVersao(dirJ, "t0000001000", "A01"), 5);
});

test("pessoas: o rótulo cuja máscara ainda não chegou espera, e não entra em nada", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}]);
  const m = new Uint8Array(640 * 360);
  m.fill(1, 1000, 1200);
  const nome = await gravarPessoas(pasta, { quadro: "t0000001000", pessoa: "A01", mascara: m });
  let ip = await indice.partida(PARTIDA, "pessoas");
  assert.deepEqual(ip.rotulos.map((a) => a.nome), [nome]);
  assert.equal(ip.rotulos[0].dados.pixels, 200);
  await pasta.apagar(`${pasta.rotulos(PARTIDA, "pessoas")}/${nome.replace(".json", ".png")}`);
  ip = await indice.partida(PARTIDA, "pessoas");
  assert.equal(ip.rotulos.length, 0);
  assert.equal(ip.esperando.length, 1);
});

test("arquivos inválidos ou com nome que não bate ficam de fora do índice", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}]);
  const dir = pasta.rotulos(PARTIDA, "pontos");
  await pasta.escrever(`${dir}/t0000001000__A01__v1.json`, "{ quebrado");
  const nome = await gravarPontos(pasta, { quadro: "t0000001000", pessoa: "A02" });
  const conteudo = await pasta.lerTexto(`${dir}/${nome}`);
  await pasta.escrever(`${dir}/t0000001000__A03__v1.json`, conteudo); // cópia com outro autor no nome
  await gravarRevisao(pasta, { quadro: "t0000001000", rotulo: nome, revisor: "A01" });
  const ip = await indice.partida(PARTIDA, "pontos");
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

test("em que computadores cada código é usado: um registro por navegador, gravado uma vez", async () => {
  const pasta = new Pasta(new PastaMemoria());
  await pasta.criar();
  const meu = "3f2a6c1e-8b9d-4e2f-a1b3-c4d5e6f70812";
  const outro = "0b1c2d3e-4f50-4617-8899-aabbccddeeff";
  assert.equal(pasta.dispositivo("AB", meu), `pessoas/AB/${meu}.json`);
  assert.throws(() => pasta.dispositivo("ab", meu), /código/);
  assert.throws(() => pasta.dispositivo("AB", "../x"), /dispositivo/);
  assert.deepEqual(await pasta.dispositivosDoCodigo("AB"), []);
  assert.equal(await pasta.registrarDispositivo("AB", meu, new Date("2026-10-23T10:00:00Z")), true);
  assert.equal(await pasta.registrarDispositivo("AB", meu), false); // uma vez só: o arquivo nunca muda
  await pasta.registrarDispositivo("AB", outro, new Date("2026-10-24T09:00:00Z"));
  await pasta.registrarDispositivo("CD", outro);
  await pasta.escrever(`pessoas/AB/${"f".repeat(8)}-0000-0000-0000-000000000000.json`, "{ quebrado"); // sincronizando
  await pasta.escrever("pessoas/AB/notas.txt", "não é registro");
  const ab = await pasta.dispositivosDoCodigo("AB");
  assert.deepEqual(ab.map((d) => d.dispositivo).sort(), [meu, outro].sort());
  assert.equal(ab.find((d) => d.dispositivo === meu).criado_em, "2026-10-23T10:00:00.000Z");
});
