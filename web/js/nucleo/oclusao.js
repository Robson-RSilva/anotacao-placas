// Oclusão nas placas: de onde vêm as placas do quadro, onde elas caem na imagem e o que a máscara
// pintada diz de cada uma. Espelho de src/anotacao/oclusao.py (tests/js/oclusao.test.js confere os
// dois com tests/fixtures/oclusao.json, gerado pelo Python).
//
// As placas vêm de três lugares:
//   * do item do gabarito: os polígonos exatos;
//   * do pacote do estádio (o levantamento);
//   * sem levantamento, das faixas de placas: uma faixa em cada lado do campo, a uma distância da
//     linha, com uma altura, um comprimento (centrado no meio do lado; sem ele, de canto a canto) e
//     um vão no meio (atrás do gol, por exemplo), que quem anota ajusta uma vez por partida. As
//     duas laterais têm as mesmas medidas, e os dois fundos também: no campo genérico nada decide
//     qual lado é qual (a câmera espelhada desenha o mesmo campo), então as medidas não podem
//     depender do lado. Cada faixa se divide em trechos de ~8 m, que contam como placas.
//
// A câmera aprovada do quadro desenha cada placa que está de frente para ela (as de costas não
// aparecem), da mais longe para a mais perto: a mais perto cobre a outra. A máscara tem uma classe
// por pixel; fora das placas é 0, e as placas mais baixas que 10 px (ref. 960) ficam de fora.

import { raioValido } from "./camera.js";
import { REF_W } from "./convencoes.js";
import { arredondar, mediana } from "./estatistica.js";

/** Valores da máscara. */
export const CLASSE = Object.freeze({ FORA: 0, LIVRE: 1, PESSOA: 2, BOLA: 3, REDE: 4, GRAFISMO: 5, OBJETO: 6, NAO_PLACA: 7 });

/** As classes, na ordem dos valores: nome nos arquivos, nome na tela, tecla e cor (RGB). */
export const CLASSES = Object.freeze([
  { valor: 0, nome: "fora", rotulo: "Fora das placas", tecla: null, cor: [0, 0, 0] },
  { valor: 1, nome: "livre", rotulo: "Placa livre", tecla: null, cor: [52, 152, 219] },
  { valor: 2, nome: "pessoa", rotulo: "Pessoa", tecla: "1", cor: [231, 76, 60] },
  { valor: 3, nome: "bola", rotulo: "Bola", tecla: "2", cor: [241, 196, 15] },
  { valor: 4, nome: "rede", rotulo: "Rede", tecla: "3", cor: [155, 89, 182] },
  { valor: 5, nome: "grafismo", rotulo: "Grafismo", tecla: "4", cor: [230, 126, 34] },
  { valor: 6, nome: "objeto", rotulo: "Objeto", tecla: "5", cor: [26, 188, 156] },
  { valor: 7, nome: "nao_placa", rotulo: "Não é placa", tecla: "6", cor: [127, 140, 141] },
]);
export const PALETA = Object.freeze(CLASSES.map((c) => c.cor));

/** Placa mais baixa que isto na imagem (px, ref. 960) é "pequena demais": não se pinta. */
export const ALTURA_MINIMA_REF_PX = 10;
/** Na comparação entre duas máscaras, placas com menos área que isto (px, ref. 960 × 540) ficam de fora. */
export const AREA_MINIMA_REF_PX = 150;
/** Diferença aceita na fração livre de cada placa (gabarito e rótulos cegos). */
export const LIMITE_OCLUSAO = 0.05;
/** Comprimento aproximado (m) de cada trecho de uma faixa de placas. */
export const MODULO_FAIXA = 8;
/** Medidas aceitas para as faixas (m). */
export const LIMITES_FAIXA = Object.freeze({ distancia: [0.5, 30], altura: [0.2, 5], comprimento: [2, 200], vao: [0, 100] });

