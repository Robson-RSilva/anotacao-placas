// O que as páginas das duas tarefas (e as das revisões) têm em comum: as caixas de descartar e de
// confirmar, abrir a imagem de um item (o quadro ou o recorte da placa), os textos do que veio da
// revisão e o resultado do treino.

import { MOTIVOS_DESCARTE } from "../nucleo/convencoes.js";
import { MOTIVOS } from "../nucleo/formatos.js";
import { REGRA, minimoDoTreino } from "../nucleo/gabarito.js";
import { el, imagemDoArquivo } from "./util.js";

/** O texto da caixa de descartar, por tarefa. */
const DESCARTE = {
  pontos: {
    titulo: "Descartar esta imagem?",
    texto: "Descarte só a imagem que não dá para anotar direito. Uma imagem normal em que não aparece nada para marcar você salva vazia — ela também serve para o treino.",
  },
  placas: {
    titulo: "Descartar este recorte?",
    texto: "O recorte não se ajusta: se o contorno não está na placa (fora do lugar, ou é outra coisa), descarte. Uma placa sem nada na frente você salva sem pintar — ela também serve para o treino.",
  },
};

/**
 * Põe as caixas de descartar e de confirmar na vista, com os motivos de descarte da tarefa. Devolve
 * {pedirDescarte, confirmar, aberta}: `pedirDescarte()` resolve com {motivo, comentario} ou null
 * (voltou); `confirmar(titulo, texto)`, com true ou false.
 */
export function caixas(raiz, tarefa = "pontos") {
  raiz.append(document.getElementById("tpl-caixas").content.cloneNode(true));
  const $ = (id) => el(id, raiz);
  $("titulo-descartar").textContent = DESCARTE[tarefa].titulo;
  $("texto-descartar").textContent = DESCARTE[tarefa].texto;
  $("motivos-descarte").replaceChildren(
    ...Object.entries(MOTIVOS_DESCARTE[tarefa]).map(([valor, texto]) => {
      const rotulo = document.createElement("label");
      const r = Object.assign(document.createElement("input"), { type: "radio", name: "motivo-descarte", value: valor });
      rotulo.append(r, ` ${texto}`);
      return rotulo;
    }),
  );
  let resolver = null;
  const fechar = (valor) => {
    $("caixa-descartar").hidden = true;
    $("caixa-confirmar").hidden = true;
    const r = resolver;
    resolver = null;
    r?.(valor);
  };
  $("form-descartar").onsubmit = (e) => {
    e.preventDefault();
    const motivo = raiz.querySelector("input[name=motivo-descarte]:checked")?.value;
    const comentario = $("comentario-descarte").value.trim();
    if (!motivo) {
      $("erro-descartar").textContent = "Escolha o motivo.";
      return;
    }
    if (motivo === "outro" && !comentario) {
      $("erro-descartar").textContent = "Diga o motivo no comentário.";
      return;
    }
    fechar({ motivo, comentario });
  };
  $("voltar-descartar").onclick = () => fechar(null);
  $("sim-confirmar").onclick = () => fechar(true);
  $("nao-confirmar").onclick = () => fechar(false);
  const aoTeclar = (e) => {
    if (e.key === "Escape" && resolver) {
      e.preventDefault();
      fechar($("caixa-confirmar").hidden ? null : false);
    }
  };
  window.addEventListener("keydown", aoTeclar, true);
  return {
    pedirDescarte() {
      for (const r of raiz.querySelectorAll("input[name=motivo-descarte]")) r.checked = false;
      $("comentario-descarte").value = "";
      $("erro-descartar").textContent = "";
      $("caixa-descartar").hidden = false;
      raiz.querySelector("input[name=motivo-descarte]").focus();
      return new Promise((r) => {
        resolver = r;
      });
    },
    confirmar(titulo, texto) {
      $("titulo-confirmar").textContent = titulo;
      $("texto-confirmar").textContent = texto;
      $("caixa-confirmar").hidden = false;
      $("sim-confirmar").focus();
      return new Promise((r) => {
        resolver = r;
      });
    },
    aberta: () => resolver !== null,
    destruir() {
      window.removeEventListener("keydown", aoTeclar, true);
      fechar(null);
    },
  };
}

