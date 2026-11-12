// O molde do navegador é construído, amostrado e espelhado igual ao laboratório.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { LARGURA_LINHA, Molde, PONTOS_MARCAVEIS, PONTOS_SEM_MARCA, amostrar, construirCampo, descricaoPonto, distanciaElemento } from "../../web/js/nucleo/campo.js";

const lab = JSON.parse(readFileSync(new URL("../fixtures/campo_laboratorio.json", import.meta.url), "utf-8"));
const ref = JSON.parse(readFileSync(new URL("../fixtures/convencoes.json", import.meta.url), "utf-8"));

const perto = (a, b, tol = 1e-12) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

test("com largura 0, o campo construído é o do laboratório (elementos, pontos e simetria)", () => {
  for (const ref of lab.campos) {
    const geo = construirCampo(ref.L, ref.W, 0);
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
  const geo = construirCampo(105, 68, 0); // a geometria da regra ao pé da letra: as contas ficam redondas
  const el = (nome) => geo.elementos.find((e) => e.nome === nome);
  assert.ok(Math.abs(distanciaElemento(el("lateral_cab"), [0, -30, 0]) - 4) < 1e-12);
  assert.ok(Math.abs(distanciaElemento(el("circulo_central"), [0, 0, 0]) - 9.15) < 1e-12);
  assert.ok(Math.abs(distanciaElemento(el("circulo_central"), [12.15, 0, 4]) - 5) < 1e-12);
  // fora do arco da meia-lua: a distância é até a ponta mais próxima
  const ml = el("meia_lua_esq");
  const ponta = [ml.centro[0] + ml.raio * Math.cos(ml.a1), ml.centro[1] + ml.raio * Math.sin(ml.a1), 0];
  assert.ok(Math.abs(distanciaElemento(ml, [-52.5 + 11 - 9.15, 0, 0]) - Math.hypot(ponta[0] - (-52.5 + 11 - 9.15), ponta[1])) < 1e-9);
});

test("o campo de cada medida é reaproveitado, e os pontos ficam no meio das linhas", () => {
  assert.equal(LARGURA_LINHA, 0.12);
  const padrao = Molde.doCampo(105, 68);
  assert.equal(Molde.doCampo(), padrao);
  const outro = Molde.doCampo(100, 64);
  assert.equal(Molde.doCampo(100, 64), outro);
  assert.ok(perto(outro.ponto("canto_esq_cab"), [-49.94, -31.94, 0], 1e-9));
  assert.throws(() => padrao.ponto("nao_existe"));
  const area = (m, t) => [m.ponto(`${t}_esq_frente_cab`)[0] - m.ponto(`${t}_esq_fundo_cab`)[0], m.ponto(`${t}_esq_frente_opo`)[1] - m.ponto(`${t}_esq_frente_cab`)[1]];
  for (const m of [padrao, outro]) {
    const [fundo, largura] = area(m, "ga");
    assert.ok(Math.abs(fundo - 16.38) < 1e-9 && Math.abs(largura - 40.2) < 1e-9, `${m.L} × ${m.W}`);
    const [fundo_pa, largura_pa] = area(m, "pa");
    assert.ok(Math.abs(fundo_pa - 5.38) < 1e-9 && Math.abs(largura_pa - 18.2) < 1e-9, `${m.L} × ${m.W}`);
    assert.ok(perto(m.ponto("gol_esq_topo_cab"), [-m.L / 2 + 0.06, -3.72, 2.5], 1e-9));
    assert.ok(perto(m.ponto("penalti_esq"), [-m.L / 2 + 11, 0, 0], 1e-9));
    assert.ok(Math.abs(Math.hypot(...m.ponto("circ_meio_cab")) - 9.09) < 1e-9);
  }
});

test("os 39 pontos que se marcam e os nomes do outro lado: os mesmos do Python", () => {
  assert.deepEqual([...PONTOS_MARCAVEIS], ref.pontos_marcaveis);
  assert.deepEqual([...PONTOS_SEM_MARCA], ref.pontos_sem_marca);
  const m = Molde.doCampo();
  for (const [nome, outro] of Object.entries(ref.perm180)) assert.equal(m.espelharPonto(nome), outro, nome);
});

test("cada ponto dito em português", () => {
  assert.equal(descricaoPonto("canto_esq_cab"), "Canto · fundo esquerdo, lado das cabines");
  assert.equal(descricaoPonto("pa_dir_fundo_opo"), "Pequena área: na linha de fundo · fundo direito, lado oposto");
  assert.equal(descricaoPonto("gol_esq_pe_opo"), "Trave: pé, no gramado · fundo esquerdo, lado oposto");
  assert.equal(descricaoPonto("penalti_dir"), "Marca do pênalti · fundo direito");
  const textos = PONTOS_MARCAVEIS.map(descricaoPonto);
  assert.equal(new Set(textos).size, textos.length); // nenhum texto repetido
});