const EPS_Z = 0.1; // m: o polígono é cortado antes do plano da câmera
const PASSOS_ARESTA = 16; // cada aresta vira 16 pontos (com distorção, as retas da placa curvam)
const AMOSTRAS_ALTURA = 16;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const prod = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const entre = (a, b, t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
/** Arredondamento igual nos dois lados (o `round` do Python arredonda o meio para o par). */
const arredondarMeio = (x) => Math.floor(x + 0.5);

// ------------------------------------------------------------------------------ placas
export function faixasPadrao() {
  return {
    laterais: { distancia: 4, altura: 1, comprimento: null, vao: 0, ligada: true },
    fundos: { distancia: 5, altura: 1, comprimento: null, vao: 0, ligada: true },
  };
}

/** O problema nas medidas das faixas, ou null. */
export function erroNasFaixas(faixas) {
  for (const [nome, f] of [["laterais", faixas?.laterais], ["fundos", faixas?.fundos]]) {
    if (!f) return `faltam as medidas das faixas (${nome})`;
    for (const [campo, [min, max]] of Object.entries(LIMITES_FAIXA)) {
      const v = f[campo];
      if (campo === "comprimento" && (v === null || v === undefined)) continue; // de canto a canto
      if (!(Number.isFinite(v) && v >= min && v <= max)) return `${campo} das faixas (${nome}) fora do aceito: de ${min} a ${max} m`;
    }
    if (f.comprimento !== null && f.comprimento !== undefined && f.vao >= f.comprimento) return `o vão das faixas (${nome}) precisa ser menor que o comprimento`;
  }
  return null;
}

/**
 * Os trechos das faixas de placas de um campo, como placas {id, lado, vertices} (BL, BR, TR, TL
 * vistos de frente, do campo). Os IDs crescem com x nas laterais e com y nos fundos, como no pacote.
 */
export function placasDasFaixas(campo, faixas) {
  const hl = campo.comprimento / 2;
  const hw = campo.largura / 2;
  const { laterais: lat, fundos: fun } = faixas;
  const xf = hl + fun.distancia; // linha das placas de fundo
  const yl = hw + lat.distancia; // linha das placas laterais
  const out = [];
  const trechos = (de, ate) => {
    const n = Math.max(1, arredondarMeio((ate - de) / MODULO_FAIXA));
    return Array.from({ length: n }, (_, k) => [de + ((ate - de) * k) / n, de + ((ate - de) * (k + 1)) / n]);
  };
  // a faixa centrada no meio do lado, com o vão no meio (sem comprimento: de canto a canto)
  const daFaixa = (f, cheio) => {
    const C = f.comprimento ?? cheio;
    const V = Math.min(f.vao ?? 0, C);
    const partes = V > 0 ? [[-C / 2, -V / 2], [V / 2, C / 2]] : [[-C / 2, C / 2]];
    return partes.flatMap(([de, ate]) => (ate - de > 1e-9 ? trechos(de, ate) : []));
  };
  const placa = (lado, k, BL, BR, altura) => out.push({
    id: `${lado.toUpperCase()}_${String(k + 1).padStart(2, "0")}`,
    lado,
    vertices: [[BL[0], BL[1], 0], [BR[0], BR[1], 0], [BR[0], BR[1], altura], [BL[0], BL[1], altura]],
  });
  if (lat.ligada) {
    // vista do campo, a direita da faixa oposta é +x; a da faixa das cabines, -x
    daFaixa(lat, 2 * xf).forEach(([a, b], k) => placa("opo", k, [a, yl], [b, yl], lat.altura));
    daFaixa(lat, 2 * xf).forEach(([a, b], k) => placa("cab", k, [b, -yl], [a, -yl], lat.altura));
  }
  if (fun.ligada) {
    daFaixa(fun, 2 * yl).forEach(([a, b], k) => placa("esq", k, [-xf, a], [-xf, b], fun.altura));
    daFaixa(fun, 2 * yl).forEach(([a, b], k) => placa("dir", k, [xf, b], [xf, a], fun.altura));
  }
  return out;
}

export function centroDaPlaca(V) {
  return [0, 1, 2].map((i) => (V[0][i] + V[1][i] + V[2][i] + V[3][i]) / 4);
}

/** A placa está de frente para a câmera? (as de costas não aparecem na transmissão) */
export function deFrente(C, V) {
  return prod(cruz(sub(V[1], V[0]), sub(V[3], V[0])), sub(C, centroDaPlaca(V))) > 0;
}

// ------------------------------------------------------------------------------ projeção
function noReferencialDaCamera(cam, X) {
  const R = cam.R;
  const dx = X[0] - cam.C[0];
  const dy = X[1] - cam.C[1];
  const dz = X[2] - cam.C[2];
  return [
    R[0][0] * dx + R[0][1] * dy + R[0][2] * dz,
    R[1][0] * dx + R[1][1] * dy + R[1][2] * dz,
    R[2][0] * dx + R[2][1] * dy + R[2][2] * dz,
  ];
}

/** Projeta um ponto já no referencial da câmera, como `Camera.projetar` (null atrás ou fora do raio válido). */
function projetarDaCamera(cam, P) {
  if (!(P[2] > 1e-3)) return null;
  let nx = P[0] / P[2];
  let ny = P[1] / P[2];
  if (cam.k1 !== 0 || cam.k2 !== 0) {
    const r2 = nx * nx + ny * ny;
    if (!(Math.sqrt(r2) < raioValido(cam.k1, cam.k2))) return null;
    const s = 1 + cam.k1 * r2 + cam.k2 * r2 * r2;
    nx *= s;
    ny *= s;
  }
  return [cam.f * nx + cam.cx, cam.f * ny + cam.cy];
}

const projetar = (cam, X) => projetarDaCamera(cam, noReferencialDaCamera(cam, X));

/** Recorta o polígono (no referencial da câmera) no plano z = EPS_Z (Sutherland–Hodgman). */
function cortarPerto(P) {
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    const da = a[2] - EPS_Z;
    const db = b[2] - EPS_Z;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(entre(a, b, da / (da - db)));
  }
  return out;
}

