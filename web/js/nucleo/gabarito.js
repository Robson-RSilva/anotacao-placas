// Gabarito: imagens com a resposta verdadeira (do simulador ou de rótulos já arbitrados) — onde está
// cada ponto do campo, na tarefa de pontos; a máscara de cada jogador, na de jogadores.
//
// Serve para treinar e liberar quem começa (com o resultado na hora), medir cada anotador o tempo
// todo (itens escondidos na fila, sem resultado) e testar a ferramenta antes do primeiro vídeo real.
// Cada item dá certo ou errado (as regras abaixo); a pessoa é liberada para as imagens reais quando
// acerta K dos últimos N itens da tarefa. Os rótulos do gabarito ficam em `gabarito/rotulos/` e nunca
// entram no treino.

import { Molde } from "./campo.js";
import { PARTIDA_GABARITO, REF_W } from "./convencoes.js";
import { mediana } from "./estatistica.js";

/**
 * Regras de cada tarefa. Pontos: um ponto conta como achado a até `perto_px` do lugar certo; o item
 * dá certo sem nenhum ponto errado, com `cobertura` dos pontos que aparecem achados e o erro mediano
 * até `erro_px` (px na referência 960). Jogadores: com 1 px de tolerância na borda, cada jogador
 * pintado em pelo menos `cobertura_jogador` da área, ninguém que não é jogador pintado e a
 * sobreposição (IoU) de pelo menos `iou`.
 */
export const REGRA = Object.freeze({
  pontos: Object.freeze({
    n: 10,
    k: 8,
    erro_px: 2.0,
    perto_px: 8.0,
    no_lugar_px: 4.0,
    cobertura: 0.8,
    meta: "acertar 8 dos últimos 10",
  }),
  jogadores: Object.freeze({
    n: 5,
    k: 4,
    iou: 0.8,
    cobertura_jogador: 0.5,
    outra_pessoa: 0.25,
    pequeno_px: 30,
    meta: "acertar 4 dos últimos 5",
  }),
});

const CAMPO = Molde.doCampo();

// ------------------------------------------------------------------------------ pontos
function casar(marcados, porNome, girar, escala) {
  const out = [];
  for (const m of marcados) {
    const nome = girar ? CAMPO.espelharPonto(m.ponto) : m.ponto;
    const v = porNome.get(nome);
    out.push({ ponto: m.ponto, como: nome, x: m.x, y: m.y, verdade: v ?? null, d: v ? Math.hypot(m.x - v.x, m.y - v.y) * escala : null });
  }
  return out;
}

/**
 * Compara os pontos marcados com os do item. O nome dos lados depende de onde a pessoa acha que a
 * câmera está: a mesma marcação vista do outro lado do campo (girada 180°) também vale, e vale a
 * que acha mais pontos. Devolve {acerto, erro_mediano_px, cobertura, visiveis, achados, faltaram,
 * errados, girado, pontos: [{ponto, x, y, verdade, d, estado}]}; `estado` é "certo", "longe" (achado,
 * mas a mais de `no_lugar_px`) ou "errado" (nome trocado, ou um ponto que não está ali).
 */
export function compararPontos(marcados, item, regra = REGRA.pontos) {
  const escala = REF_W / item.largura;
  const porNome = new Map(item.pontos.map((p) => [p.ponto, p]));
  const opcoes = [false, true].map((girar) => {
    const c = casar(marcados, porNome, girar, escala);
    const achados = c.filter((x) => x.d !== null && x.d <= regra.perto_px);
    return { girar, c, n: achados.length, soma: achados.reduce((s, x) => s + x.d, 0) };
  });
  const melhor = opcoes[1].n > opcoes[0].n || (opcoes[1].n === opcoes[0].n && opcoes[1].soma < opcoes[0].soma) ? opcoes[1] : opcoes[0];
  const pontos = melhor.c.map((x) => ({
    ...x,
    estado: x.d === null || x.d > regra.perto_px ? "errado" : x.d <= regra.no_lugar_px ? "certo" : "longe",
  }));
  const marcadosComo = new Set(pontos.filter((x) => x.estado !== "errado").map((x) => x.como));
  const visiveis = item.pontos.filter((p) => p.visivel);
  const faltaram = visiveis.filter((p) => !marcadosComo.has(p.ponto)).map((p) => (melhor.girar ? CAMPO.espelharPonto(p.ponto) : p.ponto));
  const errados = pontos.filter((x) => x.estado === "errado");
  // o erro mediano é dos pontos que aparecem (os cobertos a pessoa só estima)
  const dVisiveis = pontos.filter((x) => x.estado !== "errado" && x.verdade.visivel).map((x) => x.d);
  const erro = mediana(dVisiveis);
  const cobertura = visiveis.length ? (visiveis.length - faltaram.length) / visiveis.length : 1;
  const acerto = !errados.length && cobertura >= regra.cobertura && (erro === null ? !visiveis.length : erro <= regra.erro_px);
  return {
    acerto,
    erro_mediano_px: erro,
    cobertura,
    visiveis: visiveis.length,
    achados: visiveis.length - faltaram.length,
    faltaram,
    errados: errados.map((x) => x.ponto),
    girado: melhor.girar,
    pontos,
  };
}

