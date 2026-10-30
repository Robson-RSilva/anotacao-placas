// O campo — espelho de src/anotacao/campo.py, que é a mesma definição do laboratório: 26 elementos
// (17 retas no gramado, 3 arcos e 6 segmentos dos gols) e 43 pontos-chave, dos quais 39 se marcam
// na tarefa de pontos. As medidas internas são as da regra. A permutação dos nomes sob a rotação de
// 180° sai da geometria (tests/js/campo.test.js confere com o laboratório). O mapa da página de
// pontos (ui/mapa.js) desenha esta geometria.

const MEDIDAS = Object.freeze({
  grande_area_fundo: 16.5,
  grande_area_meia: 20.16,
  pequena_area_fundo: 5.5,
  pequena_area_meia: 9.16,
  raio_circulo: 9.15,
  penalti: 11.0,
  gol_meio: 3.66,
  gol_altura: 2.44,
});

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

/** O ponto 3D na fração `s` (0 a 1) do elemento: a mesma marcação em campos de medidas diferentes. */
export function pontoNaFracao(el, s) {
  if (el.tipo === "reta") return [0, 1, 2].map((i) => el.A[i] + s * (el.B[i] - el.A[i]));
  const a = el.a0 + s * (el.a1 - el.a0);
  return [el.centro[0] + el.raio * Math.cos(a), el.centro[1] + el.raio * Math.sin(a), 0];
}

/** Pontos 3D ao longo do elemento, com espaçamento aproximado `passo` (m) — igual a campo.py. */
export function amostrar(el, passo = 0.25) {
  const n = Math.max(Math.ceil(comprimento(el) / passo), 1) + 1;
  return linspace(0, 1, n).map((s) => pontoNaFracao(el, s));
}

const DOIS_PI = 2 * Math.PI;
const modulo = (a, m) => a - m * Math.floor(a / m);

/** Distância euclidiana 3D de um ponto ao elemento (exata, sem amostrar). */
export function distanciaElemento(el, P) {
  if (el.tipo === "reta") {
    const ab = [el.B[0] - el.A[0], el.B[1] - el.A[1], el.B[2] - el.A[2]];
    const ap = [P[0] - el.A[0], P[1] - el.A[1], P[2] - el.A[2]];
    const den = Math.max(ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2], 1e-15);
    const t = Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / den));
    return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
  }
  const dx = P[0] - el.centro[0];
  const dy = P[1] - el.centro[1];
  const ang = Math.atan2(dy, dx);
  const span = el.a1 - el.a0;
  const rel = modulo(ang - el.a0, DOIS_PI);
  const dentro = rel <= span + 1e-12 || span >= DOIS_PI - 1e-9;
  if (dentro) return Math.hypot(Math.hypot(dx, dy) - el.raio, P[2]);
  let melhor = Infinity;
  for (const a of [el.a0, el.a1]) {
    const q = [el.centro[0] + el.raio * Math.cos(a), el.centro[1] + el.raio * Math.sin(a), 0];
    melhor = Math.min(melhor, Math.hypot(P[0] - q[0], P[1] - q[1], P[2] - q[2]));
  }
  return melhor;
}

/**
 * Geometria do campo L x W (metros): {L, W, elementos, pontos, perm180} — o mesmo formato de
 * `Campo.para_web()` no Python.
 */
