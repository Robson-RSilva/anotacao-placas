// Montar, validar e gravar os rótulos de câmera e as revisões cruzadas.

import { residuoMediano } from "./avaliacao.js";
import { ladoCanonico } from "./camera.js";
import { Molde } from "./campo.js";
import { MANUAL, VERSAO, nomeArquivo } from "./convencoes.js";
import { arredondar } from "./estatistica.js";
import { pendentesRevisao } from "./filas.js";
import { validar } from "./formatos.js";

/** O rótulo saiu da fila de revisão da pessoa (outra pessoa revisou, ou a fila mudou). */
export class ForaDaFila extends Error {
  constructor() {
    super("este rótulo não está mais na sua fila de revisão");
    this.name = "ForaDaFila";
  }
}

function cameraDoRotulo(c) {
  return {
    hfov_graus: c.hfov_graus,
    pan: c.pan,
    tilt: c.tilt,
    roll: c.roll,
    C: [Number(c.C[0]), Number(c.C[1]), Number(c.C[2])],
    k1: c.k1 ?? 0,
  };
}

function partiuDe(p) {
  return { fonte: p.fonte, versao: p.versao ?? null, referencia: p.referencia ?? null };
}

const campoDoRotulo = (c) => (c ? { comprimento: arredondar(Number(c.comprimento), 1), largura: arredondar(Number(c.largura), 1) } : null);

/**
 * Monta e valida um rótulo de câmera (sem gravar). `dados` traz partida, quadro, pacote, largura,
 * altura, partiu_de, campo (as medidas do molde), camera, pontos_travados, linhas_travadas,
 * situacao, comentario e segundos_ativos; `versao` e `corrige` são opcionais.
 */
export async function montarRotulo(indice, pessoa, dados, { versao, agora = new Date() } = {}) {
  const camera = dados.camera ? cameraDoRotulo(dados.camera) : null;
  const r = {
    formato: "rotulo.camera/1",
    partida: dados.partida,
    pacote: dados.pacote,
    quadro: dados.quadro,
    anotador: pessoa,
    versao,
    ferramenta: VERSAO,
    manual: MANUAL.camera,
    criado_em: agora.toISOString(),
    segundos_ativos: arredondar(Math.max(0, dados.segundos_ativos || 0), 1),
    partiu_de: partiuDe(dados.partiu_de),
    campo: campoDoRotulo(dados.campo),
    camera,
    lado: camera ? (ladoCanonico(camera.C) ? "canonico" : "espelhado") : null,
    pontos_travados: camera ? (dados.pontos_travados || []).map((p) => ({ ponto: p.ponto, x: p.x, y: p.y })) : [],
    linhas_travadas: camera ? (dados.linhas_travadas || []).map((p) => ({ elemento: p.elemento, x: p.x, y: p.y })) : [],
    situacao: dados.situacao,
    comentario: (dados.comentario || "").trim(),
    residuo_mediano_px: null,
    corrige: dados.corrige ?? null,
  };
  if (camera) {
    const pacote = await indice.pacote(dados.pacote);
    const res = residuoMediano(r, Molde.doRotulo(r, pacote), dados.largura, dados.altura);
    r.residuo_mediano_px = res === null ? null : arredondar(res, 3);
  }
  return validar("rotulo", r);
}

/** Grava um rótulo novo da pessoa (versão seguinte à última dela neste quadro). */
export async function salvarRotulo(indice, pessoa, dados, { agora = new Date() } = {}) {
  const pasta = indice.pasta;
  const dir = pasta.rotulos(dados.partida);
  const versao = await pasta.proximaVersao(dir, dados.quadro, pessoa);
  const rotulo = await montarRotulo(indice, pessoa, dados, { versao, agora });
  const nome = nomeArquivo(dados.quadro, pessoa, versao);
  await pasta.escreverJson(`${dir}/${nome}`, rotulo);
  return { nome, caminho: `${dir}/${nome}`, rotulo };
}

function montarRevisao(arquivo, pessoa, versao, { decisao, motivo, comentario, segundos_ativos }, nova, agora) {
  return {
    formato: "revisao.camera/1",
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
 * correção como rótulo novo da pessoa que revisa, apontando o rótulo corrigido em `corrige`.
 */
export async function salvarRevisao(indice, pessoa, arquivo, decisao, { agora = new Date() } = {}) {
  const pasta = indice.pasta;
  const pendentes = await pendentesRevisao(indice, pessoa);
  if (!pendentes.some((p) => p.arquivo.caminho === arquivo.caminho)) throw new ForaDaFila();
  const dir = pasta.revisoes(arquivo.partida);
  const versao = await pasta.proximaVersao(dir, arquivo.quadro, pessoa);
  // valida a decisão antes de gravar qualquer coisa
  validar("revisao", montarRevisao(arquivo, pessoa, versao, decisao, decisao.decisao === "corrigir" ? "pendente" : null, agora));
  let nova = null;
  if (decisao.decisao === "corrigir") {
    if (!decisao.correcao) throw new Error("a correção precisa da câmera corrigida");
    const man = await indice.manifesto(arquivo.partida);
    const r = await salvarRotulo(
      indice,
      pessoa,
      {
        ...decisao.correcao,
        partida: arquivo.partida,
        quadro: arquivo.quadro,
        pacote: man.pacote,
        largura: man.video.largura,
        altura: man.video.altura,
        partiu_de: { fonte: "rotulo_revisado", referencia: arquivo.nome },
        corrige: arquivo.nome,
      },
      { agora },
    );
    nova = r.nome;
  }
  const rev = validar("revisao", montarRevisao(arquivo, pessoa, versao, decisao, nova, agora));
  const nome = nomeArquivo(arquivo.quadro, pessoa, versao);
  await pasta.escreverJson(`${dir}/${nome}`, rev);
  return { nome, caminho: `${dir}/${nome}`, revisao: rev, correcao: nova };
}
