// O detector de pontos no navegador: preparar a imagem e decodificar os mapas da rede como o `modelo.py`
// que o laboratório (exposicao-treino) exporta junto com o `detector.onnx` (ADR-0017). Aqui fica só a
// conta, sem nada do navegador; a rede roda no ONNX Runtime Web (video/previsao.js). Os testes conferem as
// duas metades contra casos gerados pelo próprio laboratório (tests/fixtures/detector/).
//
// A imagem vai para a entrada da rede (896 × 504 no detector-v1) como no treino, byte a byte igual à do
// laboratório (com o OpenCV 5):
//   * a janela: a menor janela com a proporção da entrada que contém o quadro, centrada (um quadro 4:3
//     ganha faixas pretas dos lados);
//   * a redução para a largura da entrada: a INTER_AREA do OpenCV (a média de cada célula, com os pesos
//     das bordas, somada em float32 e arredondada para o par); numa imagem menor que a entrada, a
//     ampliação bilinear do OpenCV (em ponto fixo);
//   * com a janela (proporção diferente de 16:9), a escala e a translação do warpAffine bilinear do
//     OpenCV, com preto fora da imagem;
//   * BGR, um plano por cor, dividido por 255.
// Dos mapas (kp: os logits de cada ponto; off: o deslocamento na célula), um ponto por canal: o pico da
// sigmoide, em x = (jx + ox) · passo; dois pontos a até nms_celulas células: fica o de maior escore; só os
// 39 que se marcam; e de volta aos pixels do quadro pela janela.

import { arredondarPar } from "./convencoes.js";

/** O escore mínimo de um ponto para ele ir para a imagem (ADR-0011 do laboratório: 97% certos). */
export const CORTE_ESCORE = 0.5;

const f32 = Math.fround;
const sat8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** A menor janela [x0, y0, largura, altura] com a proporção da entrada (IW × IH) que contém a imagem, centrada. */
export function janelaBase(W, H, IW, IH) {
  const a = IW / IH;
  let bw;
  let bh;
  if (a <= W / H) {
    bw = W;
    bh = W / a;
  } else {
    bw = H * a;
    bh = H;
  }
  return [(W - bw) / 2, (H - bh) / 2, bw, bh];
}

// ------------------------------------------------------------------------------------------------- INTER_AREA
/** As parcelas de cada pixel de saída numa direção (`computeResizeAreaTab` do OpenCV). */
function tabelaArea(ssize, dsize, cn, escala) {
  const di = [];
  const si = [];
  const alfa = [];
  for (let dx = 0; dx < dsize; dx++) {
    const fsx1 = dx * escala;
    const fsx2 = fsx1 + escala;
    const celula = Math.min(escala, ssize - fsx1);
    let sx1 = Math.ceil(fsx1);
    let sx2 = Math.floor(fsx2);
    sx2 = Math.min(sx2, ssize - 1);
    sx1 = Math.min(sx1, sx2);
    if (sx1 - fsx1 > 1e-3) {
      di.push(dx * cn);
      si.push((sx1 - 1) * cn);
      alfa.push((sx1 - fsx1) / celula);
    }
    for (let sx = sx1; sx < sx2; sx++) {
      di.push(dx * cn);
      si.push(sx * cn);
      alfa.push(1 / celula);
    }
    if (fsx2 - sx2 > 1e-3) {
      di.push(dx * cn);
      si.push(sx2 * cn);
      alfa.push(Math.min(Math.min(fsx2 - sx2, 1), celula) / celula);
    }
  }
  return { di: Int32Array.from(di), si: Int32Array.from(si), alfa: Float32Array.from(alfa) };
}

/** Redução por um fator inteiro (o caminho rápido do OpenCV: a média de cada bloco). */
function reduzirAreaInteira(src, sw, dw, dh, cn, ix, iy) {
  const dst = new Uint8Array(dw * dh * cn);
  const area = ix * iy;
  const escala = f32(1 / area);
  const passo = sw * cn;
  // por 2 × 2, o OpenCV soma com SIMD e arredonda com (soma + 2) >> 2 (o meio para cima)
  const metadeParaCima = ix === 2 && iy === 2 && (cn === 1 || cn === 3 || cn === 4);
  for (let dy = 0; dy < dh; dy++) {
    const base = dy * iy * passo;
    for (let dx = 0; dx < dw; dx++) {
      for (let k = 0; k < cn; k++) {
        let soma = 0;
        for (let sy = 0; sy < iy; sy++) {
          const linha = base + sy * passo + dx * ix * cn + k;
          for (let sx = 0; sx < ix; sx++) soma += src[linha + sx * cn];
        }
        dst[(dy * dw + dx) * cn + k] = metadeParaCima ? sat8((soma + 2) >> 2) : sat8(arredondarPar(f32(soma * escala)));
      }
    }
  }
  return dst;
}

