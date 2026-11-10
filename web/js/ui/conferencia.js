// A conferência da câmera nas páginas: os pontos que valem de cada quadro, a medida do campo de cada partida
// (guardada enquanto a página está aberta), o texto de cada aviso e o desenho do campo visto pela câmera.
//
// Onde a medida do campo ainda não é conhecida (uma partida com poucos rótulos, os itens do gabarito), só
// valem os avisos que não dependem dela: os nomes espelhados, a câmera do lado oposto e a câmera
// impossível. O "ponto fora" depende da medida: com o campo errado, quase todo quadro acusaria.

import { descricaoPonto } from "../nucleo/campo.js";
import { anguloDeVisao, conferirQuadro, linhasDoCampo, medirCampo } from "../nucleo/camera.js";
import { PARTIDA_GABARITO } from "../nucleo/convencoes.js";
import { aprovado } from "../nucleo/filas.js";
import { numero } from "./util.js";

export const CAMPO_PADRAO = Object.freeze({ L: 105, W: 68 });

/** Quadros úteis em cada direção para a medida do campo valer (comprimento e largura). */
export const MINIMO_PARA_MEDIR = 5;

/** Avisos que valem sem a medida do campo. */
const ROBUSTOS = new Set(["espelhado", "lado_oposto", "impossivel", "poucos_pontos", "poucos_no_chao", "degenerado"]);

export const NIVEIS = Object.freeze({
  conferir: "para conferir",
  atencao: "atenção",
  ok: "batem",
  sem_folga: "poucos pontos para conferir",
  sem_camera: "sem câmera",
});

/** Os pontos que valem para a câmera num rótulo de pontos (nenhum, se a imagem foi descartada). */
export const pontosQueValem = (dados) => (dados && dados.situacao !== "descartada" ? dados.pontos : []);

/** O rótulo que vale de cada quadro de uma partida: o aprovado, ou o mais recente. Map quadro -> arquivo. */
export function rotulosQueValem(ip) {
  const porQuadro = new Map();
  for (const a of ip?.rotulos ?? []) {
    const atual = porQuadro.get(a.quadro);
    if (!atual || Date.parse(a.dados.criado_em) > Date.parse(atual.dados.criado_em)) porQuadro.set(a.quadro, a);
  }
  for (const q of porQuadro.keys()) {
    const ap = aprovado(ip, q);
    if (ap) porQuadro.set(q, ap.a);
  }
  return porQuadro;
}

const pausa = () => new Promise((r) => setTimeout(r, 0));

const MEDIDAS = new Map();

/**
 * A medida do campo de uma partida pelos rótulos que valem ([{nome, pontos, largura, altura}]):
 * {L, W, quadrosL, quadrosW, conhecido}. Guardada pela lista de rótulos: muda quando um rótulo muda.
 */
export function campoDaPartida(partida, rotulos) {
  const chave = `${partida}|${rotulos.map((r) => r.nome).sort().join(",")}`;
  if (MEDIDAS.has(chave)) return MEDIDAS.get(chave);
  const m = medirCampo(rotulos.filter((r) => r.pontos.length >= 5));
  const out = { ...m, conhecido: m.quadrosL >= MINIMO_PARA_MEDIR && m.quadrosW >= MINIMO_PARA_MEDIR };
  if (MEDIDAS.size > 50) MEDIDAS.clear();
  MEDIDAS.set(chave, out);
  return out;
}

const CONFERENCIAS = new Map();

/** A conferência de um rótulo (guardada pelo nome do arquivo e pela medida do campo). */
export function conferirRotulo(nome, pontos, largura, altura, campo) {
  const chave = `${nome}|${campo.L}|${campo.W}`;
  if (nome && CONFERENCIAS.has(chave)) return CONFERENCIAS.get(chave);
  const c = conferirQuadro(pontos, largura, altura, campo);
  if (nome) {
    if (CONFERENCIAS.size > 5000) CONFERENCIAS.clear();
    CONFERENCIAS.set(chave, c);
  }
  return c;
}

