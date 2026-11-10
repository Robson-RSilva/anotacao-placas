// A conferência nas páginas: o rótulo que vale de cada quadro, a medida do campo guardada, os avisos
// robustos (que valem sem a medida) e o texto de cada aviso.
import assert from "node:assert/strict";
import { test } from "node:test";

import { conferirQuadro, projetar } from "../../web/js/nucleo/camera.js";
import { Molde, PONTOS_MARCAVEIS } from "../../web/js/nucleo/campo.js";
import { campoDaPartida, camadaDoCampo, pontosQueValem, resumoDaConferencia, soRobustos, textoDoAviso } from "../../web/js/ui/conferencia.js";

function olharPara(C, alvo, hfov, w = 1280, h = 720) {
  const d = alvo.map((v, i) => v - C[i]);
  const n = Math.hypot(...d);
  const fz = d.map((v) => v / n);
  const nd = Math.hypot(fz[0], fz[1]);
  const r = [fz[1] / nd, -fz[0] / nd, 0];
  const b = [fz[1] * r[2] - fz[2] * r[1], fz[2] * r[0] - fz[0] * r[2], fz[0] * r[1] - fz[1] * r[0]];
  return { f: w / 2 / Math.tan((hfov * Math.PI) / 360), R: [r, b, fz], C, w, h, cx: w / 2, cy: h / 2 };
}

const CAM = olharPara([5, -60, 22], [-25, 2, 0], 45);
const molde = Molde.doCampo();
const PONTOS = PONTOS_MARCAVEIS.map((n) => ({ ponto: n, p: projetar(CAM, molde.ponto(n)) }))
  .filter(({ p }) => p && p[0] > 2 && p[1] > 2 && p[0] < CAM.w - 2 && p[1] < CAM.h - 2)
  .map(({ ponto, p }) => ({ ponto, x: p[0], y: p[1] }));

test("o descarte não leva pontos; a medida do campo é guardada pela lista de rótulos", () => {
  assert.deepEqual(pontosQueValem({ situacao: "descartada", pontos: [{ ponto: "centro", x: 1, y: 1 }] }), []);
  assert.equal(pontosQueValem({ situacao: "ok", pontos: PONTOS }).length, PONTOS.length);
  const rotulos = [{ nome: "a.json", pontos: PONTOS, largura: CAM.w, altura: CAM.h }];
  const m = campoDaPartida("p1", rotulos);
  assert.equal(m.conhecido, false); // um quadro só não mede o campo
  assert.equal(campoDaPartida("p1", rotulos), m);
});

test("sem a medida do campo, só valem os avisos robustos; o texto de cada um", () => {
  const i = PONTOS.findIndex((p) => p.ponto === "ga_esq_frente_cab");
  const fora = PONTOS.map((p, k) => (k === i ? { ...p, x: p.x + 30 } : p));
  const c = conferirQuadro(fora, CAM.w, CAM.h);
  assert.equal(c.nivel, "conferir");
  const r = soRobustos(c);
  assert.equal(r.nivel, "sem_folga");
  assert.deepEqual(r.avisos, []);
  assert.match(resumoDaConferencia(r), /A câmera fecha/);
  assert.match(textoDoAviso(c.avisos[0]), /Grande área: canto da frente · fundo esquerdo, lado das cabines \(ga_esq_frente_cab\) está a \d+ px/);
  const espelhados = PONTOS.map((p) => ({ ...p, ponto: p.ponto.replace(/esq|dir/g, (m) => (m === "esq" ? "dir" : "esq")) }));
  const e = soRobustos(conferirQuadro(espelhados, CAM.w, CAM.h));
  assert.equal(e.nivel, "conferir");
  assert.match(resumoDaConferencia(e), /espelhados/);
  assert.equal(camadaDoCampo(e), null); // a câmera embaixo do gramado não se desenha
  const ok = conferirQuadro(PONTOS, CAM.w, CAM.h);
  assert.match(resumoDaConferencia(ok), /Os pontos batem entre si/);
  const camada = camadaDoCampo(c);
  assert.ok(camada.linhas.length > 3);
  assert.equal(camada.setas.length, 1);
  assert.deepEqual(camada.setas[0].de, [fora[i].x, fora[i].y]);
});
