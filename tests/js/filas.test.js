// Filas: treino e liberação pelo gabarito, gabarito escondido a cada 15, devolvidos primeiro,
// câmera de partida, revisão cruzada às cegas e partidas incompletas.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Camera } from "../../web/js/nucleo/camera.js";
import {
  INTERVALO_GABARITO,
  cameraInicial,
  pendentesRevisao,
  proximoCamera,
  revisorDesignado,
  situacaoAnotador,
} from "../../web/js/nucleo/filas.js";
import { N_LIBERACAO, liberacao, nTreino } from "../../web/js/nucleo/gabarito.js";
import { calcularPlacar } from "../../web/js/nucleo/placar.js";
import {
  AGORA,
  PARTIDA,
  cameraExemplo,
  criarGabarito,
  criarPartida,
  esquemas,
  gravarRevisao,
  gravarRotulo,
  pastaExemplo,
} from "./apoio.js";

await esquemas();

const quadro = (k) => `t${String(1000 * (k + 1)).padStart(10, "0")}`;

test("sem gabarito não há bloqueio; a fila segue a ordem e pula o que já foi feito", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{ atribuido_a: ["A02"] }, {}, {}]);
  const sit = await situacaoAnotador(indice, "A01");
  assert.equal(sit.liberado, true);
  assert.equal(sit.gabarito_total, 0);
  let item = await proximoCamera(indice, "A01");
  assert.equal(item.quadro, quadro(1));
  assert.equal(item.versao, 1);
  assert.equal(item.partiu_de.fonte, "registro");
  assert.equal(item.partiu_de.referencia, "estadio-sintetico/pacote-1.0");
  await gravarRotulo(pasta, { quadro: quadro(1), pessoa: "A01", cam: cameraExemplo() });
  item = await proximoCamera(indice, "A01");
  assert.equal(item.quadro, quadro(2));
  assert.equal(item.partiu_de.fonte, "quadro_anotado"); // mesma tomada, já anotada
  await gravarRotulo(pasta, { quadro: quadro(2), pessoa: "A01" });
  assert.equal(await proximoCamera(indice, "A01"), null);
});

test("treino com gabarito até a liberação; depois um escondido a cada 15", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, Array.from({ length: 40 }, () => ({})));
  const cams = await criarGabarito(pasta, 14);
  // quem começa vê gabarito de treino
  let item = await proximoCamera(indice, "A01");
  assert.equal(item.partida, "gabarito");
  assert.equal(item.treino, true);
  assert.equal(item.largura, 640);
  // 10 acertos liberam
  const ids = Object.keys(cams);
  for (let k = 0; k < N_LIBERACAO; k++) await gravarRotulo(pasta, { partida: "gabarito", quadro: ids[k], pessoa: "A01", cam: cams[ids[k]], m: k });
  const sit = await situacaoAnotador(indice, "A01");
  assert.equal(sit.liberado, true);
  assert.ok(sit.mediana_px < 1e-6);
  for (let k = 0; k < INTERVALO_GABARITO - 1; k++) await gravarRotulo(pasta, { quadro: quadro(k), pessoa: "A01", m: 20 + k });
  item = await proximoCamera(indice, "A01");
  assert.ok(item.partida === PARTIDA && !item.treino, "14 reais: ainda não é a vez do gabarito");
  await gravarRotulo(pasta, { quadro: quadro(14), pessoa: "A01", m: 40 });
  item = await proximoCamera(indice, "A01");
  assert.ok(item.partida === "gabarito" && !item.treino, "o 16º item é um gabarito escondido");
  await gravarRotulo(pasta, { partida: "gabarito", quadro: item.quadro, pessoa: "A01", cam: cams[item.quadro], m: 41 });
  item = await proximoCamera(indice, "A01");
  assert.equal(item.partida, PARTIDA, "depois do escondido, volta para os reais até mais 15");
});

