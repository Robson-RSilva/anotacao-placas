// PNG de índices (8 bits por pixel, com paleta ou em tons de cinza), sem dependências: a máscara da
// oclusão nas placas. Cada pixel guarda o número da classe; a paleta só serve para quem abre o
// arquivo num visualizador de imagens ver as cores. Espelho de src/anotacao/mascara.py.

import { crc32 } from "./zip.js";

const ASSINATURA = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

async function passarPor(bytes, fluxo) {
  const saida = new Blob([bytes]).stream().pipeThrough(fluxo);
  return new Uint8Array(await new Response(saida).arrayBuffer());
}

function pedaco(tipo, dados) {
  const out = new Uint8Array(12 + dados.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, dados.length);
  for (let i = 0; i < 4; i++) out[4 + i] = tipo.charCodeAt(i);
  out.set(dados, 8);
  dv.setUint32(8 + dados.length, crc32(out.subarray(4, 8 + dados.length)));
  return out;
}

function juntar(partes) {
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** PNG com paleta: `indices` (Uint8Array, w * h, linha a linha) e `paleta` ([[r, g, b], ...]). */
export async function codificarPng(indices, w, h, paleta) {
  if (indices.length !== w * h) throw new Error("tamanho da máscara não bate com a imagem");
  if (typeof CompressionStream === "undefined") throw new Error("este navegador não grava PNG");
  const bruto = new Uint8Array(h * (w + 1)); // cada linha: o filtro (0, nenhum) e os pixels
  for (let y = 0; y < h; y++) bruto.set(indices.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 3, 0, 0, 0], 8); // 8 bits, paleta, deflate, filtros padrão, sem entrelaçamento
  const plte = new Uint8Array(paleta.length * 3);
  paleta.forEach((cor, i) => plte.set(cor, 3 * i));
  return juntar([
    ASSINATURA,
    pedaco("IHDR", ihdr),
    pedaco("PLTE", plte),
    pedaco("IDAT", await passarPor(bruto, new CompressionStream("deflate"))),
    pedaco("IEND", new Uint8Array(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Lê um PNG de 8 bits com paleta ou em tons de cinza (o que o OpenCV grava de uma máscara):
 * {largura, altura, dados: Uint8Array com o índice (ou o tom) de cada pixel}.
 */
export async function decodificarPng(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 8 || ASSINATURA.some((v, i) => b[i] !== v)) throw new Error("não é um PNG");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8;
  let w = 0;
  let h = 0;
  let cabecalho = null;
  const idat = [];
  while (p + 12 <= b.length) {
    const n = dv.getUint32(p);
    const tipo = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (p + 12 + n > b.length) throw new Error("PNG cortado");
    const dados = b.subarray(p + 8, p + 8 + n);
    if (tipo === "IHDR") {
      w = dv.getUint32(p + 8);
      h = dv.getUint32(p + 12);
      cabecalho = { bits: dados[8], cor: dados[9], entrelacado: dados[12] };
    } else if (tipo === "IDAT") {
      idat.push(dados);
    } else if (tipo === "IEND") {
      break;
    }
    p += 12 + n;
  }
  if (!cabecalho || !w || !h) throw new Error("PNG sem cabeçalho");
  if (cabecalho.bits !== 8 || ![0, 3].includes(cabecalho.cor) || cabecalho.entrelacado !== 0) {
    throw new Error("a máscara precisa ser um PNG de 8 bits, com paleta ou em tons de cinza, sem entrelaçamento");
  }
  if (typeof DecompressionStream === "undefined") throw new Error("este navegador não lê PNG");
  const bruto = await passarPor(juntar(idat), new DecompressionStream("deflate"));
  if (bruto.length < h * (w + 1)) throw new Error("PNG cortado");
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const filtro = bruto[y * (w + 1)];
    const ent = y * (w + 1) + 1;
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const a = x ? out[o + x - 1] : 0;
      const c0 = y ? out[o - w + x] : 0;
      const d = x && y ? out[o - w + x - 1] : 0;
      const v = bruto[ent + x];
      let r;
      if (filtro === 0) r = v;
      else if (filtro === 1) r = v + a;
      else if (filtro === 2) r = v + c0;
      else if (filtro === 3) r = v + ((a + c0) >> 1);
      else if (filtro === 4) r = v + paeth(a, c0, d);
      else throw new Error(`PNG com filtro desconhecido (${filtro})`);
      out[o + x] = r & 0xff;
    }
  }
  return { largura: w, altura: h, dados: out };
}

/** É um PNG? (os 8 primeiros bytes) */
export function ehPng(bytes) {
  return bytes.length >= 8 && ASSINATURA.every((v, i) => bytes[i] === v);
}
