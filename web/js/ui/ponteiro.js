// O mouse lento das telas de marcar e de pintar: com Ctrl apertado, a mira anda 1/4 do que o mouse anda,
// para acertar o pixel (com a lupa, nos pontos) ou contornar uma perna com o pincel.
//
// A página não tem como frear o cursor do sistema: ela esconde o cursor e desenha a própria mira, que é
// onde o clique vale. Soltando o Ctrl, a mira fica onde está e volta a andar junto com o mouse; a
// distância que sobrou entre os dois some aos poucos enquanto o mouse anda (metade do caminho andado
// vai para encostar a mira no mouse). Saindo da imagem, a mira volta para debaixo do mouse.
//
// Só os eventos do ponteiro mudam o estado (o Ctrl de cada um diz se o modo lento vale); a roda do
// mouse usa a mira como está — no trackpad, a pinça chega como roda com Ctrl.

export const FATOR_LENTO = 0.25;

const prender = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * O próximo lugar da mira: `mira` e `real` são onde a mira e o mouse estavam; `novo`, onde o mouse está
 * agora; `lento`, se o Ctrl está apertado; `limite`, [largura, altura] da tela (a mira não sai dela).
 */
export function proximaMira(mira, real, novo, lento, limite = null, fator = FATOR_LENTO) {
  const dx = novo[0] - real[0];
  const dy = novo[1] - real[1];
  let mx;
  let my;
  if (lento) {
    mx = mira[0] + dx * fator;
    my = mira[1] + dy * fator;
  } else {
    mx = mira[0] + dx;
    my = mira[1] + dy;
    const ox = novo[0] - mx;
    const oy = novo[1] - my;
    const longe = Math.hypot(ox, oy);
    if (longe > 0) {
      const passo = Math.min(longe, 0.5 * Math.hypot(dx, dy));
      mx += (ox / longe) * passo;
      my += (oy / longe) * passo;
    }
  }
  if (limite) {
    mx = prender(mx, 0, limite[0]);
    my = prender(my, 0, limite[1]);
  }
  return [mx, my];
}

export class PonteiroFino {
  constructor(canvas, { fator = FATOR_LENTO } = {}) {
    this.cv = canvas;
    this.fator = fator;
    this.real = null; // onde o mouse está (px da tela, a partir do canto do canvas)
    this.mira = null; // onde a mira está: é onde o clique vale
    this.lento = false;
  }

  /** A mira para um evento do ponteiro; com `atualizar` falso (a roda do mouse), só lê. */
  posicao(e, { atualizar = true } = {}) {
    const r = this.cv.getBoundingClientRect();
    const novo = [e.clientX - r.left, e.clientY - r.top];
    if (!atualizar) return this.mira ? [...this.mira] : novo;
    const lento = Boolean(e.ctrlKey);
    if (!this.real || !this.mira) {
      this.real = novo;
      this.mira = novo;
      this.lento = lento;
      return [...novo];
    }
    this.mira = proximaMira(this.mira, this.real, novo, lento, [r.width, r.height], this.fator);
    this.real = novo;
    this.lento = lento;
    return [...this.mira];
  }

  /** A mira não está debaixo do mouse (ou o modo lento está ligado): a página esconde o cursor e a desenha. */
  get desviada() {
    if (!this.real || !this.mira) return false;
    return this.lento || Math.hypot(this.mira[0] - this.real[0], this.mira[1] - this.real[1]) > 0.5;
  }

  /** O mouse saiu da imagem: a mira volta para debaixo dele. */
  soltar() {
    this.real = null;
    this.mira = null;
    this.lento = false;
  }

  /** Desenha a mira (uma cruz com o centro vazio) em `ctx`, nas coordenadas da tela. */
  desenhar(ctx) {
    if (!this.desviada) return;
    const [x, y] = this.mira;
    ctx.save();
    ctx.lineCap = "butt";
    for (const [cor, largura] of [["rgba(0,0,0,0.85)", 3], [this.lento ? "#ffd33d" : "#ffffff", 1.25]]) {
      ctx.strokeStyle = cor;
      ctx.lineWidth = largura;
      ctx.beginPath();
      for (const [ax, ay, bx, by] of [[0, -11, 0, -3], [0, 3, 0, 11], [-11, 0, -3, 0], [3, 0, 11, 0]]) {
        ctx.moveTo(x + ax, y + ay);
        ctx.lineTo(x + bx, y + by);
      }
      ctx.stroke();
    }
    ctx.fillStyle = this.lento ? "#ffd33d" : "#ffffff";
    ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    if (this.lento) {
      ctx.font = "11px system-ui, sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText("lento", x + 9, y + 20);
      ctx.fillStyle = "#ffd33d";
      ctx.fillText("lento", x + 9, y + 20);
    }
    ctx.restore();
  }
}