test("errar o gabarito não libera", async () => {
  const { pasta, indice } = await pastaExemplo();
  const cams = await criarGabarito(pasta, 12);
  const ids = Object.keys(cams);
  for (let k = 0; k < 10; k++) {
    const c = cams[ids[k]].paraRotulo();
    const errada = Camera.deHfov(c.hfov_graus, c.pan + 1.5, c.tilt, c.roll, c.C, 640, 360);
    await gravarRotulo(pasta, { partida: "gabarito", quadro: ids[k], pessoa: "A02", cam: errada, m: k });
  }
  const sit = await situacaoAnotador(indice, "A02");
  assert.equal(sit.liberado, false);
  assert.ok(sit.mediana_px > 2);
  assert.match(sit.motivo, /faltam acertos/);
  const item = await proximoCamera(indice, "A02");
  assert.equal(item.treino, true);
  assert.ok(!ids.slice(0, 10).includes(item.quadro));
});

test("liberação: mediana dos últimos 10 e o momento em que liberou", () => {
  const r = (v) => ({ mediana_px: v });
  assert.equal(liberacao([], false).liberado, true);
  assert.equal(liberacao(Array.from({ length: 9 }, () => r(0.5)), true).liberado, false);
  const res = [r(5), r(null), ...Array.from({ length: 10 }, () => r(1))];
  assert.equal(liberacao(res, true).liberado, true);
  assert.equal(nTreino(res), 10); // nos 10 primeiros há 8 acertos: a mediana já fica em 1 px
  assert.equal(nTreino([r(5), r(5), r(5)]), -1);
});

test("devolvido volta primeiro, como versão nova, partindo da versão anterior", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}]);
  const cam = cameraExemplo();
  const nome = await gravarRotulo(pasta, { quadro: quadro(0), pessoa: "A01", cam });
  await gravarRevisao(pasta, { quadro: quadro(0), rotulo: nome, revisor: "A02", decisao: "devolver", comentario: "olhe o lado" });
  const item = await proximoCamera(indice, "A01");
  assert.equal(item.quadro, quadro(0));
  assert.equal(item.versao, 2);
  assert.deepEqual(item.devolvido, { motivo: "lado_trocado", comentario: "olhe o lado" });
  assert.equal(item.partiu_de.fonte, "rotulo_anterior");
  assert.equal(item.partiu_de.referencia, nome);
});

test("câmera de partida: previsão do modelo, a não ser nos quadros sem previsão", async () => {
  const { pasta, indice } = await pastaExemplo();
  const fila = await criarPartida(pasta, [{}, { sem_previsao: true }]);
  const prevista = cameraExemplo([10, 5, 0], 33).paraRotulo();
  for (const it of fila.itens) {
    await pasta.gravar("previsao", pasta.previsao(PARTIDA, it.quadro), {
      formato: "previsao.camera/1",
      partida: PARTIDA,
      quadro: it.quadro,
      fonte: "detector_A",
      versao: "3f9c",
      camera: prevista,
      confianca: 0.9,
    });
  }
  const ip = await indice.partida(PARTIDA);
  const a = await cameraInicial(indice, ip, fila.itens[0], 640, 360, "estadio-sintetico/pacote-1.0");
  assert.deepEqual(a.partiu_de, { fonte: "modelo", versao: "detector_A@3f9c", referencia: null });
  assert.equal(a.camera.pan, prevista.pan);
  const b = await cameraInicial(indice, ip, fila.itens[1], 640, 360, "estadio-sintetico/pacote-1.0");
  assert.equal(b.partiu_de.fonte, "registro");
});

test("revisão às cegas: nunca o autor, cada rótulo uma vez, correções fora", async () => {
  const membros = ["A01", "A02", "A03"].map((codigo) => ({ codigo, nome: codigo, papeis: ["anotador", "revisor"] }));
  const { pasta, indice } = await pastaExemplo({ membros });
  await criarPartida(pasta, Array.from({ length: 12 }, () => ({})));
  const nomes = [];
  for (let k = 0; k < 12; k++) nomes.push(await gravarRotulo(pasta, { quadro: quadro(k), pessoa: "A01", cam: cameraExemplo(), m: k }));
  const pend = { A01: await pendentesRevisao(indice, "A01"), A02: await pendentesRevisao(indice, "A02"), A03: await pendentesRevisao(indice, "A03") };
  assert.equal(pend.A01.length, 0);
  assert.equal(pend.A02.length + pend.A03.length, 12);
  assert.ok(pend.A02.length > 0 && pend.A03.length > 0, "o sorteio espalha entre os revisores");
  for (const nome of nomes) assert.notEqual(revisorDesignado(nome, "A01", ["A01", "A02", "A03"], ["A01", "A02", "A03"]), "A01");
  // revisado sai da fila; correção do revisor não volta para revisão
  const { arquivo } = pend.A02[0];
  await gravarRevisao(pasta, { quadro: arquivo.quadro, rotulo: arquivo.nome, revisor: "A02", decisao: "corrigir", nova_versao: `${arquivo.quadro}__A02__v1.json` });
  await gravarRotulo(pasta, { quadro: arquivo.quadro, pessoa: "A02", cam: cameraExemplo(), corrige: arquivo.nome });
  const depois = [...(await pendentesRevisao(indice, "A02")), ...(await pendentesRevisao(indice, "A03"))];
  assert.equal(depois.length, 11);
  assert.ok(!depois.some((p) => p.arquivo.nome === arquivo.nome || p.arquivo.pessoa === "A02"));
});

