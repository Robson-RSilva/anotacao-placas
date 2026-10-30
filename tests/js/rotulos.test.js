// Gravar rótulos e revisões pelo navegador, nas duas tarefas; levar e trazer arquivos em .zip.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { VERSAO } from "../../web/js/nucleo/convencoes.js";
import { pendentesRevisao, proximo } from "../../web/js/nucleo/filas.js";
import { ErroFormato } from "../../web/js/nucleo/formatos.js";
import { compararComGabarito } from "../../web/js/nucleo/gabarito.js";
import { Pasta } from "../../web/js/nucleo/pasta.js";
import { decodificarPng } from "../../web/js/nucleo/png.js";
import { ForaDaFila, salvarRevisao, salvarRotulo } from "../../web/js/nucleo/rotulos.js";
import { exportarZip, importarZip, soDaPessoa, tipoDoCaminho } from "../../web/js/nucleo/transferencia.js";
import { criarZip, crc32, lerZip } from "../../web/js/nucleo/zip.js";
import {
  FIXTURES,
  PARTIDA,
  PastaMemoria,
  criarGabaritoJogadores,
  criarGabaritoPontos,
  criarPartida,
  esquemas,
  mascaraVerdadeira,
  pastaExemplo,
} from "./apoio.js";

await esquemas();

const quadro = (k) => `t${String(1000 * (k + 1)).padStart(10, "0")}`;
const dados = (item, extra = {}) => ({
  partida: item.partida,
  quadro: item.quadro,
  largura: item.largura,
  altura: item.altura,
  partiu_de: item.partiu_de,
  situacao: "ok",
  motivo_descarte: null,
  comentario: "",
  segundos_ativos: 33.27,
  ...extra,
});

test("salvar os pontos: versão, arredondamento, descarte e validação", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}]);
  const item = await proximo(indice, "pontos", "A01");
  const pontos = [{ ponto: "centro", x: 320.123456, y: 180.5 }, { ponto: "meio_cab", x: 330, y: 359.999 }];
  const { nome, rotulo } = await salvarRotulo(indice, "pontos", "A01", dados(item, { pontos }));
  assert.equal(nome, `${item.quadro}__A01__v1.json`);
  assert.equal(rotulo.ferramenta, VERSAO);
  assert.equal(rotulo.manual, "pontos-0.1");
  assert.equal(rotulo.segundos_ativos, 33.3);
  assert.deepEqual(rotulo.pontos[0], { ponto: "centro", x: 320.12, y: 180.5 });
  assert.deepEqual(await pasta.lerJson(`${pasta.rotulos(PARTIDA, "pontos")}/${nome}`), rotulo);
  // de novo no mesmo quadro: versão 2
  const r2 = await salvarRotulo(indice, "pontos", "A01", dados(item, { pontos: [] }));
  assert.equal(r2.rotulo.versao, 2);
  // descartada: sem pontos, mesmo que a tela tenha alguns
  const outro = (await proximo(indice, "pontos", "A01")) ?? { ...item, quadro: quadro(1) };
  const d = await salvarRotulo(indice, "pontos", "A01", dados(outro, { pontos, situacao: "descartada", motivo_descarte: "grafismo" }));
  assert.deepEqual([d.rotulo.situacao, d.rotulo.motivo_descarte, d.rotulo.pontos], ["descartada", "grafismo", []]);
  await assert.rejects(salvarRotulo(indice, "pontos", "A01", dados(item, { situacao: "descartada", motivo_descarte: "outro" })), ErroFormato);
  await assert.rejects(salvarRotulo(indice, "pontos", "A01", dados(item, { pontos: [{ ponto: "centro", x: 700, y: 1 }] })), /fora da imagem/);
});