export function construirCampo(L = 105, W = 68) {
  const M = MEDIDAS;
  const hl = L / 2;
  const hw = W / 2;
  const elementos = [];
  const reta = (nome, grupo, A, B) => elementos.push({ nome, tipo: "reta", grupo, A, B });
  const arco = (nome, grupo, c, raio, a0, a1) => elementos.push({ nome, tipo: "arco", grupo, centro: [c[0], c[1], 0], raio, a0, a1 });

  reta("lateral_cab", "lateral", [-hl, -hw, 0], [hl, -hw, 0]);
  reta("lateral_opo", "lateral", [-hl, hw, 0], [hl, hw, 0]);
  reta("fundo_esq", "fundo", [-hl, -hw, 0], [-hl, hw, 0]);
  reta("fundo_dir", "fundo", [hl, -hw, 0], [hl, hw, 0]);
  reta("meio", "meio", [0, -hw, 0], [0, hw, 0]);
  for (const [tag, fundo, meia] of [
    ["grande_area", M.grande_area_fundo, M.grande_area_meia],
    ["pequena_area", M.pequena_area_fundo, M.pequena_area_meia],
  ]) {
    for (const [s, lado] of [[-1, "esq"], [1, "dir"]]) {
      const x0 = s * hl;
      const x1 = s * (hl - fundo);
      reta(`${tag}_${lado}_cab`, tag, [x0, -meia, 0], [x1, -meia, 0]);
      reta(`${tag}_${lado}_opo`, tag, [x0, meia, 0], [x1, meia, 0]);
      reta(`${tag}_${lado}_frente`, tag, [x1, -meia, 0], [x1, meia, 0]);
    }
  }
  arco("circulo_central", "circulo", [0, 0], M.raio_circulo, -Math.PI, Math.PI);
  const a = Math.acos((M.grande_area_fundo - M.penalti) / M.raio_circulo);
  arco("meia_lua_esq", "meia_lua", [-hl + M.penalti, 0], M.raio_circulo, -a, a);
  arco("meia_lua_dir", "meia_lua", [hl - M.penalti, 0], M.raio_circulo, Math.PI - a, Math.PI + a);
  const g = M.gol_meio;
  const gh = M.gol_altura;
  for (const [s, lado] of [[-1, "esq"], [1, "dir"]]) {
    const x = s * hl;
    reta(`gol_${lado}_trave_cab`, "gol", [x, -g, 0], [x, -g, gh]);
    reta(`gol_${lado}_trave_opo`, "gol", [x, g, 0], [x, g, gh]);
    reta(`gol_${lado}_travessao`, "gol", [x, -g, gh], [x, g, gh]);
  }

  const pontos = [];
  const ponto = (nome, X, tipo) => pontos.push({ nome, X, tipo });
  for (const [sx, lado] of [[-1, "esq"], [1, "dir"]]) {
    ponto(`canto_${lado}_cab`, [sx * hl, -hw, 0], "linha");
    ponto(`canto_${lado}_opo`, [sx * hl, hw, 0], "linha");
  }
  ponto("meio_cab", [0, -hw, 0], "linha");
  ponto("meio_opo", [0, hw, 0], "linha");
  for (const [curto, fundo, meia] of [["ga", M.grande_area_fundo, M.grande_area_meia], ["pa", M.pequena_area_fundo, M.pequena_area_meia]]) {
    for (const [sx, lado] of [[-1, "esq"], [1, "dir"]]) {
      ponto(`${curto}_${lado}_fundo_cab`, [sx * hl, -meia, 0], "linha");
      ponto(`${curto}_${lado}_fundo_opo`, [sx * hl, meia, 0], "linha");
      ponto(`${curto}_${lado}_frente_cab`, [sx * (hl - fundo), -meia, 0], "linha");
      ponto(`${curto}_${lado}_frente_opo`, [sx * (hl - fundo), meia, 0], "linha");
    }
  }
  const r = M.raio_circulo;
  ponto("circ_meio_cab", [0, -r, 0], "circulo");
  ponto("circ_meio_opo", [0, r, 0], "circulo");
  ponto("circ_esq", [-r, 0, 0], "circulo");
  ponto("circ_dir", [r, 0, 0], "circulo");
  ponto("centro", [0, 0, 0], "marca");
  for (const [sx, lado] of [[-1, "esq"], [1, "dir"]]) ponto(`penalti_${lado}`, [sx * (hl - M.penalti), 0, 0], "marca");
  const yy = Math.sqrt(r ** 2 - (M.grande_area_fundo - M.penalti) ** 2);
  for (const [sx, lado] of [[-1, "esq"], [1, "dir"]]) {
    ponto(`ml_${lado}_cab`, [sx * (hl - M.grande_area_fundo), -yy, 0], "circulo");
    ponto(`ml_${lado}_opo`, [sx * (hl - M.grande_area_fundo), yy, 0], "circulo");
    ponto(`ml_${lado}_topo`, [sx * (hl - M.penalti - r), 0, 0], "circulo");
  }
  for (const [sx, lado] of [[-1, "esq"], [1, "dir"]]) {
    ponto(`gol_${lado}_pe_cab`, [sx * hl, -g, 0], "gol");
    ponto(`gol_${lado}_pe_opo`, [sx * hl, g, 0], "gol");
    ponto(`gol_${lado}_topo_cab`, [sx * hl, -g, gh], "gol");
    ponto(`gol_${lado}_topo_opo`, [sx * hl, g, gh], "gol");
  }
  return { L, W, elementos, pontos, perm180: perm180(elementos, pontos) };
}

