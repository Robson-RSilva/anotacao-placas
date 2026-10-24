// Oclusão na página: a fila (só quadros com a câmera aprovada, dupla às cegas, devolvidos primeiro),
// as faixas que passam de um quadro para o outro, gravar a pintura e a revisão, o gabarito da
// oclusão, o placar e o .zip.
import assert from "node:assert/strict";
import { test } from "node:test";

import { REF_PACOTE_GENERICO } from "../../web/js/nucleo/convencoes.js";
import { cameraAprovada, pendentesRevisaoOclusao, proximoOclusao, situacaoOclusao } from "../../web/js/nucleo/filas-oclusao.js";
import { N_LIBERACAO_OCLUSAO, compararOclusaoComGabarito } from "../../web/js/nucleo/gabarito.js";
import { CLASSE, PALETA, geometria, mascaraEfetiva, placasDasFaixas } from "../../web/js/nucleo/oclusao.js";
import { calcularPlacar } from "../../web/js/nucleo/placar.js";
import { codificarPng, decodificarPng } from "../../web/js/nucleo/png.js";
import { salvarRevisaoOclusao, salvarRotuloOclusao } from "../../web/js/nucleo/rotulos-oclusao.js";
import { exportarZip, importarZip, soDaPessoa, tipoDoCaminho } from "../../web/js/nucleo/transferencia.js";
import { criarZip, lerZip } from "../../web/js/nucleo/zip.js";
import { PACOTE, PARTIDA, PastaMemoria, cameraExemplo, criarPartida, esquemas, gravarRevisao, gravarRotulo, pastaExemplo } from "./apoio.js";
import { Pasta } from "../../web/js/nucleo/pasta.js";

await esquemas();

const W = 640;
const H = 360;
const quadro = (k) => `t${String(1000 * (k + 1)).padStart(10, "0")}`;

/** Câmeras de todos os quadros anotadas por A01; as de `aprovar` aprovadas por A02. */
async function cameras(pasta, n, aprovar, extra = {}) {
  const nomes = [];
  for (let k = 0; k < n; k++) {
    const nome = await gravarRotulo(pasta, { quadro: quadro(k), pessoa: "A01", cam: cameraExemplo(), m: k, ...extra });
    if (aprovar.includes(k)) await gravarRevisao(pasta, { quadro: quadro(k), rotulo: nome, revisor: "A02", m: 30 + k });
    nomes.push(nome);
  }
  return nomes;
}

/** Uma "pessoa" cobrindo a metade esquerda da primeira placa que se pinta. */
function pessoaNaPlaca(cam, placas = PACOTE().placas) {
  const geo = geometria(cam, placas, cam.w, cam.h);
  const alvo = geo.info.find((p) => !p.pequena);
  let x0 = Infinity;
  let x1 = -Infinity;
  for (let i = 0; i < geo.regiao.length; i++) {
    if (geo.regiao[i] !== alvo.k + 1) continue;
    x0 = Math.min(x0, i % cam.w);
    x1 = Math.max(x1, i % cam.w);
  }
  const pintura = new Uint8Array(cam.w * cam.h);
  for (let i = 0; i < geo.regiao.length; i++) {
    if (geo.regiao[i] === alvo.k + 1 && i % cam.w < (x0 + x1) / 2) pintura[i] = CLASSE.PESSOA;
  }
  return { alvo, pintura, geo };
}

function dadosDaPintura(item, pintura, extra = {}) {
  return {
    partida: item.partida,
    quadro: item.quadro,
    pacote: item.pacote,
    largura: item.largura,
    altura: item.altura,
    camera: item.camera,
    camera_de: item.camera_de,
    campo: item.campo,
    placas_de: item.placas_de,
    faixas: item.faixas,
    placas3d: item.placas_de === "faixas" ? placasDasFaixas(item.campo, item.faixas) : item.placas,
    partiu_de: item.partiu_de,
    pintura,
    situacao: "ok",
    comentario: "",
    segundos_ativos: 42,
    ...extra,
  };
}