test("salvar os jogadores: a máscara (0 e 1) ao lado, com os pixels pintados contados", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}]);
  const item = await proximo(indice, "jogadores", "A01");
  const m = new Uint8Array(640 * 360);
  m.fill(7, 2000, 2100); // qualquer valor diferente de zero é jogador
  const { nome, rotulo } = await salvarRotulo(indice, "jogadores", "A01", dados(item, { mascara: m }));
  assert.equal(rotulo.pixels, 100);
  assert.equal(rotulo.mascara, nome.replace(".json", ".png"));
  const png = await pasta.arquivo(`${pasta.rotulos(PARTIDA, "jogadores")}/${rotulo.mascara}`);
  const lido = await decodificarPng(new Uint8Array(await png.arrayBuffer()));
  assert.deepEqual([lido.largura, lido.altura], [640, 360]);
  assert.equal(lido.dados[2050], 1);
  assert.equal(lido.dados.reduce((s, v) => s + v, 0), 100);
  // sem jogador: a máscara toda 0; descartada: sem máscara
  const vazio = await salvarRotulo(indice, "jogadores", "A01", dados(item, { mascara: new Uint8Array(640 * 360) }));
  assert.deepEqual([vazio.rotulo.pixels, vazio.rotulo.versao], [0, 2]);
  const desc = await salvarRotulo(indice, "jogadores", "A01", dados(item, { mascara: m, situacao: "descartada", motivo_descarte: "borrao" }));
  assert.deepEqual([desc.rotulo.mascara, desc.rotulo.pixels, desc.mascara], [null, 0, null]);
  await assert.rejects(salvarRotulo(indice, "jogadores", "A01", dados(item, { mascara: new Uint8Array(10) })), /tamanho/);
});

test("revisão: aprovar, devolver com motivo e corrigir (versão nova com a autoria de quem revisa)", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}, {}]);
  for (let k = 0; k < 3; k++) {
    const item = await proximo(indice, "pontos", "A01");
    await salvarRotulo(indice, "pontos", "A01", dados(item, { pontos: [{ ponto: "centro", x: 320 + k, y: 180 }] }));
  }
  const [p1, p2, p3] = await pendentesRevisao(indice, "pontos", "A02");
  const r1 = await salvarRevisao(indice, "pontos", "A02", p1.arquivo, { decisao: "aprovar", segundos_ativos: 4 });
  assert.deepEqual([r1.revisao.formato, r1.revisao.decisao, r1.revisao.motivo, r1.revisao.manual], ["revisao.pontos/1", "aprovar", null, "revisao-0.2"]);
  await assert.rejects(salvarRevisao(indice, "pontos", "A02", p2.arquivo, { decisao: "devolver" }), ErroFormato);
  const r2 = await salvarRevisao(indice, "pontos", "A02", p2.arquivo, { decisao: "devolver", motivo: "faltou_ponto", comentario: "o meio-campo aparece" });
  assert.equal(r2.revisao.motivo, "faltou_ponto");
  const correcao = { pontos: [{ ponto: "centro", x: 330, y: 181 }], situacao: "ok", motivo_descarte: null, comentario: "", segundos_ativos: 9 };
  const r3 = await salvarRevisao(indice, "pontos", "A02", p3.arquivo, { decisao: "corrigir", correcao, segundos_ativos: 12 });
  assert.equal(r3.correcao, `${p3.arquivo.quadro}__A02__v1.json`);
  const corrigido = await pasta.lerJson(`${pasta.rotulos(PARTIDA, "pontos")}/${r3.correcao}`);
  assert.deepEqual([corrigido.anotador, corrigido.corrige, corrigido.partiu_de.fonte], ["A02", p3.arquivo.nome, "rotulo_revisado"]);
  assert.deepEqual(corrigido.pontos, correcao.pontos);
  assert.equal((await pendentesRevisao(indice, "pontos", "A02")).length, 0);
  await assert.rejects(salvarRevisao(indice, "pontos", "RS", p1.arquivo, { decisao: "aprovar" }), ForaDaFila); // já revisado
});

test("revisão dos jogadores: a correção grava a máscara nova de quem revisa", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}]);
  const item = await proximo(indice, "jogadores", "A01");
  await salvarRotulo(indice, "jogadores", "A01", dados(item, { mascara: new Uint8Array(640 * 360) }));
  const [p] = await pendentesRevisao(indice, "jogadores", "A02");
  const m = new Uint8Array(640 * 360);
  m.fill(1, 0, 50);
  const correcao = { mascara: m, situacao: "ok", motivo_descarte: null, comentario: "faltou o goleiro", segundos_ativos: 30 };
  const r = await salvarRevisao(indice, "jogadores", "A02", p.arquivo, { decisao: "corrigir", correcao });
  const corrigido = await pasta.lerJson(`${pasta.rotulos(PARTIDA, "jogadores")}/${r.correcao}`);
  assert.deepEqual([corrigido.pixels, corrigido.corrige, corrigido.comentario], [50, p.arquivo.nome, "faltou o goleiro"]);
  assert.equal(r.revisao.formato, "revisao.jogadores/1");
});