/**
 * `cv2.resize(src, (dw, dh), interpolation=cv2.INTER_AREA)` para uma redução (dw ≤ sw, dh ≤ sh), em
 * imagens uint8 intercaladas de `cn` canais: a mesma tabela de pesos, as mesmas somas em float32 e o
 * mesmo arredondamento (para o par).
 */
export function reduzirArea(src, sw, sh, dw, dh, cn = 3) {
  if (dw === sw && dh === sh) return Uint8Array.from(src);
  const escalaX = 1 / (dw / sw);
  const escalaY = 1 / (dh / sh);
  if (escalaX < 1 || escalaY < 1) throw new Error("a INTER_AREA aqui só reduz");
  const ix = arredondarPar(escalaX);
  const iy = arredondarPar(escalaY);
  if (Math.abs(escalaX - ix) < Number.EPSILON && Math.abs(escalaY - iy) < Number.EPSILON) {
    return reduzirAreaInteira(src, sw, dw, dh, cn, ix, iy);
  }
  const tx = tabelaArea(sw, dw, cn, escalaX);
  const ty = tabelaArea(sh, dh, 1, escalaY);
  const largura = dw * cn;
  const dst = new Uint8Array(largura * dh);
  const buf = new Float32Array(largura);
  const soma = new Float32Array(largura);
  const escrever = (dy) => {
    const o = dy * largura;
    for (let d = 0; d < largura; d++) dst[o + d] = sat8(arredondarPar(soma[d]));
  };
  let anterior = ty.di[0];
  for (let j = 0; j < ty.di.length; j++) {
    const beta = ty.alfa[j];
    const dy = ty.di[j];
    const o = ty.si[j] * sw * cn;
    buf.fill(0);
    for (let k = 0; k < tx.di.length; k++) {
      const s = o + tx.si[k];
      const d = tx.di[k];
      const a = tx.alfa[k];
      for (let c = 0; c < cn; c++) buf[d + c] += f32(src[s + c] * a); // float32: o produto e a soma arredondados
    }
    if (dy !== anterior) {
      escrever(anterior);
      for (let d = 0; d < largura; d++) soma[d] = beta * buf[d];
      anterior = dy;
    } else {
      for (let d = 0; d < largura; d++) soma[d] += f32(beta * buf[d]);
    }
  }
  escrever(anterior);
  return dst;
}

// ------------------------------------------------------------------------------------------------- bilinear
/** Os coeficientes da INTER_LINEAR numa direção, em ponto fixo (11 bits), com as bordas repetidas. */
function coeficientesLineares(ssize, dsize) {
  const escala = 1 / (dsize / ssize);
  const ofs = new Int32Array(dsize);
  const a0 = new Int32Array(dsize);
  const a1 = new Int32Array(dsize);
  for (let d = 0; d < dsize; d++) {
    let f = f32((d + 0.5) * escala - 0.5);
    let s = Math.floor(f);
    f = f32(f - s);
    if (s < 0) {
      f = 0;
      s = 0;
    }
    if (s >= ssize - 1) {
      f = 0;
      s = ssize - 1;
    }
    ofs[d] = s;
    a0[d] = arredondarPar(f32(1 - f) * 2048);
    a1[d] = arredondarPar(f * 2048);
  }
  return { ofs, a0, a1 };
}

/**
 * `cv2.resize(src, (dw, dh), interpolation=cv2.INTER_LINEAR)` em uint8 de `cn` canais — o ponto fixo do
 * OpenCV (11 bits por direção), com o arredondamento da versão SIMD na vertical. Usada só para ampliar
 * (uma imagem menor que a entrada da rede).
 */
