// A imagem da página de pontos: mostra o quadro, os pontos marcados e uma lupa, e marca os pontos
// direto na imagem.
//
//   ponto escolhido no mapa + clique na imagem    marca o ponto ali (ou muda de lugar)
//   clique na imagem sem ponto escolhido          um "?" fica esperando o nome: clique no mapa
//   arrastar um ponto                             ajusta o lugar
//   botão direito num ponto (ou Delete)           apaga
//   roda do mouse                                 aproxima; botão direito, do meio ou espaço + arrastar move a vista
//   Ctrl apertado                                 o mouse lento: a mira anda 1/4 do que o mouse anda (ponteiro.js)
//   cruzamento (X): dois cliques em cada linha    o ponto vai para onde as duas retas se cruzam (o ponto coberto)
//
// As coordenadas são px da imagem a partir do canto de cima à esquerda (o primeiro pixel vai de 0 a 1).

import { PONTOS_MARCAVEIS } from "../nucleo/campo.js";
import { ANGULO_PEQUENO, DISTANCIA_MINIMA, cruzarRetas, retaNaImagem } from "../nucleo/cruzamento.js";
import { PonteiroFino } from "./ponteiro.js";

const PERTO = 9; // px na tela: clique em cima de um ponto
const LUPA = 168; // px na tela
const AUMENTO = 6;
const MIRA = [4, 14]; // px na tela, do centro da lupa: onde cada braço da mira começa e termina
const CLARO = 140; // a claridade (0 a 255) a partir da qual a mira da lupa fica preta
const ORDEM = new Map(PONTOS_MARCAVEIS.map((n, i) => [n, i]));
const COR = { certo: "#3fb950", longe: "#d29922", errado: "#f85149" };
const COR_LINHAS = ["#ffd33d", "#ff6fd8"]; // as duas retas do cruzamento

/** O que a página diz em cada passo do cruzamento (`descrever`: o nome do ponto para gente). */
export function textoCruzamento(m, descrever = (nome) => nome) {
  const n = m.cruzamento?.cliques.length ?? 0;
  const passo = [
    "Cruzamento: clique dois pontos na primeira linha, longe um do outro, no meio da linha pintada.",
    "Cruzamento: o segundo ponto da primeira linha — a reta tracejada tem que seguir a linha pintada.",
    "Cruzamento: agora dois pontos na outra linha.",
    "Cruzamento: o segundo ponto da outra linha — o círculo mostra onde o ponto vai ficar.",
  ][Math.min(n, 3)];
  const qual = m.selecionado ? ` O ponto vai ser: ${descrever(m.selecionado)}.` : "";
  return `${passo}${qual} (Esc cancela; Backspace desfaz o último clique)`;
}

