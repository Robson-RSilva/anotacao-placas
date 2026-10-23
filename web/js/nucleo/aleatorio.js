// Sorteios reprodutíveis: xoshiro128** com semente tirada do SHA-256 de um texto (o ID da partida,
// o código da pessoa). Sortear de novo com o mesmo texto dá o mesmo resultado em qualquer máquina.

import { sha256Bytes } from "./hash.js";

/** Semente de 128 bits (4 palavras de 32) a partir de um texto. */
export function sementeDe(texto) {
  const b = sha256Bytes(String(texto));
  const s = new Uint32Array(4);
  for (let i = 0; i < 4; i++) s[i] = (b[4 * i] | (b[4 * i + 1] << 8) | (b[4 * i + 2] << 16) | (b[4 * i + 3] << 24)) >>> 0;
  if (!(s[0] | s[1] | s[2] | s[3])) s[0] = 1;
  return s;
}

const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;

export class Aleatorio {
  /** @param {string | Uint32Array} semente texto ou 4 palavras de 32 bits */
  constructor(semente) {
    this.s = typeof semente === "string" ? sementeDe(semente) : Uint32Array.from(semente);
    if (this.s.length !== 4) throw new Error("a semente precisa de 4 palavras");
  }

  /** Próximo inteiro de 32 bits sem sinal. */
  proximo() {
    const s = this.s;
    const r = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return r;
  }

  /** Real em [0, 1) com 53 bits. */
  real() {
    const a = this.proximo() >>> 5;
    const b = this.proximo() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** Inteiro em [0, n), sem viés. */
  inteiro(n) {
    if (!(Number.isInteger(n) && n > 0 && n <= 2 ** 32)) throw new RangeError(`n inválido: ${n}`);
    const limite = 2 ** 32 - (2 ** 32 % n);
    for (;;) {
      const x = this.proximo();
      if (x < limite) return x % n;
    }
  }

  /** Permutação de 0..n-1 (Fisher–Yates). */
  permutacao(n) {
    const p = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = this.inteiro(i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    return p;
  }

  /** Cópia embaralhada de uma lista. */
  embaralhar(lista) {
    return this.permutacao(lista.length).map((i) => lista[i]);
  }

  /** k índices distintos de 0..n-1, em ordem sorteada. */
  amostra(n, k) {
    return this.permutacao(n).slice(0, Math.min(k, n));
  }

  /** Índice sorteado com probabilidade proporcional aos pesos (não negativos). */
  ponderado(pesos) {
    let total = 0;
    for (const p of pesos) total += p;
    if (!(total > 0)) return this.inteiro(pesos.length);
    let x = this.real() * total;
    for (let i = 0; i < pesos.length; i++) {
      x -= pesos[i];
      if (x < 0) return i;
    }
    return pesos.length - 1;
  }
}