export function redimensionarLinear(src, sw, sh, dw, dh, cn = 3) {
  if (dw === sw && dh === sh) return Uint8Array.from(src);
  const cx = coeficientesLineares(sw, dw);
  const largura = dw * cn;
  // a passada horizontal de cada linha da fonte (inteiros: valor × 2048)
  const horizontal = (sy) => {
    const out = new Int32Array(largura);
    const o = sy * sw * cn;
    for (let dx = 0; dx < dw; dx++) {
      const s = cx.ofs[dx];
      const s1 = Math.min(s + 1, sw - 1);
      for (let c = 0; c < cn; c++) out[dx * cn + c] = src[o + s * cn + c] * cx.a0[dx] + src[o + s1 * cn + c] * cx.a1[dx];
    }
    return out;
  };
  const linhas = new Map();
  const linha = (sy) => {
    if (!linhas.has(sy)) linhas.set(sy, horizontal(sy));
    return linhas.get(sy);
  };
  const escalaY = 1 / (dh / sh);
  const dst = new Uint8Array(largura * dh);
  for (let dy = 0; dy < dh; dy++) {
    let fy = f32((dy + 0.5) * escalaY - 0.5);
    const sy = Math.floor(fy);
    fy = f32(fy - sy);
    const b0 = arredondarPar(f32(1 - fy) * 2048);
    const b1 = arredondarPar(fy * 2048);
    const S0 = linha(Math.min(Math.max(sy, 0), sh - 1));
    const S1 = linha(Math.min(Math.max(sy + 1, 0), sh - 1));
    for (let d = 0; d < largura; d++) {
      const v = (((S0[d] >> 4) * b0) >> 16) + (((S1[d] >> 4) * b1) >> 16);
      dst[dy * largura + d] = sat8((v + 2) >> 2);
    }
  }
  return dst;
}

/**
 * `cv2.warpAffine(src, M, (dw, dh), flags=INTER_LINEAR, borderMode=BORDER_CONSTANT, borderValue=0)` em
 * uint8 de `cn` canais. `M` = [a, b, c, d, e, f] leva a fonte ao destino. As contas do OpenCV 5 (em
 * float32, com as somas de produtos fundidas, como no SIMD dele), com preto fora da imagem. No OpenCV 4
 * (ponto fixo, 1/32 de pixel), o resultado fica a um ou dois níveis de cinza deste.
 */
export function afimLinear(src, sw, sh, dw, dh, M, cn = 3) {
  // a inversa (destino -> fonte), como o OpenCV calcula, em float32
  let D = M[0] * M[4] - M[1] * M[3];
  D = D !== 0 ? 1 / D : 0;
  const i0 = M[4] * D;
  const i1 = M[1] * -D;
  const i3 = M[3] * -D;
  const i4 = M[0] * D;
  const inv = [i0, i1, -i0 * M[2] - i1 * M[5], i3, i4, -i3 * M[2] - i4 * M[5]].map(f32);
  const dst = new Uint8Array(dw * dh * cn);
  const passo = sw * cn;
  const px = (x, y, c) => (x >= 0 && x < sw && y >= 0 && y < sh ? src[y * passo + x * cn + c] : 0);
  for (let y = 0; y < dh; y++) {
    const linhaX = f32(f32(inv[1] * y) + inv[2]);
    const linhaY = f32(f32(inv[4] * y) + inv[5]);
    for (let x = 0; x < dw; x++) {
      const fx = f32(inv[0] * x + linhaX); // fundida: um arredondamento só
      const fy = f32(inv[3] * x + linhaY);
      const sx = Math.floor(fx);
      const sy = Math.floor(fy);
      const a = f32(fx - sx);
      const b = f32(fy - sy);
      const o = (y * dw + x) * cn;
      for (let c = 0; c < cn; c++) {
        const p00 = px(sx, sy, c);
        const p01 = px(sx + 1, sy, c);
        const p10 = px(sx, sy + 1, c);
        const p11 = px(sx + 1, sy + 1, c);
        const v0 = f32(p00 + a * (p01 - p00));
        const v1 = f32(p10 + a * (p11 - p10));
        dst[o + c] = sat8(arredondarPar(f32(v0 + b * f32(v1 - v0))));
      }
    }
  }
  return dst;
}

// ------------------------------------------------------------------------------------------------- a entrada
/** RGBA (o `ImageData` do canvas) -> BGR intercalado. */
export function rgbaParaBgr(rgba, n) {
  const bgr = new Uint8Array(n * 3);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    bgr[j] = rgba[4 * i + 2];
    bgr[j + 1] = rgba[4 * i + 1];
    bgr[j + 2] = rgba[4 * i];
  }
  return bgr;
}

/**
 * A imagem de entrada da rede (IH × IW × 3, BGR uint8) e a janela [x0, y0, kx, ky] para voltar aos
 * pixels do quadro: o `preparar` do `modelo.py`.
 */