/**
 * A imagem de um item da fila — um quadro da partida (pontos), um recorte (placas) ou um item do
 * gabarito: {img, url}. `item.tarefa` diz qual (sem ela, pontos).
 */
export async function abrirImagem(pasta, item) {
  const arquivo = await pasta.arquivo(pasta.imagem(item.partida, item.tarefa ?? "pontos", item.quadro));
  if (!arquivo) throw new Error("A imagem ainda não chegou na pasta (o Drive terminou de sincronizar?).");
  const aberta = await imagemDoArquivo(arquivo);
  if (aberta.img.naturalWidth !== item.largura || aberta.img.naturalHeight !== item.altura) {
    URL.revokeObjectURL(aberta.url);
    throw new Error("A imagem não tem o tamanho que a fila diz.");
  }
  return aberta;
}

/** "Devolvido na revisão: motivo — “comentário”". */
export function textoDevolvido(tarefa, devolvido) {
  const motivo = MOTIVOS[tarefa][devolvido.motivo] || devolvido.motivo;
  return `Devolvido na revisão: ${motivo.charAt(0).toLowerCase()}${motivo.slice(1)}${devolvido.comentario ? ` — “${devolvido.comentario}”` : ""}`;
}

/** De onde a imagem começou, para quem anota (ou vazio). */
export function textoPartiu(tarefa, partiu) {
  if (partiu.fonte === "modelo") return tarefa === "pontos" ? "Começa com os pontos de um modelo: confira cada um e corrija." : "Começa com a pintura de um modelo: confira e corrija.";
  if (partiu.fonte === "rotulo_anterior") return "Começa com a sua versão anterior.";
  return "";
}

/** O texto da situação de um rótulo (para a revisão). */
export function textoSituacao(r, tarefa = "pontos") {
  if (r.situacao !== "descartada") return tarefa === "placas" ? "Pintado" : "Anotada";
  const motivo = MOTIVOS_DESCARTE[tarefa][r.motivo_descarte] || r.motivo_descarte;
  return `${tarefa === "placas" ? "Descartado" : "Descartada"}: ${motivo.charAt(0).toLowerCase()}${motivo.slice(1)}`;
}

/** Quanto falta para a liberação, em português ("Faltam 3 acertos…" / "Liberado…"). */
export function textoLiberacao(tarefa, sit) {
  const regra = REGRA[tarefa];
  if (sit.liberado) return sit.gabarito_total ? "Você está liberado para as imagens reais." : "";
  const minimo = minimoDoTreino(regra);
  if (minimo > regra.n && sit.n < minimo) {
    return `Para a liberação: fazer pelo menos ${minimo} (até aqui, ${sit.n}) e acertar ${regra.k} dos últimos ${regra.n} (nos últimos ${sit.ultimos}, ${sit.acertos} certo(s)).`;
  }
  const faltamItens = Math.max(0, regra.n - sit.ultimos);
  const faltamAcertos = Math.max(0, regra.k - sit.acertos);
  if (faltamItens > 0 && faltamAcertos > 0) return `Para a liberação: acertar ${regra.k} dos últimos ${regra.n} (até aqui, ${sit.acertos} de ${sit.ultimos}).`;
  return `Para a liberação: acertar ${regra.k} dos últimos ${regra.n} (nos últimos ${sit.ultimos}, ${sit.acertos} certos).`;
}

/** Os parâmetros do endereço (#/pontos?treino&ver=g1001). */
export function parametros() {
  const i = location.hash.indexOf("?");
  return new URLSearchParams(i >= 0 ? location.hash.slice(i + 1) : "");
}

/** O texto de uma tecla não vale quando se escreve num campo. */
export const escrevendo = (e) => e.target.matches?.("textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]), select");
