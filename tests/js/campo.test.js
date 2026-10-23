// O molde do navegador amostra e espelha igual ao laboratório.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Molde, amostrar } from "../../src/anotacao/web/js/campo.js";

const lab = JSON.parse(readFileSync(new URL("../fixtures/camera_laboratorio.json", import.meta.url), "utf-8"));

function geoDoLaboratorio(ref) {
  return {
    L: ref.L,
    W: ref.W,
    elementos: ref.elementos.map((e) => ({ ...e, tipo: e.tipo === "line" ? "reta" : "arco" })),
    pontos: ref.pontos,
    perm180: { elementos: ref.perm180_elementos, pontos: ref.perm180_pontos },
  };
}

test("amostras iguais às do laboratório", () => {
  for (const ref of lab.campos) {
    const geo = geoDoLaboratorio(ref);
    geo.elementos.forEach((el, k) => {
      const a = amostrar(el, 1.0);
      const b = ref.elementos[k].amostras_1m;
      assert.equal(a.length, b.length, el.nome);
      a.forEach((p, i) => p.forEach((v, j) => assert.ok(Math.abs(v - b[i][j]) < 1e-12, `${el.nome} ${i}`)));
    });
  }
});

test("espelhar nomes pela rotação de 180°", () => {
  const m = new Molde(geoDoLaboratorio(lab.campos[0]));
  assert.equal(m.espelharPonto("canto_esq_cab"), "canto_dir_opo");
  assert.equal(m.espelharPonto("centro"), "centro");
  assert.equal(m.espelharElemento("lateral_cab"), "lateral_opo");
  assert.equal(m.espelharElemento("grande_area_esq_frente"), "grande_area_dir_frente");
  for (const p of m.pontos) assert.equal(m.espelharPonto(m.espelharPonto(p.nome)), p.nome);
});
