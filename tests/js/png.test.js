// PNG de índices: grava e lê de volta, e lê os PNGs fixos do Python e do OpenCV.
import assert from "node:assert/strict";
import { test } from "node:test";

import { codificarPng, decodificarPng, ehPng } from "../../web/js/nucleo/png.js";
import { PALETA_PLACAS } from "../../web/js/nucleo/rotulos.js";
import { FIXTURES, lerJson } from "./apoio.js";

const FIX = lerJson(new URL("png.json", FIXTURES));
const bytesDe = (b64) => Uint8Array.from(Buffer.from(b64, "base64"));

test("PNG: grava e lê de volta, e lê o do Python e o do OpenCV (com filtros)", async () => {
  const w = 33;
  const h = 17;
  const m = new Uint8Array(w * h).map((_, i) => (i * 7) % 8);
  const png = await codificarPng(m, w, h, Array.from({ length: 8 }, (_, v) => [v * 30, v * 30, v * 30]));
  assert.ok(ehPng(png));
  const lido = await decodificarPng(png);
  assert.equal(lido.largura, w);
  assert.equal(lido.altura, h);
  assert.deepEqual([...lido.dados], [...m]);
  for (const nome of ["png_paleta", "png_cinza"]) {
    const f = FIX[nome];
    const d = await decodificarPng(bytesDe(f.base64));
    assert.deepEqual([d.largura, d.altura], [f.largura, f.altura], nome);
    assert.deepEqual([...d.dados], f.indices, nome);
  }
  await assert.rejects(decodificarPng(Uint8Array.of(1, 2, 3)), /não é um PNG/);
});

test("a máscara das placas: 0 e 1, com a paleta de duas cores", async () => {
  const m = new Uint8Array(12 * 5);
  m.fill(1, 14, 20);
  const lido = await decodificarPng(await codificarPng(m, 12, 5, PALETA_PLACAS));
  assert.deepEqual([...lido.dados], [...m]);
});
