// A marca "importando": duas pessoas não importam a mesma partida ao mesmo tempo.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Pasta } from "../../web/js/nucleo/pasta.js";
import { MarcaDeImportacao, PartidaJaExiste } from "../../web/js/video/importar.js";
import { PARTIDA, PastaMemoria } from "./apoio.js";

test("marca de importação: uma importação por partida de cada vez, e marca parada não trava", async () => {
  const pasta = new Pasta(new PastaMemoria());
  let agora = Date.parse("2026-11-03T15:00:00Z");
  const relogio = () => agora;
  const video = { name: "jogo.mp4", size: 1000 };
  const a = new MarcaDeImportacao(pasta, PARTIDA, video, relogio);
  await a.conferir();
  await a.renovar(true);
  const b = new MarcaDeImportacao(pasta, PARTIDA, { name: "outro.mp4", size: 5 }, relogio);
  await assert.rejects(b.conferir(), PartidaJaExiste);
  await a.conferir(); // a própria marca não atrapalha
  agora += 9 * 60_000;
  await assert.rejects(b.conferir(), /sendo importada agora \(jogo\.mp4\).*daqui a 1 min/);
  await a.renovar(); // mais de um minuto depois: renova
  agora += 9 * 60_000;
  await assert.rejects(b.conferir(), PartidaJaExiste); // renovada há 9 minutos: ainda vale
  agora += 2 * 60_000;
  await b.conferir(); // 11 minutos sem renovar: aquela importação parou
  await b.renovar(true);
  await a.tirar(); // não tira a marca de outra importação
  await assert.rejects(new MarcaDeImportacao(pasta, PARTIDA, video, relogio).conferir(), /outro\.mp4/);
  await b.tirar();
  assert.equal(await pasta.existe(pasta.importando(PARTIDA)), false);
  await b.renovar(true); // depois de tirada, não volta
  assert.equal(await pasta.existe(pasta.importando(PARTIDA)), false);
});
