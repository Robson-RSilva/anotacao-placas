// Pintor da oclusão: desenha o quadro, o contorno das placas e a pintura, e pinta só dentro das
// placas que se pintam (as pequenas demais e o resto da imagem ficam escurecidos e não mudam).
//
//   arrastar (pincel)      pinta a classe escolhida; "Apagar" volta a placa livre
//   laço: arrastar         contorna à mão e, ao soltar, preenche
//   laço: clique a clique  um vértice por clique; feche no primeiro ponto, com dois cliques ou Enter
//   botão direito, botão do meio ou espaço + arrastar   move a vista; roda do mouse aproxima
//
// A pintura guarda, em cada pixel, a classe pintada (0: nada). O que não foi pintado dentro das
// placas é placa livre (oclusao.js, mascaraEfetiva). Na tela, a pintura é listrada (uma diagonal
// clara a cada 4 px): a cor da classe some em cima de uma camisa da mesma cor, a listra não.

import { CLASSE, CLASSES, estatisticas, geometria, mascaraEfetiva, rasterizar } from "../nucleo/oclusao.js";

const COR_LADO = { cab: "#4fc3f7", opo: "#ffb74d", esq: "#ce93d8", dir: "#80cbc4" };
const ALFA_CLASSE = 150; // 0 a 255
const LISTRA = [[255, 255, 255], 170];
const ESCURO_FORA = 100;
const ESCURO_PEQUENA = 60;
const PERTO_DO_PRIMEIRO = 9; // px na tela: clique que fecha o laço