/** Por que um item dos pontos deu errado, em português (vazio quando deu certo). */
export function motivoPontos(r, regra = REGRA.pontos) {
  if (r.descartada) return "a imagem tinha resposta: descartar conta como erro";
  const partes = [];
  if (r.errados.length) partes.push(`${r.errados.length} ponto(s) com o nome trocado ou fora do lugar`);
  if (r.cobertura < regra.cobertura) partes.push(`faltaram ${r.faltaram.length} dos ${r.visiveis} pontos que aparecem`);
  if (r.erro_mediano_px !== null && r.erro_mediano_px > regra.erro_px) {
    partes.push(`erro mediano de ${r.erro_mediano_px.toFixed(1).replace(".", ",")} px (a meta é até ${String(regra.erro_px).replace(".", ",")} px)`);
  }
  return partes.join("; ");
}

// ------------------------------------------------------------------------------ jogadores
/**
 * A borda de 1 px dos jogadores, que não conta: os pixels com um vizinho (dos 8) do outro lado da
 * silhueta. `jogador(v)` diz se o valor de um pixel da verdade é jogador.
 */
export function bordaDosJogadores(verdade, w, h, n) {
  const borda = new Uint8Array(w * h);
  const eh = (v) => v >= 1 && v <= n;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = eh(verdade[i]);
      let diferente = false;
      for (let dy = -1; dy <= 1 && !diferente; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue;
          if (eh(verdade[yy * w + xx]) !== a) {
            diferente = true;
            break;
          }
        }
      }
      if (diferente) borda[i] = 1;
    }
  }
  return borda;
}

/**
 * Compara uma pintura (1 onde há jogador) com a máscara verdadeira do item (1 a N: cada jogador; acima
 * de N: as outras pessoas; 0: o resto), com 1 px de tolerância na borda dos jogadores. Devolve
 * {acerto, iou, jogadores: [{id, area, cobertura, pequeno}], faltaram, outras, fora_px, borda}.
 */
export function compararJogadores(pintura, verdade, w, h, n, regra = REGRA.jogadores) {
  const borda = bordaDosJogadores(verdade, w, h, n);
  const area = new Float64Array(256);
  const nucleo = new Float64Array(256);
  const pintadoNucleo = new Float64Array(256);
  const pintadoTodo = new Float64Array(256);
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let fora = 0;
  for (let i = 0; i < w * h; i++) {
    const v = verdade[i];
    const p = pintura[i] ? 1 : 0;
    area[v] += 1;
    if (p) pintadoTodo[v] += 1;
    if (borda[i]) continue;
    nucleo[v] += 1;
    if (p) pintadoNucleo[v] += 1;
    const jogador = v >= 1 && v <= n;
    if (jogador && p) tp += 1;
    else if (jogador) fn += 1;
    else if (p) {
      fp += 1;
      if (v === 0) fora += 1;
    }
  }
  const escala2 = (REF_W / w) ** 2;
  const jogadores = [];
  for (let j = 1; j <= n; j++) {
    if (!area[j]) continue;
    const cobertura = nucleo[j] ? pintadoNucleo[j] / nucleo[j] : pintadoTodo[j] / area[j];
    jogadores.push({ id: j, area: area[j], cobertura, pequeno: area[j] * escala2 < regra.pequeno_px });
  }
  const outras = [];
  for (let v = n + 1; v < 256; v++) {
    if (!area[v]) continue;
    const parte = nucleo[v] ? pintadoNucleo[v] / nucleo[v] : pintadoTodo[v] / area[v];
    if (parte >= regra.outra_pessoa) outras.push(v);
  }
  const faltaram = jogadores.filter((j) => !j.pequeno && j.cobertura < regra.cobertura_jogador).map((j) => j.id);
  const uniao = tp + fn + fp;
  const iou = uniao ? tp / uniao : 1;
  return {
    acerto: !faltaram.length && !outras.length && iou >= regra.iou,
    iou,
    jogadores,
    faltaram,
    outras,
    fora_px: fora,
    borda,
  };
}

/** Por que um item dos jogadores deu errado, em português (vazio quando deu certo). */
export function motivoJogadores(r, regra = REGRA.jogadores) {
  if (r.descartada) return "a imagem tinha resposta: descartar conta como erro";
  const partes = [];
  if (r.faltaram.length) partes.push(`faltou pintar ${r.faltaram.length} jogador(es)`);
  if (r.outras.length) partes.push(`pintou ${r.outras.length} pessoa(s) que não é jogador`);
  if (r.iou < regra.iou) partes.push(`sobreposição de ${Math.round(100 * r.iou)}% (a meta é ${Math.round(100 * regra.iou)}%)`);
  return partes.join("; ");
}