test("sem outros revisores, qualquer membro que não seja o autor revisa", () => {
  assert.equal(revisorDesignado("t0000001000__A01__v1.json", "A01", ["A01"], ["A01", "A02"]), "A02");
  assert.equal(revisorDesignado("t0000001000__A01__v1.json", "A01", [], ["A01"]), null);
});

test("dupla às cegas: quem também anota o quadro só revisa depois de fazer o próprio rótulo", async () => {
  const { pasta, indice } = await pastaExemplo(); // A01 e A02 anotam e revisam
  await criarPartida(pasta, [{ atribuido_a: ["A01", "A02"], dupla: true }]);
  const q = quadro(0);
  const doA01 = await gravarRotulo(pasta, { quadro: q, pessoa: "A01", cam: cameraExemplo(), m: 1 });
  // A02 ainda vai anotar o mesmo quadro do zero: não pode ver o rótulo de A01 antes
  assert.deepEqual(await pendentesRevisao(indice, "A02"), []);
  assert.equal(revisorDesignado(doA01, "A01", ["A01", "A02"], ["A01", "A02"], new Set(["A02"])), null);
  const item = await proximoCamera(indice, "A02");
  assert.equal(item.quadro, q);
  assert.notEqual(item.partiu_de.referencia, doA01); // nunca parte do rótulo do outro no mesmo quadro
  const doA02 = await gravarRotulo(pasta, { quadro: q, pessoa: "A02", cam: cameraExemplo([-7, 0, 0]), m: 2 });
  // depois de anotar, cada um revisa o rótulo do outro
  assert.deepEqual((await pendentesRevisao(indice, "A02")).map((p) => p.arquivo.nome), [doA01]);
  assert.deepEqual((await pendentesRevisao(indice, "A01")).map((p) => p.arquivo.nome), [doA02]);
  // A02 corrige o de A01: a correção (versão 2 de A02) não esconde o rótulo de A02, que segue esperando revisão
  await gravarRotulo(pasta, { quadro: q, pessoa: "A02", cam: cameraExemplo([-6, 0, 0]), versao: 2, corrige: doA01, m: 3 });
  await gravarRevisao(pasta, { quadro: q, rotulo: doA01, revisor: "A02", decisao: "corrigir", nova_versao: `${q}__A02__v2.json`, m: 3 });
  assert.deepEqual((await pendentesRevisao(indice, "A01")).map((p) => p.arquivo.nome), [doA02]);
  assert.equal(await proximoCamera(indice, "A02"), null);
});

test("uma correção feita na revisão não conta como o rótulo da pessoa no quadro", async () => {
  const membros = ["A01", "A02", "A03"].map((codigo) => ({ codigo, nome: codigo, papeis: ["anotador", "revisor"] }));
  const { pasta, indice } = await pastaExemplo({ membros });
  await criarPartida(pasta, [{ atribuido_a: ["A01", "A02"], dupla: true }]);
  const q = quadro(0);
  const doA01 = await gravarRotulo(pasta, { quadro: q, pessoa: "A01", cam: cameraExemplo(), m: 1 });
  await gravarRotulo(pasta, { quadro: q, pessoa: "A02", cam: cameraExemplo(), corrige: doA01, m: 2 }); // de antes da 0.2.1
  const item = await proximoCamera(indice, "A02");
  assert.equal(item.quadro, q, "o quadro continua na fila de A02");
  assert.equal(item.versao, 2, "e a versão nova não repete o nome da correção");
});

