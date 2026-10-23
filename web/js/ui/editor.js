// Editor do molde: desenha o quadro, o molde do campo e as placas, e ajusta a câmera ao que a
// pessoa arrasta e trava.
//
//   arrastar um ponto      o molde inteiro acompanha; ao soltar, o ponto fica travado ali
//   clicar num ponto       trava o ponto onde ele está
//   arrastar uma linha     a linha do molde vai até o cursor; ao soltar, fica travada ali
//   arrastar um travado    move o alvo dele
//   botão direito          destrava
//   arrastar o vazio       move a vista; roda do mouse aproxima

import { ajustar } from "../nucleo/solver.js";

const COR = {
  linha: "rgba(255,255,255,0.92)",
  sombra: "rgba(0,0,0,0.6)",
  destaque: "#ffd54a",
  ponto: "#ffd54a",
  pino: "#00e676",
  medio: "#ffca28",
  ruim: "#ff5252",
  lados: { cab: "#4fc3f7", opo: "#ffb74d", esq: "#ce93d8", dir: "#80cbc4" },
};
const RAIO_PONTO = 11;
const RAIO_LINHA = 8;
const SIGMA_ARRASTE = 0.5;
const SIGMA_PINO = 1.0;

const copiar = (o) => JSON.parse(JSON.stringify(o));

