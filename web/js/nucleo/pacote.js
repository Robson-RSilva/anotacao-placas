// Pacote do estádio: medidas do campo, placas (polígonos 3D) e posição das câmeras do registro.
// Espelho das funções de src/anotacao/pacote.py usadas pelas páginas.

import { Camera } from "./camera.js";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const soma = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const prod = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * Campo genérico para anotar sem o levantamento do estádio: 105 x 68 m, sem placas, e câmeras em
 * posições típicas de uma transmissão (só para o molde começar perto). Espelho de
 * `pacote_generico()` em src/anotacao/pacote.py.
 */
export function pacoteGenerico() {
  const hl = 105 / 2;
  const hw = 68 / 2;
  const cam = (nome, tipo, T) => ({ nome, tipo, T });
  return {
    formato: "pacote.estadio/1",
    estadio: "generico",
    versao: "1.0",
    nome: "Campo genérico (sem o levantamento do estádio)",
    campo: { comprimento: 105, largura: 68 },
    placas: [],
    cameras: [
      cam("principal", "principal", [0, -hw - 24, 18]),
      cam("16m_esq", "16m", [-(hl - 16.5), -hw - 24, 18]),
      cam("16m_dir", "16m", [hl - 16.5, -hw - 24, 18]),
      cam("fundo_esq", "fundo", [-hl - 15, 0, 10]),
      cam("fundo_dir", "fundo", [hl + 15, 0, 10]),
      cam("reversa", "reversa", [0, hw + 16, 10]),
      cam("baixa", "baixa", [0, -hw - 6, 2]),
      cam("tatica", "tatica", [0, -hw - 30, 35]),
    ],
  };
}

/** Pontos 3D ao longo do contorno de todas as placas (para comparar duas câmeras). */
export function amostrasPlacas(pacote, passo = 0.5) {
  const pts = [];
  for (const placa of pacote.placas) {
    const V = placa.vertices;
    for (let i = 0; i < 4; i++) {
      const a = V[i];
      const b = V[(i + 1) % 4];
      const n = Math.max(Math.ceil(norma(sub(b, a)) / passo), 1);
      for (let k = 0; k < n; k++) {
        const t = k / n;
        pts.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
      }
    }
  }
  return pts;
}

/** Câmera inicial quando não há previsão nem quadro anotado: a do registro olhando o centro. */
export function cameraPadrao(pacote, w, h, nome = null) {
  const escolha = (nome && pacote.cameras.find((c) => c.nome === nome))
    || pacote.cameras.find((c) => c.tipo === "principal")
    || pacote.cameras[0];
  return Camera.olharPara(escolha.T, alvoDoRegistro(pacote, escolha), 40, w, h);
}

/** Para onde a câmera do registro olha ao começar: o centro, ou a área quando é de fundo. */
export function alvoDoRegistro(pacote, reg) {
  if (reg.tipo === "fundo") return [Math.sign(reg.T[0]) * (pacote.campo.comprimento / 3), 0, 0];
  return [0, 0, 0];
}

/** Placas retangulares, vértices BL, BR, TR, TL vistos de frente e frente virada para o campo. */
export function validarGeometria(pacote) {
  const erros = [];
  for (const placa of pacote.placas) {
    const V = placa.vertices;
    const e1 = sub(V[1], V[0]);
    const e2 = sub(V[3], V[0]);
    if (norma(e1) < 0.1 || norma(e2) < 0.1) {
      erros.push(`${placa.id}: placa degenerada`);
      continue;
    }
    if (Math.abs(prod(e1, e2)) > 1e-3 * norma(e1) * norma(e2)) erros.push(`${placa.id}: arestas não ortogonais`);
    if (norma(sub(V[2], soma(V[1], e2))) > 1e-3) erros.push(`${placa.id}: não é um retângulo`);
    const n = cruz(e1, e2);
    const centro = [0, 1, 2].map((i) => (V[0][i] + V[1][i] + V[2][i] + V[3][i]) / 4);
    const paraOCampo = [-centro[0], -centro[1], 0];
    if (prod(n, paraOCampo) <= 0) erros.push(`${placa.id}: vértices fora de ordem (a frente da placa não olha para o campo)`);
  }
  return erros;
}