/**
 * Confere os quadros de uma partida aos poucos, sem travar a página: `quadros` = [{id, nome, pontos,
 * largura, altura}]. `aoAndar(feitos, total)` a cada lote; `vivo()` falso interrompe. Devolve {campo,
 * porQuadro: Map id -> conferência} ou null se interrompida. Sem a medida do campo, só os avisos robustos.
 */
export async function conferirPartida(partida, quadros, { aoAndar = () => {}, vivo = () => true } = {}) {
  await pausa();
  const campo = campoDaPartida(partida, quadros);
  const ajustar = campo.conhecido ? (c) => c : soRobustos;
  const porQuadro = new Map();
  for (let i = 0; i < quadros.length; i++) {
    const q = quadros[i];
    porQuadro.set(q.id, ajustar(conferirRotulo(q.nome, q.pontos, q.largura, q.altura, campo)));
    if (i % 8 === 7) {
      aoAndar(i + 1, quadros.length);
      await pausa();
      if (!vivo()) return null;
    }
  }
  aoAndar(quadros.length, quadros.length);
  return { campo, porQuadro };
}

/** Só os avisos que valem sem a medida do campo (com o nível refeito). */
export function soRobustos(c) {
  const avisos = c.avisos.filter((a) => ROBUSTOS.has(a.codigo));
  const nivel = avisos.some((a) => a.nivel === "conferir") ? "conferir" : avisos.some((a) => a.nivel === "atencao") ? "atencao" : c.cam ? "sem_folga" : "sem_camera";
  return { ...c, avisos, nivel, parcial: true };
}

const nomeDoPonto = (p) => `${descricaoPonto(p)} (${p})`;

/** O aviso em português, para quem anota ou revisa. */
export function textoDoAviso(a) {
  switch (a.codigo) {
    case "ponto_fora":
      return `${nomeDoPonto(a.ponto)} está a ${numero(a.px, 0)} px de onde os outros pontos dizem que ele fica: confira o lugar e o nome.`;
    case "ponto_duvidoso":
      return `${nomeDoPonto(a.ponto)} está a ${numero(a.px, 0)} px de onde os outros pontos dizem que ele fica: vale olhar de perto.`;
    case "espelhado":
      return "Os nomes estão espelhados (esquerda e direita, ou cabines e oposto, trocados): com eles, a câmera ficaria embaixo do gramado.";
    case "lado_oposto":
      return "Com estes nomes, a câmera fica do lado oposto às cabines. Se a imagem é da câmera principal, os nomes estão girados meia-volta: gire o mapa e confira.";
    case "impossivel":
      return "Com estes pontos não sai uma câmera possível: algum ponto está muito fora do lugar, ou com o nome trocado.";
    case "poucos_pontos":
      return "Poucos pontos para a câmera: são precisos 4 no gramado.";
    case "poucos_no_chao":
      return "Os pontos no gramado não bastam para a câmera: são precisos 4, e não todos numa mesma linha.";
    case "degenerado":
      return "Com estes pontos a câmera não fica determinada.";
    default:
      return a.codigo;
  }
}

/** Uma frase sobre a conferência (para a página de marcar, a revisão e o visor). */
export function resumoDaConferencia(c) {
  if (c.avisos.some((a) => a.nivel === "conferir" || a.nivel === "atencao")) return c.avisos.filter((a) => a.nivel !== "info").map(textoDoAviso).join(" ");
  if (c.nivel === "sem_camera") return c.avisos.length ? textoDoAviso(c.avisos[0]) : "Sem câmera.";
  if (c.parcial) return "A câmera fecha. A conferência ponto a ponto vem quando a partida tiver rótulos para medir o campo.";
  if (c.nivel === "sem_folga") return `A câmera fecha, mas com ${c.n} pontos não dá para conferir cada um.`;
  const pior = Math.max(...c.residuos.map((x) => x.loo ?? x.px));
  return `Os pontos batem entre si: o mais longe está a ${numero(pior, 1)} px de onde os outros dizem.`;
}