export class Editor {
  constructor(canvas, { imagem, molde, placas = [], camera, somenteLeitura = false, aoMudar = () => {},
    aoPassar = () => {} }) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.img = imagem;
    this.w = imagem.naturalWidth;
    this.h = imagem.naturalHeight;
    this.molde = molde;
    this.placas = placas;
    this.cam = camera;
    this.camInicial = camera;
    this.somenteLeitura = somenteLeitura;
    this.aoMudar = aoMudar;
    this.aoPassar = aoPassar;
    this.pinos = [];
    this.historico = [];
    this.hover = null;
    this.arraste = null;
    this.mostrarNomes = true;
    this.mostrarPlacas = true;
    this.vista = { escala: 1, ox: 0, oy: 0 };
    this._quadroPedido = false;
    this._usarMolde(molde);
    this._contornos = this.placas.map((p) => this._contornoPlaca(p.vertices));
    this._eventos();
    this._ro = new ResizeObserver(() => this.ajustarVista());
    this._ro.observe(canvas.parentElement);
    this.ajustarVista();
  }

  destruir() {
    this._ro.disconnect();
    for (const [nome, fn] of this._ouvintes) this.cv.removeEventListener(nome, fn);
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

  // ------------------------------------------------------------------ estado
  _guardar() {
    this.historico.push({ cam: this.cam, pinos: copiar(this.pinos), molde: this.molde });
    if (this.historico.length > 100) this.historico.shift();
  }

  desfazer() {
    const s = this.historico.pop();
    if (!s) return;
    if (s.molde !== this.molde) this._usarMolde(s.molde);
    this.cam = s.cam;
    this.pinos = s.pinos;
    this._mudou();
  }

  _usarMolde(molde) {
    this.molde = molde;
    this._amostrasTela = molde.elementos.map((el) => molde.amostras(el.nome, 0.5));
  }

  /** Outras medidas do campo: os travados continuam, e a câmera se ajusta de novo a eles. */
  trocarMolde(molde) {
    if (molde === this.molde) return;
    this._guardar();
    this._usarMolde(molde);
    this._assentar();
    this._mudou();
  }

  recomecar(camera) {
    this._guardar();
    this.cam = camera;
    this.pinos = [];
    this._mudou();
  }

  definir(camera, pinos = [], molde = null) {
    if (molde && molde !== this.molde) this._usarMolde(molde);
    this.cam = camera;
    this.pinos = copiar(pinos);
    this._mudou();
  }

  /** Vira o lado: câmera espelhada e pinos renomeados pela simetria (os alvos na imagem não mudam). */
  espelhar() {
    this._guardar();
    this.cam = this.cam.espelhada();
    this.pinos = this.pinos.map((p) => (p.tipo === "ponto"
      ? { ...p, nome: this.molde.espelharPonto(p.nome) }
      : { ...p, elemento: this.molde.espelharElemento(p.elemento) }));
    this._mudou();
  }

  estado() {
    return {
      camera: this.cam.paraRotulo(),
      pontos_travados: this.pinos.filter((p) => p.tipo === "ponto").map((p) => ({ ponto: p.nome, x: p.x, y: p.y })),
      linhas_travadas: this.pinos.filter((p) => p.tipo === "linha").map((p) => ({ elemento: p.elemento, x: p.x, y: p.y })),
    };
  }

  /** Pinos a partir de um rótulo salvo (para a revisão). */
  pinosDoRotulo(rotulo) {
    return [
      ...(rotulo.pontos_travados || []).map((p) => ({ tipo: "ponto", nome: p.ponto, x: p.x, y: p.y })),
      ...(rotulo.linhas_travadas || []).map((p) => ({ tipo: "linha", elemento: p.elemento, x: p.x, y: p.y })),
    ];
  }

  /** Distância (ref. 960) de cada pino até o molde. */
  residuos() {
    const s = 960 / this.w;
    return this.pinos.map((p) => {
      let d;
      if (p.tipo === "ponto") {
        const px = this.cam.projetar(this.molde.ponto(p.nome));
        d = px ? Math.hypot(px[0] - p.x, px[1] - p.y) : Infinity;
      } else {
        const pts = this.molde.amostras(p.elemento, 0.25).map((X) => this.cam.projetar(X));
        d = Math.abs(distancia(p, pts));
      }
      return { pino: p, px: d * s };
    });
  }

  _mudou() {
    this.desenhar();
    this.aoMudar(this);
  }

  // ------------------------------------------------------------------ ajuste
  _restricoes(excluir = null) {
    return this.pinos.filter((p) => p !== excluir).map((p) => (p.tipo === "ponto"
      ? { tipo: "ponto", X: this.molde.ponto(p.nome), alvo: [p.x, p.y], sigma: SIGMA_PINO }
      : { tipo: "linha", amostras: this.molde.amostras(p.elemento, 0.25), alvo: [p.x, p.y], sigma: SIGMA_PINO }));
  }

  _assentar() {
    if (!this.pinos.length) return;
    this.cam = ajustar(this.cam, this._restricoes(), { iteracoes: 30 });
  }

  // ------------------------------------------------------------------ eventos
  _eventos() {
    this._ouvintes = [
      ["pointerdown", (e) => this._baixar(e)],
      ["pointermove", (e) => this._mover(e)],
      ["pointerup", (e) => this._soltar(e)],
      ["pointercancel", () => { this.arraste = null; }],
      ["wheel", (e) => this._roda(e)],
      ["contextmenu", (e) => this._direito(e)],
      ["pointerleave", () => { this.hover = null; this.aoPassar(null); this.desenhar(); }],
    ];
    for (const [nome, fn] of this._ouvintes) {
      this.cv.addEventListener(nome, fn, { passive: !["wheel", "contextmenu"].includes(nome) });
    }
  }

  _baixar(e) {
    if (e.button !== 0) return;
    const [sx, sy] = this._posicao(e);
    this.cv.setPointerCapture(e.pointerId);
    const alvo = this.somenteLeitura ? null : this._acertar(sx, sy);
    if (!alvo) {
      this.arraste = { tipo: "vista", sx, sy, ox: this.vista.ox, oy: this.vista.oy };
      return;
    }
    this._guardar();
    this.arraste = { ...alvo, sx, sy, ancora: this.cam, moveu: false };
  }

  _mover(e) {
    const [sx, sy] = this._posicao(e);
    const a = this.arraste;
    if (!a) {
      const alvo = this.somenteLeitura ? null : this._acertar(sx, sy);
      const nome = alvo ? (alvo.nome || alvo.elemento || alvo.pino?.nome || alvo.pino?.elemento) : null;
      if ((this.hover && this.hover.chave) !== (alvo && alvo.chave)) {
        this.hover = alvo;
        this.aoPassar(nome);
        this.desenhar();
      }
      return;
    }
    if (a.tipo === "vista") {
      this.vista.ox = a.ox + (sx - a.sx);
      this.vista.oy = a.oy + (sy - a.sy);
      this._pedirQuadro();
      return;
    }
    if (!a.moveu && Math.hypot(sx - a.sx, sy - a.sy) < 3) return;
    a.moveu = true;
    const [x, y] = this.paraImagem(sx, sy);
    a.alvoAtual = [x, y];
    let extra;
    if (a.tipo === "pino") {
      a.pino.x = x;
      a.pino.y = y;
      extra = [];
    } else if (a.tipo === "ponto") {
      extra = [{ tipo: "ponto", X: this.molde.ponto(a.nome), alvo: [x, y], sigma: SIGMA_ARRASTE }];
    } else {
      extra = [{ tipo: "linha", amostras: this.molde.amostras(a.elemento, 0.25), alvo: [x, y], sigma: SIGMA_ARRASTE }];
    }
    const outros = a.tipo === "ponto"
      ? this._restricoes(this.pinos.find((p) => p.tipo === "ponto" && p.nome === a.nome))
      : this._restricoes();
    this.cam = ajustar(this.cam, [...outros, ...extra], { ancora: a.ancora, iteracoes: 8 });
    this._pedirQuadro();
  }

  _soltar(e) {
    const a = this.arraste;
    this.arraste = null;
    if (!a || a.tipo === "vista") return;
    if (this.cv.hasPointerCapture(e.pointerId)) this.cv.releasePointerCapture(e.pointerId);
    if (a.tipo === "ponto") {
      let alvo = a.alvoAtual;
      if (!a.moveu) {
        const px = this.cam.projetar(this.molde.ponto(a.nome));
        if (!px) return;
        alvo = px;
      }
      this.pinos = this.pinos.filter((p) => !(p.tipo === "ponto" && p.nome === a.nome));
      this.pinos.push({ tipo: "ponto", nome: a.nome, x: alvo[0], y: alvo[1] });
    } else if (a.tipo === "linha") {
      if (!a.moveu) {
        const [x, y] = this.paraImagem(a.sx, a.sy);
        this.pinos.push({ tipo: "linha", elemento: a.elemento, x, y });
      } else {
        this.pinos.push({ tipo: "linha", elemento: a.elemento, x: a.alvoAtual[0], y: a.alvoAtual[1] });
      }
    }
    this._assentar();
    this._mudou();
  }

  _direito(e) {
    e.preventDefault();
    if (this.somenteLeitura) return;
    const [sx, sy] = this._posicao(e);
    const p = this._pinoPerto(sx, sy);
    if (!p) return;
    this._guardar();
    this.pinos = this.pinos.filter((q) => q !== p);
    this._assentar();
    this._mudou();
  }

  _roda(e) {
    e.preventDefault();
    const [sx, sy] = this._posicao(e);
    const fator = Math.exp(-e.deltaY * 0.0015);
    const nova = Math.min(40, Math.max(0.1, this.vista.escala * fator));
    const [x, y] = this.paraImagem(sx, sy);
    this.vista.escala = nova;
    this.vista.ox = sx - nova * x;
    this.vista.oy = sy - nova * y;
    this._pedirQuadro();
  }

  aproximar(fator) {
    const r = this.cv.getBoundingClientRect();
    this._roda({ preventDefault() {}, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      deltaY: -Math.log(fator) / 0.0015 });
  }

  // ------------------------------------------------------------------ acerto (tela)
  _pinoPerto(sx, sy) {
    let melhor = null;
    let dmin = RAIO_PONTO;
    for (const p of this.pinos) {
      const [px, py] = this.paraTela(p.x, p.y);
      const d = Math.hypot(px - sx, py - sy);
      if (d < dmin) {
        dmin = d;
        melhor = p;
      }
    }
    return melhor;
  }

  _acertar(sx, sy) {
    const pino = this._pinoPerto(sx, sy);
    if (pino) return { tipo: "pino", pino, chave: `pino:${this.pinos.indexOf(pino)}` };
    let melhor = null;
    let dmin = RAIO_PONTO;
    for (const p of this.molde.pontos) {
      const px = this.cam.projetar(p.X);
      if (!px) continue;
      const [tx, ty] = this.paraTela(px[0], px[1]);
      const d = Math.hypot(tx - sx, ty - sy);
      if (d < dmin) {
        dmin = d;
        melhor = { tipo: "ponto", nome: p.nome, chave: `ponto:${p.nome}` };
      }
    }
    if (melhor) return melhor;
    dmin = RAIO_LINHA;
    this.molde.elementos.forEach((el, k) => {
      const pts = this._amostrasTela[k].map((X) => {
        const px = this.cam.projetar(X);
        return px ? this.paraTela(px[0], px[1]) : null;
      });
      const d = Math.abs(distancia({ x: sx, y: sy }, pts));
      if (d < dmin) {
        dmin = d;
        melhor = { tipo: "linha", elemento: el.nome, chave: `linha:${el.nome}` };
      }
    });
    return melhor;
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

  _contornoPlaca(V) {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const a = V[i];
      const b = V[(i + 1) % 4];
      for (let k = 0; k < 6; k++) {
        const t = k / 6;
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
      }
    }
    return out;
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (this.mostrarPlacas) this._desenharPlacas(ctx);
    this._desenharMolde(ctx);
    this._desenharPinos(ctx);
  }

  _caminho(ctx, pts) {
    let aberto = false;
    ctx.beginPath();
    for (const p of pts) {
      if (!p) {
        aberto = false;
        continue;
      }
      const [x, y] = this.paraTela(p[0], p[1]);
      if (!aberto) {
        ctx.moveTo(x, y);
        aberto = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
  }

  _desenharPlacas(ctx) {
    ctx.font = "12px system-ui, sans-serif";
    this.placas.forEach((placa, k) => {
      const pts = this._contornos[k].map((X) => this.cam.projetar(X));
      if (pts.some((p) => !p)) return;
      const visivel = pts.some((p) => p[0] >= 0 && p[0] < this.w && p[1] >= 0 && p[1] < this.h);
      if (!visivel) return;
      const cor = COR.lados[placa.lado] || "#fff";
      this._caminho(ctx, pts);
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = cor;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.setLineDash(placa.tipo === "led" ? [6, 4] : []);
      ctx.strokeStyle = cor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      const topo = this.cam.projetar([(placa.vertices[2][0] + placa.vertices[3][0]) / 2,
        (placa.vertices[2][1] + placa.vertices[3][1]) / 2, placa.vertices[2][2]]);
      if (topo) {
        const [tx, ty] = this.paraTela(topo[0], topo[1]);
        const texto = placa.patrocinador ? `${placa.id} · ${placa.patrocinador}` : placa.id;
        ctx.lineWidth = 3;
        ctx.strokeStyle = COR.sombra;
        ctx.strokeText(texto, tx - ctx.measureText(texto).width / 2, ty - 4);
        ctx.fillStyle = cor;
        ctx.fillText(texto, tx - ctx.measureText(texto).width / 2, ty - 4);
      }
    });
  }

  _desenharMolde(ctx) {
    const travadas = new Set(this.pinos.filter((p) => p.tipo === "linha").map((p) => p.elemento));
    this.molde.elementos.forEach((el, k) => {
      const pts = this._amostrasTela[k].map((X) => this.cam.projetar(X));
      const destaque = this.hover && this.hover.tipo === "linha" && this.hover.elemento === el.nome;
      this._caminho(ctx, pts);
      ctx.strokeStyle = COR.sombra;
      ctx.lineWidth = destaque ? 5 : 3;
      ctx.stroke();
      ctx.strokeStyle = destaque || travadas.has(el.nome) ? COR.destaque : COR.linha;
      ctx.lineWidth = destaque ? 2.5 : 1.25;
      ctx.stroke();
    });
    const pinados = new Set(this.pinos.filter((p) => p.tipo === "ponto").map((p) => p.nome));
    ctx.font = "11px system-ui, sans-serif";
    for (const p of this.molde.pontos) {
      const px = this.cam.projetar(p.X);
      if (!px) continue;
      const [x, y] = this.paraTela(px[0], px[1]);
      const destaque = this.hover && this.hover.tipo === "ponto" && this.hover.nome === p.nome;
      ctx.beginPath();
      ctx.arc(x, y, destaque ? 5.5 : 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = pinados.has(p.nome) ? COR.pino : COR.ponto;
      ctx.strokeStyle = COR.sombra;
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      if (destaque && this.mostrarNomes) {
        ctx.lineWidth = 3;
        ctx.strokeText(p.nome, x + 8, y - 8);
        ctx.fillStyle = "#fff";
        ctx.fillText(p.nome, x + 8, y - 8);
      }
    }
  }

  _desenharPinos(ctx) {
    for (const r of this.residuos()) {
      const p = r.pino;
      const [tx, ty] = this.paraTela(p.x, p.y);
      const cor = r.px <= 2 ? COR.pino : r.px <= 5 ? COR.medio : COR.ruim;
      if (p.tipo === "ponto") {
        const px = this.cam.projetar(this.molde.ponto(p.nome));
        if (px) {
          const [x, y] = this.paraTela(px[0], px[1]);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(tx, ty);
          ctx.strokeStyle = cor;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.arc(tx, ty, 7, 0, 2 * Math.PI);
      ctx.moveTo(tx - 11, ty);
      ctx.lineTo(tx + 11, ty);
      ctx.moveTo(tx, ty - 11);
      ctx.lineTo(tx, ty + 11);
      ctx.strokeStyle = COR.sombra;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.strokeStyle = cor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

/** Distância com sinal de {x, y} a uma polilinha de pontos [u, v] (nulos quebram a linha). */
function distancia(p, pts) {
  let melhor = Infinity;
  let sinal = 1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const den = abx * abx + aby * aby;
    const t = den > 1e-12 ? Math.min(1, Math.max(0, ((p.x - a[0]) * abx + (p.y - a[1]) * aby) / den)) : 0;
    const d = Math.hypot(a[0] + t * abx - p.x, a[1] + t * aby - p.y);
    if (d < melhor) {
      melhor = d;
      sinal = abx * (p.y - a[1]) - aby * (p.x - a[0]) >= 0 ? 1 : -1;
    }
  }
  return sinal * melhor;
}
