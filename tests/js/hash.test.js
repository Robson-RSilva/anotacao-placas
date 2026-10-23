// SHA-256 incremental e sorteios reprodutíveis.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";

import { Aleatorio, sementeDe } from "../../web/js/nucleo/aleatorio.js";
import { Sha256, sha256Hex } from "../../web/js/nucleo/hash.js";

const referencia = (b) => createHash("sha256").update(b).digest("hex");

test("SHA-256 igual ao do Node em vários tamanhos e cortes", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_003]) {
    const b = randomBytes(n);
    assert.equal(sha256Hex(b), referencia(b), `n=${n}`);
    const h = new Sha256();
    for (let i = 0; i < n; i += 37) h.update(b.subarray(i, Math.min(n, i + 37)));
    assert.equal(h.hex(), referencia(b), `em partes, n=${n}`);
  }
  assert.equal(sha256Hex("ação"), referencia(Buffer.from("ação", "utf-8")));
});

test("SHA-256 rápido o bastante para vídeos grandes", () => {
  const bloco = randomBytes(8 << 20);
  const h = new Sha256();
  const t0 = performance.now();
  for (let i = 0; i < 4; i++) h.update(bloco);
  const mbs = 32 / ((performance.now() - t0) / 1000);
  assert.ok(mbs > 40, `${mbs.toFixed(0)} MB/s`);
});

test("sorteios reprodutíveis pela semente", () => {
  const a = new Aleatorio("2026-11-02_x_a-b");
  const b = new Aleatorio("2026-11-02_x_a-b");
  const c = new Aleatorio("outra");
  const sa = Array.from({ length: 20 }, () => a.proximo());
  assert.deepEqual(sa, Array.from({ length: 20 }, () => b.proximo()));
  assert.notDeepEqual(sa, Array.from({ length: 20 }, () => c.proximo()));
  assert.deepEqual([...sementeDe("x")], [...sementeDe("x")]);
});

test("inteiros, permutações e amostras válidos", () => {
  const r = new Aleatorio("teste");
  const cont = new Array(6).fill(0);
  for (let i = 0; i < 6000; i++) cont[r.inteiro(6)] += 1;
  for (const v of cont) assert.ok(v > 850 && v < 1150, String(cont));
  const p = r.permutacao(50);
  assert.deepEqual([...p].sort((x, y) => x - y), Array.from({ length: 50 }, (_, i) => i));
  const am = r.amostra(10, 4);
  assert.equal(new Set(am).size, 4);
  assert.ok(am.every((v) => v >= 0 && v < 10));
  for (let i = 0; i < 1000; i++) {
    const x = r.real();
    assert.ok(x >= 0 && x < 1);
  }
  const pond = new Array(3).fill(0);
  for (let i = 0; i < 3000; i++) pond[r.ponderado([0, 1, 3])] += 1;
  assert.equal(pond[0], 0);
  assert.ok(pond[2] > 2 * pond[1]);
});