test("os itens escondidos do gabarito contam a partir da liberação", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, Array.from({ length: 140 }, () => ({})));
  // 100 rótulos reais feitos quando ainda não havia gabarito
  for (let k = 0; k < 100; k++) await gravarRotulo(pasta, { quadro: quadro(k), pessoa: "A01", m: k });
  const cams = await criarGabarito(pasta, 20);
  const ids = Object.keys(cams);
  let item = await proximoCamera(indice, "A01");
  assert.ok(item.partida === "gabarito" && item.treino, "com gabarito novo, primeiro o treino");
  for (let k = 0; k < N_LIBERACAO; k++) await gravarRotulo(pasta, { partida: "gabarito", quadro: ids[k], pessoa: "A01", cam: cams[ids[k]], m: 200 + k });
  // liberado: volta para os reais, sem uma rajada de escondidos por causa dos 100 de antes
  for (let k = 0; k < INTERVALO_GABARITO; k++) {
    item = await proximoCamera(indice, "A01");
    assert.ok(item.partida === PARTIDA, `real ${k + 1} depois da liberação`);
    await gravarRotulo(pasta, { quadro: item.quadro, pessoa: "A01", m: 300 + k });
  }
  item = await proximoCamera(indice, "A01");
  assert.ok(item.partida === "gabarito" && !item.treino, "depois de 15 reais, um escondido");
  await gravarRotulo(pasta, { partida: "gabarito", quadro: item.quadro, pessoa: "A01", cam: cams[item.quadro], m: 400 });
  assert.equal((await proximoCamera(indice, "A01")).partida, PARTIDA, "e só um");
});

test("partida incompleta ou inválida não trava as filas nem o placar", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}]);
  const semFila = "2026-11-05_estadio-sintetico_time-c-time-d";
  await criarPartida(pasta, [{}], { partida: semFila });
  await pasta.apagar(pasta.fila(semFila)); // a fila ainda não sincronizou
  const vazia = "2026-11-06_estadio-sintetico_time-e-time-f";
  await criarPartida(pasta, [{}], { partida: vazia });
  await pasta.escrever(pasta.manifesto(vazia), "", { sobrescrever: true }); // escrita interrompida
  assert.deepEqual(await pasta.listarPartidas(), [PARTIDA, semFila]);
  assert.equal((await proximoCamera(indice, "A01")).partida, PARTIDA);
  const nome = await gravarRotulo(pasta, { quadro: quadro(0), pessoa: "A01", cam: cameraExemplo() });
  assert.deepEqual((await pendentesRevisao(indice, "A02")).map((p) => p.arquivo.nome), [nome]);
  const pl = await calcularPlacar(indice, AGORA);
  assert.deepEqual(pl.partidas.map((p) => p.partida), [PARTIDA]);
  assert.equal(pl.problemas.length, 1);
  assert.equal(pl.problemas[0].partida, semFila);
  assert.match(pl.problemas[0].erro, /fila\.json/);
});

test("dupla às cegas: o revisor não muda quando o outro anotador termina o dele", async () => {
  const membros = ["A01", "A02", "A03"].map((codigo) => ({ codigo, nome: codigo, papeis: ["anotador", "revisor"] }));
  const { pasta, indice } = await pastaExemplo({ membros });
  await criarPartida(pasta, [{ atribuido_a: ["A01", "A02"], dupla: true }]);
  const q = quadro(0);
  const doA01 = await gravarRotulo(pasta, { quadro: q, pessoa: "A01", cam: cameraExemplo(), m: 1 });
  const nomes = async (p) => (await pendentesRevisao(indice, p)).map((x) => x.arquivo.nome);
  assert.deepEqual(await nomes("A03"), [doA01]);
  const doA02 = await gravarRotulo(pasta, { quadro: q, pessoa: "A02", cam: cameraExemplo([-7, 0, 0]), m: 2 });
  assert.deepEqual(await nomes("A03"), [doA01, doA02]); // o de A01 continua com A03
  assert.deepEqual(await nomes("A01"), []);
  assert.deepEqual(await nomes("A02"), []);
});
