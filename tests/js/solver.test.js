// O ajuste recupera a câmera a partir de pontos e linhas travados, e anda de forma previsível.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Camera } from "../../src/anotacao/web/js/camera.js";
import { amostrar } from "../../src/anotacao/web/js/campo.js";
import { ajustar, distanciaPolilinha, sigmasPadrao } from "../../src/anotacao/web/js/solver.js";

const lab = JSON.parse(readFileSync(new URL("../fixtures/camera_laboratorio.json", import.meta.url), "utf-8"));
const campo = lab.campos[0];
const ponto = (nome) => campo.pontos.find((p) => p.nome === nome).X;

function reproj(cam, verdade, nomes) {
  return Math.max(...nomes.map((n) => {
    const a = cam.projetar(ponto(n));
    const b = verdade.projetar(ponto(n));
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }));
}

test("pontos espalhados recuperam a câmera", () => {
  const verdade = Camera.olharPara([1.5, -57, 15], [-6, 4, 0], 36, 1920, 1080, 0.4);
  const nomes = ["circ_meio_cab", "circ_meio_opo", "meio_opo", "circ_esq", "circ_dir", "centro"];
  const restr = nomes.map((n) => ({ tipo: "ponto", X: ponto(n), alvo: verdade.projetar(ponto(n)), sigma: 1 }));
  const partida = Camera.olharPara([0, -58, 14], [0, 0, 0], 40, 1920, 1080);
  let cam = partida;
  for (let k = 0; k < 4; k++) cam = ajustar(cam, restr, { iteracoes: 30 });
  assert.ok(reproj(cam, verdade, campo.pontos.map((p) => p.nome).filter((n) => n.startsWith("circ") || n === "centro")) < 0.5);
});

test("um ponto só gira a câmera (pan e tilt), sem mexer na posição nem no zoom", () => {
  const cam0 = Camera.olharPara([0, -58, 14], [0, 0, 0], 40, 1920, 1080);
  const alvo = [cam0.projetar([0, 0, 0])[0] + 120, cam0.projetar([0, 0, 0])[1] - 60];
  const cam = ajustar(cam0, [{ tipo: "ponto", X: [0, 0, 0], alvo, sigma: 0.5 }], { iteracoes: 20 });
  const px = cam.projetar([0, 0, 0]);
  assert.ok(Math.hypot(px[0] - alvo[0], px[1] - alvo[1]) < 1.0);
  assert.ok(Math.abs(cam.hfov - cam0.hfov) < 0.05);
  cam.C.forEach((v, i) => assert.ok(Math.abs(v - cam0.C[i]) < 0.05));
  assert.ok(Math.abs(cam.ptr[2]) < 0.1);
});

test("linha travada puxa o molde até ela", () => {
  const verdade = Camera.olharPara([0, -58, 14], [5, 0, 0], 38, 1920, 1080);
  const lateral = amostrar({ ...campo.elementos[0], tipo: "reta" }, 0.25);
  const meio = amostrar({ ...campo.elementos[4], tipo: "reta" }, 0.25);
  const pontoNaLinha = (amostras, k) => verdade.projetar(amostras[k]);
  const restr = [
    { tipo: "ponto", X: ponto("centro"), alvo: verdade.projetar(ponto("centro")), sigma: 1 },
    { tipo: "ponto", X: ponto("circ_dir"), alvo: verdade.projetar(ponto("circ_dir")), sigma: 1 },
    { tipo: "linha", amostras: lateral, alvo: pontoNaLinha(lateral, 160), sigma: 1 },
    { tipo: "linha", amostras: meio, alvo: pontoNaLinha(meio, 30), sigma: 1 },
  ];
  let cam = Camera.olharPara([0, -58, 14], [0, 0, 0], 42, 1920, 1080);
  for (let k = 0; k < 3; k++) cam = ajustar(cam, restr, { iteracoes: 30 });
  for (const r of restr) {
    const d = r.tipo === "ponto"
      ? Math.hypot(...cam.projetar(r.X).map((v, i) => v - r.alvo[i]))
      : Math.abs(distanciaPolilinha(r.alvo, r.amostras.map((X) => cam.projetar(X))));
    assert.ok(d < 1.0, `${r.tipo}: ${d}`);
  }
});

test("o que se libera depende das pistas", () => {
  const s1 = sigmasPadrao([{ tipo: "ponto" }]);
  const s4 = sigmasPadrao([{ tipo: "ponto" }, { tipo: "ponto" }, { tipo: "ponto" }, { tipo: "ponto" }]);
  assert.ok(s1[5] < 0.1 && s4[5] > 1);
  assert.ok(s1[3] < 0.01 && s4[3] > 0.1);
});