test("fila da oclusão: só os quadros com a câmera aprovada, uma vez cada, e duas na dupla às cegas", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}, { dupla: true }]);
  await cameras(pasta, 3, [0, 2]);
  const ip = await indice.partida(PARTIDA);
  assert.equal(cameraAprovada(ip, quadro(1)), null); // anotada, mas ainda sem revisão
  assert.equal(cameraAprovada(ip, quadro(0)).nome, `${quadro(0)}__A01__v1.json`);
  const cam = cameraExemplo();
  const feitos = [];
  for (const pessoa of ["A02", "A03", "A04"]) {
    const item = await proximoOclusao(indice, pessoa);
    if (!item) break;
    assert.notEqual(item.quadro, quadro(1));
    assert.equal(item.placas_de, "pacote"); // o pacote sintético tem as placas do levantamento
    assert.equal(item.camera_de, `${item.quadro}__A01__v1.json`);
    assert.deepEqual(item.camera, cam.paraRotulo());
    const { pintura } = pessoaNaPlaca(cam);
    await salvarRotuloOclusao(indice, pessoa, dadosDaPintura(item, pintura));
    feitos.push(item.quadro);
  }
  // q0 uma vez, q2 (dupla) duas
  assert.deepEqual(feitos.sort(), [quadro(0), quadro(2), quadro(2)]);
  assert.equal(await proximoOclusao(indice, "A05"), null);
  // aprovada a câmera de q1, ele entra
  await gravarRevisao(pasta, { quadro: quadro(1), rotulo: `${quadro(1)}__A01__v1.json`, revisor: "A03", m: 50 });
  assert.equal((await proximoOclusao(indice, "A05")).quadro, quadro(1));
});

test("gravar a pintura: a máscara PNG ao lado, o que ela diz de cada placa e a versão seguinte", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}]);
  await cameras(pasta, 1, [0]);
  const item = await proximoOclusao(indice, "A02");
  const cam = cameraExemplo();
  const { alvo, pintura, geo } = pessoaNaPlaca(cam);
  const { nome, rotulo } = await salvarRotuloOclusao(indice, "A02", dadosDaPintura(item, pintura));
  assert.equal(nome, `${quadro(0)}__A02__v1.json`);
  assert.equal(rotulo.mascara, `${quadro(0)}__A02__v1.png`);
  assert.equal(rotulo.manual, "oclusao-0.1");
  const dir = pasta.rotulos(PARTIDA, "oclusao");
  const png = await decodificarPng(new Uint8Array(await (await pasta.arquivo(`${dir}/${rotulo.mascara}`)).arrayBuffer()));
  assert.deepEqual([...png.dados], [...mascaraEfetiva(pintura, geo.roi)]);
  const p = rotulo.placas.find((x) => x.id === alvo.id);
  assert.ok(p.livre_frac > 0.2 && p.livre_frac < 0.8);
  assert.equal(p.livre_px + p.pessoa_px + p.outra_placa_px, p.area_px);
  // sem placas para pintar: sem máscara; e a versão seguinte não repete o nome
  const outra = await salvarRotuloOclusao(indice, "A02", dadosDaPintura(item, null, { situacao: "sem_placas" }));
  assert.equal(outra.nome, `${quadro(0)}__A02__v2.json`);
  assert.equal(outra.rotulo.mascara, null);
  // uma máscara sem rótulo (gravação interrompida) também conta para a versão
  await pasta.escrever(`${dir}/${quadro(0)}__A02__v3.png`, Uint8Array.of(1));
  const terceira = await salvarRotuloOclusao(indice, "A02", dadosDaPintura(item, pintura));
  assert.equal(terceira.nome, `${quadro(0)}__A02__v4.json`);
  // o rótulo que chegou antes da máscara espera por ela
  await pasta.apagar(`${dir}/${terceira.rotulo.mascara}`);
  const ipo = await indice.partida(PARTIDA, "oclusao");
  assert.deepEqual(ipo.esperando.map((x) => x.nome), [terceira.nome]);
  assert.ok(!ipo.rotulos.some((x) => x.nome === terceira.nome));
});

test("revisão da oclusão: às cegas; o devolvido volta com a pintura anterior; a correção é de quem revisa", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}]);
  await cameras(pasta, 2, [0, 1]);
  const cam = cameraExemplo();
  const { pintura } = pessoaNaPlaca(cam);
  for (let k = 0; k < 2; k++) {
    const item = await proximoOclusao(indice, "A02");
    await salvarRotuloOclusao(indice, "A02", dadosDaPintura(item, pintura));
  }
  assert.equal((await pendentesRevisaoOclusao(indice, "A02")).length, 0); // a própria pessoa não revisa
  const pend = await pendentesRevisaoOclusao(indice, "A03");
  assert.equal(pend.length, 2);
  await salvarRevisaoOclusao(indice, "A03", pend[0].arquivo, { decisao: "devolver", motivo: "classe_errada", comentario: "é a bola" });
  const correcao = Uint8Array.from(pintura, (v) => (v ? CLASSE.BOLA : 0));
  const r = await salvarRevisaoOclusao(indice, "A03", pend[1].arquivo, {
    decisao: "corrigir",
    comentario: "",
    correcao: { pintura: correcao, placas3d: PACOTE().placas, situacao: "ok", comentario: "", segundos_ativos: 9 },
  });
  assert.equal(r.correcao, `${pend[1].arquivo.quadro}__A03__v1.json`);
  const ipo = await indice.partida(PARTIDA, "oclusao");
  const corrigida = ipo.rotulos.find((a) => a.nome === r.correcao).dados;
  assert.equal(corrigida.corrige, pend[1].arquivo.nome);
  assert.equal(corrigida.partiu_de.fonte, "rotulo_revisado");
  assert.ok(corrigida.placas.some((p) => p.bola_px > 0) && corrigida.placas.every((p) => p.pessoa_px === 0));
  await assert.rejects(salvarRevisaoOclusao(indice, "A03", pend[1].arquivo, { decisao: "aprovar" }), /não está mais na sua fila/);
  // o devolvido volta primeiro, com a pintura anterior
  const volta = await proximoOclusao(indice, "A02");
  assert.equal(volta.quadro, pend[0].arquivo.quadro);
  assert.deepEqual(volta.devolvido, { motivo: "classe_errada", comentario: "é a bola" });
  assert.equal(volta.partiu_de.fonte, "rotulo_anterior");
  assert.equal(volta.mascara_inicial, `${pasta.rotulos(PARTIDA, "oclusao")}/${pend[0].arquivo.nome.replace(".json", ".png")}`);
  assert.equal(volta.versao, 2);
});