/** O contorno da placa na imagem (pontos [u, v]), com a distorção da lente; null quando não aparece. */
export function contornoNaImagem(cam, V) {
  const P = cortarPerto(V.map((X) => noReferencialDaCamera(cam, X)));
  if (P.length < 3) return null;
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    for (let k = 0; k < PASSOS_ARESTA; k++) {
      const q = projetarDaCamera(cam, entre(a, b, k / PASSOS_ARESTA));
      if (q) out.push(q);
    }
  }
  return out.length >= 3 ? out : null;
}

/**
 * Os pixels (x, y) cujo centro (x + 0,5; y + 0,5) cai dentro do polígono (regra par-ímpar), linha a
 * linha: chama `aoTrecho(y, x0, x1)` para cada trecho [x0, x1) dentro da imagem w × h.
 */
export function rasterizar(pol, w, h, aoTrecho) {
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const p of pol) {
    if (p[1] < ymin) ymin = p[1];
    if (p[1] > ymax) ymax = p[1];
  }
  const y0 = Math.max(0, Math.ceil(ymin - 0.5));
  const y1 = Math.min(h - 1, Math.ceil(ymax - 0.5) - 1);
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const Y = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
      const ya = pol[j][1];
      const yb = pol[i][1];
      if ((ya <= Y && Y < yb) || (yb <= Y && Y < ya)) {
        xs.push(pol[j][0] + ((Y - ya) / (yb - ya)) * (pol[i][0] - pol[j][0]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xi = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xf = Math.min(w, Math.ceil(xs[k + 1] - 0.5));
      if (xf > xi) aoTrecho(y, xi, xf);
    }
  }
}