test("treino com gabarito: o resultado na hora, nas duas tarefas", async () => {
  const { pasta, indice } = await pastaExemplo();
  const pontos = await criarGabaritoPontos(pasta, 3);
  const jog = await criarGabaritoJogadores(pasta, 2);
  const item = await proximo(indice, "pontos", "A01");
  const g = pontos[item.quadro];
  const { nome } = await salvarRotulo(indice, "pontos", "A01", dados(item, { pontos: g.pontos.filter((p) => p.visivel).map(({ ponto, x, y }) => ({ ponto, x: x + 0.5, y })) }));
  const ip = await indice.partida("gabarito", "pontos");
  const r = await compararComGabarito(indice, "pontos", ip.rotulos.find((a) => a.nome === nome), g);
  assert.equal(r.acerto, true);
  assert.ok(Math.abs(r.erro_mediano_px - 0.75) < 1e-9);
  const itemJ = await proximo(indice, "jogadores", "A01");
  const v = mascaraVerdadeira();
  const so1 = v.map((x) => (x === 1 ? 1 : 0));
  const salvo = await salvarRotulo(indice, "jogadores", "A01", dados(itemJ, { mascara: so1 }));
  const ipJ = await indice.partida("gabarito", "jogadores");
  const rJ = await compararComGabarito(indice, "jogadores", ipJ.rotulos.find((a) => a.nome === salvo.nome), jog[itemJ.quadro]);
  assert.equal(rJ.acerto, false);
  assert.deepEqual(rJ.faltaram, [2]);
});

test(".zip: ida e volta, CRC e leitura de um .zip comprimido do sistema", async () => {
  const blob = await criarZip([
    { caminho: "a/b.txt", dados: "olá" },
    { caminho: "c.bin", dados: new Uint8Array([1, 2, 3]) },
  ]);
  const lidos = [];
  for await (const e of lerZip(blob)) lidos.push([e.caminho, Array.from(e.dados)]);
  assert.deepEqual(lidos, [["a/b.txt", Array.from(new TextEncoder().encode("olá"))], ["c.bin", [1, 2, 3]]]);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const doSistema = new Blob([readFileSync(new URL("deflate.zip", FIXTURES))]);
  const nomes = [];
  for await (const e of lerZip(doSistema)) nomes.push(e.caminho);
  assert.deepEqual(nomes, ["trabalho/equipe.json", "trabalho/notas.txt", "__MACOSX/trabalho/._equipe.json"]);
  await assert.rejects(async () => {
    for await (const _ of lerZip(new Blob(["não é zip"]))) void _;
  }, /não é um arquivo .zip/);
});