test("faixas: a primeira pintura da partida abre com as padrão; as seguintes, com as da última", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}], { pacote: REF_PACOTE_GENERICO });
  await cameras(pasta, 2, [0, 1], { pacote: REF_PACOTE_GENERICO, campo: { comprimento: 105, largura: 68 } });
  const primeiro = await proximoOclusao(indice, "A02");
  assert.equal(primeiro.placas_de, "faixas");
  assert.equal(primeiro.faixas_padrao, true);
  assert.equal(primeiro.faixas.laterais.distancia, 4);
  const faixas = {
    laterais: { distancia: 4.5, altura: 0.9, comprimento: 96, vao: 0, ligada: true },
    fundos: { distancia: 5, altura: 1, comprimento: 60, vao: 12, ligada: true },
  };
  const cam = cameraExemplo();
  const { pintura } = pessoaNaPlaca(cam, placasDasFaixas(primeiro.campo, faixas));
  const { rotulo } = await salvarRotuloOclusao(indice, "A02", dadosDaPintura({ ...primeiro, faixas }, pintura));
  assert.deepEqual(rotulo.faixas, faixas);
  assert.ok(rotulo.placas.some((p) => p.pessoa_px > 0));
  const segundo = await proximoOclusao(indice, "A02");
  assert.equal(segundo.faixas_padrao, false);
  assert.deepEqual(segundo.faixas, faixas);
});

test("gabarito da oclusão: treino até a mediana dos últimos 5 ficar em até 5% de cada placa, depois os quadros reais", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}]);
  await cameras(pasta, 1, [0]);
  const cam = cameraExemplo();
  const { pintura, geo } = pessoaNaPlaca(cam);
  const verdade = mascaraEfetiva(pintura, geo.roi);
  const png = await codificarPng(verdade, W, H, PALETA);
  const n = N_LIBERACAO_OCLUSAO + 2;
  for (let k = 0; k < n; k++) {
    const id = `g${String(401 + k).padStart(4, "0")}`;
    await pasta.escrever(pasta.mascaraGabarito(id), png);
    await pasta.gravar("gabarito_oclusao", pasta.itemGabarito(id), {
      formato: "gabarito.oclusao/1",
      id,
      pacote: "estadio-sintetico/pacote-1.0",
      imagem: `${id}.jpg`,
      mascara: `${id}.png`,
      largura: W,
      altura: H,
      camera: cam.paraRotulo(),
      campo: null,
      placas: PACOTE().placas,
      origem: "simulador",
      observacao: "",
    });
  }
  assert.equal((await indice.itensGabarito("camera")).length, 0); // os da oclusão não são da câmera
  assert.equal((await indice.itensGabarito("oclusao")).length, n);
  let sit = await situacaoOclusao(indice, "A02");
  assert.equal(sit.liberado, false);
  // a primeira pintura esquece a pessoa: fora da tolerância
  let item = await proximoOclusao(indice, "A02");
  assert.equal(item.treino, true);
  assert.equal(item.placas_de, "gabarito");
  const errada = await salvarRotuloOclusao(indice, "A02", dadosDaPintura(item, new Uint8Array(W * H)));
  const d = await compararOclusaoComGabarito(indice, errada.rotulo, (await indice.itensGabarito("oclusao")).find((g) => g.id === item.quadro));
  assert.ok(d.maxima > 0.2);
  // a mediana dos últimos 5: com 4 certas depois da errada, já passa
  for (let k = 0; k < N_LIBERACAO_OCLUSAO - 1; k++) {
    assert.equal((await situacaoOclusao(indice, "A02")).liberado, false);
    item = await proximoOclusao(indice, "A02");
    assert.equal(item.treino, true);
    await salvarRotuloOclusao(indice, "A02", dadosDaPintura(item, pintura), { agora: new Date(Date.now() + 1000 * (k + 1)) });
  }
  sit = await situacaoOclusao(indice, "A02");
  assert.equal(sit.liberado, true, sit.motivo);
  assert.equal(sit.mediana, 0);
  item = await proximoOclusao(indice, "A02");
  assert.equal(item.treino, false);
  assert.equal(item.partida, PARTIDA);
});