/** Altura da placa na imagem (px, ref. 960): a maior entre as colunas da placa que caem na imagem. */
export function alturaNaImagem(cam, V, w, h) {
  let maior = 0;
  for (let i = 0; i <= AMOSTRAS_ALTURA; i++) {
    const t = i / AMOSTRAS_ALTURA;
    const pb = projetar(cam, entre(V[0], V[1], t));
    const pt = projetar(cam, entre(V[3], V[2], t));
    if (!pb || !pt) continue;
    if (Math.max(pb[0], pt[0]) < 0 || Math.min(pb[0], pt[0]) >= w || Math.max(pb[1], pt[1]) < 0 || Math.min(pb[1], pt[1]) >= h) continue;
    maior = Math.max(maior, Math.hypot(pt[0] - pb[0], pt[1] - pb[1]));
  }
  return (maior * REF_W) / w;
}

/**
 * Onde cada placa cai no quadro: `regiao` (Uint16Array, w × h) diz em cada pixel qual placa está na
 * frente (índice + 1; 0 fora das placas), `roi` (Uint8Array) marca o que se pinta (as placas que não
 * são pequenas demais) e `info` lista as placas que caem na imagem, na ordem de `placas`:
 * {k, id, lado, area_px, altura_ref_px, pequena}. `contornos` são os polígonos, para desenhar.
 */
export function geometria(cam, placas, w, h) {
  const vistas = [];
  placas.forEach((placa, k) => {
    const V = placa.vertices;
    if (!deFrente(cam.C, V)) return;
    const pol = contornoNaImagem(cam, V);
    if (!pol) return;
    const d = sub(cam.C, centroDaPlaca(V));
    vistas.push({ k, pol, dist: Math.hypot(d[0], d[1], d[2]) });
  });
  vistas.sort((a, b) => b.dist - a.dist || a.k - b.k); // a mais longe primeiro: a mais perto cobre
  const regiao = new Uint16Array(w * h);
  const area = new Map();
  for (const v of vistas) {
    let n = 0;
    rasterizar(v.pol, w, h, (y, x0, x1) => {
      regiao.fill(v.k + 1, y * w + x0, y * w + x1);
      n += x1 - x0;
    });
    if (n) area.set(v.k, n);
  }
  const info = [...area.keys()].sort((a, b) => a - b).map((k) => {
    const altura = arredondar(alturaNaImagem(cam, placas[k].vertices, w, h), 1); // decide com o número que se mostra
    return { k, id: placas[k].id, lado: placas[k].lado ?? null, area_px: area.get(k), altura_ref_px: altura, pequena: altura < ALTURA_MINIMA_REF_PX };
  });
  const pequena = new Uint8Array(placas.length + 1);
  for (const p of info) if (p.pequena) pequena[p.k + 1] = 1;
  const roi = new Uint8Array(w * h);
  for (let i = 0; i < regiao.length; i++) {
    const r = regiao[i];
    if (r && !pequena[r]) roi[i] = 1;
  }
  return { w, h, placas, regiao, roi, info, contornos: vistas.map((v) => ({ k: v.k, pol: v.pol })) };
}

// ------------------------------------------------------------------------------ máscara
/**
 * A máscara que se grava: dentro das placas que se pintam, a classe pintada (o que não foi pintado
 * é placa livre); fora delas, 0. `pintura` tem a classe pintada em cada pixel (0: nada).
 */
export function mascaraEfetiva(pintura, roi) {
  const out = new Uint8Array(roi.length);
  for (let i = 0; i < roi.length; i++) if (roi[i]) out[i] = pintura[i] > CLASSE.FORA && pintura[i] <= CLASSE.NAO_PLACA ? pintura[i] : CLASSE.LIVRE;
  return out;
}

/** A pintura de partida a partir de uma máscara gravada (a versão anterior ou a previsão de um modelo). */
export function pinturaDe(mascara) {
  const out = new Uint8Array(mascara.length);
  for (let i = 0; i < mascara.length; i++) {
    const v = mascara[i];
    if (v > CLASSE.LIVRE && v <= CLASSE.NAO_PLACA) out[i] = v;
  }
  return out;
}