/** Índice de cada elemento e ponto sob a rotação de 180° em torno de z (como `Campo.perm180`). */
function perm180(elementos, pontos) {
  const espelho = (X) => [-X[0], -X[1], X[2]];
  const pk = pontos.map((p) => {
    const Y = espelho(p.X);
    let melhor = -1;
    let dmin = Infinity;
    pontos.forEach((q, j) => {
      const d = Math.hypot(Y[0] - q.X[0], Y[1] - q.X[1], Y[2] - q.X[2]);
      if (d < dmin) {
        dmin = d;
        melhor = j;
      }
    });
    if (!(dmin < 1e-9)) throw new Error(`ponto-chave ${p.nome} sem imagem sob a simetria`);
    return melhor;
  });
  const pe = elementos.map((e) => {
    const P = amostrar(e, 0.5).map(espelho);
    let melhor = -1;
    let dmin = Infinity;
    elementos.forEach((f, j) => {
      if (Math.abs(comprimento(f) - comprimento(e)) > 1e-6) return;
      let dd = 0;
      for (const X of P) dd = Math.max(dd, distanciaElemento(f, X));
      if (dd < dmin) {
        dmin = dd;
        melhor = j;
      }
    });
    if (!(dmin <= 1e-6)) throw new Error(`elemento ${e.nome} sem imagem sob a simetria`);
    return melhor;
  });
  return { elementos: pe, pontos: pk };
}

const MOLDES = new Map();

/**
 * Pontos que não se marcam à mão: o mais à esquerda e o mais à direita do círculo central e o topo de
 * cada meia-lua não ficam num cruzamento de linhas nem numa marca — na imagem não há o que clicar.
 */
export const PONTOS_SEM_MARCA = Object.freeze(["circ_esq", "circ_dir", "ml_esq_topo", "ml_dir_topo"]);

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

  /** O campo com estas medidas, em metros (um por medida, reaproveitado). */
  static doCampo(comprimento = 105, largura = 68) {
    const chave = `${comprimento}|${largura}`;
    if (!MOLDES.has(chave)) MOLDES.set(chave, new Molde(construirCampo(comprimento, largura)));
    return MOLDES.get(chave);
  }

  ponto(nome) {
    const i = this._iPonto.get(nome);
    if (i === undefined) throw new Error(`ponto-chave desconhecido: ${nome}`);
    return this.pontos[i].X;
  }

  elemento(nome) {
    const i = this._iElemento.get(nome);
    if (i === undefined) throw new Error(`elemento desconhecido: ${nome}`);
    return this.elementos[i];
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

/** Os 39 pontos da tarefa de pontos, na ordem do laboratório. */
export const PONTOS_MARCAVEIS = Object.freeze(Molde.doCampo().pontos.map((p) => p.nome).filter((n) => !PONTOS_SEM_MARCA.includes(n)));

const FUNDO = { esq: "fundo esquerdo", dir: "fundo direito" };
const LADO = { cab: "lado das cabines", opo: "lado oposto" };

/** O ponto dito em português, para quem anota ("Canto · fundo esquerdo, lado das cabines"). */
export function descricaoPonto(nome) {
  const p = nome.split("_");
  const onde = (f, l) => [FUNDO[f], LADO[l]].filter(Boolean).join(", ");
  switch (p[0]) {
    case "canto":
      return `Canto · ${onde(p[1], p[2])}`;
    case "meio":
      return `Linha do meio na lateral · ${LADO[p[1]]}`;
    case "ga":
    case "pa": {
      const area = p[0] === "ga" ? "Grande área" : "Pequena área";
      return `${area}: ${p[2] === "fundo" ? "na linha de fundo" : "canto da frente"} · ${onde(p[1], p[3])}`;
    }
    case "circ":
      return `Círculo central na linha do meio · ${LADO[p[2]]}`;
    case "centro":
      return "Centro do campo (a marca)";
    case "penalti":
      return `Marca do pênalti · ${FUNDO[p[1]]}`;
    case "ml":
      return `Meia-lua na linha da grande área · ${onde(p[1], p[2])}`;
    case "gol":
      return `Trave: ${p[2] === "pe" ? "pé, no gramado" : "topo, no travessão"} · ${onde(p[1], p[3])}`;
    default:
      return nome;
  }
}