const rgba = ([r, g, b], a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; // ImageData em little-endian

export class Pintor {
  constructor(canvas, { imagem, camera, placas, molde = null, pintura = null, somenteLeitura = false, aoMudar = () => {}, aoPassar = () => {} }) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.img = imagem;
    this.w = imagem.naturalWidth;
    this.h = imagem.naturalHeight;
    this.cam = camera;
    this.molde = molde;
    this.somenteLeitura = somenteLeitura;
    this.aoMudar = aoMudar;
    this.aoPassar = aoPassar;
    this.pintura = pintura ? Uint8Array.from(pintura) : new Uint8Array(this.w * this.h);
    if (this.pintura.length !== this.w * this.h) throw new Error("a máscara não tem o tamanho do quadro");
    this.classe = CLASSE.PESSOA;
    this.ferramenta = "pincel";
    this.raio = 6; // px da imagem
    this.mostrarPintura = true;
    this.mostrarContornos = true;
    this.mostrarMolde = false;
    this.desfeitos = [];
    this.refeitos = [];
    this.vista = { escala: 1, ox: 0, oy: 0 };
    this.ponteiro = null; // [sx, sy] na tela
    this.traco = null;
    this.laco = null;
    this.arraste = null;
    this.espaco = false;
    this.hover = null;
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
    this.cores32 = CLASSES.map((c) => rgba(c.cor, ALFA_CLASSE));
    this.listra32 = rgba(...LISTRA);
    this.fora32 = rgba([0, 0, 0], ESCURO_FORA);
    this.pequena32 = rgba([0, 0, 0], ESCURO_PEQUENA);
    this._amostrasMolde = molde ? molde.elementos.map((el) => molde.amostras(el.nome, 0.5)) : [];
    this.trocarPlacas(placas, { avisar: false });
    this._eventos();
    this._ro = new ResizeObserver(() => this.ajustarVista());
    this._ro.observe(canvas.parentElement);
    this.ajustarVista();
  }

  destruir() {
    this._ro.disconnect();
    for (const [alvo, nome, fn] of this._ouvintes) alvo.removeEventListener(nome, fn);
  }

  // ------------------------------------------------------------------ placas e pintura
  /** Outras placas (as faixas mudaram): a pintura continua, e o que se pinta muda junto. */
  trocarPlacas(placas, { avisar = true } = {}) {
    this.placas = placas;
    this.geo = geometria(this.cam, placas, this.w, this.h);
    this._info = new Map(this.geo.info.map((p) => [p.k, p]));
    this._redesenharCamada(0, 0, this.w, this.h);
    if (avisar) this._mudou();
    else this.desenhar();
  }

  /** Troca a pintura inteira (e esquece o desfazer): a de um rótulo, ou a resposta do gabarito. */
  definir(pintura) {
    this.pintura = pintura ? Uint8Array.from(pintura) : new Uint8Array(this.w * this.h);
    this.desfeitos = [];
    this.refeitos = [];
    this.laco = null;
    this._redesenharCamada(0, 0, this.w, this.h);
    this._mudou();
  }

  /** A máscara que se grava (oclusao.js). */
  mascara() {
    return mascaraEfetiva(this.pintura, this.geo.roi);
  }

  estatisticas() {
    return estatisticas(this.mascara(), this.geo);
  }

  /** Classe da máscara num pixel da imagem (null fora). */
  classeEm(x, y) {
    const i = Math.floor(y) * this.w + Math.floor(x);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.geo.roi[i] ? this.pintura[i] || CLASSE.LIVRE : CLASSE.FORA;
  }

  _redesenharCamada(x0, y0, x1, y1) {
    const { roi, regiao } = this.geo;
    const P = this.pintura;
    const px = this.px32;
    const w = this.w;
    for (let y = y0; y < y1; y++) {
      for (let x = x0, i = y * w + x0; x < x1; x++, i++) {
        if (roi[i]) {
          const c = P[i];
          if (c > CLASSE.LIVRE && c <= CLASSE.NAO_PLACA) px[i] = (x + y) % 4 === 0 ? this.listra32 : this.cores32[c];
          else px[i] = 0;
        } else {
          px[i] = regiao[i] ? this.pequena32 : this.fora32;
        }
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
    return this.classe === CLASSE.LIVRE ? 0 : this.classe; // "Apagar": volta a ser placa livre
  }

  /** Um carimbo redondo do pincel, só dentro do que se pinta. */
  _carimbo(cx, cy) {
    const r = this.raio;
    const r2 = r * r;
    const v = this._valor;
    const { roi } = this.geo;
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
        if (roi[i] && this.pintura[i] !== v) this._mudar(i, v);
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

  /** Preenche o laço com a classe escolhida (só dentro do que se pinta). */
  fecharLaco() {
    const laco = this.laco;
    this.laco = null;
    if (!laco || laco.pontos.length < 3) {
      this.desenhar();
      return;
    }
    this._iniciar();
    const v = this._valor;
    const { roi } = this.geo;
    let y0 = this.h;
    let y1 = 0;
    let x0 = this.w;
    let x1 = 0;
    rasterizar(laco.pontos, this.w, this.h, (y, a, b) => {
      for (let i = y * this.w + a, fim = y * this.w + b; i < fim; i++) if (roi[i] && this.pintura[i] !== v) this._mudar(i, v);
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

  /** Aproxima a vista numa região da imagem (por exemplo, a faixa de placas). */
  enquadrar(x0, y0, x1, y1, margem = 24) {
    const pai = this.cv.parentElement.getBoundingClientRect();
    const escala = Math.min(40, Math.max(0.1, Math.min((pai.width - 2 * margem) / (x1 - x0), (pai.height - 2 * margem) / (y1 - y0))));
    this.vista = { escala, ox: pai.width / 2 - escala * (x0 + x1) / 2, oy: pai.height / 2 - escala * (y0 + y1) / 2 };
    this.desenhar();
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
        this.hover = null;
        this.aoPassar(null);
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
    this._passar(x, y);
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

  _passar(x, y) {
    let texto = null;
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) {
      const i = Math.floor(y) * this.w + Math.floor(x);
      const r = this.geo.regiao[i];
      if (r) {
        const p = this._info.get(r - 1);
        const c = this.classeEm(x, y);
        texto = p?.pequena ? `${this.placas[r - 1].id} · pequena demais` : `${this.placas[r - 1].id} · ${CLASSES[c].rotulo.toLowerCase()}`;
        this.hover = r - 1;
      } else {
        this.hover = null;
      }
    }
    this.aoPassar(texto);
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
    let aberto = false;
    for (const p of pts) {
      if (!p) {
        aberto = false;
        continue;
      }
      const [x, y] = this.paraTela(Math.max(-1e5, Math.min(1e5, p[0])), Math.max(-1e5, Math.min(1e5, p[1])));
      if (!aberto) {
        ctx.moveTo(x, y);
        aberto = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
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
    if (this.mostrarPintura) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.camada, 0, 0);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (this.mostrarMolde) this._desenharMolde(ctx);
    if (this.mostrarContornos) this._desenharContornos(ctx);
    this._desenharLaco(ctx);
    this._desenharPincel(ctx);
  }

  _desenharMolde(ctx) {
    for (const amostras of this._amostrasMolde) {
      this._caminho(ctx, amostras.map((X) => this.cam.projetar(X)));
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  _desenharContornos(ctx) {
    ctx.font = "12px system-ui, sans-serif";
    for (const { k, pol } of this.geo.contornos) {
      const info = this._info.get(k);
      if (!info) continue;
      const placa = this.placas[k];
      const destaque = this.hover === k;
      this._caminho(ctx, pol, true);
      ctx.setLineDash(info.pequena ? [4, 4] : []);
      ctx.strokeStyle = info.pequena ? "rgba(200,200,200,0.7)" : COR_LADO[placa.lado] || "#fff";
      ctx.lineWidth = destaque ? 2.5 : 1.25;
      ctx.stroke();
      ctx.setLineDash([]);
      if (destaque) {
        let topo = pol[0];
        for (const p of pol) if (p[1] < topo[1]) topo = p;
        const [tx, ty] = this.paraTela(topo[0], topo[1]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.strokeText(placa.id, tx, ty - 5);
        ctx.fillStyle = "#fff";
        ctx.fillText(placa.id, tx, ty - 5);
      }
    }
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
    const [r, g, b] = CLASSES[this.classe].cor;
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
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
    const [cr, cg, cb] = this.classe === CLASSE.LIVRE ? [255, 255, 255] : CLASSES[this.classe].cor;
    ctx.strokeStyle = `rgb(${cr},${cg},${cb})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
