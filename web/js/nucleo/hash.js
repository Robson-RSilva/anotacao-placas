// SHA-256 incremental (FIPS 180-4). O `crypto.subtle` do navegador só faz o hash de um buffer
// inteiro de uma vez; um vídeo de transmissão tem gigabytes, então o hash vai por partes.

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  constructor() {
    this._h = new Int32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this._w = new Int32Array(64);
    this._resto = new Uint8Array(64);
    this._nResto = 0;
    this._total = 0;
    this._digest = null;
  }

  /** Acrescenta bytes (Uint8Array, ArrayBuffer ou texto UTF-8). */
  update(dados) {
    if (this._digest) throw new Error("o hash já foi finalizado");
    let b = dados;
    if (typeof b === "string") b = new TextEncoder().encode(b);
    else if (!(b instanceof Uint8Array)) b = new Uint8Array(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength);
    this._total += b.length;
    let i = 0;
    if (this._nResto) {
      const n = Math.min(64 - this._nResto, b.length);
      this._resto.set(b.subarray(0, n), this._nResto);
      this._nResto += n;
      i = n;
      if (this._nResto < 64) return this;
      this._bloco(this._resto, 0);
      this._nResto = 0;
    }
    const fim = b.length - 64;
    for (; i <= fim; i += 64) this._bloco(b, i);
    if (i < b.length) {
      this._resto.set(b.subarray(i), 0);
      this._nResto = b.length - i;
    }
    return this;
  }

  _bloco(b, o) {
    const w = this._w;
    const h = this._h;
    for (let t = 0; t < 16; t++) {
      const j = o + 4 * t;
      w[t] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3];
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h[0];
    let bb = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let t = 0; t < 64; t++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[t] + w[t]) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + bb) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }

  /** Finaliza e devolve os 32 bytes do hash. */
  digest() {
    if (this._digest) return this._digest;
    const bits = this._total * 8;
    const pad = new Uint8Array(((this._nResto < 56 ? 56 : 120) - this._nResto) + 8);
    pad[0] = 0x80;
    const n = pad.length;
    const alto = Math.floor(bits / 2 ** 32);
    const baixo = bits % 2 ** 32;
    pad[n - 8] = (alto >>> 24) & 255;
    pad[n - 7] = (alto >>> 16) & 255;
    pad[n - 6] = (alto >>> 8) & 255;
    pad[n - 5] = alto & 255;
    pad[n - 4] = (baixo >>> 24) & 255;
    pad[n - 3] = (baixo >>> 16) & 255;
    pad[n - 2] = (baixo >>> 8) & 255;
    pad[n - 1] = baixo & 255;
    const total = this._total;
    this.update(pad);
    this._total = total;
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[4 * i] = (this._h[i] >>> 24) & 255;
      out[4 * i + 1] = (this._h[i] >>> 16) & 255;
      out[4 * i + 2] = (this._h[i] >>> 8) & 255;
      out[4 * i + 3] = this._h[i] & 255;
    }
    this._digest = out;
    return out;
  }

  hex() {
    return Array.from(this.digest(), (v) => v.toString(16).padStart(2, "0")).join("");
  }
}

/** SHA-256 em hexadecimal de um texto (UTF-8) ou de bytes. */
export function sha256Hex(dados) {
  return new Sha256().update(dados).hex();
}

/** Os bytes do SHA-256 de um texto (UTF-8) ou de bytes. */
export function sha256Bytes(dados) {
  return new Sha256().update(dados).digest();
}