/**
 * O que a máscara diz de cada placa da imagem: os pixels de cada classe onde a placa está na frente,
 * os cobertos por outra placa e a fração livre — (livre + rede) / (área − "não é placa"); a rede não
 * cobre por enquanto (se conta, decide-se depois, com `rede_px`). Placas pequenas demais ficam sem
 * fração.
 */
export function estatisticas(mascara, geo) {
  const contas = new Map(geo.info.map((p) => [p.k + 1, new Float64Array(8)]));
  const { regiao } = geo;
  for (let i = 0; i < regiao.length; i++) {
    const r = regiao[i];
    if (!r) continue;
    const c = contas.get(r);
    const v = mascara[i];
    if (c && v < 8) c[v] += 1;
  }
  return geo.info.map((p) => {
    const c = contas.get(p.k + 1);
    let naFrente = 0;
    for (const v of c) naFrente += v;
    const util = p.area_px - c[CLASSE.NAO_PLACA];
    return {
      id: p.id,
      lado: p.lado,
      area_px: p.area_px,
      outra_placa_px: p.area_px - naFrente,
      livre_px: c[CLASSE.LIVRE],
      pessoa_px: c[CLASSE.PESSOA],
      bola_px: c[CLASSE.BOLA],
      rede_px: c[CLASSE.REDE],
      grafismo_px: c[CLASSE.GRAFISMO],
      objeto_px: c[CLASSE.OBJETO],
      nao_placa_px: c[CLASSE.NAO_PLACA],
      livre_frac: p.pequena || util <= 0 ? null : arredondar((c[CLASSE.LIVRE] + c[CLASSE.REDE]) / util, 4),
      altura_ref_px: p.altura_ref_px,
      pequena: p.pequena,
    };
  });
}

/** Placas que se pintam (as que não são pequenas demais). */
export const pintaveis = (info) => info.filter((p) => !p.pequena);

/**
 * Há o que pintar no quadro? Uma conta leve, para a fila: alguma placa de frente para a câmera,
 * com o contorno dentro da imagem e alta o bastante (sem montar a imagem das regiões).
 */
export function temPlacaParaPintar(cam, placas, w, h) {
  for (const placa of placas) {
    const V = placa.vertices;
    if (!deFrente(cam.C, V)) continue;
    const pol = contornoNaImagem(cam, V);
    if (!pol) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [x, y] of pol) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    if (x1 < 0 || x0 >= w || y1 < 0 || y0 >= h) continue;
    if (arredondar(alturaNaImagem(cam, V, w, h), 1) >= ALTURA_MINIMA_REF_PX) return true;
  }
  return false;
}

/**
 * Diferença na fração livre de cada placa, só pelas contas dos dois rótulos (sem as máscaras):
 * {maxima, mediana, n, placas: [{id, dif}]}. Entram as placas dos dois, que não são pequenas demais e
 * têm área suficiente. Serve para mostrar; o que decide é `compararMascaras`, que tolera 1 px na borda.
 */
export function compararOclusao(placasA, placasB, w) {
  const porId = new Map(placasB.map((p) => [p.id, p]));
  const escala = (REF_W / w) ** 2;
  const grande = (p) => !p.pequena && p.livre_frac !== null && (p.area_px - p.nao_placa_px) * escala >= AREA_MINIMA_REF_PX;
  const placas = [];
  for (const a of placasA) {
    const b = porId.get(a.id);
    if (b && grande(a) && grande(b)) placas.push({ id: a.id, dif: arredondar(Math.abs(a.livre_frac - b.livre_frac), 4) });
  }
  if (!placas.length) return { maxima: null, mediana: null, n: 0, placas };
  return { maxima: Math.max(...placas.map((p) => p.dif)), mediana: mediana(placas.map((p) => p.dif)), n: placas.length, placas };
}

/** As classes que cobrem a placa: a rede não cobre (por enquanto), e "não é placa" não é placa. */
export const COBREM = Object.freeze([CLASSE.PESSOA, CLASSE.BOLA, CLASSE.GRAFISMO, CLASSE.OBJETO]);