/** Onde fica a câmera, em palavras. */
export function textoDaCamera(cam) {
  const d = Math.hypot(cam.C[0], cam.C[1]);
  return `Câmera a ${numero(d, 0)} m do centro do campo e ${numero(Math.abs(cam.C[2]), 0)} m de altura, com ${numero(anguloDeVisao(cam), 0)}° de ângulo de visão.`;
}

/** O que o Marcador desenha por cima: as linhas do campo vistas pela câmera e, nos pontos acusados, a seta até onde os outros pontos os põem. */
export function camadaDoCampo(c) {
  if (!c?.cam || c.cam.C[2] < 0) return null;
  const acusados = new Set(c.avisos.filter((a) => a.ponto).map((a) => a.ponto));
  const setas = c.residuos
    .filter((x) => acusados.has(x.ponto) && x.previsto)
    .map((x) => ({ de: [x.x, x.y], para: x.previsto, cor: c.nivel === "conferir" ? "#ff5252" : "#ffb300" }));
  return { linhas: linhasDoCampo(c.cam, c.campo), setas };
}

/**
 * A linha da câmera numa página de marcar ou de revisar: mede o campo da partida do item em segundo plano
 * e, a cada mudança dos pontos, confere (depois de uma pequena espera). Sem a medida do campo (partida com
 * poucos rótulos, item do gabarito), só aparecem os avisos robustos — e nada quando não há aviso. O aviso
 * não impede salvar.
 */
export class ConferenciaAoVivo {
  constructor(caixa, indice, { minimo = 5 } = {}) {
    this.caixa = caixa;
    this.indice = indice;
    this.minimo = minimo;
    this.it = null;
    this.campo = null;
    this.espera = null;
    this.ultimos = null;
    this.ultima = null; // a última conferência mostrada (ajuda a testar)
    this.geracao = 0;
  }

  /** O item da tela mudou ({partida, largura, altura} ou null). */
  definirItem(it) {
    this.it = it;
    this.campo = null;
    this.ultimos = null;
    this.esconder();
    const g = ++this.geracao;
    if (!it || it.partida === PARTIDA_GABARITO) return;
    setTimeout(async () => {
      try {
        const ip = await this.indice.partida(it.partida, "pontos");
        if (g !== this.geracao) return;
        const rotulos = [...rotulosQueValem(ip).values()].map((a) => ({ nome: a.nome, pontos: pontosQueValem(a.dados), largura: a.dados.largura, altura: a.dados.altura }));
        const campo = campoDaPartida(it.partida, rotulos);
        if (g !== this.geracao) return;
        this.campo = campo;
        if (this.ultimos) this.conferir(this.ultimos);
      } catch {
        // sem a medida do campo, ficam só os avisos robustos
      }
    }, 30);
  }

  /** Os pontos mudaram: confere daqui a pouco (um clique atrás do outro não refaz a conta a cada um). */
  conferirDepois(lista) {
    this.ultimos = lista;
    clearTimeout(this.espera);
    this.espera = setTimeout(() => this.conferir(lista), 120);
  }

  conferir(lista) {
    const it = this.it;
    if (!it || lista.length < this.minimo) return this.esconder();
    const campo = this.campo?.conhecido ? this.campo : { ...(this.campo ?? CAMPO_PADRAO), conhecido: false };
    let c = conferirQuadro(lista, it.largura, it.altura, campo);
    if (!campo.conhecido) c = soRobustos(c);
    if (c.parcial && c.nivel !== "conferir" && c.nivel !== "atencao") return this.esconder();
    this.ultima = c;
    this.caixa.hidden = false;
    this.caixa.className = `camera-status ${c.nivel}`;
    this.caixa.textContent = `Câmera: ${resumoDaConferencia(c)}`;
  }

  esconder() {
    this.ultima = null;
    this.caixa.hidden = true;
  }

  destruir() {
    clearTimeout(this.espera);
    this.geracao++;
  }
}
