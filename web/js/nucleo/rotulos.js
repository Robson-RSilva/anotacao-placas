// Montar, validar e gravar os rótulos das duas tarefas (pontos e jogadores) e as revisões cruzadas.
//
// Nos jogadores, a máscara (PNG) é gravada antes do rótulo: o índice só lê um rótulo depois que a
// máscara dele existe, e, no outro computador, um rótulo que chegou antes da máscara espera por ela.

import { MANUAL, VERSAO, mascaraDe, nomeArquivo } from "./convencoes.js";
import { arredondar } from "./estatistica.js";
import { pendentesRevisao } from "./filas.js";
import { TIPOS_DA_TAREFA, validar } from "./formatos.js";
import { codificarPng } from "./png.js";

/** As cores da máscara dos jogadores: 0 fundo, 1 jogador (só para quem abre o PNG num visualizador). */
export const PALETA_JOGADORES = Object.freeze([[0, 0, 0], [255, 64, 129]]);

/** O rótulo saiu da fila de revisão da pessoa (outra pessoa revisou, ou a fila mudou). */
export class ForaDaFila extends Error {
  constructor() {
    super("este rótulo não está mais na sua fila de revisão");
    this.name = "ForaDaFila";
  }
}

const partiuDe = (p) => ({ fonte: p.fonte, versao: p.versao ?? null, referencia: p.referencia ?? null });

/** Pixels pintados de uma máscara (diferentes de zero). */
export function contarPintados(mascara) {
  let n = 0;
  for (let i = 0; i < mascara.length; i++) if (mascara[i]) n += 1;
  return n;
}

/**
 * Monta e valida um rótulo (sem gravar). `dados` traz partida, quadro, largura, altura, partiu_de,
 * situacao ("ok" ou "descartada"), motivo_descarte, comentario e segundos_ativos; nos pontos, `pontos`
 * ([{ponto, x, y}], px da imagem); nos jogadores, `mascara` (Uint8Array, 1 onde há jogador; null na
 * imagem descartada). `corrige` é opcional. Devolve {nome, rotulo, mascara}.
 */
export function montarRotulo(tarefa, pessoa, dados, { versao, agora = new Date() }) {
  const nome = nomeArquivo(dados.quadro, pessoa, versao);
  const descartada = dados.situacao === "descartada";
  const r = {
    formato: tarefa === "pontos" ? "rotulo.pontos/1" : "rotulo.jogadores/1",
    partida: dados.partida,
    quadro: dados.quadro,
    anotador: pessoa,
    versao,
    ferramenta: VERSAO,
    manual: MANUAL[tarefa],
    criado_em: agora.toISOString(),
    segundos_ativos: arredondar(Math.max(0, dados.segundos_ativos || 0), 1),
    largura: dados.largura,
    altura: dados.altura,
    partiu_de: partiuDe(dados.partiu_de),
    situacao: dados.situacao,
    motivo_descarte: descartada ? dados.motivo_descarte ?? null : null,
    comentario: (dados.comentario || "").trim(),
    corrige: dados.corrige ?? null,
  };
  let mascara = null;
  if (tarefa === "pontos") {
    r.pontos = descartada ? [] : (dados.pontos || []).map((p) => ({ ponto: p.ponto, x: arredondar(p.x, 2), y: arredondar(p.y, 2) }));
  } else {
    mascara = descartada ? null : Uint8Array.from(dados.mascara, (v) => (v ? 1 : 0));
    if (mascara && mascara.length !== dados.largura * dados.altura) throw new Error("a máscara não tem o tamanho da imagem");
    r.mascara = mascara ? mascaraDe(nome) : null;
    r.pixels = mascara ? contarPintados(mascara) : 0;
  }
  return { nome, rotulo: validar(TIPOS_DA_TAREFA[tarefa].rotulo, r), mascara };
}

/** Grava um rótulo novo da pessoa na tarefa (versão seguinte à última dela no quadro). */
export async function salvarRotulo(indice, tarefa, pessoa, dados, { agora = new Date() } = {}) {
  const pasta = indice.pasta;
  const dir = pasta.rotulos(dados.partida, tarefa);
  const versao = await pasta.proximaVersao(dir, dados.quadro, pessoa);
  const { nome, rotulo, mascara } = montarRotulo(tarefa, pessoa, dados, { versao, agora });
  if (mascara) await pasta.escrever(`${dir}/${rotulo.mascara}`, await codificarPng(mascara, rotulo.largura, rotulo.altura, PALETA_JOGADORES));
  await pasta.escreverJson(`${dir}/${nome}`, rotulo);
  return { nome, caminho: `${dir}/${nome}`, rotulo, mascara };
}

function montarRevisao(tarefa, arquivo, pessoa, versao, { decisao, motivo, comentario, segundos_ativos }, nova, agora) {
  return {
    formato: tarefa === "pontos" ? "revisao.pontos/1" : "revisao.jogadores/1",
    partida: arquivo.partida,
    quadro: arquivo.quadro,
    rotulo: arquivo.nome,
    revisor: pessoa,
    versao,
    decisao,
    motivo: decisao === "devolver" ? motivo ?? null : null,
    comentario: (comentario || "").trim(),
    nova_versao: nova,
    ferramenta: VERSAO,
    manual: MANUAL.revisao,
    criado_em: agora.toISOString(),
    segundos_ativos: arredondar(Math.max(0, segundos_ativos || 0), 1),
  };
}

/**
 * Grava a decisão da revisão cruzada sobre `arquivo` (o rótulo revisado). Ao corrigir, grava antes a
 * correção como rótulo novo de quem revisa, apontando o corrigido em `corrige`; `decisao.correcao`
 * traz o que muda (os pontos ou a máscara, a situação, o motivo do descarte e o comentário).
 */
export async function salvarRevisao(indice, tarefa, pessoa, arquivo, decisao, { agora = new Date() } = {}) {
  const pasta = indice.pasta;
  const pendentes = await pendentesRevisao(indice, tarefa, pessoa);
  if (!pendentes.some((p) => p.arquivo.caminho === arquivo.caminho)) throw new ForaDaFila();
  const tipo = TIPOS_DA_TAREFA[tarefa].revisao;
  const dir = pasta.revisoes(arquivo.partida, tarefa);
  const versao = await pasta.proximaVersao(dir, arquivo.quadro, pessoa);
  // valida a decisão antes de gravar qualquer coisa
  validar(tipo, montarRevisao(tarefa, arquivo, pessoa, versao, decisao, decisao.decisao === "corrigir" ? "pendente" : null, agora));
  let nova = null;
  if (decisao.decisao === "corrigir") {
    const c = decisao.correcao;
    if (!c) throw new Error("a correção precisa do rótulo corrigido");
    const r = arquivo.dados;
    const { nome } = await salvarRotulo(
      indice,
      tarefa,
      pessoa,
      {
        ...c,
        partida: r.partida,
        quadro: r.quadro,
        largura: r.largura,
        altura: r.altura,
        partiu_de: { fonte: "rotulo_revisado", referencia: arquivo.nome },
        corrige: arquivo.nome,
      },
      { agora },
    );
    nova = nome;
  }
  const rev = validar(tipo, montarRevisao(tarefa, arquivo, pessoa, versao, decisao, nova, agora));
  const nome = nomeArquivo(arquivo.quadro, pessoa, versao);
  await pasta.escreverJson(`${dir}/${nome}`, rev);
  return { nome, caminho: `${dir}/${nome}`, revisao: rev, correcao: nova };
}
