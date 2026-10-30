// O mapa do campo da página de pontos: o desenho do campo visto de cima, com os 39 pontos que se
// marcam. Clicar num ponto do mapa diz qual ponto você vai marcar (ou dá o nome do ponto que você
// acabou de clicar na imagem). O mapa gira de 90 em 90 graus (R) para ficar como a imagem: o lado
// que fica embaixo é o mais perto da câmera.
//
// Os nomes dos pontos são sempre os do campo (o "lado das cabines" é o da câmera principal). Visto
// do outro lado, a marcação é a mesma girada 180 graus: as duas valem.

import { Molde, PONTOS_MARCAVEIS, descricaoPonto } from "../nucleo/campo.js";

const SVG = "http://www.w3.org/2000/svg";
const CAMPO = Molde.doCampo(105, 68);
const HL = CAMPO.L / 2;
const HW = CAMPO.W / 2;
/** Os gols desenhados deitados para fora do campo: o topo das traves 3,4 m atrás da linha de fundo. */
const TOPO = 3.4;
const MARGEM = 7;

function el(nome, attrs = {}, pai = null) {
  const e = document.createElementNS(SVG, nome);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (pai) pai.append(e);
  return e;
}

/** Onde cada ponto fica no desenho (x para a direita, y para baixo; o lado das cabines embaixo). */
export function posicaoNoMapa(nome) {
  const [x, y, z] = CAMPO.ponto(nome);
  const fora = z > 0 ? Math.sign(x) * TOPO : 0; // o topo da trave: deitado para fora
  return [x + fora, -y];
}

/** Os nomes dos lados, fora do campo (nas coordenadas do campo: x, y). */
const ROTULOS = [
  { texto: "lado das cabines", X: [0, -HW - 4.2] },
  { texto: "lado oposto", X: [0, HW + 4.2] },
  { texto: "fundo esquerdo", X: [-HL + 12, HW + 4.2] },
  { texto: "fundo direito", X: [HL - 12, HW + 4.2] },
];

export class Mapa {
  /**
   * @param {HTMLElement} pai onde o mapa entra
   * @param {{aoEscolher?: (nome: string) => void, aoPassar?: (nome: string | null) => void, giro?: number}} opcoes
   */
  constructor(pai, { aoEscolher = () => {}, aoPassar = () => {}, giro = 0 } = {}) {
    this.aoEscolher = aoEscolher;
    this.aoPassar = aoPassar;
    this.giro = ((giro % 360) + 360) % 360;
    this.estados = new Map(); // nome -> classe ("marcado", "certo", "errado", "faltou"...)
    this.selecionado = null;
    this.svg = el("svg", { class: "mapa", role: "img", "aria-label": "Mapa do campo com os pontos que se marcam" });
    this.grupo = el("g", {}, this.svg);
    this.textos = el("g", { class: "mapa-rotulos" }, this.svg);
    this._desenharCampo();
    this.circulos = new Map();
    for (const nome of PONTOS_MARCAVEIS) {
      const [x, y] = posicaoNoMapa(nome);
      const g = el("g", { class: "ponto-mapa", "data-ponto": nome, tabindex: -1 }, this.grupo);
      el("circle", { cx: x, cy: y, r: 2.7, class: "alvo" }, g);
      el("circle", { cx: x, cy: y, r: 1.35, class: "marca" }, g);
      const titulo = el("title", {}, g);
      titulo.textContent = `${descricaoPonto(nome)} (${nome})`;
      g.addEventListener("click", (e) => {
        e.preventDefault();
        this.aoEscolher(nome);
      });
      g.addEventListener("pointerenter", () => this.aoPassar(nome));
      g.addEventListener("pointerleave", () => this.aoPassar(null));
      this.circulos.set(nome, g);
    }
    pai.append(this.svg);
    this._aplicarGiro();
  }

  _desenharCampo() {
    const g = el("g", { class: "linhas" }, this.grupo);
    el("rect", { x: -HL - MARGEM, y: -HW - MARGEM, width: CAMPO.L + 2 * MARGEM, height: CAMPO.W + 2 * MARGEM, class: "gramado" }, g);
    for (const e of CAMPO.elementos) {
      if (e.grupo === "gol") continue;
      if (e.tipo === "reta") {
        el("line", { x1: e.A[0], y1: -e.A[1], x2: e.B[0], y2: -e.B[1] }, g);
      } else {
        const pts = CAMPO.amostras(e.nome, 0.5).map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join(" ");
        el("polyline", { points: pts, fill: "none" }, g);
      }
    }
    el("circle", { cx: 0, cy: 0, r: 0.35, class: "marca-campo" }, g);
    for (const s of [-1, 1]) {
      el("circle", { cx: s * (HL - 11), cy: 0, r: 0.35, class: "marca-campo" }, g);
      // o gol deitado: as traves saem da linha de fundo para fora, e o travessão liga os topos
      const x0 = s * HL;
      const x1 = s * (HL + TOPO);
      el("polyline", { points: `${x0},3.66 ${x1},3.66 ${x1},-3.66 ${x0},-3.66`, class: "gol", fill: "none" }, g);
    }
  }

  _aplicarGiro() {
    const deitado = this.giro % 180 === 0;
    const L = CAMPO.L + 2 * MARGEM + 6;
    const W = CAMPO.W + 2 * MARGEM + 6;
    const [vw, vh] = deitado ? [L, W] : [W, L];
    this.svg.setAttribute("viewBox", `${-vw / 2} ${-vh / 2} ${vw} ${vh}`);
    this.grupo.setAttribute("transform", `rotate(${this.giro})`);
    this.textos.replaceChildren();
    const a = (this.giro * Math.PI) / 180;
    for (const r of ROTULOS) {
      const [x, y] = [r.X[0], -r.X[1]];
      const t = el("text", { x: (x * Math.cos(a) - y * Math.sin(a)).toFixed(2), y: (x * Math.sin(a) + y * Math.cos(a)).toFixed(2) }, this.textos);
      t.textContent = r.texto;
    }
  }

  /** Gira o mapa 90 graus (no sentido horário). */
  girar(passos = 1) {
    this.giro = (((this.giro + 90 * passos) % 360) + 360) % 360;
    this._aplicarGiro();
  }

  /**
   * Mostra o estado de cada ponto: `estados` é Map nome -> classe ("marcado"; no resultado do
   * gabarito, "certo", "longe", "errado" ou "faltou"); `selecionado`, o ponto escolhido.
   */
  atualizar({ estados = this.estados, selecionado = this.selecionado, destaque = null } = {}) {
    this.estados = estados;
    this.selecionado = selecionado;
    for (const [nome, g] of this.circulos) {
      g.setAttribute("class", ["ponto-mapa", estados.get(nome) || "", nome === selecionado ? "selecionado" : "", nome === destaque ? "destaque" : ""].join(" ").trim());
    }
  }

  destruir() {
    this.svg.remove();
  }
}