test("exportar e importar a pasta: só arquivos da pasta de trabalho, validados, sem sobrescrever", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}]);
  const item = await proximo(indice, "pontos", "A01");
  await salvarRotulo(indice, "pontos", "A01", dados(item, { pontos: [{ ponto: "centro", x: 1, y: 1 }] }));
  const itemJ = await proximo(indice, "jogadores", "A01");
  await salvarRotulo(indice, "jogadores", "A01", dados(itemJ, { mascara: new Uint8Array(640 * 360) }));
  await pasta.escrever(`${pasta.quadros(PARTIDA)}/${quadro(0)}.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  await pasta.escrever("conjuntos/x/pontos.parquet", "não vai");
  await pasta.escrever(`partidas/${PARTIDA}/rotulos/camera/${quadro(0)}__A01__v1.json`, "{}"); // da 0.7: não vai
  const { blob, n } = await exportarZip(pasta);
  assert.equal(n, 9); // equipe, divisão, manifesto, tomadas, fila, os dois rótulos, a máscara e o quadro
  const caminhos = [];
  for await (const e of lerZip(blob)) caminhos.push(e.caminho);
  assert.ok(!caminhos.some((c) => c.startsWith("conjuntos/") || c.includes("/camera/")));
  // noutra pasta vazia
  const outra = new Pasta(new PastaMemoria("outra"));
  const r = await importarZip(outra, blob);
  assert.deepEqual(r, { gravados: n, existentes: 0, conflitos: [], recusados: [] });
  const r2 = await importarZip(outra, blob);
  assert.equal(r2.existentes, n);
  // mesmo nome com outro conteúdo (a mesma pessoa anotou o quadro em dois computadores): conflito
  const [rotulo] = await outra.listar(pasta.rotulos(PARTIDA, "pontos"));
  const caminho = `${pasta.rotulos(PARTIDA, "pontos")}/${rotulo.nome}`;
  const mudado = { ...(await outra.lerJson(caminho)), comentario: "feito no outro computador" };
  await outra.escreverJson(caminho, mudado, { sobrescrever: true });
  const r4 = await importarZip(outra, blob);
  assert.deepEqual(r4.conflitos, [caminho]);
  assert.equal(r4.existentes, n - 1);
  assert.equal((await outra.lerJson(caminho)).comentario, "feito no outro computador"); // ficou o da pasta
  // só os arquivos de A01: os dois rótulos e a máscara
  const meus = await exportarZip(pasta, soDaPessoa("A01"));
  assert.equal(meus.n, 3);
  // .zip do sistema com pasta-mãe e lixo do macOS
  const terceira = new Pasta(new PastaMemoria("terceira"));
  const r3 = await importarZip(terceira, new Blob([readFileSync(new URL("deflate.zip", FIXTURES))]));
  assert.equal(r3.gravados, 1);
  assert.deepEqual(r3.recusados.map((x) => x.caminho), ["notas.txt"]);
  assert.equal((await terceira.lerEquipe()).membros[0].nome, "Ana Conceição");
});

test("importar um lote de ouro: os itens das duas tarefas; os da 0.7 são recusados", async () => {
  await esquemas();
  const destino = new Pasta(new PastaMemoria("destino"));
  await destino.criar();
  const origem = new Pasta(new PastaMemoria("origem"));
  await origem.criar();
  await criarGabaritoPontos(origem, 2);
  await criarGabaritoJogadores(origem, 1);
  await origem.escrever("gabarito/itens/g1001.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  await origem.escreverJson("gabarito/itens/g0001.json", { formato: "gabarito.camera/1", id: "g0001" });
  const { blob } = await exportarZip(origem, (c) => c.startsWith("gabarito/"));
  const r = await importarZip(destino, blob);
  assert.equal(r.gravados, 5); // 2 itens dos pontos, 1 dos jogadores com a máscara, e uma imagem
  assert.deepEqual(r.recusados.map((x) => x.caminho), ["gabarito/itens/g0001.json"]);
  assert.match(r.recusados[0].motivo, /versão anterior/);
});

test("tipo de arquivo pelo caminho", () => {
  assert.equal(tipoDoCaminho("equipe.json"), "equipe");
  assert.equal(tipoDoCaminho("estadios/arena-x/pacote-1.0/pacote.json"), null); // da 0.7
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/rotulos/pontos/t0000001000__A01__v1.json`), "rotulo_pontos");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/revisoes/jogadores/t0000001000__A01__v1.json`), "revisao_jogadores");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/rotulos/jogadores/t0000001000__A01__v1.png`), "png");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/rotulos/pontos/t0000001000__A01__v1.png`), null);
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/rotulos/camera/t0000001000__A01__v1.json`), null);
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/quadros/t0000001000.jpg`), "jpg");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/previsoes/pontos/t0000001000.json`), "previsao_pontos");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/previsoes/jogadores/t0000001000.png`), "png");
  assert.equal(tipoDoCaminho("gabarito/itens/g1001.json"), "gabarito");
  assert.equal(tipoDoCaminho("gabarito/itens/g2001.png"), "png");
  assert.equal(tipoDoCaminho("gabarito/rotulos/pontos/g1001__A01__v1.json"), "rotulo_pontos");
  assert.equal(tipoDoCaminho("gabarito/rotulos/jogadores/g2001__A01__v1.png"), "png");
  assert.equal(tipoDoCaminho("partidas/x/fila.json"), null);
  assert.equal(tipoDoCaminho("conjuntos/2026/pontos.parquet"), null);
  const disp = "pessoas/AB/3f2a6c1e-8b9d-4e2f-a1b3-c4d5e6f70812.json";
  assert.equal(tipoDoCaminho(disp), "dispositivo");
  assert.equal(tipoDoCaminho("pessoas/ab/3f2a6c1e-8b9d-4e2f-a1b3-c4d5e6f70812.json"), null);
  assert.equal(tipoDoCaminho("pessoas/AB/qualquer.json"), null);
  assert.ok(soDaPessoa("AB")(disp) && !soDaPessoa("CD")(disp));
});
