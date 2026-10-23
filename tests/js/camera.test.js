// O modelo de câmera do navegador é o mesmo do laboratório (mesma fixture dos testes em Python).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Camera, ladoCanonico, ptrDeRot, rotDePtr } from "../../src/anotacao/web/js/camera.js";

const lab = JSON.parse(readFileSync(new URL("../fixtures/camera_laboratorio.json", import.meta.url), "utf-8"));
const camera = (c) => Camera.dePtr(c.f, c.pan, c.tilt, c.roll, c.C, c.w, c.h, c.k1);

test("projeção igual à do laboratório", () => {
  let pior = 0;
  for (const caso of lab.casos) {
    const cam = camera(caso.camera);
    lab.pontos_3d.forEach((X, i) => {
      const px = cam.projetar(X);
      const esperado = caso.pixels[i];
      assert.equal(px === null, esperado === null, `caso com k1=${caso.camera.k1}, ponto ${i}`);
      if (px) pior = Math.max(pior, Math.abs(px[0] - esperado[0]), Math.abs(px[1] - esperado[1]));
    });
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) assert.ok(Math.abs(cam.R[a][b] - caso.R[a][b]) < 1e-12);
    }
  }
  assert.ok(pior < 1e-6, `pior diferença ${pior} px`);
});

test("ângulos, hfov, espelhada e lado canônico", () => {
  for (const caso of lab.casos) {
    const c = caso.camera;
    const [pan, tilt, roll] = ptrDeRot(rotDePtr(c.pan, c.tilt, c.roll));
    assert.ok(Math.abs(pan - c.pan) < 1e-9 && Math.abs(tilt - c.tilt) < 1e-9 && Math.abs(roll - c.roll) < 1e-9);
    const cam = camera(c);
    assert.ok(Math.abs(cam.hfov - c.hfov_graus) < 1e-9);
    const esp = cam.espelhada();
    const [ep, et, er] = esp.ptr;
    assert.ok(Math.abs(ep - caso.espelhada.pan) < 1e-9 && Math.abs(et - caso.espelhada.tilt) < 1e-9);
    assert.ok(Math.abs(er - caso.espelhada.roll) < 1e-9);
    esp.C.forEach((v, i) => assert.ok(Math.abs(v - caso.espelhada.C[i]) < 1e-12));
    assert.equal(ladoCanonico(cam.C), caso.lado_canonico);
  }
});

test("rótulo ida e volta", () => {
  const cam = Camera.olharPara([3, -58, 14], [10, 5, 0], 33, 1920, 1080);
  const volta = Camera.deRotulo(cam.paraRotulo(), 1920, 1080);
  for (const X of [[0, 0, 0], [20, 10, 0], [-30, -20, 2.44]]) {
    const a = cam.projetar(X);
    const b = volta.projetar(X);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9);
  }
});