// ------------------------------------------------------------------------------ resultados e liberação
const _verdades = new WeakMap(); // item (o objeto que o índice guarda) -> a máscara verdadeira
const _comparacoes = new WeakMap(); // máscara de uma pintura -> {verdade, resultado}

/** A máscara verdadeira de um item dos jogadores ({largura, altura, dados}), conferida uma vez. */
export async function verdadeJogadores(indice, item) {
  const m = await indice.mascara(indice.pasta.mascaraGabarito(item.id));
  if (_verdades.get(item) === m) return m;
  if (m.largura !== item.largura || m.altura !== item.altura) throw new Error(`${item.id}: a máscara não tem o tamanho da imagem`);
  _verdades.set(item, m);
  return m;
}

/**
 * O resultado de um rótulo do gabarito: {acerto, descartada, ...a comparação}. A conta dos jogadores
 * só se refaz quando a pintura ou a verdade mudam (o placar e a página central perguntam de novo a
 * cada atualização).
 */
export async function compararComGabarito(indice, tarefa, arquivo, item) {
  const r = arquivo.dados;
  if (r.situacao === "descartada") return { acerto: false, descartada: true };
  if (tarefa === "pontos") return { ...compararPontos(r.pontos, item), descartada: false };
  const verdade = await verdadeJogadores(indice, item);
  const m = await indice.mascara(`${indice.pasta.rotulos(PARTIDA_GABARITO, "jogadores")}/${r.mascara}`);
  const hit = _comparacoes.get(m);
  if (hit && hit.verdade === verdade) return hit.resultado;
  if (m.largura !== item.largura || m.altura !== item.altura) throw new Error(`${r.mascara}: a máscara não tem o tamanho da imagem`);
  const resultado = { ...compararJogadores(m.dados, verdade.dados, item.largura, item.altura, item.jogadores), descartada: false };
  _comparacoes.set(m, { verdade, resultado });
  return resultado;
}

/** Um número curto do resultado, para tabelas: o erro mediano (pontos) ou a sobreposição (jogadores). */
export function resumo(tarefa, r) {
  if (r.descartada) return "descartou";
  if (tarefa === "pontos") {
    const erro = r.erro_mediano_px === null ? "" : ` · ${r.erro_mediano_px.toFixed(1).replace(".", ",")} px`;
    return `${r.achados} de ${r.visiveis} pontos${erro}${r.errados.length ? ` · ${r.errados.length} errado(s)` : ""}`;
  }
  const n = r.jogadores.filter((j) => !j.pequeno).length;
  return `${n - r.faltaram.length} de ${n} jogadores · ${Math.round(100 * r.iou)}%${r.outras.length ? ` · ${r.outras.length} a mais` : ""}`;
}

/**
 * A última versão de cada item do gabarito da tarefa anotado pela pessoa, comparada com a resposta:
 * [{item, acerto, resultado, arquivo, criado_em}], do mais antigo para o mais novo.
 */
export async function resultados(indice, tarefa, pessoa, itens = null) {
  const porId = new Map((itens ?? (await indice.itensGabarito(tarefa))).map((g) => [g.id, g]));
  const ip = await indice.partida(PARTIDA_GABARITO, tarefa);
  const out = [];
  for (const a of ip.ultimos().values()) {
    if (a.pessoa !== pessoa || !porId.has(a.quadro)) continue;
    let resultado;
    try {
      resultado = await compararComGabarito(indice, tarefa, a, porId.get(a.quadro));
    } catch {
      continue; // a máscara verdadeira (ou a da pintura) ainda não chegou: o item não conta
    }
    out.push({ item: a.quadro, acerto: resultado.acerto, resultado, arquivo: a, criado_em: a.dados.criado_em });
  }
  return out.sort((x, y) => Date.parse(x.criado_em) - Date.parse(y.criado_em));
}

/**
 * Liberado para as imagens reais: acertou K dos últimos N itens da tarefa. Sem gabarito da tarefa,
 * não há bloqueio.
 */
export function liberacao(res, temGabarito, regra) {
  if (!temGabarito) return { liberado: true, n: 0, acertos: 0, motivo: "sem gabarito importado" };
  const ultimos = res.slice(-regra.n);
  const acertos = ultimos.filter((r) => r.acerto).length;
  const liberado = ultimos.length >= regra.n && acertos >= regra.k;
  const falta = ultimos.length < regra.n ? `${ultimos.length} de ${regra.n} feitos, ${acertos} certo(s)` : `${acertos} certos nos últimos ${regra.n}`;
  return {
    liberado,
    n: res.length,
    acertos,
    ultimos: ultimos.length,
    motivo: liberado ? "" : `em treino no gabarito: ${falta} (meta: ${regra.meta})`,
  };
}

/** Quantos resultados vieram antes da liberação (o treino); -1 se ainda não foi liberado. */
export function nTreino(res, regra) {
  for (let k = regra.n; k <= res.length; k++) {
    if (res.slice(k - regra.n, k).filter((r) => r.acerto).length >= regra.k) return k;
  }
  return -1;
}
