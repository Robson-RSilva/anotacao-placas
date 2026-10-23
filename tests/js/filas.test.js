// Filas: treino e liberação pelo gabarito, gabarito escondido a cada 15, devolvidos primeiro,
// câmera de partida e revisão cruzada às cegas.
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
import {
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
