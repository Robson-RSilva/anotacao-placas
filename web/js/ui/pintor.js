// O pintor das placas: desenha o recorte da placa e a pintura, e pinta o que está na frente da placa.
//
//   arrastar (pincel)      pinta; com a borracha (E), apaga
//   laço: arrastar         contorna à mão e, ao soltar, preenche (ou apaga, com a borracha)
//   laço: clique a clique  um vértice por clique; feche no primeiro ponto, com dois cliques ou Enter
//   botão direito, botão do meio ou espaço + arrastar   move a vista; roda do mouse aproxima
//
// A pintura guarda, em cada pixel, 1 onde algo cobre a placa e 0 no resto. Com a região da placa, só
// se pinta dentro dela: o pincel e o laço não passam do contorno, e o que fica fora da placa (o pouco
// em volta que o recorte traz, para dar o contexto) aparece escurecido, com o contorno da placa por
// cima. Na tela, a pintura é listrada (uma diagonal clara a cada 4 px): a cor some em cima de uma
// camisa da mesma cor, a listra não. No treino, o resultado aparece por cima: o que acertou, o que
// faltou e o que pintou a mais.

import { mascaraDaRegiao, rasterizar } from "../nucleo/regiao.js";

const COR = [255, 64, 129];
const ALFA = 150; // 0 a 255
const LISTRA = [[255, 255, 255], 170];
const FORA = [[8, 10, 14], 140]; // o escuro por cima do que fica fora da placa
const COR_CONTORNO = "#29d3ff";
const PERTO_DO_PRIMEIRO = 9; // px na tela: clique que fecha o laço
/** As cores do resultado do treino: 1 certo, 2 faltou, 3 a mais. */
export const CORES_RESULTADO = Object.freeze({ 1: [[46, 160, 67], 140], 2: [[248, 81, 73], 190], 3: [[255, 196, 0], 190] });

