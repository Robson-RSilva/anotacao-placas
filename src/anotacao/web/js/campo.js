// Molde do campo, a partir da geometria que o servidor manda (campo.py: para_web).

export function linspace(a, b, n) {
  if (n === 1) return [a];
  const passo = (b - a) / (n - 1);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = a + i * passo;
  out[n - 1] = b;
  return out;
}

export function comprimento(el) {
  if (el.tipo === "reta") return Math.hypot(el.B[0] - el.A[0], el.B[1] - el.A[1], el.B[2] - el.A[2]);
  return el.raio * Math.abs(el.a1 - el.a0);
}

/** Pontos 3D ao longo do elemento, com espaçamento aproximado `passo` (m) — igual a campo.py. */
export function amostrar(el, passo = 0.25) {
  const n = Math.max(Math.ceil(comprimento(el) / passo), 1) + 1;
  const t = linspace(0, 1, n);
  if (el.tipo === "reta") {
    return t.map((s) => [0, 1, 2].map((i) => el.A[i] + s * (el.B[i] - el.A[i])));
  }
  return t.map((s) => {
    const a = el.a0 + s * (el.a1 - el.a0);
    return [el.centro[0] + el.raio * Math.cos(a), el.centro[1] + el.raio * Math.sin(a), 0];
  });
}

export class Molde {
  constructor(geo) {
    this.L = geo.L;
    this.W = geo.W;
    this.elementos = geo.elementos;
    this.pontos = geo.pontos;
    this.perm = geo.perm180;
    this._iPonto = new Map(this.pontos.map((p, i) => [p.nome, i]));
    this._iElemento = new Map(this.elementos.map((e, i) => [e.nome, i]));
    this._amostras = new Map();
  }

  ponto(nome) {
    return this.pontos[this._iPonto.get(nome)].X;
  }

  elemento(nome) {
    return this.elementos[this._iElemento.get(nome)];
  }

  amostras(nome, passo = 0.25) {
    const chave = `${nome}|${passo}`;
    if (!this._amostras.has(chave)) this._amostras.set(chave, amostrar(this.elemento(nome), passo));
    return this._amostras.get(chave);
  }

  /** Nome do ponto-chave na posição simétrica (rotação de 180°). */
  espelharPonto(nome) {
    return this.pontos[this.perm.pontos[this._iPonto.get(nome)]].nome;
  }

  espelharElemento(nome) {
    return this.elementos[this.perm.elementos[this._iElemento.get(nome)]].nome;
  }
}
