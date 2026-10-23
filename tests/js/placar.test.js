// Placar, concordância dos rótulos cegos e medidas em pixels na referência 960.
import assert from "node:assert/strict";
import { test } from "node:test";

import { distanciaCameras, distanciaPolilinha, residuoMediano, residuos } from "../../web/js/nucleo/avaliacao.js";
import { Camera } from "../../web/js/nucleo/camera.js";
import { Molde } from "../../web/js/nucleo/campo.js";
import { pacoteGenerico } from "../../web/js/nucleo/pacote.js";
import { calcularPlacar } from "../../web/js/nucleo/placar.js";
import { AGORA, PACOTE, cameraExemplo, criarPartida, esquemas, gravarRevisao, gravarRotulo, pastaExemplo } from "./apoio.js";

await esquemas();

const quadro = (k) => `t${String(1000 * (k + 1)).padStart(10, "0")}`;

test("distância entre câmeras: zero para a mesma, cresce com o erro de pan", () => {
  const pacote = PACOTE();
  const molde = Molde.doPacote(pacote);
  const cam = cameraExemplo([-8, 0, 0], 38);
  const r = cam.paraRotulo();
  const d0 = distanciaCameras(r, r, pacote, molde, 640, 360);
  assert.ok(d0[0] < 1e-9 && d0[1] < 1e-9);
  const quase = Camera.deHfov(r.hfov_graus, r.pan + 0.05, r.tilt, r.roll, r.C, 640, 360).paraRotulo();
  const d = distanciaCameras(r, quase, pacote, molde, 640, 360);
  assert.ok(d[0] > 0.05 && d[0] < 3, `0,05° de pan num plano de 38° ≈ 1,3 px na ref. 960 (${d[0]})`);
  const ceu = Camera.olharPara([0, -58, 14], [0, -58, 60], 20, 640, 360).paraRotulo(); // olhando para cima
  assert.equal(distanciaCameras(ceu, ceu, pacote, molde, 640, 360), null);
});

test("distância no campo genérico: as marcações de cada rótulo, com as medidas que ele usou", () => {
  const pacote = pacoteGenerico(); // sem placas: vale o campo
  const r = cameraExemplo([-8, 0, 0], 38).paraRotulo();
  const padrao = Molde.doPacote(pacote);
  assert.ok(distanciaCameras(r, r, pacote, padrao, 640, 360)[0] < 1e-9);
  // a mesma câmera com o campo esticado desenha as marcações em outro lugar
  const esticado = Molde.doCampo(100, 64);
  const d = distanciaCameras(r, r, pacote, padrao, 640, 360, esticado);
  assert.ok(d[0] > 1 && d[1] >= d[0], `${d}`);
  assert.deepEqual(distanciaCameras(r, r, pacote, esticado, 640, 360, esticado), [0, 0]);
});

test("resíduos dos travados, em px na referência 960", () => {
  const pacote = PACOTE();
  const molde = Molde.doPacote(pacote);
  const cam = cameraExemplo([-8, 0, 0], 38, 1920, 1080);
  const px = cam.projetar(molde.ponto("centro"));
  const lat = molde.amostras("lateral_cab", 0.25).map((X) => cam.projetar(X));
  const naLinha = lat.find((p) => p && p[0] > 500 && p[0] < 1500);
  const rotulo = {
    camera: cam.paraRotulo(),
    pontos_travados: [{ ponto: "centro", x: px[0] + 4, y: px[1] }],
    linhas_travadas: [{ elemento: "lateral_cab", x: naLinha[0], y: naLinha[1] }],
  };
  const r = residuos(rotulo, molde, 1920, 1080);
  assert.ok(Math.abs(r[0] - 2) < 1e-9, `4 px num quadro 1920 = 2 px na ref. 960 (${r[0]})`);
  assert.ok(r[1] < 0.05);
  assert.ok(Math.abs(residuoMediano(rotulo, molde, 1920, 1080) - (r[0] + r[1]) / 2) < 1e-12);
  assert.equal(residuoMediano({ camera: null }, molde, 1920, 1080), null);
  assert.equal(distanciaPolilinha([0, 0], [null, [3, 4], null]), 5);
  assert.equal(distanciaPolilinha([0, 0], [null]), Infinity);
});

test("placar: aprovados, devolvidos, concordância dos cegos e progresso das partidas", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{ dupla: true, atribuido_a: ["A01", "A02"] }, {}, {}]);
  const cam = cameraExemplo([-8, 0, 0], 38);
  const r = cam.paraRotulo();
  const quase = Camera.deHfov(r.hfov_graus, r.pan + 0.05, r.tilt, r.roll, r.C, 640, 360);
  const n1 = await gravarRotulo(pasta, { quadro: quadro(0), pessoa: "A01", cam });
  const n2 = await gravarRotulo(pasta, { quadro: quadro(0), pessoa: "A02", cam: quase, m: 5 });
  const n3 = await gravarRotulo(pasta, { quadro: quadro(1), pessoa: "A01", cam, m: 6 });
  await gravarRotulo(pasta, { quadro: quadro(2), pessoa: "A01", cam, m: 7 });
  await gravarRevisao(pasta, { quadro: quadro(0), rotulo: n1, revisor: "A02", m: 10 });
  await gravarRevisao(pasta, { quadro: quadro(0), rotulo: n2, revisor: "A01", m: 30 });
  await gravarRevisao(pasta, { quadro: quadro(1), rotulo: n3, revisor: "A02", decisao: "devolver", m: 31 });
  const pl = await calcularPlacar(indice, new Date(AGORA.getTime() + 3_600_000));
  const a01 = pl.pessoas.find((p) => p.pessoa === "A01");
  const a02 = pl.pessoas.find((p) => p.pessoa === "A02");
  assert.equal(a01.rotulos, 3);
  assert.equal(a01.aprovados, 1);
  assert.equal(a01.devolvidos, 1);
  assert.equal(a01.taxa_aprovacao, 0.5);
  assert.equal(a01.tempo_mediano_s, 20);
  assert.ok(a01.concordancia_px > 0.05 && a01.concordancia_px < 3);
  assert.equal(a01.concordancia_px, a02.concordancia_px);
  assert.equal(a02.revisoes_feitas, 2);
  assert.equal(a01.liberado, true);
  assert.ok(a01.dias_seguidos >= 1);
  assert.deepEqual(pl.partidas[0], {
    partida: pl.partidas[0].partida,
    sorteados: 3,
    anotados: 3,
    aprovados: 1,
    pendentes_revisao: 1,
  });
  assert.deepEqual(pl.total, { sorteados: 3, anotados: 3, aprovados: 1, pendentes_revisao: 1 });
  assert.equal(pl.pessoas[0].pessoa, "A01"); // empate na semana: mais aprovados no total, depois o código
});