export class Marcador {
  constructor(canvas, { imagem, pontos = [], somenteLeitura = false, aoMudar = () => {}, aoPassar = () => {}, aoPendente = () => {}, aoCruzamento = () => {} }) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.img = imagem;
    this.w = imagem.naturalWidth;
    this.h = imagem.naturalHeight;
    this.somenteLeitura = somenteLeitura;
    this.aoMudar = aoMudar;
    this.aoPassar = aoPassar;
    this.aoPendente = aoPendente;
    this.aoCruzamento = aoCruzamento; // ({erro, aviso, feito}) a cada passo do cruzamento
    this.pontos = new Map(pontos.map((p) => [p.ponto, { x: p.x, y: p.y }]));
    this.selecionado = null; // o ponto a marcar no próximo clique (escolhido no mapa)
    this.pendente = null; // {x, y}: um clique esperando o nome
    this.cruzamento = null; // {cliques: [[x, y], ...]}: o ajudante de cruzamento em andamento
    this.construcao = null; // {linhas, ponto}: as retas do último cruzamento, até o próximo clique
    this.destaque = null; // o ponto em que o mouse está (na imagem ou no mapa)
    this.mostrarNomes = false;
    this.mostrarPontos = true;
    this.resultado = null; // no treino: {pontos: [{ponto, x, y, verdade, estado}], faltaram: [{x, y, ponto}]}
    this.desfeitos = [];
    this.refeitos = [];
    this.vista = { escala: 1, ox: 0, oy: 0 };
    this.ponteiro = null;
    this.arraste = null; // {tipo: "vista" | "ponto", ...}
    this.espaco = false;
    this.fino = new PonteiroFino(canvas);
    this._pixels = undefined; // os pixels da imagem, lidos na primeira vez que a lupa aparece
    this._quadroPedido = false;
    this._eventos();
    this._ro = new ResizeObserver(() => this.ajustarVista());
    this._ro.observe(canvas.parentElement);
    this.ajustarVista();
  }

  destruir() {
    this._ro.disconnect();
    for (const [alvo, nome, fn] of this._ouvintes) alvo.removeEventListener(nome, fn);
  }

  // ------------------------------------------------------------------ os pontos
  /** Os pontos marcados, na ordem dos pontos do campo: [{ponto, x, y}]. */
  lista() {
    return [...this.pontos.entries()]
      .map(([ponto, p]) => ({ ponto, x: p.x, y: p.y }))
      .sort((a, b) => (ORDEM.get(a.ponto) ?? 99) - (ORDEM.get(b.ponto) ?? 99));
  }

  _guardar() {
    this.desfeitos.push(this.lista());
    if (this.desfeitos.length > 100) this.desfeitos.shift();
    this.refeitos = [];
  }

  _mudou() {
    this.desenhar();
    this.aoMudar(this);
  }

  /** Troca todos os pontos (e esquece o desfazer). */
  definir(pontos) {
    this.pontos = new Map(pontos.map((p) => [p.ponto, { x: p.x, y: p.y }]));
    this.desfeitos = [];
    this.refeitos = [];
    this.pendente = null;
    this.cruzamento = null;
    this.construcao = null;
    this._mudou();
  }

  colocar(nome, x, y) {
    if (this.somenteLeitura) return;
    this._guardar();
    this.pontos.set(nome, { x: Math.min(this.w, Math.max(0, x)), y: Math.min(this.h, Math.max(0, y)) });
    this._mudou();
  }

  apagar(nome) {
    if (this.somenteLeitura || !this.pontos.has(nome)) return;
    this._guardar();
    this.pontos.delete(nome);
    if (this.destaque === nome) this.destaque = null;
    this._mudou();
  }

  /**
   * Escolhe o ponto a marcar (no mapa). Com um "?" esperando, ele vira esse ponto; com o ponto já na
   * imagem, ele fica escolhido para mudar de lugar no próximo clique.
   */
  escolher(nome) {
    if (this.pendente && !this.somenteLeitura) {
      const { x, y } = this.pendente;
      this.pendente = null;
      this.selecionado = null;
      this.colocar(nome, x, y);
      this.aoPendente(null);
      return;
    }
    this.selecionado = this.selecionado === nome ? null : nome;
    this.desenhar();
    this.aoMudar(this);
  }

  cancelar() {
    this.pendente = null;
    this.selecionado = null;
    this.aoPendente(null);
    this._mudou();
  }

  desfazer() {
    if (this.pendente) {
      this.cancelar();
      return;
    }
    const antes = this.desfeitos.pop();
    if (!antes) return;
    this.refeitos.push(this.lista());
    this.pontos = new Map(antes.map((p) => [p.ponto, { x: p.x, y: p.y }]));
    this._mudou();
  }

  refazer() {
    const depois = this.refeitos.pop();
    if (!depois) return;
    this.desfeitos.push(this.lista());
    this.pontos = new Map(depois.map((p) => [p.ponto, { x: p.x, y: p.y }]));
    this._mudou();
  }

  // ------------------------------------------------------------------ o ajudante de cruzamento
  /** Começa o cruzamento: dois cliques em cada linha, e o ponto vai para onde as duas retas se cruzam. */
  iniciarCruzamento() {
    if (this.somenteLeitura) return;
    this.pendente = null;
    this.construcao = null;
    this.cruzamento = { cliques: [] };
    this.aoPendente(null);
    this.aoCruzamento({});
    this.desenhar();
  }

  cancelarCruzamento() {
    if (!this.cruzamento && !this.construcao) return;
    this.cruzamento = null;
    this.construcao = null;
    this.aoCruzamento({});
    this.desenhar();
  }

  /** Desfaz o último clique do cruzamento. */
  tirarCliqueDoCruzamento() {
    if (!this.cruzamento) return;
    this.cruzamento.cliques.pop();
    this.aoCruzamento({});
    this.desenhar();
  }

  _cliqueDoCruzamento(x, y) {
    const c = this.cruzamento;
    c.cliques.push([x, y]);
    const n = c.cliques.length;
    if (n % 2 === 0) {
      const [a, b] = c.cliques.slice(-2);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < DISTANCIA_MINIMA) {
        c.cliques.pop();
        this.aoCruzamento({ erro: "Os dois cliques de uma linha precisam ficar longe um do outro." });
        this.desenhar();
        return;
      }
    }
    if (n < 4) {
      this.aoCruzamento({});
      this.desenhar();
      return;
    }
    const [a, b, p, q] = c.cliques;
    const r = cruzarRetas(a, b, p, q);
    if (!r) {
      c.cliques.splice(2);
      this.aoCruzamento({ erro: "As duas linhas estão quase paralelas: o ponto ficaria incerto demais. Clique de novo a outra linha." });
      this.desenhar();
      return;
    }
    const [ix, iy] = r.ponto;
    this.cruzamento = null;
    this.construcao = { linhas: [[a, b], [p, q]], ponto: r.ponto };
    if (ix < 0 || iy < 0 || ix > this.w || iy > this.h) {
      this.construcao.ponto = null;
      this.aoCruzamento({ erro: "As linhas se cruzam fora da imagem: ponto fora da imagem não se marca." });
      this.desenhar();
      return;
    }
    if (this.selecionado) {
      const nome = this.selecionado;
      this.selecionado = null;
      this.colocar(nome, ix, iy);
    } else {
      this.pendente = { x: ix, y: iy };
      this.aoPendente(this.pendente);
      this._mudou();
    }
    this.aoCruzamento({ feito: true, aviso: r.angulo < ANGULO_PEQUENO ? "As linhas se cruzam num ângulo pequeno: confira o ponto na lupa." : "" });
  }

  /** O ponto marcado debaixo do mouse (px da tela), ou null. */
  pontoEm(sx, sy) {
    let melhor = null;
    let dmin = PERTO;
    for (const [nome, p] of this.pontos) {
      const [px, py] = this.paraTela(p.x, p.y);
      const d = Math.hypot(px - sx, py - sy);
      if (d <= dmin) {
        dmin = d;
        melhor = nome;
      }
    }
    return melhor;
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

  /** Onde o evento do ponteiro vale: a mira (com Ctrl, o mouse lento). */
  _posicao(e) {
    return this.fino.posicao(e);
  }

  _roda(e) {
    e.preventDefault();
    const [sx, sy] = this.fino.posicao(e, { atualizar: false }); // aproxima em volta da mira
    this._zoom(sx, sy, e.deltaY);
  }

  _zoom(sx, sy, deltaY) {
    const nova = Math.min(60, Math.max(0.1, this.vista.escala * Math.exp(-deltaY * 0.0015)));
    const [x, y] = this.paraImagem(sx, sy);
    this.vista = { escala: nova, ox: sx - nova * x, oy: sy - nova * y };
    this._pedirQuadro();
  }

  aproximar(fator) {
    const r = this.cv.getBoundingClientRect();
    this._zoom(r.width / 2, r.height / 2, -Math.log(fator) / 0.0015);
  }

  /** O cursor do sistema some quando a página desenha a mira (o mouse lento). */
  _cursor() {
    if (this.arraste?.tipo === "vista" || (this.arraste && !this.arraste.tipo)) return;
    this.cv.style.cursor = this.fino.desviada ? "none" : "";
  }

  // ------------------------------------------------------------------ eventos
  _eventos() {
    this._ouvintes = [
      [this.cv, "pointerdown", (e) => this._baixar(e)],
      [this.cv, "pointermove", (e) => this._mover(e)],
      [this.cv, "pointerup", (e) => this._soltar(e)],
      [this.cv, "pointercancel", () => {
        this.arraste = null;
      }],
      [this.cv, "wheel", (e) => this._roda(e)],
      [this.cv, "contextmenu", (e) => e.preventDefault()],
      [this.cv, "pointerleave", () => {
        this.ponteiro = null;
        this.fino.soltar();
        this._cursor();
        this._passar(null);
        this.desenhar();
      }],
    ];
    for (const [alvo, nome, fn] of this._ouvintes) alvo.addEventListener(nome, fn, { passive: !["wheel", "contextmenu"].includes(nome) });
  }

  _baixar(e) {
    const [sx, sy] = this._posicao(e);
    if (e.button === 0 && !this.espaco && this.construcao) {
      this.construcao = null; // as retas do último cruzamento ficam até o próximo clique
      this._pedirQuadro();
    }
    const sobre = this.cruzamento ? null : this.pontoEm(sx, sy); // no cruzamento, o clique num ponto é um clique dele
    if (e.button === 2 && sobre && !this.somenteLeitura) {
      this.apagar(sobre);
      return;
    }
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.espaco)) {
      this.cv.setPointerCapture(e.pointerId);
      this.arraste = { tipo: "vista", sx, sy, ox: this.vista.ox, oy: this.vista.oy };
      this.cv.style.cursor = "grabbing";
      return;
    }
    if (e.button !== 0) return;
    if (this.somenteLeitura) {
      this.cv.setPointerCapture(e.pointerId);
      this.arraste = { tipo: "vista", sx, sy, ox: this.vista.ox, oy: this.vista.oy };
      return;
    }
    this.cv.setPointerCapture(e.pointerId);
    if (sobre && sobre !== this.selecionado) {
      const p = this.pontos.get(sobre);
      this.arraste = { tipo: "ponto", nome: sobre, sx, sy, x0: p.x, y0: p.y, moveu: false };
      return;
    }
    this.arraste = { tipo: "clique", sx, sy };
  }

  _mover(e) {
    const [sx, sy] = this._posicao(e);
    this.ponteiro = [sx, sy];
    const a = this.arraste;
    if (a?.tipo === "vista") {
      this.vista.ox = a.ox + (sx - a.sx);
      this.vista.oy = a.oy + (sy - a.sy);
    } else if (a?.tipo === "ponto") {
      if (!a.moveu && Math.hypot(sx - a.sx, sy - a.sy) >= 3) {
        a.moveu = true;
        this._guardar();
      }
      if (a.moveu) {
        const [x, y] = this.paraImagem(sx, sy);
        this.pontos.set(a.nome, { x: Math.min(this.w, Math.max(0, x)), y: Math.min(this.h, Math.max(0, y)) });
      }
    }
    this._passar(a?.tipo === "ponto" ? a.nome : this.pontoEm(sx, sy));
    this._cursor();
    this._pedirQuadro();
  }

  _soltar(e) {
    if (this.cv.hasPointerCapture(e.pointerId)) this.cv.releasePointerCapture(e.pointerId);
    const a = this.arraste;
    this.arraste = null;
    this.cv.style.cursor = "";
    this._cursor();
    if (!a) return;
    if (a.tipo === "ponto") {
      if (a.moveu) {
        this._mudou();
      } else if (this.selecionado) {
        // com um ponto escolhido no mapa, o clique marca esse ponto, mesmo colado num que já está lá
        const [x, y] = this.paraImagem(a.sx, a.sy);
        const nome = this.selecionado;
        this.selecionado = null;
        this.colocar(nome, x, y);
      } else {
        // clicou num ponto: ele fica escolhido (no mapa também), para ver qual é ou mudar de lugar
        this.selecionado = a.nome;
        this._mudou();
      }
      return;
    }
    if (a.tipo !== "clique") return;
    const [sx, sy] = this._posicao(e);
    if (Math.hypot(sx - a.sx, sy - a.sy) > 6) return;
    const [x, y] = this.paraImagem(sx, sy);
    if (x < 0 || y < 0 || x > this.w || y > this.h) return;
    if (this.cruzamento) {
      this._cliqueDoCruzamento(x, y);
      return;
    }
    if (this.selecionado) {
      const nome = this.selecionado;
      this.selecionado = null;
      this.colocar(nome, x, y);
      return;
    }
    this.pendente = { x, y };
    this.aoPendente(this.pendente);
    this._mudou();
  }

  _passar(nome) {
    if (nome === this.destaque) return;
    this.destaque = nome;
    this.aoPassar(nome);
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
    if (this.mostrarPontos) {
      if (this.resultado) this._desenharResultado(ctx);
      this._desenharPontos(ctx, (x, y) => this.paraTela(x, y), 1);
    }
    this._desenharCruzamento(ctx, (x, y) => this.paraTela(x, y), 1);
    this._desenharLupa(ctx);
    if (this.arraste?.tipo !== "vista") this.fino.desenhar(ctx);
  }

  _marca(ctx, sx, sy, cor, raio, grosso = false) {
    ctx.beginPath();
    ctx.arc(sx, sy, raio, 0, 2 * Math.PI);
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = grosso ? 4.5 : 3.5;
    ctx.stroke();
    ctx.strokeStyle = cor;
    ctx.lineWidth = grosso ? 2.2 : 1.6;
    ctx.stroke();
    ctx.beginPath(); // o centro exato: um ponto de 1 px
    ctx.fillStyle = cor;
    ctx.fillRect(sx - 0.75, sy - 0.75, 1.5, 1.5);
  }

  _texto(ctx, texto, sx, sy) {
    ctx.font = "12px system-ui, sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeText(texto, sx + 8, sy - 7);
    ctx.fillStyle = "#fff";
    ctx.fillText(texto, sx + 8, sy - 7);
  }

  _desenharPontos(ctx, tela, fator) {
    const estado = new Map((this.resultado?.pontos || []).map((p) => [p.ponto, p.estado]));
    for (const [nome, p] of this.pontos) {
      const [sx, sy] = tela(p.x, p.y);
      const escolhido = nome === this.selecionado;
      const realce = nome === this.destaque;
      const cor = estado.has(nome) ? COR[estado.get(nome)] : escolhido ? "#ffd33d" : realce ? "#ffffff" : "#4fc3f7";
      this._marca(ctx, sx, sy, cor, (realce || escolhido ? 7 : 5) * fator, escolhido);
      if (fator === 1 && (this.mostrarNomes || realce || escolhido)) this._texto(ctx, nome, sx, sy);
    }
    if (this.pendente) {
      const [sx, sy] = tela(this.pendente.x, this.pendente.y);
      this._marca(ctx, sx, sy, "#ffffff", 7 * fator, true);
      if (fator === 1) this._texto(ctx, "? clique no mapa", sx, sy);
    }
  }

  _desenharResultado(ctx) {
    const r = this.resultado;
    ctx.setLineDash([]);
    for (const p of r.pontos) {
      if (!p.verdade) continue;
      const [ax, ay] = this.paraTela(p.x, p.y);
      const [bx, by] = this.paraTela(p.verdade.x, p.verdade.y);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = COR[p.estado];
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    for (const v of r.verdadeiros) {
      const [sx, sy] = this.paraTela(v.x, v.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = v.faltou ? "#ff9800" : "rgba(63,185,80,0.95)";
      ctx.fill();
      if (v.faltou) {
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(sx, sy, 9, 0, 2 * Math.PI);
        ctx.strokeStyle = "#ff9800";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        this._texto(ctx, `faltou: ${v.ponto}`, sx, sy);
      }
    }
  }

  /**
   * O cruzamento em andamento (as retas pelos cliques, a reta ainda sendo escolhida, que segue o mouse, e
   * onde o ponto vai ficar) ou o último feito; `tela` leva px da imagem à tela (ou à lupa).
   */
  _desenharCruzamento(ctx, tela, fator) {
    const c = this.cruzamento;
    const k = this.construcao;
    if (!c && !k) return;
    const mouse = this.ponteiro && this.arraste?.tipo !== "vista" ? this.paraImagem(...this.ponteiro) : null;
    const cliques = c ? c.cliques : [];
    const linhas = []; // [p, q, cor, se ainda segue o mouse]
    if (c) {
      if (cliques.length >= 2) linhas.push([cliques[0], cliques[1], COR_LINHAS[0], false]);
      else if (cliques.length === 1 && mouse) linhas.push([cliques[0], mouse, COR_LINHAS[0], true]);
      if (cliques.length === 3 && mouse) linhas.push([cliques[2], mouse, COR_LINHAS[1], true]);
    } else {
      k.linhas.forEach(([p, q], i) => linhas.push([p, q, COR_LINHAS[i], false]));
    }
    ctx.save();
    ctx.lineCap = "butt";
    for (const [p, q, cor, seguindo] of linhas) {
      const seg = retaNaImagem(p, q, this.w, this.h);
      if (!seg) continue;
      const [a, b] = seg.map(([x, y]) => tela(x, y));
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 2.5 * fator;
      ctx.stroke();
      ctx.setLineDash(seguindo ? [3, 4] : [9, 4]);
      ctx.strokeStyle = cor;
      ctx.lineWidth = fator;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const [i, [x, y]] of cliques.entries()) {
      const [sx, sy] = tela(x, y);
      for (const [cor, largura] of [["rgba(0,0,0,0.85)", 3], [COR_LINHAS[i < 2 ? 0 : 1], 1.5]]) {
        ctx.strokeStyle = cor;
        ctx.lineWidth = largura;
        ctx.beginPath();
        ctx.moveTo(sx - 4, sy - 4);
        ctx.lineTo(sx + 4, sy + 4);
        ctx.moveTo(sx + 4, sy - 4);
        ctx.lineTo(sx - 4, sy + 4);
        ctx.stroke();
      }
    }
    let alvo = null;
    if (c && cliques.length === 3 && mouse) alvo = cruzarRetas(cliques[0], cliques[1], cliques[2], mouse)?.ponto ?? null;
    else if (!c) alvo = k.ponto;
    if (alvo) {
      const [sx, sy] = tela(...alvo);
      ctx.beginPath();
      ctx.arc(sx, sy, 7 * fator, 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.setLineDash(c ? [3, 3] : []);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** O pixel da imagem em (x, y) é claro (a mira da lupa fica preta em cima dele)? */
  claro(x, y) {
    if (this._pixels === undefined) {
      try {
        const c = document.createElement("canvas");
        c.width = this.w;
        c.height = this.h;
        const cc = c.getContext("2d", { willReadFrequently: true });
        cc.drawImage(this.img, 0, 0);
        this._pixels = cc.getImageData(0, 0, this.w, this.h).data;
      } catch {
        this._pixels = null; // sem os pixels, a mira fica branca
      }
    }
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (!this._pixels || xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return false;
    const i = 4 * (yi * this.w + xi);
    return 0.2126 * this._pixels[i] + 0.7152 * this._pixels[i + 1] + 0.0722 * this._pixels[i + 2] > CLARO;
  }

  /**
   * A mira da lupa: quatro braços de 2 px em volta do centro (o centro fica livre, para ver o pixel), cada
   * pixel preto em cima do que é claro — as linhas do campo, onde ficam os pontos — e branco no resto.
   */
  _desenharMira(ctx, cx, cy, x, y, aumento) {
    const [vao, fim] = MIRA;
    for (let s = vao; s < fim; s++) {
      // [onde a célula de 1 px fica na lupa, se o braço é deitado]; a cor sai do meio da célula
      for (const [px, py, deitado] of [[cx + s, cy, true], [cx - s - 1, cy, true], [cx, cy + s, false], [cx, cy - s - 1, false]]) {
        const ix = x + (px + (deitado ? 0.5 : 0) - cx) / aumento;
        const iy = y + (py + (deitado ? 0 : 0.5) - cy) / aumento;
        ctx.fillStyle = this.claro(ix, iy) ? "#000" : "#fff";
        if (deitado) ctx.fillRect(px, cy - 1, 1, 2);
        else ctx.fillRect(cx - 1, py, 2, 1);
      }
    }
  }

  _desenharLupa(ctx) {
    if (!this.ponteiro || this.arraste?.tipo === "vista" || this.vista.escala * AUMENTO < 2) return;
    const [sx, sy] = this.ponteiro;
    const [x, y] = this.paraImagem(sx, sy);
    if (x < 0 || y < 0 || x > this.w || y > this.h) return;
    const larg = this.cv.clientWidth;
    const lx = sx < larg / 2 ? larg - LUPA - 12 : 12; // do lado oposto ao mouse
    const ly = 12;
    const aumento = Math.max(AUMENTO, this.vista.escala * 2.5);
    const meio = LUPA / 2 / aumento; // px da imagem do centro até a borda da lupa
    ctx.save();
    ctx.beginPath();
    ctx.rect(lx, ly, LUPA, LUPA);
    ctx.clip();
    ctx.fillStyle = "#111";
    ctx.fillRect(lx, ly, LUPA, LUPA);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.img, x - meio, y - meio, 2 * meio, 2 * meio, lx, ly, LUPA, LUPA);
    const tela = (px, py) => [lx + LUPA / 2 + (px - x) * aumento, ly + LUPA / 2 + (py - y) * aumento];
    if (this.mostrarPontos) this._desenharPontos(ctx, tela, 0.8);
    this._desenharCruzamento(ctx, tela, 0.8);
    this._desenharMira(ctx, lx + LUPA / 2, ly + LUPA / 2, x, y, aumento);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(lx + 0.5, ly + 0.5, LUPA - 1, LUPA - 1);
  }
}
