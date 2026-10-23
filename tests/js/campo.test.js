// O molde do navegador é construído, amostrado e espelhado igual ao laboratório.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Molde, amostrar, construirCampo, distanciaElemento } from "../../web/js/nucleo/campo.js";

const lab = JSON.parse(readFileSync(new URL("../fixtures/camera_laboratorio.json", import.meta.url), "utf-8"));

const perto = (a, b, tol = 1e-12) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

test("o campo construído é o do laboratório (elementos, pontos e simetria)", () => {
  for (const ref of lab.campos) {
    const geo = construirCampo(ref.L, ref.W);
    assert.equal(geo.elementos.length, 26);
    assert.equal(geo.pontos.length, 43);
    geo.elementos.forEach((el, k) => {
      const r = ref.elementos[k];
      assert.equal(el.nome, r.nome);
      assert.equal(el.grupo, r.grupo);
      assert.equal(el.tipo, r.tipo === "line" ? "reta" : "arco");
      if (el.tipo === "reta") {
        assert.ok(perto(el.A, r.A) && perto(el.B, r.B), el.nome);
      } else {
        assert.ok(perto(el.centro, r.centro) && Math.abs(el.raio - r.raio) < 1e-12, el.nome);
        assert.ok(Math.abs(el.a0 - r.a0) < 1e-12 && Math.abs(el.a1 - r.a1) < 1e-12, el.nome);
      }
      const a = amostrar(el, 1.0);
      assert.equal(a.length, r.amostras_1m.length, el.nome);
      a.forEach((p, i) => assert.ok(perto(p, r.amostras_1m[i]), `${el.nome} ${i}`));
    });
    geo.pontos.forEach((p, k) => {
      assert.equal(p.nome, ref.pontos[k].nome);
      assert.equal(p.tipo, ref.pontos[k].tipo);
      assert.ok(perto(p.X, ref.pontos[k].X), p.nome);
    });
    assert.deepEqual(geo.perm180.elementos, ref.perm180_elementos);
    assert.deepEqual(geo.perm180.pontos, ref.perm180_pontos);
  }
});

test("espelhar nomes pela rotação de 180°", () => {
  const m = new Molde(construirCampo(105, 68));
  assert.equal(m.espelharPonto("canto_esq_cab"), "canto_dir_opo");
  assert.equal(m.espelharPonto("centro"), "centro");
  assert.equal(m.espelharElemento("lateral_cab"), "lateral_opo");
  assert.equal(m.espelharElemento("grande_area_esq_frente"), "grande_area_dir_frente");
  assert.equal(m.espelharElemento("meia_lua_esq"), "meia_lua_dir");
  for (const p of m.pontos) assert.equal(m.espelharPonto(m.espelharPonto(p.nome)), p.nome);
});

test("distância exata a retas e arcos", () => {
  const geo = construirCampo(105, 68);
  const el = (nome) => geo.elementos.find((e) => e.nome === nome);
  assert.ok(Math.abs(distanciaElemento(el("lateral_cab"), [0, -30, 0]) - 4) < 1e-12);
  assert.ok(Math.abs(distanciaElemento(el("circulo_central"), [0, 0, 0]) - 9.15) < 1e-12);
  assert.ok(Math.abs(distanciaElemento(el("circulo_central"), [12.15, 0, 4]) - 5) < 1e-12);
  // fora do arco da meia-lua: a distância é até a ponta mais próxima
  const ml = el("meia_lua_esq");
  const ponta = [ml.centro[0] + ml.raio * Math.cos(ml.a1), ml.centro[1] + ml.raio * Math.sin(ml.a1), 0];
  assert.ok(Math.abs(distanciaElemento(ml, [-52.5 + 11 - 9.15, 0, 0]) - Math.hypot(ponta[0] - (-52.5 + 11 - 9.15), ponta[1])) < 1e-9);
});

test("molde do pacote é reaproveitado por dimensão", () => {
  const a = Molde.doPacote({ campo: { comprimento: 100, largura: 64 } });
  const b = Molde.doPacote({ campo: { comprimento: 100, largura: 64 } });
  assert.equal(a, b);
  assert.equal(a.L, 100);
  assert.throws(() => a.ponto("nao_existe"));
});
