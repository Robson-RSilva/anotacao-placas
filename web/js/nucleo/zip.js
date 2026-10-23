// Arquivos .zip sem dependências: gravar (sem compressão; JPEG e JSON pequenos não ganham quase
// nada) e ler (sem compressão ou "deflate", o que os sistemas operacionais usam), para levar a
// pasta de trabalho de um lugar a outro quando não dá para usar uma pasta sincronizada.

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function horaDos(data) {
  const d = data instanceof Date && !Number.isNaN(data.getTime()) ? data : new Date();
  const ano = Math.max(1980, d.getFullYear());
  return {
    hora: ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff,
    data: (((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

async function bytesDe(dados) {
  if (dados instanceof Uint8Array) return dados;
  if (typeof dados === "string") return new TextEncoder().encode(dados);
  if (dados && typeof dados.arrayBuffer === "function") return new Uint8Array(await dados.arrayBuffer());
  return new Uint8Array(dados);
}

/**
 * Monta um .zip (Blob). `entradas`: [{caminho, dados: Uint8Array | Blob | texto, data?: Date}].
 * Sem ZIP64: até 65 535 arquivos e 4 GiB.
 */
export async function criarZip(entradas) {
  const partesSaida = [];
  const central = [];
  let pos = 0;
  const codificador = new TextEncoder();
  if (entradas.length > 0xffff) throw new Error("arquivos demais para um .zip simples");
  for (const e of entradas) {
    const nome = codificador.encode(e.caminho);
    const dados = await bytesDe(e.dados);
    const crc = crc32(dados);
    const { hora, data } = horaDos(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nomes em UTF-8
    local.setUint16(8, 0, true); // sem compressão
    local.setUint16(10, hora, true);
    local.setUint16(12, data, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true);
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);
    partesSaida.push(new Uint8Array(local.buffer), nome, dados);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, hora, true);
    c.setUint16(14, data, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, dados.length, true);
    c.setUint32(24, dados.length, true);
    c.setUint16(28, nome.length, true);
    c.setUint32(42, pos, true);
    central.push(new Uint8Array(c.buffer), nome);
    pos += 30 + nome.length + dados.length;
    if (pos > 0xffffffff) throw new Error("o .zip passaria de 4 GiB");
  }
  const tamanhoCentral = central.reduce((s, b) => s + b.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, entradas.length, true);
  fim.setUint16(10, entradas.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, pos, true);
  return new Blob([...partesSaida, ...central, new Uint8Array(fim.buffer)], { type: "application/zip" });
}

async function descomprimir(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("este navegador não descompacta .zip");
  const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

/** Lê um .zip (Blob/File). Gera {caminho, dados: Uint8Array, data: Date} para cada arquivo. */
export async function* lerZip(blob) {
  const tam = blob.size;
  const cauda = new Uint8Array(await blob.slice(Math.max(0, tam - 65_557), tam).arrayBuffer());
  let i = cauda.length - 22;
  while (i >= 0 && !(cauda[i] === 0x50 && cauda[i + 1] === 0x4b && cauda[i + 2] === 0x05 && cauda[i + 3] === 0x06)) i--;
  if (i < 0) throw new Error("não é um arquivo .zip");
  const fim = new DataView(cauda.buffer, i, 22);
  const n = fim.getUint16(10, true);
  const tamanhoCentral = fim.getUint32(12, true);
  const inicioCentral = fim.getUint32(16, true);
  if (inicioCentral === 0xffffffff || n === 0xffff) throw new Error(".zip grande demais (ZIP64) para ler aqui");
  const dir = new DataView(await blob.slice(inicioCentral, inicioCentral + tamanhoCentral).arrayBuffer());
  const decodificador = new TextDecoder();
  let p = 0;
  for (let k = 0; k < n; k++) {
    if (dir.getUint32(p, true) !== 0x02014b50) throw new Error(".zip danificado (diretório central)");
    const metodo = dir.getUint16(p + 10, true);
    const hora = dir.getUint16(p + 12, true);
    const dia = dir.getUint16(p + 14, true);
    const crc = dir.getUint32(p + 16, true);
    const tamComprimido = dir.getUint32(p + 20, true);
    const lNome = dir.getUint16(p + 28, true);
    const lExtra = dir.getUint16(p + 30, true);
    const lComentario = dir.getUint16(p + 32, true);
    const inicioLocal = dir.getUint32(p + 42, true);
    const caminho = decodificador.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, lNome));
    p += 46 + lNome + lExtra + lComentario;
    if (caminho.endsWith("/")) continue;
    const cab = new DataView(await blob.slice(inicioLocal, inicioLocal + 30).arrayBuffer());
    if (cab.getUint32(0, true) !== 0x04034b50) throw new Error(`.zip danificado (${caminho})`);
    const inicioDados = inicioLocal + 30 + cab.getUint16(26, true) + cab.getUint16(28, true);
    const bruto = new Uint8Array(await blob.slice(inicioDados, inicioDados + tamComprimido).arrayBuffer());
    let dados;
    if (metodo === 0) dados = bruto;
    else if (metodo === 8) dados = await descomprimir(bruto);
    else throw new Error(`${caminho}: compressão não suportada (método ${metodo})`);
    if (crc32(dados) !== crc) throw new Error(`${caminho}: conteúdo corrompido no .zip`);
    const data = new Date(1980 + (dia >> 9), ((dia >> 5) & 15) - 1, dia & 31, hora >> 11, (hora >> 5) & 63, (hora & 31) * 2);
    yield { caminho, dados, data };
  }
}
