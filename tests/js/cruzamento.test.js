// O ajudante de cruzamento: o ponto onde duas retas se cruzam, e o pedaço de cada reta dentro da imagem.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ANGULO_MINIMO, cruzarRetas, retaNaImagem } from "../../web/js/nucleo/cruzamento.js";

const perto = (a, b, tol = 1e-9) => assert.ok(Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol, `${a} x ${b}`);

test("o cruzamento de duas retas, com o ângulo entre elas", () => {
  // uma horizontal (y = 100) e uma vertical (x = 300): o cruzamento fica fora dos cliques, onde está coberto
  let r = cruzarRetas([10, 100], [200, 100], [300, 10], [300, 60]);
  perto(r.ponto, [300, 100]);
  assert.ok(Math.abs(r.angulo - 90) < 1e-9);
  // em perspectiva: duas linhas do campo inclinadas, que se cruzam em (412.5, 237.5)
  const a = [100, 50];
  const b = [262.5, 147.5]; // na reta y = 50 + 0.6 (x - 100)
  const c = [600, 50];
  const d = [520, 130]; // na reta y = 50 - (x - 600)
  r = cruzarRetas(a, b, c, d);
  perto(r.ponto, [412.5, 237.5], 1e-9);
  assert.ok(r.angulo > 60 && r.angulo < 90);
  // a ordem dos cliques não importa
  perto(cruzarRetas(b, a, d, c).ponto, r.ponto, 1e-9);
  // quase paralelas, ou dois cliques no mesmo lugar: não dá
  assert.equal(cruzarRetas([0, 0], [100, 0], [0, 10], [100, 10 + 100 * Math.tan(((ANGULO_MINIMO - 0.5) * Math.PI) / 180)]), null);
  assert.equal(cruzarRetas([0, 0], [1, 1], [50, 0], [50, 100]), null);
  assert.equal(cruzarRetas([0, 0], [100, 0], [50, 0], [50, 2]), null);
});

test("o pedaço de cada reta dentro da imagem", () => {
  assert.deepEqual(retaNaImagem([10, 100], [20, 100], 640, 360), [[0, 100], [640, 100]]);
  assert.deepEqual(retaNaImagem([300, 10], [300, 20], 640, 360), [[300, 0], [300, 360]]);
  const [p, q] = retaNaImagem([0, 0], [64, 36], 640, 360); // a diagonal
  perto(p, [0, 0]);
  perto(q, [640, 360]);
  assert.equal(retaNaImagem([0, -10], [10, -10], 640, 360), null); // por fora, em cima
  assert.equal(retaNaImagem([700, 0], [800, 100], 640, 360), null); // passa longe
  assert.equal(retaNaImagem([5, 5], [5, 5], 640, 360), null);
});
