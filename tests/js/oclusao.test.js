// Oclusão nas placas: as faixas de placas, a geometria (os mesmos pixels do Python), a máscara, as
// estatísticas por placa e a comparação entre duas máscaras; e o PNG de índices.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Camera } from "../../web/js/nucleo/camera.js";
import {
  ALTURA_MINIMA_REF_PX,
  CLASSE,
  PALETA,
  compararMascaras,
  compararOclusao,
  deFrente,
  erroNasFaixas,
  estatisticas,
  faixasPadrao,
  geometria,
  mascaraEfetiva,
  pinturaDe,
  placasDasFaixas,
  rasterizar,
} from "../../web/js/nucleo/oclusao.js";
import { validarGeometria } from "../../web/js/nucleo/pacote.js";
import { codificarPng, decodificarPng, ehPng } from "../../web/js/nucleo/png.js";
import { FIXTURES, lerJson } from "./apoio.js";

const FIX = lerJson(new URL("oclusao.json", FIXTURES));

function rle(a) {
  const out = [];
  for (let i = 0; i < a.length; i++) {
    if (out.length && out[out.length - 1][0] === a[i]) out[out.length - 1][1] += 1;
    else out.push([a[i], 1]);
  }
  return out;
}

const bytesDe = (b64) => Uint8Array.from(Buffer.from(b64, "base64"));

test("faixas de placas: trechos de ~8 m, IDs crescendo com x e com y, frente para o campo", () => {
  const placas = placasDasFaixas(FIX.campo, FIX.faixas);
  assert.deepEqual(placas, FIX.placas); // os mesmos números do Python
  const ids = placas.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  // um "pacote" com essas placas passa na mesma conferência dos pacotes de estádio
  const comoPacote = { placas: placas.map((p) => ({ ...p, tipo: "led", patrocinador: null })) };
  assert.deepEqual(validarGeometria(comoPacote), []);
  const opo = placas.filter((p) => p.lado === "opo");
  assert.ok(opo.every((p, k) => k === 0 || p.vertices[0][0] > opo[k - 1].vertices[0][0]));
  const comprimento = (p) => Math.hypot(p.vertices[1][0] - p.vertices[0][0], p.vertices[1][1] - p.vertices[0][1]);
  assert.ok(placas.every((p) => comprimento(p) > 6 && comprimento(p) < 10));
  // sem os fundos, só as laterais
  const soLaterais = placasDasFaixas(FIX.campo, { ...FIX.faixas, fundos: { ...FIX.faixas.fundos, ligada: false } });
  assert.deepEqual(new Set(soLaterais.map((p) => p.lado)), new Set(["opo", "cab"]));
  assert.equal(erroNasFaixas(faixasPadrao()), null);
  assert.match(erroNasFaixas({ ...faixasPadrao(), fundos: { ...faixasPadrao().fundos, distancia: 0.1 } }), /distancia/);
  assert.match(erroNasFaixas({ ...faixasPadrao(), fundos: { ...faixasPadrao().fundos, comprimento: 10, vao: 12 } }), /vão/);
  // o vão no meio do fundo: nenhum trecho atrás do gol
  const fundos = placasDasFaixas(FIX.campo, FIX.faixas).filter((p) => p.lado === "esq");
  const ys = fundos.flatMap((p) => [p.vertices[0][1], p.vertices[1][1]]);
  assert.ok(fundos.every((p) => Math.min(p.vertices[0][1], p.vertices[1][1]) >= 5.5 - 1e-9 || Math.max(p.vertices[0][1], p.vertices[1][1]) <= -5.5 + 1e-9));
  assert.ok(Math.abs(Math.min(...ys) + 31) < 1e-9 && Math.abs(Math.max(...ys) - 31) < 1e-9);
  // as do laboratório: 12 placas de 8 m nas laterais e 3 de cada lado do gol
  const lab = placasDasFaixas({ comprimento: 105, largura: 68 }, {
    laterais: { distancia: 4, altura: 0.98, comprimento: 96, vao: 0, ligada: true },
    fundos: { distancia: 5, altura: 0.98, comprimento: 60, vao: 12, ligada: true },
  });
  assert.equal(lab.filter((p) => p.lado === "opo").length, 12);
  assert.equal(lab.filter((p) => p.lado === "esq").length, 6);
  assert.deepEqual(lab.filter((p) => p.lado === "esq").map((p) => (p.vertices[0][1] + p.vertices[1][1]) / 2), [-26, -18, -10, 10, 18, 26]);
});