const rgba = ([r, g, b], a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; // ImageData em little-endian

export class Pintor {
  /**
   * `regiao`: o polígono da placa (px da imagem), onde se pinta; sem ela, pinta-se a imagem inteira.
   * `mascara`: a pintura de partida (o que cair fora da região fica de fora).
   */
  constructor(canvas, { imagem, mascara = null, regiao = null, somenteLeitura = false, aoMudar = () => {} }) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.img = imagem;
    this.w = imagem.naturalWidth;
    this.h = imagem.naturalHeight;
    this.somenteLeitura = somenteLeitura;
    this.aoMudar = aoMudar;
    this.regiao = regiao;
    this.permitido = regiao ? mascaraDaRegiao(regiao, this.w, this.h) : null;
    this.pintura = new Uint8Array(this.w * this.h);
    if (mascara) this._copiar(mascara);
    this.ferramenta = "pincel";
    this.apagando = false;
    this.raio = 4; // px da imagem
    this.mostrarPintura = true;
    this.resultado = null; // no treino: Uint8Array com 0 a 3 (CORES_RESULTADO)
    this.desfeitos = [];
    this.refeitos = [];
    this.vista = { escala: 1, ox: 0, oy: 0 };
    this.ponteiro = null;
    this.traco = null;
    this.laco = null;
    this.arraste = null;
    this.espaco = false;
    this._op = null;
    this._geracao = new Uint32Array(this.w * this.h);
    this._nOps = 0;
    this._quadroPedido = false;
    this.camada = document.createElement("canvas");
    this.camada.width = this.w;
    this.camada.height = this.h;
    this.cc = this.camada.getContext("2d");
    this.dados = this.cc.createImageData(this.w, this.h);
    this.px32 = new Uint32Array(this.dados.data.buffer);
    this.cor32 = rgba(COR, ALFA);
    this.listra32 = rgba(...LISTRA);
    this.resultado32 = Object.fromEntries(Object.entries(CORES_RESULTADO).map(([k, [c, a]]) => [k, rgba(c, a)]));
    this.fora = this.permitido ? this._camadaFora() : null;
    this._redesenharCamada(0, 0, this.w, this.h);
    this._eventos();
    this._ro = new ResizeObserver(() => this.ajustarVista());
    this._ro.observe(canvas.parentElement);
    this.ajustarVista();
  }

  destruir() {
    this._ro.disconnect();
    for (const [alvo, nome, fn] of this._ouvintes) alvo.removeEventListener(nome, fn);
  }

  _copiar(m) {
    if (m.length !== this.w * this.h) throw new Error("a máscara não tem o tamanho da imagem");
    const ok = this.permitido;
    for (let i = 0; i < m.length; i++) this.pintura[i] = m[i] && (!ok || ok[i]) ? 1 : 0;
  }

  /** O escuro por cima do que fica fora da placa. */
  _camadaFora() {
    const c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    const cc = c.getContext("2d");
    const dados = cc.createImageData(this.w, this.h);
    const px = new Uint32Array(dados.data.buffer);
    const escuro = rgba(...FORA);
    for (let i = 0; i < px.length; i++) if (!this.permitido[i]) px[i] = escuro;
    cc.putImageData(dados, 0, 0);
    return c;
  }

  // ------------------------------------------------------------------ a pintura
  /** Troca a pintura inteira (e esquece o desfazer): a de um rótulo, ou a resposta do gabarito. */
  definir(mascara) {
    this.pintura.fill(0);
    if (mascara) this._copiar(mascara);
    this.desfeitos = [];
    this.refeitos = [];
    this.laco = null;
    this._redesenharCamada(0, 0, this.w, this.h);
    this._mudou();
  }

  /** Mostra o resultado do treino por cima (ou nada, com null). */
  mostrarResultado(resultado) {
    this.resultado = resultado;
    this._redesenharCamada(0, 0, this.w, this.h);
    this.desenhar();
  }

  /** A máscara que se grava: 1 onde algo cobre a placa. */
  mascara() {
    return Uint8Array.from(this.pintura);
  }

  pixels() {
    let n = 0;
    for (let i = 0; i < this.pintura.length; i++) n += this.pintura[i];
    return n;
  }

  _redesenharCamada(x0, y0, x1, y1) {
    const P = this.pintura;
    const R = this.resultado;
    const px = this.px32;
    const w = this.w;
    for (let y = y0; y < y1; y++) {
      for (let x = x0, i = y * w + x0; x < x1; x++, i++) {
        if (R) px[i] = R[i] ? this.resultado32[R[i]] : 0;
        else px[i] = P[i] ? ((x + y) % 4 === 0 ? this.listra32 : this.cor32) : 0;
      }
    }
    if (x1 > x0 && y1 > y0) this.cc.putImageData(this.dados, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }

  // ------------------------------------------------------------------ operações (com desfazer)
  _iniciar() {
    this._nOps += 1;
    this._op = { id: this._nOps, indices: [], antes: [], x0: this.w, y0: this.h, x1: 0, y1: 0 };
  }

  _mudar(i, v) {
    const op = this._op;
    if (this._geracao[i] !== op.id) {
      this._geracao[i] = op.id;
      op.indices.push(i);
      op.antes.push(this.pintura[i]);
    }
    this.pintura[i] = v;
  }

  _caixa(x0, y0, x1, y1) {
    const op = this._op;
    op.x0 = Math.min(op.x0, x0);
    op.y0 = Math.min(op.y0, y0);
    op.x1 = Math.max(op.x1, x1);
    op.y1 = Math.max(op.y1, y1);
  }

  _terminar() {
    const op = this._op;
    this._op = null;
    if (!op || !op.indices.length) return;
    op.depois = Uint8Array.from(op.indices, (i) => this.pintura[i]);
    op.indices = Uint32Array.from(op.indices);
    op.antes = Uint8Array.from(op.antes);
    this.desfeitos.push(op);
    if (this.desfeitos.length > 80) this.desfeitos.shift();
    this.refeitos = [];
    this._mudou();
  }

  _reaplicar(op, valores) {
    for (let k = 0; k < op.indices.length; k++) this.pintura[op.indices[k]] = valores[k];
    this._redesenharCamada(op.x0, op.y0, op.x1, op.y1);
    this._mudou();
  }

  desfazer() {
    if (this.laco) {
      this.laco = null;
      this.desenhar();
      return;
    }
    const op = this.desfeitos.pop();
    if (!op) return;
    this.refeitos.push(op);
    this._reaplicar(op, op.antes);
  }

  refazer() {
    const op = this.refeitos.pop();
    if (!op) return;
    this.desfeitos.push(op);
    this._reaplicar(op, op.depois);
  }

  get _valor() {
    return this.apagando ? 0 : 1;
  }

  /** Um carimbo redondo do pincel (só dentro da placa, quando há região). */
  _carimbo(cx, cy) {
    const r = this.raio;
    const r2 = r * r;
    const v = this._valor;
    const ok = this.permitido;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    if (x1 < x0 || y1 < y0) return;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * this.w + x;
        if (this.pintura[i] !== v && (!ok || ok[i])) this._mudar(i, v);
      }
    }
    this._caixa(x0, y0, x1 + 1, y1 + 1);
    this._redesenharCamada(x0, y0, x1 + 1, y1 + 1);
  }

  _tracar(x, y) {
    const t = this.traco;
    const d = Math.hypot(x - t.x, y - t.y);
    const passo = Math.max(0.75, this.raio / 3);
    for (let s = passo; s < d; s += passo) this._carimbo(t.x + ((x - t.x) * s) / d, t.y + ((y - t.y) * s) / d);
    this._carimbo(x, y);
    this.traco = { x, y };
  }

  /** Preenche o laço (ou apaga, com a borracha). */
  fecharLaco() {
    const laco = this.laco;
    this.laco = null;
    if (!laco || laco.pontos.length < 3) {
      this.desenhar();
      return;
    }
    this._iniciar();
    const v = this._valor;
    const ok = this.permitido;
    let y0 = this.h;
    let y1 = 0;
    let x0 = this.w;
    let x1 = 0;
    rasterizar(laco.pontos, this.w, this.h, (y, a, b) => {
      for (let i = y * this.w + a, fim = y * this.w + b; i < fim; i++) if (this.pintura[i] !== v && (!ok || ok[i])) this._mudar(i, v);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y + 1);
      x0 = Math.min(x0, a);
      x1 = Math.max(x1, b);
    });
    if (x1 > x0) {
      this._caixa(x0, y0, x1, y1);
      this._redesenharCamada(x0, y0, x1, y1);
    }
    this._terminar();
    this.desenhar();
  }

  cancelarLaco() {
    this.laco = null;
    this.desenhar();
  }

  tirarPontoDoLaco() {
    if (!this.laco?.cliques) return;
    this.laco.pontos.pop();
    if (!this.laco.pontos.length) this.laco = null;
    this.desenhar();
  }

  _mudou() {
    this.desenhar();
    this.aoMudar(this);
  }

  // ------------------------------------------------------------------ vista
  ajustarVista() {
    const pai = this.cv.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cv.style.width = `${pai.width}px`;
    this.cv.style.height = `${pai.height}px`;
    this.cv.width = Math.round(pai.width * dpr);
    this.cv.height = Math.round(pai.height * dpr);
    const escala = Math.min(pai.width / this.w, pai.height / this.h);
    this.vista = { escala, ox: (pai.width - escala * this.w) / 2, oy: (pai.height - escala * this.h) / 2 };
    this.desenhar();
  }

  paraTela(x, y) {
    return [this.vista.ox + this.vista.escala * x, this.vista.oy + this.vista.escala * y];
  }

  paraImagem(sx, sy) {
    return [(sx - this.vista.ox) / this.vista.escala, (sy - this.vista.oy) / this.vista.escala];
  }

  _posicao(e) {
    const r = this.cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _roda(e) {
    e.preventDefault();
    const [sx, sy] = this._posicao(e);
    const nova = Math.min(40, Math.max(0.1, this.vista.escala * Math.exp(-e.deltaY * 0.0015)));
    const [x, y] = this.paraImagem(sx, sy);
    this.vista = { escala: nova, ox: sx - nova * x, oy: sy - nova * y };
    this._pedirQuadro();
  }

  aproximar(fator) {
    const r = this.cv.getBoundingClientRect();
    this._roda({ preventDefault() {}, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaY: -Math.log(fator) / 0.0015 });
  }

  // ------------------------------------------------------------------ eventos
  _eventos() {
    this._ouvintes = [
      [this.cv, "pointerdown", (e) => this._baixar(e)],
      [this.cv, "pointermove", (e) => this._mover(e)],
      [this.cv, "pointerup", (e) => this._soltar(e)],
      [this.cv, "pointercancel", () => this._cancelarArraste()],
      [this.cv, "dblclick", () => {
        if (this.laco?.cliques && this.laco.pontos.length >= 3) this.fecharLaco();
      }],
      [this.cv, "wheel", (e) => this._roda(e)],
      [this.cv, "contextmenu", (e) => e.preventDefault()],
      [this.cv, "pointerleave", () => {
        this.ponteiro = null;
        this.desenhar();
      }],
    ];
    for (const [alvo, nome, fn] of this._ouvintes) alvo.addEventListener(nome, fn, { passive: !["wheel", "contextmenu"].includes(nome) });
  }

  _cancelarArraste() {
    if (this.traco) {
      this.traco = null;
      this._terminar();
    }
    this.arraste = null;
  }

  _baixar(e) {
    const [sx, sy] = this._posicao(e);
    const mover = e.button === 1 || e.button === 2 || (e.button === 0 && (this.espaco || this.somenteLeitura));
    if (mover) {
      this.cv.setPointerCapture(e.pointerId);
      this.arraste = { sx, sy, ox: this.vista.ox, oy: this.vista.oy };
      this.cv.style.cursor = "grabbing";
      return;
    }
    if (e.button !== 0) return;
    this.cv.setPointerCapture(e.pointerId);
    const [x, y] = this.paraImagem(sx, sy);
    if (this.ferramenta === "pincel") {
      this._iniciar();
      this.traco = { x, y };
      this._carimbo(x, y);
      this._pedirQuadro();
      return;
    }
    // laço
    if (!this.laco) {
      this.laco = { pontos: [[x, y]], arrastando: true, cliques: false, sx, sy, longe: 0 };
    } else if (this.laco.cliques) {
      const [px, py] = this.paraTela(...this.laco.pontos[0]);
      if (this.laco.pontos.length >= 3 && Math.hypot(px - sx, py - sy) < PERTO_DO_PRIMEIRO) this.fecharLaco();
      else this.laco.pontos.push([x, y]);
    }
    this._pedirQuadro();
  }

  _mover(e) {
    const [sx, sy] = this._posicao(e);
    this.ponteiro = [sx, sy];
    if (this.arraste) {
      this.vista.ox = this.arraste.ox + (sx - this.arraste.sx);
      this.vista.oy = this.arraste.oy + (sy - this.arraste.sy);
      this._pedirQuadro();
      return;
    }
    const [x, y] = this.paraImagem(sx, sy);
    if (this.traco) {
      this._tracar(x, y);
    } else if (this.laco?.arrastando && !this.laco.cliques) {
      const ultimo = this.paraTela(...this.laco.pontos[this.laco.pontos.length - 1]);
      if (Math.hypot(ultimo[0] - sx, ultimo[1] - sy) >= 1.5) this.laco.pontos.push([x, y]);
      // o quanto o arraste se afastou de onde começou: o laço à mão livre termina perto do começo
      this.laco.longe = Math.max(this.laco.longe, Math.hypot(sx - this.laco.sx, sy - this.laco.sy));
    }
    this._pedirQuadro();
  }

  _soltar(e) {
    if (this.cv.hasPointerCapture(e.pointerId)) this.cv.releasePointerCapture(e.pointerId);
    if (this.arraste) {
      this.arraste = null;
      this.cv.style.cursor = "";
      return;
    }
    if (this.traco) {
      this.traco = null;
      this._terminar();
      return;
    }
    const laco = this.laco;
    if (laco?.arrastando) {
      laco.arrastando = false;
      // arrastou (mesmo que tenha voltado ao começo, como no laço fechado à mão): fecha; senão, foi
      // um clique, e o laço segue clique a clique
      const moveu = laco.longe >= 4 && laco.pontos.length >= 3;
      if (moveu && !laco.cliques) this.fecharLaco();
      else laco.cliques = true;
    }
  }

  // ------------------------------------------------------------------ desenho
  _pedirQuadro() {
    if (this._quadroPedido) return;
    this._quadroPedido = true;
    requestAnimationFrame(() => {
      this._quadroPedido = false;
      this.desenhar();
    });
  }

  _caminho(ctx, pts, fechar = false) {
    ctx.beginPath();
    pts.forEach((p, k) => {
      const [x, y] = this.paraTela(p[0], p[1]);
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    if (fechar) ctx.closePath();
  }

  desenhar() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const { escala, ox, oy } = this.vista;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    ctx.setTransform(dpr * escala, 0, 0, dpr * escala, dpr * ox, dpr * oy);
    ctx.imageSmoothingEnabled = escala < 2;
    ctx.drawImage(this.img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (this.fora) ctx.drawImage(this.fora, 0, 0);
    if (this.mostrarPintura || this.resultado) ctx.drawImage(this.camada, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    this._desenharContorno(ctx);
    this._desenharLaco(ctx);
    this._desenharPincel(ctx);
  }

  /** O contorno da placa (a região), por cima de tudo. */
  _desenharContorno(ctx) {
    if (!this.regiao) return;
    this._caminho(ctx, this.regiao, true);
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = COR_CONTORNO;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }

  _desenharLaco(ctx) {
    const laco = this.laco;
    if (!laco) return;
    const pts = [...laco.pontos];
    if (laco.cliques && this.ponteiro) pts.push(this.paraImagem(...this.ponteiro));
    this._caminho(ctx, pts, !laco.cliques);
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = this.apagando ? "#ffffff" : `rgb(${COR.join(",")})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (laco.cliques) {
      const [x, y] = this.paraTela(...laco.pontos[0]);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
  }

  _desenharPincel(ctx) {
    if (!this.ponteiro || this.somenteLeitura || this.ferramenta !== "pincel" || this.arraste || this.espaco) return;
    const [sx, sy] = this.ponteiro;
    const r = Math.max(1, this.raio * this.vista.escala);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, 2 * Math.PI);
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = this.apagando ? "#ffffff" : `rgb(${COR.join(",")})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(this.apagando ? [3, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/**
 * O mapa do resultado do treino, pixel a pixel (CORES_RESULTADO): 1 pintou certo, 2 faltou, 3 pintou a
 * mais; a borda de 1 px que não conta fica sem cor. Na verdade, o que está na frente da placa são os
 * números de 1 a `n`.
 */
export function mapaDoResultado(pintura, verdade, borda, n) {
  const out = new Uint8Array(pintura.length);
  for (let i = 0; i < pintura.length; i++) {
    if (borda[i]) continue;
    const v = verdade[i];
    const naFrente = v >= 1 && v <= n;
    if (pintura[i]) out[i] = naFrente ? 1 : 3;
    else if (naFrente) out[i] = 2;
  }
  return out;
}