test("placar da oclusão: aprovados, quadros com câmera aprovada, câmera errada e concordância dos cegos", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{ dupla: true }, {}, {}]);
  await cameras(pasta, 3, [0, 1]);
  const cam = cameraExemplo();
  const { pintura } = pessoaNaPlaca(cam);
  const quase = Uint8Array.from(pintura);
  for (let i = 0; i < quase.length; i += 97) if (quase[i]) quase[i] = 0; // um pouco diferente
  const salvos = {};
  for (const [pessoa, p] of [["A02", pintura], ["A03", quase]]) {
    const item = await proximoOclusao(indice, pessoa);
    assert.equal(item.quadro, quadro(0)); // q0, em dupla, para as duas
    salvos[pessoa] = await salvarRotuloOclusao(indice, pessoa, dadosDaPintura(item, p));
  }
  const q1 = await proximoOclusao(indice, "A04");
  const errada = await salvarRotuloOclusao(indice, "A04", dadosDaPintura(q1, null, { situacao: "camera_errada" }));
  const pend = await pendentesRevisaoOclusao(indice, "A05");
  for (const x of pend) await salvarRevisaoOclusao(indice, "A05", x.arquivo, { decisao: "aprovar" });
  const pl = await calcularPlacar(indice, new Date("2026-11-04T12:00:00Z"));
  const oc = pl.oclusao;
  assert.deepEqual(oc.partidas.map((p) => [p.elegiveis, p.anotados, p.aprovados, p.camera_errada]), [[2, 2, 2, 1]]);
  const a02 = oc.pessoas.find((p) => p.pessoa === "A02");
  assert.equal(a02.aprovados, 1);
  assert.ok(a02.concordancia !== null && a02.concordancia < 0.05);
  assert.equal(pl.pessoas.find((p) => p.pessoa === "A02").aprovados, 0, "o placar da câmera continua só da câmera");
  assert.ok(errada.rotulo.situacao === "camera_errada" && salvos.A02.rotulo.mascara);
});

test("o .zip leva as pinturas com as máscaras, e recusa uma máscara que não é PNG", async () => {
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/rotulos/oclusao/t0000001000__A02__v1.json`), "rotulo_oclusao");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/rotulos/oclusao/t0000001000__A02__v1.png`), "png");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/revisoes/oclusao/t0000001000__A03__v1.json`), "revisao_oclusao");
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/revisoes/oclusao/t0000001000__A03__v1.png`), null);
  assert.equal(tipoDoCaminho(`partidas/${PARTIDA}/previsoes/oclusao/t0000001000.png`), "png");
  assert.equal(tipoDoCaminho("gabarito/itens/g0401.png"), "png");
  assert.equal(tipoDoCaminho("gabarito/rotulos/oclusao/g0401__A02__v1.png"), "png");
  assert.equal(tipoDoCaminho("gabarito/rotulos/oclusao/g0401__A02__v1.json"), "rotulo_oclusao");
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}]);
  await cameras(pasta, 1, [0]);
  const item = await proximoOclusao(indice, "A02");
  const { pintura } = pessoaNaPlaca(cameraExemplo());
  await salvarRotuloOclusao(indice, "A02", dadosDaPintura(item, pintura));
  const { blob } = await exportarZip(pasta, soDaPessoa("A02"));
  const nomes = [];
  for await (const e of lerZip(blob)) nomes.push(e.caminho);
  assert.deepEqual(nomes.sort(), [
    `partidas/${PARTIDA}/revisoes/camera/${quadro(0)}__A02__v1.json`, // a revisão da câmera que A02 fez
    `partidas/${PARTIDA}/rotulos/oclusao/${quadro(0)}__A02__v1.json`,
    `partidas/${PARTIDA}/rotulos/oclusao/${quadro(0)}__A02__v1.png`,
  ]);
  // noutra pasta: as duas partes chegam; uma "máscara" que não é PNG fica de fora
  const outra = new Pasta(new PastaMemoria());
  await outra.criar();
  const r = await importarZip(outra, blob);
  assert.equal(r.gravados, 3);
  const falsa = await criarZip([{ caminho: `partidas/${PARTIDA}/rotulos/oclusao/${quadro(0)}__A09__v1.png`, dados: "não é png" }]);
  const r2 = await importarZip(outra, falsa);
  assert.deepEqual(r2.recusados.map((x) => x.motivo), ["não é um PNG"]);
});
