// Montar, validar e gravar as pinturas da oclusão nas placas e as revisões cruzadas delas.
//
// A máscara (PNG) é gravada antes do rótulo: o índice só lê um rótulo depois que a máscara dele
// existe, e, no outro computador, um rótulo que chegou antes da máscara espera por ela.

import { Camera } from "./camera.js";
import { MANUAL, VERSAO, mascaraDe, nomeArquivo } from "./convencoes.js";
import { arredondar } from "./estatistica.js";
import { pendentesRevisaoOclusao } from "./filas-oclusao.js";
import { validar } from "./formatos.js";
import { PALETA, estatisticas, geometria, mascaraEfetiva } from "./oclusao.js";
import { codificarPng } from "./png.js";
import { ForaDaFila } from "./rotulos.js";

const COM_MASCARA = new Set(["ok", "duvida"]);

function cameraDoRotulo(c) {
  return { hfov_graus: c.hfov_graus, pan: c.pan, tilt: c.tilt, roll: c.roll, C: [Number(c.C[0]), Number(c.C[1]), Number(c.C[2])], k1: c.k1 ?? 0 };
}

const faixasDoRotulo = (f) => (f
  ? Object.fromEntries(["laterais", "fundos"].map((k) => [k, {
    distancia: arredondar(Number(f[k].distancia), 2),
    altura: arredondar(Number(f[k].altura), 2),
    comprimento: f[k].comprimento === null || f[k].comprimento === undefined ? null : arredondar(Number(f[k].comprimento), 2),
    vao: arredondar(Number(f[k].vao ?? 0), 2),
    ligada: Boolean(f[k].ligada),
  }]))
  : null);

/**
 * Monta e valida uma pintura (sem gravar): o rótulo e, quando há, a máscara que se grava ao lado.
 * `dados` traz partida, quadro, pacote, largura, altura, camera, camera_de, campo, placas_de,
 * faixas, placas3d (as placas que a câmera desenha), partiu_de, pintura (Uint8Array, a classe
 * pintada em cada pixel; null sem máscara), situacao, comentario e segundos_ativos; `corrige` é
 * opcional. A máscara e o que ela diz de cada placa saem da pintura e da geometria, aqui.
 */
export function montarRotuloOclusao(pessoa, dados, { versao, agora = new Date() }) {
  const nome = nomeArquivo(dados.quadro, pessoa, versao);
  const comMascara = COM_MASCARA.has(dados.situacao) && dados.pintura !== null && dados.pintura !== undefined;
  let mascara = null;
  let placas = [];
  if (comMascara) {
    const cam = Camera.deRotulo(dados.camera, dados.largura, dados.altura);
    const geo = geometria(cam, dados.placas3d, dados.largura, dados.altura);
    mascara = mascaraEfetiva(dados.pintura, geo.roi);
    placas = estatisticas(mascara, geo);
  }
  const r = {
    formato: "rotulo.oclusao/1",
    partida: dados.partida,
    pacote: dados.pacote,
    quadro: dados.quadro,
    anotador: pessoa,
    versao,
    ferramenta: VERSAO,
    manual: MANUAL.oclusao,
    criado_em: agora.toISOString(),
    segundos_ativos: arredondar(Math.max(0, dados.segundos_ativos || 0), 1),
    largura: dados.largura,
    altura: dados.altura,
    camera_de: dados.camera_de ?? null,
    camera: cameraDoRotulo(dados.camera),
    campo: dados.campo ? { comprimento: arredondar(Number(dados.campo.comprimento), 1), largura: arredondar(Number(dados.campo.largura), 1) } : null,
    placas_de: dados.placas_de,
    faixas: dados.placas_de === "faixas" ? faixasDoRotulo(dados.faixas) : null,
    partiu_de: { fonte: dados.partiu_de.fonte, versao: dados.partiu_de.versao ?? null, referencia: dados.partiu_de.referencia ?? null },
    mascara: comMascara ? mascaraDe(nome) : null,
    placas,
    situacao: dados.situacao,
    comentario: (dados.comentario || "").trim(),
    corrige: dados.corrige ?? null,
  };
  return { nome, rotulo: validar("rotulo_oclusao", r), mascara };
}

/** Grava uma pintura nova da pessoa (versão seguinte à última dela no quadro): a máscara e o rótulo. */
export async function salvarRotuloOclusao(indice, pessoa, dados, { agora = new Date() } = {}) {
  const pasta = indice.pasta;
  const dir = pasta.rotulos(dados.partida, "oclusao");
  const versao = await pasta.proximaVersao(dir, dados.quadro, pessoa);
  const { nome, rotulo, mascara } = montarRotuloOclusao(pessoa, dados, { versao, agora });
  if (mascara) await pasta.escrever(`${dir}/${rotulo.mascara}`, await codificarPng(mascara, rotulo.largura, rotulo.altura, PALETA));
  await pasta.escreverJson(`${dir}/${nome}`, rotulo);
  return { nome, caminho: `${dir}/${nome}`, rotulo, mascara };
}

function montarRevisao(arquivo, pessoa, versao, { decisao, motivo, comentario, segundos_ativos }, nova, agora) {
  return {
    formato: "revisao.oclusao/1",
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
 * Grava a decisão da revisão cruzada sobre a pintura `arquivo`. Ao corrigir, grava antes a correção
 * como pintura nova de quem revisa, apontando a corrigida em `corrige`; `decisao.correcao` traz a
 * pintura, as faixas, a situação e o comentário (a câmera e as placas continuam as do rótulo).
 */
export async function salvarRevisaoOclusao(indice, pessoa, arquivo, decisao, { agora = new Date() } = {}) {
  const pasta = indice.pasta;
  const pendentes = await pendentesRevisaoOclusao(indice, pessoa);
  if (!pendentes.some((p) => p.arquivo.caminho === arquivo.caminho)) throw new ForaDaFila();
  const dir = pasta.revisoes(arquivo.partida, "oclusao");
  const versao = await pasta.proximaVersao(dir, arquivo.quadro, pessoa);
  validar("revisao_oclusao", montarRevisao(arquivo, pessoa, versao, decisao, decisao.decisao === "corrigir" ? "pendente" : null, agora));
  let nova = null;
  if (decisao.decisao === "corrigir") {
    const c = decisao.correcao;
    if (!c) throw new Error("a correção precisa da pintura corrigida");
    const r = arquivo.dados;
    const { nome } = await salvarRotuloOclusao(
      indice,
      pessoa,
      {
        partida: r.partida,
        quadro: r.quadro,
        pacote: r.pacote,
        largura: r.largura,
        altura: r.altura,
        camera: r.camera,
        camera_de: r.camera_de,
        campo: r.campo,
        placas_de: r.placas_de,
        faixas: c.faixas ?? r.faixas,
        placas3d: c.placas3d,
        partiu_de: { fonte: "rotulo_revisado", referencia: arquivo.nome },
        pintura: c.pintura,
        situacao: c.situacao,
        comentario: c.comentario,
        segundos_ativos: c.segundos_ativos,
        corrige: arquivo.nome,
      },
      { agora },
    );
    nova = nome;
  }
  const rev = validar("revisao_oclusao", montarRevisao(arquivo, pessoa, versao, decisao, nova, agora));
  const nome = nomeArquivo(arquivo.quadro, pessoa, versao);
  await pasta.escreverJson(`${dir}/${nome}`, rev);
  return { nome, caminho: `${dir}/${nome}`, revisao: rev, correcao: nova };
}