test("de frente: a câmera principal vê a faixa oposta e não vê a das cabines", () => {
  const placas = placasDasFaixas(FIX.campo, FIX.faixas);
  const C = [0, -56, 17];
  assert.ok(placas.filter((p) => p.lado === "opo").every((p) => deFrente(C, p.vertices)));
  assert.ok(placas.filter((p) => p.lado === "cab").every((p) => !deFrente(C, p.vertices)));
});

test("geometria e estatísticas: os mesmos pixels e números do Python", () => {
  const { largura: w, altura: h } = FIX;
  for (const caso of FIX.casos) {
    const cam = Camera.deRotulo(caso.camera, w, h);
    const geo = geometria(cam, FIX.placas, w, h);
    assert.deepEqual(geo.info, caso.info, caso.nome);
    assert.deepEqual(rle(geo.regiao), caso.regiao, caso.nome);
    assert.deepEqual(rle(geo.roi), caso.roi, caso.nome);
    const pintura = new Uint8Array(w * h);
    const retangulo = (y0, y1, x0, x1, v) => {
      for (let y = y0; y < y1; y++) pintura.fill(v, y * w + x0, y * w + x1);
    };
    retangulo(90, 150, 100, 180, CLASSE.PESSOA);
    retangulo(120, 140, 300, 330, CLASSE.GRAFISMO);
    retangulo(60, 200, 400, 420, CLASSE.NAO_PLACA);
    retangulo(100, 110, 200, 204, CLASSE.BOLA);
    const mascara = mascaraEfetiva(pintura, geo.roi);
    assert.deepEqual(estatisticas(mascara, geo), caso.estatisticas, caso.nome);
    const outra = new Uint8Array(w * h);
    const ret2 = (y0, y1, x0, x1, v) => {
      for (let y = y0; y < y1; y++) outra.fill(v, y * w + x0, y * w + x1);
    };
    ret2(89, 151, 99, 181, CLASSE.PESSOA);
    ret2(120, 140, 306, 336, CLASSE.GRAFISMO);
    ret2(60, 200, 400, 420, CLASSE.NAO_PLACA);
    assert.deepEqual(compararMascaras(mascara, mascaraEfetiva(outra, geo.roi), geo), caso.comparacao, caso.nome);
  }
});

test("comparar máscaras: 1 px na borda não conta; esquecer a pessoa conta a área dela", () => {
  const { largura: w, altura: h } = FIX;
  const caso = FIX.casos.find((c) => c.nome === "baixa");
  const geo = geometria(Camera.deRotulo(caso.camera, w, h), FIX.placas, w, h);
  const alvo = geo.info.find((p) => !p.pequena);
  let x0 = Infinity;
  let x1 = -Infinity;
  for (let i = 0; i < geo.regiao.length; i++) {
    if (geo.regiao[i] !== alvo.k + 1) continue;
    x0 = Math.min(x0, i % w);
    x1 = Math.max(x1, i % w);
  }
  const pintura = new Uint8Array(w * h);
  for (let i = 0; i < geo.regiao.length; i++) {
    if (geo.regiao[i] === alvo.k + 1 && i % w < x0 + ((x1 - x0) * 2) / 3) pintura[i] = CLASSE.PESSOA; // dois terços da placa
  }
  const a = mascaraEfetiva(pintura, geo.roi);
  assert.equal(compararMascaras(a, a, geo).maxima, 0);
  // a mesma pintura 1 px mais larga para os lados
  const larga = Uint8Array.from(pintura);
  for (let i = 1; i < pintura.length - 1; i++) if (pintura[i - 1] || pintura[i + 1]) larga[i] = larga[i] || CLASSE.PESSOA;
  const r = compararMascaras(a, mascaraEfetiva(larga, geo.roi), geo);
  assert.ok(r.maxima < 0.05, `${r.maxima}`);
  // a pessoa esquecida
  const esquecida = compararMascaras(a, mascaraEfetiva(new Uint8Array(w * h), geo.roi), geo);
  assert.ok(esquecida.maxima > 0.5, `${esquecida.maxima}`);
  assert.equal(esquecida.placas.find((p) => p.dif === esquecida.maxima).id, alvo.id);
});

