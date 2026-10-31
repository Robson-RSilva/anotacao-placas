// A região da placa (e o laço do pintor): os mesmos pixels que o Python (tests/fixtures/regioes.json).
import assert from "node:assert/strict";
import { test } from "node:test";

import { foraDaRegiao, mascaraDaRegiao, rasterizar } from "../../web/js/nucleo/regiao.js";
import { FIXTURES, lerJson } from "./apoio.js";

const ref = lerJson(new URL("regioes.json", FIXTURES));

test("os pixels dentro de cada polígono são os do Python", () => {
  for (const caso of ref.casos) {
    const m = mascaraDaRegiao(caso.poligono, ref.largura, ref.altura);
    const linhas = [];
    for (let y = 0; y < ref.altura; y++) linhas.push(Array.from(m.subarray(y * ref.largura, (y + 1) * ref.largura)).join(""));
    assert.deepEqual(linhas, caso.linhas, JSON.stringify(caso.poligono));
  }
});

test("trechos, cache por polígono e o que fica fora", () => {
  const pol = [[2, 1], [6, 1], [6, 3], [2, 3]];
  const trechos = [];
  rasterizar(pol, 8, 4, (y, a, b) => trechos.push([y, a, b]));
  assert.deepEqual(trechos, [[1, 2, 6], [2, 2, 6]]);
  rasterizar([[0, 0], [5, 0]], 8, 4, () => assert.fail("sem área, nada"));
  const m = mascaraDaRegiao(pol, 8, 4);
  assert.equal(mascaraDaRegiao(pol, 8, 4), m); // o mesmo polígono: a mesma máscara
  assert.notEqual(mascaraDaRegiao(pol, 9, 4), m);
  const pintura = new Uint8Array(32);
  pintura[1 * 8 + 3] = 1;
  pintura[0] = 1;
  assert.equal(foraDaRegiao(pintura, m), 1);
});
