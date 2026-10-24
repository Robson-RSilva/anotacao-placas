// Gabarito: quadros com a câmera verdadeira (do simulador ou de rótulos já arbitrados).
//
// Serve para treinar e liberar quem começa (com o resultado na hora), medir cada anotador o tempo
// todo (itens escondidos na fila, sem resultado) e testar a ferramenta antes do primeiro vídeo
// real. Os rótulos do gabarito ficam em `gabarito/rotulos/` e nunca entram no treino.

import { distanciaCameras } from "./avaliacao.js";
import { Molde } from "./campo.js";
import { PARTIDA_GABARITO } from "./convencoes.js";
import { mediana } from "./estatistica.js";

export const N_LIBERACAO = 10;
export const LIMITE_LIBERACAO_PX = 2.0;

/** O campo verdadeiro do item: as medidas dele (um campo de outro tamanho no molde do pacote) ou as do pacote. */
export function campoDoItem(item, pacote) {
  return item.campo ? Molde.doCampo(item.campo.comprimento, item.campo.largura) : Molde.doPacote(pacote);
}

/** Diferença entre a câmera de um rótulo e a do item do gabarito: {mediana_px, p90_px} (null sem câmera). */
export async function compararComGabarito(indice, camera, item, campo = null) {
  if (!camera) return { mediana_px: null, p90_px: null };
  const pacote = await indice.pacote(item.pacote);
  const verdade = campoDoItem(item, pacote);
  // as medidas que a pessoa usou; um rótulo sem elas (da 0.2) usou as do pacote
  const doRotulo = campo ? Molde.doCampo(campo.comprimento, campo.largura) : Molde.doPacote(pacote);
  const d = distanciaCameras(camera, item.camera, pacote, doRotulo, item.largura, item.altura, verdade);
  return d ? { mediana_px: d[0], p90_px: d[1] } : { mediana_px: null, p90_px: null };
}

/** Última versão de cada item do gabarito anotado pela pessoa, comparada com a câmera verdadeira. */
export async function resultados(indice, pessoa, itens = null) {
  const porId = new Map((itens ?? (await indice.itensGabarito())).map((g) => [g.id, g]));
  const ip = await indice.partida(PARTIDA_GABARITO);
  const out = [];
  for (const a of ip.ultimos().values()) {
    if (a.pessoa !== pessoa || !porId.has(a.quadro)) continue;
    const r = await compararComGabarito(indice, a.dados.camera, porId.get(a.quadro), a.dados.campo);
    out.push({ item: a.quadro, mediana_px: r.mediana_px, criado_em: a.dados.criado_em });
  }
  return out.sort((x, y) => Date.parse(x.criado_em) - Date.parse(y.criado_em));
}

const valor = (r) => (r.mediana_px === null ? Infinity : r.mediana_px);

/** Liberado para dados reais: mediana dos últimos 10 itens ≤ 2 px. Sem gabarito, não há bloqueio. */
export function liberacao(res, temGabarito) {
  if (!temGabarito) return { liberado: true, n: 0, mediana_px: null, motivo: "sem gabarito importado" };
  const ultimos = res.slice(-N_LIBERACAO);
  const m = ultimos.length ? mediana(ultimos.map(valor)) : null;
  const ok = ultimos.length >= N_LIBERACAO && m !== null && m <= LIMITE_LIBERACAO_PX;
  return {
    liberado: ok,
    n: res.length,
    mediana_px: m === null || m === Infinity ? null : m,
    motivo: ok ? "" : `faltam acertos no gabarito (${ultimos.length}/${N_LIBERACAO}, meta ≤ 2 px)`,
  };
}

/** Quantos resultados vieram antes da liberação (o treino); -1 se ainda não foi liberado. */
export function nTreino(res) {
  for (let k = N_LIBERACAO; k <= res.length; k++) {
    const m = mediana(res.slice(k - N_LIBERACAO, k).map(valor));
    if (m !== null && m <= LIMITE_LIBERACAO_PX) return k;
  }
  return -1;
}
