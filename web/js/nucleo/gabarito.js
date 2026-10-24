// Gabarito: quadros com a resposta verdadeira (do simulador ou de rótulos já arbitrados) — a câmera,
// na tarefa de câmera; as placas e a máscara, na de oclusão.
//
// Serve para treinar e liberar quem começa (com o resultado na hora), medir cada anotador o tempo
// todo (itens escondidos na fila, sem resultado) e testar a ferramenta antes do primeiro vídeo
// real. Cada tarefa tem a sua liberação. Os rótulos do gabarito ficam em `gabarito/rotulos/` e nunca
// entram no treino.

import { distanciaCameras } from "./avaliacao.js";
import { Camera } from "./camera.js";
import { Molde } from "./campo.js";
import { PARTIDA_GABARITO } from "./convencoes.js";
import { mediana } from "./estatistica.js";
import { LIMITE_OCLUSAO, compararMascaras, estatisticas, geometria } from "./oclusao.js";

export const N_LIBERACAO = 10;
export const LIMITE_LIBERACAO_PX = 2.0;
export const N_LIBERACAO_OCLUSAO = 5;

/** Liberação de cada tarefa: quantos itens seguidos, até que diferença e como dizer a meta. */
export const REGRA = Object.freeze({
  camera: Object.freeze({ n: N_LIBERACAO, limite: LIMITE_LIBERACAO_PX, meta: "meta ≤ 2 px" }),
  oclusao: Object.freeze({ n: N_LIBERACAO_OCLUSAO, limite: LIMITE_OCLUSAO, meta: "meta: até 5% de cada placa diferente da resposta" }),
});

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
    out.push({ item: a.quadro, mediana_px: r.mediana_px, valor: r.mediana_px, criado_em: a.dados.criado_em });
  }
  return out.sort((x, y) => Date.parse(x.criado_em) - Date.parse(y.criado_em));
}

const valor = (r) => {
  const v = r.valor !== undefined ? r.valor : r.mediana_px;
  return v === null || v === undefined ? Infinity : v;
};

/**
 * Liberado para dados reais: a mediana dos últimos itens dentro da meta (câmera: 10 itens, ≤ 2 px;
 * oclusão: 5 itens, ≤ 0,05 na fração livre). Sem gabarito da tarefa, não há bloqueio. `mediana` é a
 * medida da tarefa (`mediana_px` é o mesmo número, o nome que a câmera sempre usou).
 */
export function liberacao(res, temGabarito, regra = REGRA.camera) {
  if (!temGabarito) return { liberado: true, n: 0, mediana: null, mediana_px: null, motivo: "sem gabarito importado" };
  const ultimos = res.slice(-regra.n);
  const m = ultimos.length ? mediana(ultimos.map(valor)) : null;
  const ok = ultimos.length >= regra.n && m !== null && m <= regra.limite;
  const med = m === null || m === Infinity ? null : m;
  return {
    liberado: ok,
    n: res.length,
    mediana: med,
    mediana_px: med,
    motivo: ok ? "" : `faltam acertos no gabarito (${ultimos.length}/${regra.n}, ${regra.meta})`,
  };
}

/** Quantos resultados vieram antes da liberação (o treino); -1 se ainda não foi liberado. */
export function nTreino(res, regra = REGRA.camera) {
  for (let k = regra.n; k <= res.length; k++) {
    const m = mediana(res.slice(k - regra.n, k).map(valor));
    if (m !== null && m <= regra.limite) return k;
  }
  return -1;
}

// ------------------------------------------------------------------------------ oclusão
const _verdades = new WeakMap(); // item (o objeto que o índice guarda) -> {mascara, placas}

/** A geometria de um item do gabarito da oclusão: as placas exatas pela câmera exata. */
export function geometriaDoItem(item) {
  const cam = Camera.deRotulo(item.camera, item.largura, item.altura);
  return geometria(cam, item.placas, item.largura, item.altura);
}

/** O que a máscara verdadeira diz de cada placa do item (calculado uma vez por item). */
export async function verdadeOclusao(indice, item) {
  const m = await indice.mascara(indice.pasta.mascaraGabarito(item.id));
  const hit = _verdades.get(item);
  if (hit && hit.mascara === m) return hit;
  if (m.largura !== item.largura || m.altura !== item.altura) throw new Error(`${item.id}: a máscara não tem o tamanho do quadro`);
  const geo = geometriaDoItem(item);
  const v = { mascara: m, geo, placas: estatisticas(m.dados, geo) };
  _verdades.set(item, v);
  return v;
}

/**
 * Diferença entre uma pintura do gabarito e a máscara verdadeira, placa a placa, com a tolerância de
 * 1 px na borda (oclusao.js, compararMascaras): {maxima, mediana, n, placas}; null sem máscara.
 */
const _comparacoes = new WeakMap(); // máscara da pintura (o objeto que o índice guarda) -> {verdade, resultado}

export async function compararOclusaoComGabarito(indice, rotulo, item) {
  if (rotulo.mascara === null) return { maxima: null, mediana: null, n: 0, placas: [] };
  const v = await verdadeOclusao(indice, item);
  const m = await indice.mascara(`${indice.pasta.rotulos(PARTIDA_GABARITO, "oclusao")}/${rotulo.mascara}`);
  // o placar e a página central perguntam de novo a cada atualização: a conta só se refaz quando um
  // dos dois arquivos muda
  const hit = _comparacoes.get(m);
  if (hit && hit.verdade === v) return hit.resultado;
  if (m.largura !== item.largura || m.altura !== item.altura) throw new Error(`${rotulo.mascara}: a máscara não tem o tamanho do quadro`);
  const resultado = compararMascaras(m.dados, v.mascara.dados, v.geo);
  _comparacoes.set(m, { verdade: v, resultado });
  return resultado;
}

/** Última versão de cada item do gabarito da oclusão anotado pela pessoa, comparada com a verdade. */
export async function resultadosOclusao(indice, pessoa, itens = null) {
  const porId = new Map((itens ?? (await indice.itensGabarito("oclusao"))).map((g) => [g.id, g]));
  const ip = await indice.partida(PARTIDA_GABARITO, "oclusao");
  const out = [];
  for (const a of ip.ultimos().values()) {
    if (a.pessoa !== pessoa || !porId.has(a.quadro)) continue;
    let r;
    try {
      r = await compararOclusaoComGabarito(indice, a.dados, porId.get(a.quadro));
    } catch {
      continue; // a máscara verdadeira ainda não chegou (ou é inválida): o item não conta
    }
    out.push({ item: a.quadro, valor: r.maxima, n: r.n, criado_em: a.dados.criado_em });
  }
  return out.sort((x, y) => Date.parse(x.criado_em) - Date.parse(y.criado_em));
}