export function prepararImagem(bgr, W, H, IW, IH) {
  const [x0, y0, bw, bh] = janelaBase(W, H, IW, IH);
  let reduzida = bgr;
  let rw = W;
  let rh = H;
  if (W !== IW) {
    rw = IW;
    rh = Math.max(1, arredondarPar((H * IW) / W));
    reduzida = IW < W ? reduzirArea(bgr, W, H, rw, rh) : redimensionarLinear(bgr, W, H, rw, rh);
  }
  const kx = IW / bw;
  const ky = IH / bh;
  const janela = [x0, y0, kx, ky];
  if (Math.abs(x0) < 1e-6 && Math.abs(y0) < 1e-6 && Math.abs(kx - IW / W) < 1e-9 && Math.abs(ky - IH / H) < 1e-9) {
    return { imagem: reduzirArea(reduzida, rw, rh, IW, IH), janela };
  }
  const s = rw / W;
  const ax = kx / s;
  const bx = -kx * x0;
  const ay = ky / s;
  const by = -ky * y0;
  const M = [ax, 0, 0.5 * ax + bx - 0.5, 0, ay, 0.5 * ay + by - 0.5];
  return { imagem: afimLinear(reduzida, rw, rh, IW, IH, M), janela };
}

/** BGR uint8 (IH × IW × 3) -> o tensor da rede (1 × 3 × IH × IW, float32, um plano por cor, / 255). */
export function paraTensor(imagem, IW, IH) {
  const n = IW * IH;
  const t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    t[i] = imagem[3 * i] / 255;
    t[n + i] = imagem[3 * i + 1] / 255;
    t[2 * n + i] = imagem[3 * i + 2] / 255;
  }
  return t;
}

/** Do RGBA de um quadro W × H ao tensor da entrada (IW × IH) e à janela. */
export function prepararEntrada(rgba, W, H, IW, IH) {
  const { imagem, janela } = prepararImagem(rgbaParaBgr(rgba, W * H), W, H, IW, IH);
  return { tensor: paraTensor(imagem, IW, IH), janela };
}

// ------------------------------------------------------------------------------------------------- os pontos
const sigmoide = (v) => f32(1 / (1 + Math.exp(-v)));

/**
 * Os pontos achados nos mapas da rede, como o `Detector` do `modelo.py`: [{ponto, x, y, escore}] em px do
 * quadro, na ordem dos canais. `saidas`: {kp, off} (Float32Array, um lote só) com `altura` × `largura`
 * células; `contrato`: o do cartão do modelo; `janela`: a de `prepararImagem`.
 */
export function decodificar(saidas, contrato, janela, limiar = CORTE_ESCORE) {
  const { kp, off, altura: h, largura: w } = saidas;
  const nomes = contrato.saidas.kp.nomes;
  const marcaveis = new Set(contrato.nomes.marcaveis);
  const passo = contrato.saidas.passo;
  const raio = contrato.decodificacao.nms_celulas * passo;
  const n = h * w;
  const corte = f32(limiar);
  const cand = [];
  for (let k = 0; k < nomes.length; k++) {
    const base = k * n;
    // o pico da sigmoide; num empate (a sigmoide em float32 satura), vale a primeira célula, como no PyTorch
    let maior = -Infinity;
    for (let i = 0; i < n; i++) if (kp[base + i] > maior) maior = kp[base + i];
    const escore = sigmoide(maior);
    const perto = escore === 1 ? 15 : maior - 1; // só perto do máximo a sigmoide pode empatar com ele
    let idx = 0;
    for (let i = 0; i < n; i++) {
      if (kp[base + i] >= perto && sigmoide(kp[base + i]) === escore) {
        idx = i;
        break;
      }
    }
    if (!(escore >= corte) || !marcaveis.has(nomes[k])) continue;
    const jy = Math.floor(idx / w);
    const jx = idx % w;
    const x = f32(f32(jx + off[idx]) * passo);
    const y = f32(f32(jy + off[n + idx]) * passo);
    cand.push({ k, escore, x, y });
  }
  cand.sort((a, b) => b.escore - a.escore || a.k - b.k);
  const mantidos = [];
  for (const c of cand) {
    if (mantidos.some((m) => Math.hypot(c.x - m.x, c.y - m.y) <= raio)) continue;
    mantidos.push(c);
  }
  const [x0, y0, kx, ky] = janela;
  return mantidos
    .sort((a, b) => a.k - b.k)
    .map((c) => ({ ponto: nomes[c.k], x: c.x / kx + x0, y: c.y / ky + y0, escore: c.escore }));
}

/** O que vai para `previsoes/pontos/<quadro>.json`: os pontos dentro da imagem, em px com 2 casas, por nome. */
export function pontosParaGravar(pontos, W, H) {
  return pontos
    .filter((p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H)
    .map((p) => ({ ponto: p.ponto, x: arredondarPar(p.x * 100) / 100, y: arredondarPar(p.y * 100) / 100 }))
    .sort((a, b) => (a.ponto < b.ponto ? -1 : a.ponto > b.ponto ? 1 : 0));
}