/** Máximo (dilatar) ou mínimo (erodir) na vizinhança 3 × 3 de uma imagem 0/1; fora dela vale `borda`. */
function vizinhanca(b, w, h, dilatar) {
  const borda = dilatar ? 0 : 1;
  const op = dilatar ? (x, y) => x | y : (x, y) => x & y;
  const meio = new Uint8Array(b.length);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const e = x > 0 ? b[o + x - 1] : borda;
      const d = x < w - 1 ? b[o + x + 1] : borda;
      meio[o + x] = op(op(e, b[o + x]), d);
    }
  }
  const out = new Uint8Array(b.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = y > 0 ? meio[i - w] : borda;
      const s = y < h - 1 ? meio[i + w] : borda;
      out[i] = op(op(c, meio[i]), s);
    }
  }
  return out;
}

/**
 * Diferença entre duas máscaras do mesmo quadro, placa a placa, com a tolerância de 1 px na borda do
 * Manual: a fração da placa em que uma cobre e a outra não, fora da faixa de 1 px em volta do que a
 * outra pintou (nos dois sentidos). {maxima, mediana, n, placas: [{id, dif}]}; sem placa grande o
 * bastante para comparar, maxima e mediana são null.
 *
 * Pintar 1 px mais largo ou mais estreito em volta da pessoa toda não conta; esquecer uma pessoa, ou
 * pintar uma que não está lá, conta quase toda a área dela. É o que decide o gabarito e a concordância
 * dos rótulos cegos.
 */
export function compararMascaras(ma, mb, geo) {
  const { w, h, regiao } = geo;
  const cobre = new Uint8Array(8);
  for (const c of COBREM) cobre[c] = 1;
  const ca = new Uint8Array(w * h);
  const cb = new Uint8Array(w * h);
  for (let i = 0; i < ca.length; i++) {
    ca[i] = cobre[ma[i] & 7];
    cb[i] = cobre[mb[i] & 7];
  }
  const caMais = vizinhanca(ca, w, h, true);
  const caMenos = vizinhanca(ca, w, h, false);
  const cbMais = vizinhanca(cb, w, h, true);
  const cbMenos = vizinhanca(cb, w, h, false);
  const nUtil = new Float64Array(geo.placas.length + 1);
  const nFora = new Float64Array(geo.placas.length + 1);
  for (let i = 0; i < regiao.length; i++) {
    const r = regiao[i];
    if (!r || ma[i] === CLASSE.NAO_PLACA || mb[i] === CLASSE.NAO_PLACA) continue;
    nUtil[r] += 1;
    const fora = (ca[i] && !cbMais[i]) || (cbMenos[i] && !ca[i]) || (cb[i] && !caMais[i]) || (caMenos[i] && !cb[i]);
    if (fora) nFora[r] += 1;
  }
  const escala = (REF_W / w) ** 2;
  const placas = [];
  for (const p of geo.info) {
    const k = p.k + 1;
    if (p.pequena || nUtil[k] * escala < AREA_MINIMA_REF_PX) continue;
    placas.push({ id: p.id, dif: arredondar(nFora[k] / nUtil[k], 4) });
  }
  if (!placas.length) return { maxima: null, mediana: null, n: 0, placas };
  const difs = placas.map((x) => x.dif);
  return { maxima: Math.max(...difs), mediana: mediana(difs), n: difs.length, placas };
}

/** As placas de um rótulo ou item: as do gabarito, as do pacote ou as das faixas. */
export function placasDoRotulo({ placas_de: de, faixas, campo }, pacote, item = null) {
  if (de === "gabarito") {
    if (!item) throw new Error("as placas do gabarito precisam do item");
    return item.placas;
  }
  if (de === "pacote") return pacote.placas;
  if (de === "faixas") return placasDasFaixas(campo ?? pacote.campo, faixas);
  throw new Error(`origem de placas desconhecida: ${de}`);
}