test("rasterizar: o centro do pixel decide, e nada sai da imagem", () => {
  const pixels = [];
  rasterizar([[0.5, 0.5], [3.5, 0.5], [3.5, 2.5], [0.5, 2.5]], 10, 10, (y, x0, x1) => pixels.push([y, x0, x1]));
  assert.deepEqual(pixels, [[0, 0, 3], [1, 0, 3]]); // centros 0,5..2,5 em x e 0,5..1,5 em y
  const fora = [];
  rasterizar([[-50, -50], [500, -50], [500, 500], [-50, 500]], 8, 6, (y, x0, x1) => fora.push([y, x0, x1]));
  assert.equal(fora.length, 6);
  assert.ok(fora.every(([, x0, x1]) => x0 === 0 && x1 === 8));
});

test("placa baixa demais na imagem fica de fora da pintura", () => {
  const { largura: w, altura: h } = FIX;
  const caso = FIX.casos.find((c) => c.nome === "fundo");
  const geo = geometria(Camera.deRotulo(caso.camera, w, h), FIX.placas, w, h);
  const pequenas = geo.info.filter((p) => p.pequena);
  assert.ok(pequenas.length > 0);
  assert.ok(pequenas.every((p) => p.altura_ref_px < ALTURA_MINIMA_REF_PX));
  for (let i = 0; i < geo.regiao.length; i++) {
    const r = geo.regiao[i];
    if (r && pequenas.some((p) => p.k + 1 === r)) assert.equal(geo.roi[i], 0);
  }
  const est = estatisticas(mascaraEfetiva(new Uint8Array(w * h), geo.roi), geo);
  assert.ok(est.filter((p) => p.pequena).every((p) => p.livre_frac === null));
  // sem nada pintado, só fica de fora o que outra placa cobre
  for (const p of est.filter((q) => !q.pequena)) assert.ok(Math.abs(p.livre_frac - (p.area_px - p.outra_placa_px) / p.area_px) < 1e-4);
});

test("pintura de partida: só as classes que cobrem; o resto volta a ser placa livre", () => {
  const m = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 9);
  assert.deepEqual([...pinturaDe(m)], [0, 0, 2, 3, 4, 5, 6, 7, 0]);
  assert.deepEqual([...mascaraEfetiva(pinturaDe(m), Uint8Array.of(1, 1, 1, 0, 1, 1, 1, 1, 1))], [1, 1, 2, 0, 4, 5, 6, 7, 1]);
});

test("comparar: a maior diferença na fração livre, sem as placas pequenas ou de área pequena", () => {
  const p = (id, livre_frac, extra = {}) => ({ id, area_px: 2000, nao_placa_px: 0, pequena: false, livre_frac, ...extra });
  const a = [p("A", 0.8), p("B", 1), p("C", 0.5, { pequena: true, livre_frac: null }), p("D", 0.9, { area_px: 100 })];
  const b = [p("A", 0.77), p("B", 0.9), p("C", 0.1), p("D", 0.1)];
  const r = compararOclusao(a, b, 960);
  assert.equal(r.n, 2);
  assert.equal(r.maxima, 0.1);
  assert.ok(Math.abs(r.mediana - 0.065) < 1e-9);
  assert.deepEqual(compararOclusao([], b, 960), { maxima: null, mediana: null, n: 0, placas: [] });
});

test("PNG: grava e lê de volta, e lê o do Python e o do OpenCV (com filtros)", async () => {
  const w = 33;
  const h = 17;
  const m = new Uint8Array(w * h).map((_, i) => (i * 7) % 8);
  const png = await codificarPng(m, w, h, PALETA);
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
