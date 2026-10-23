// As medidas do campo no painel (página da câmera e correção na revisão): mostrar as do molde e
// trocar o molde quando a pessoa muda. O que está travado continua; "Desfazer" volta as medidas.

import { Molde, erroNasMedidas } from "../nucleo/campo.js";

/** Liga #comprimento e #largura ao editor do momento; devolve a função que mostra as medidas dele. */
export function ligarMedidas($, editorAtual) {
  const mostrar = () => {
    const editor = editorAtual();
    if (!editor) return;
    for (const [id, v] of [["comprimento", editor.molde.L], ["largura", editor.molde.W]]) {
      if (document.activeElement !== $(id)) $(id).value = v; // não atrapalha quem está digitando
    }
  };
  const mudar = () => {
    const editor = editorAtual();
    if (!editor) return;
    const L = Number($("comprimento").value);
    const W = Number($("largura").value);
    const erro = erroNasMedidas(L, W);
    $("erro").textContent = erro ? `${erro.charAt(0).toUpperCase()}${erro.slice(1)}.` : "";
    if (!erro) editor.trocarMolde(Molde.doCampo(L, W));
  };
  $("comprimento").onchange = mudar;
  $("largura").onchange = mudar;
  return mostrar;
}
