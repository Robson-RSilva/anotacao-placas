// O mouse lento: com Ctrl, a mira anda 1/4 do que o mouse anda; sem Ctrl, volta aos poucos para debaixo dele.
import assert from "node:assert/strict";
import { test } from "node:test";

import { FATOR_LENTO, PonteiroFino, proximaMira } from "../../web/js/ui/ponteiro.js";

const perto = (a, b, tol = 1e-9) => assert.ok(Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol, `${a} x ${b}`);

test("com Ctrl a mira anda 1/4; sem Ctrl anda junto e encosta no mouse andando", () => {
  assert.equal(FATOR_LENTO, 0.25);
  // lento: 100 px de mouse, 25 px de mira
  perto(proximaMira([100, 100], [100, 100], [200, 140], true), [125, 110]);
  // normal, debaixo do mouse: anda igual
  perto(proximaMira([50, 50], [50, 50], [60, 70], false), [60, 70]);
  // normal, com a mira 75 px atrás: anda o que o mouse andou e mais metade disso na direção dele
  perto(proximaMira([125, 100], [200, 100], [220, 100], false), [155, 100]);
  // a distância que sobrou nunca passa do mouse
  perto(proximaMira([199, 100], [200, 100], [240, 100], false), [240, 100]);
  // a mira não sai da tela
  perto(proximaMira([10, 10], [10, 10], [-40, 500], false, [300, 200]), [0, 200]);
});

test("o ponteiro: Ctrl de cada evento, a roda só lê, sair da imagem volta a mira para o mouse", () => {
  const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }) };
  const p = new PonteiroFino(canvas);
  const ev = (x, y, ctrlKey = false) => ({ clientX: x + 10, clientY: y + 20, ctrlKey });
  assert.deepEqual(p.posicao(ev(100, 100)), [100, 100]);
  assert.equal(p.desviada, false);
  assert.deepEqual(p.posicao(ev(180, 140, true)), [120, 110]); // lento
  assert.equal(p.desviada, true);
  assert.deepEqual(p.posicao(ev(0, 0), { atualizar: false }), [120, 110]); // a roda aproxima em volta da mira
  assert.deepEqual(p.posicao(ev(180, 140)), [120, 110]); // soltou o Ctrl sem mexer: a mira fica
  assert.equal(p.desviada, true); // ainda longe do mouse: a página desenha a mira
  p.soltar();
  assert.equal(p.desviada, false);
  assert.deepEqual(p.posicao(ev(50, 60)), [50, 60]);
});
