// Gravar rótulos e revisões pelo navegador; levar e trazer arquivos em .zip.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Camera } from "../../web/js/nucleo/camera.js";
import { Molde } from "../../web/js/nucleo/campo.js";
import { VERSAO } from "../../web/js/nucleo/convencoes.js";
import { ErroFormato } from "../../web/js/nucleo/formatos.js";
import { pendentesRevisao, proximoCamera } from "../../web/js/nucleo/filas.js";
import { compararComGabarito } from "../../web/js/nucleo/gabarito.js";
import { Pasta } from "../../web/js/nucleo/pasta.js";
import { salvarRevisao, salvarRotulo } from "../../web/js/nucleo/rotulos.js";
import { exportarZip, importarZip, soDaPessoa, tipoDoCaminho } from "../../web/js/nucleo/transferencia.js";
import { criarZip, crc32, lerZip } from "../../web/js/nucleo/zip.js";
import { FIXTURES, PARTIDA, PACOTE, PastaMemoria, cameraExemplo, criarGabarito, criarPartida, esquemas, pastaExemplo } from "./apoio.js";

await esquemas();

const quadro = (k) => `t${String(1000 * (k + 1)).padStart(10, "0")}`;

function dadosDoItem(item, cam, extra = {}) {
  const molde = Molde.doPacote(PACOTE());
  const c = Camera.deRotulo(cam.paraRotulo(), item.largura, item.altura);
  const pontos = ["centro", "circ_esq", "meio_cab"].map((n) => {
    const px = c.projetar(molde.ponto(n));
    return { ponto: n, x: px[0], y: px[1] };
  });
  return {
    partida: item.partida,
    quadro: item.quadro,
    pacote: item.pacote,
    largura: item.largura,
    altura: item.altura,
    partiu_de: item.partiu_de,
    camera: cam.paraRotulo(),
    pontos_travados: pontos,
    linhas_travadas: [],
    situacao: "ok",
    comentario: "",
    segundos_ativos: 33.27,
    ...extra,
  };
}

test("salvar rótulo: versão, lado, resíduo e validação", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}]);
  const item = await proximoCamera(indice, "A01");
  const cam = cameraExemplo();
  const { nome, rotulo } = await salvarRotulo(indice, "A01", dadosDoItem(item, cam));
  assert.equal(nome, `${quadro(0)}__A01__v1.json`);
  assert.equal(rotulo.lado, "canonico"); // câmera principal, do lado das cabines
  assert.equal(rotulo.segundos_ativos, 33.3);
  assert.ok(rotulo.residuo_mediano_px < 1e-6);
  assert.equal(rotulo.ferramenta, VERSAO);
  const lido = await pasta.lerJson(`${pasta.rotulos(PARTIDA)}/${nome}`);
  assert.deepEqual(lido, JSON.parse(JSON.stringify(rotulo)));
  // a mesma pessoa no mesmo quadro: versão 2
  const outra = await salvarRotulo(indice, "A01", dadosDoItem(item, cam, { situacao: "sem_marcacoes", camera: null }));
  assert.equal(outra.nome, `${quadro(0)}__A01__v2.json`);
  assert.deepEqual(outra.rotulo.pontos_travados, []);
  await assert.rejects(salvarRotulo(indice, "A01", dadosDoItem(item, cam, { situacao: "duvida" })), ErroFormato);
});

test("revisão: aprovar, devolver com motivo e corrigir (versão nova com a autoria de quem revisa)", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}, {}]);
  const cam = cameraExemplo();
  for (let k = 0; k < 3; k++) {
    const item = await proximoCamera(indice, "A01");
    await salvarRotulo(indice, "A01", dadosDoItem(item, cam));
  }
  const pend = await pendentesRevisao(indice, "A02");
  assert.equal(pend.length, 3);
  const r1 = await salvarRevisao(indice, "A02", pend[0].arquivo, { decisao: "aprovar", segundos_ativos: 4 });
  assert.equal(r1.revisao.motivo, null);
  await assert.rejects(salvarRevisao(indice, "A02", pend[0].arquivo, { decisao: "aprovar" }), /não está mais na sua fila/);
  await assert.rejects(salvarRevisao(indice, "A02", pend[1].arquivo, { decisao: "devolver", motivo: "outro" }), ErroFormato);
  const r2 = await salvarRevisao(indice, "A02", pend[1].arquivo, { decisao: "devolver", motivo: "lado_trocado", comentario: " virar " });
  assert.equal(r2.revisao.comentario, "virar");
  const item3 = { partida: PARTIDA, quadro: pend[2].arquivo.quadro, pacote: "estadio-sintetico/pacote-1.0", largura: 640, altura: 360, partiu_de: { fonte: "registro" } };
  const r3 = await salvarRevisao(indice, "A02", pend[2].arquivo, {
    decisao: "corrigir",
    comentario: "ajustei a lateral",
    correcao: dadosDoItem(item3, cameraExemplo([-7, 0, 0], 38)),
  });
  assert.equal(r3.correcao, `${pend[2].arquivo.quadro}__A02__v1.json`);
  const corr = await pasta.lerJson(`${pasta.rotulos(PARTIDA)}/${r3.correcao}`);
  assert.equal(corr.corrige, pend[2].arquivo.nome);
  assert.deepEqual(corr.partiu_de, { fonte: "rotulo_revisado", versao: null, referencia: pend[2].arquivo.nome });
  assert.equal((await pendentesRevisao(indice, "A02")).length, 0);
  assert.equal((await pendentesRevisao(indice, "A01")).length, 0, "a correção não volta para revisão");
  // o devolvido volta para A01 como versão 2
  const volta = await proximoCamera(indice, "A01");
  assert.equal(volta.quadro, pend[1].arquivo.quadro);
  assert.equal(volta.versao, 2);
});

test("treino com gabarito: diferença para a câmera verdadeira", async () => {
  const { pasta, indice } = await pastaExemplo();
  const cams = await criarGabarito(pasta, 3);
  const item = await proximoCamera(indice, "A01");
  assert.equal(item.treino, true);
  const verdade = cams[item.quadro].paraRotulo();
  const g = (await indice.itensGabarito()).find((x) => x.id === item.quadro);
  const errada = Camera.deHfov(verdade.hfov_graus, verdade.pan + 0.5, verdade.tilt, verdade.roll, verdade.C, 640, 360);
  const { rotulo } = await salvarRotulo(indice, "A01", dadosDoItem(item, errada));
  const d = await compararComGabarito(indice, rotulo.camera, g);
  assert.ok(d.mediana_px > 2 && d.p90_px >= d.mediana_px);
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
  const item = await proximoCamera(indice, "A01");
  await salvarRotulo(indice, "A01", dadosDoItem(item, cameraExemplo()));
  await pasta.escrever(`${pasta.quadros(PARTIDA)}/${quadro(0)}.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  await pasta.escrever("conjuntos/x/camera.parquet", "não vai");
  const { blob, n } = await exportarZip(pasta);
  assert.equal(n, 8); // equipe, divisão, pacote, manifesto, tomadas, fila, rótulo e quadro
  const caminhos = [];
  for await (const e of lerZip(blob)) caminhos.push(e.caminho);
  assert.ok(!caminhos.some((c) => c.startsWith("conjuntos/")));
  // noutra pasta vazia
  const outra = new Pasta(new PastaMemoria("outra"));
  const r = await importarZip(outra, blob);
  assert.deepEqual(r, { gravados: n, existentes: 0, conflitos: [], recusados: [] });
  const r2 = await importarZip(outra, blob);
  assert.equal(r2.existentes, n);
  // mesmo nome com outro conteúdo (a mesma pessoa anotou o quadro em dois computadores): conflito
  const [rotulo] = await outra.listar(pasta.rotulos(PARTIDA));
  const caminho = `${pasta.rotulos(PARTIDA)}/${rotulo.nome}`;
  const mudado = { ...(await outra.lerJson(caminho)), comentario: "feito no outro computador" };
  await outra.escreverJson(caminho, mudado, { sobrescrever: true });
  const r4 = await importarZip(outra, blob);
  assert.deepEqual(r4.conflitos, [caminho]);
  assert.equal(r4.existentes, n - 1);
  assert.equal((await outra.lerJson(caminho)).comentario, "feito no outro computador"); // ficou o da pasta
  // só os arquivos de A01
  const meus = await exportarZip(pasta, soDaPessoa("A01"));
  assert.equal(meus.n, 1);
  // .zip do sistema com pasta-mãe e lixo do macOS
  const terceira = new Pasta(new PastaMemoria("terceira"));
  const r3 = await importarZip(terceira, new Blob([readFileSync(new URL("deflate.zip", FIXTURES))]));
  assert.equal(r3.gravados, 1);
  assert.deepEqual(r3.recusados.map((x) => x.caminho), ["notas.txt"]);
  assert.equal((await terceira.lerEquipe()).membros[0].nome, "Ana Conceição");
});

test("tipo de arquivo pelo caminho", () => {
  assert.equal(tipoDoCaminho("equipe.json"), "equipe");
  assert.equal(tipoDoCaminho("estadios/arena-x/pacote-1.0/pacote.json"), "pacote");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/rotulos/camera/t0000001000__A01__v1.json`), "rotulo");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/revisoes/camera/t0000001000__A01__v1.json`), "revisao");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/quadros/t0000001000.jpg`), "jpg");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/previsoes/t0000001000.json`), "previsao");
  assert.equal(tipoDoCaminho("gabarito/itens/g0001.json"), "gabarito");
  assert.equal(tipoDoCaminho("gabarito/rotulos/camera/g0001__A01__v1.json"), "rotulo");
  assert.equal(tipoDoCaminho("partidas/x/fila.json"), null);
  assert.equal(tipoDoCaminho("conjuntos/2026/camera.parquet"), null);
});
