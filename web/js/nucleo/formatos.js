// Formatos dos arquivos — os mesmos de src/anotacao/formatos.py. A estrutura vem dos JSON Schemas
// gerados pelo Python (web/esquemas/); as regras entre campos (os `model_validator`) estão aqui.

import { PONTOS_MARCAVEIS } from "./campo.js";
import { RE_GABARITO, RE_MASCARA, RE_PARTIDA, RE_QUADRO, RE_RECORTE } from "./convencoes.js";
import { validarEsquema } from "./esquema.js";

/** Tipo de arquivo -> nome do esquema. */
export const ESQUEMAS = Object.freeze({
  projeto: "projeto.json",
  equipe: "equipe.json",
  divisao: "divisao.json",
  manifesto: "manifesto.partida.json",
  tomadas: "tomadas.partida.json",
  fila: "fila.partida.json",
  dispositivo: "pessoa.dispositivo.json",
  rotulo_pontos: "rotulo.pontos.json",
  revisao_pontos: "revisao.pontos.json",
  gabarito_pontos: "gabarito.pontos.json",
  previsao_pontos: "previsao.pontos.json",
  lote_recortes: "recortes.lote.json",
  rotulo_placas: "rotulo.placas.json",
  revisao_placas: "revisao.placas.json",
  gabarito_placas: "gabarito.placas.json",
});

/**
 * Tipos de arquivo de cada tarefa: o rótulo, a revisão e o item do gabarito (e o formato dele); `campo`
 * é o campo do item no rótulo e na revisão (o quadro nos pontos, o recorte nas placas).
 */
export const TIPOS_DA_TAREFA = Object.freeze({
  pontos: Object.freeze({ rotulo: "rotulo_pontos", revisao: "revisao_pontos", gabarito: "gabarito_pontos", formatoGabarito: "gabarito.pontos/1", campo: "quadro" }),
  placas: Object.freeze({ rotulo: "rotulo_placas", revisao: "revisao_placas", gabarito: "gabarito_placas", formatoGabarito: "gabarito.placas/1", campo: "recorte" }),
});

/** O tipo de um item do gabarito pelo formato dentro dele (null: de uma versão anterior). */
export function tipoDoItem(obj) {
  for (const [tarefa, t] of Object.entries(TIPOS_DA_TAREFA)) if (obj?.formato === t.formatoGabarito) return { tarefa, tipo: t.gabarito };
  return null;
}

/** Motivos de devolução na revisão, com o texto das páginas. */
export const MOTIVOS = Object.freeze({
  pontos: Object.freeze({
    ponto_fora_do_lugar: "Ponto fora do lugar (mais de 2 px)",
    nome_trocado: "Ponto com o nome trocado",
    faltou_ponto: "Faltou marcar ponto que aparece",
    ponto_que_nao_se_ve: "Ponto marcado onde não dá para ver",
    descarte_errado: "Descarte errado (dava para anotar, ou devia descartar)",
    outro: "Outro (com comentário)",
  }),
  placas: Object.freeze({
    faltou_pintar: "Faltou pintar algo na frente da placa (gente, bola, trave, grafismo…)",
    contorno_impreciso: "Contorno impreciso (mais de 1 px)",
    pintou_o_que_nao_cobre: "Pintou o que não cobre a placa (o anúncio, sombra, reflexo, a rede)",
    descarte_errado: "Descarte errado (dava para pintar, ou o recorte não estava na placa)",
    outro: "Outro (com comentário)",
  }),
});

const NOMES_PONTOS = new Set(PONTOS_MARCAVEIS);

export class ErroFormato extends Error {
  constructor(tipo, erros) {
    super(`${tipo}: ${erros.join("; ")}`);
    this.name = "ErroFormato";
    this.tipo = tipo;
    this.erros = erros;
  }
}

let esquemas = null;

/** Carrega os esquemas: no navegador, de web/esquemas/; nos testes, por `ler(nome)`. */
export async function carregarEsquemas(ler = null) {
  const leitor = ler ?? (async (nome) => {
    const r = await fetch(new URL(`../../esquemas/${nome}`, import.meta.url));
    if (!r.ok) throw new Error(`não consegui carregar o esquema ${nome}`);
    return r.json();
  });
  const pares = await Promise.all(Object.entries(ESQUEMAS).map(async ([tipo, nome]) => [tipo, await leitor(nome)]));
  esquemas = Object.fromEntries(pares);
  return esquemas;
}

export function esquemasCarregados() {
  return esquemas !== null;
}

function unicos(lista) {
  return new Set(lista).size === lista.length;
}

function partidaEItem(o, e, campo, regex, oque) {
  if (!(RE_PARTIDA.test(o.partida) || o.partida === "gabarito")) e.push("partida inválida");
  if (!(regex.test(o[campo]) || RE_GABARITO.test(o[campo]))) e.push(`${oque} inválido`);
}

/** A área de um polígono (fórmula do laço), em px². */
export function areaPoligono(pol) {
  let a = 0;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) a += pol[j][0] * pol[i][1] - pol[i][0] * pol[j][1];
  return Math.abs(a) / 2;
}

function regiaoCoerente(regiao, largura, altura, e, onde = "") {
  if (regiao.some(([x, y]) => !(x >= 0 && x <= largura && y >= 0 && y <= altura))) e.push(`${onde}a região da placa sai do recorte`);
  if (areaPoligono(regiao) < 1) e.push(`${onde}a região da placa não tem área`);
}

function situacao(o, e) {
  if ((o.situacao === "descartada") !== (o.motivo_descarte !== null)) e.push("o motivo do descarte vem sempre, e só, com a imagem descartada");
  if (o.motivo_descarte === "outro" && !o.comentario.trim()) e.push("descarte por 'outro' motivo exige comentário");
}

function pontosCoerentes(pontos, largura, altura, e) {
  for (const p of pontos) if (!NOMES_PONTOS.has(p.ponto)) e.push(`ponto desconhecido: ${p.ponto}`);
  if (!unicos(pontos.map((p) => p.ponto))) e.push("ponto marcado duas vezes");
  for (const p of pontos) if (!(p.x >= 0 && p.x <= largura && p.y >= 0 && p.y <= altura)) e.push(`o ponto ${p.ponto} está fora da imagem`);
}

function revisao(o) {
  const e = [];
  if ((o.decisao === "devolver") !== (o.motivo !== null)) e.push("motivo é obrigatório ao devolver, e só ao devolver");
  if ((o.decisao === "corrigir") !== (o.nova_versao !== null)) e.push("nova_versao é obrigatória ao corrigir, e só ao corrigir");
  if (o.motivo === "outro" && !o.comentario.trim()) e.push("motivo 'outro' exige comentário");
  return e;
}

const REGRAS = {
  equipe(o) {
    return unicos(o.membros.map((m) => m.codigo)) ? [] : ["códigos repetidos na equipe"];
  },
  divisao(o) {
    const vistos = new Set();
    for (const nome of ["validacao", "teste_congelado", "teste_externo"]) {
      for (const p of o[nome]) {
        if (vistos.has(p)) return [`partida em mais de um conjunto: ${p}`];
        vistos.add(p);
      }
    }
    return [];
  },
  rotulo_pontos(o) {
    const e = [];
    partidaEItem(o, e, "quadro", RE_QUADRO, "quadro");
    situacao(o, e);
    if (o.situacao === "descartada" && o.pontos.length) e.push("imagem descartada não leva pontos");
    pontosCoerentes(o.pontos, o.largura, o.altura, e);
    return e;
  },
  revisao_pontos: revisao,
  gabarito_pontos(o) {
    const e = [];
    pontosCoerentes(o.pontos, o.largura, o.altura, e);
    return e;
  },
  previsao_pontos(o) {
    const e = [];
    for (const p of o.pontos) if (!NOMES_PONTOS.has(p.ponto)) e.push(`ponto desconhecido: ${p.ponto}`);
    if (!unicos(o.pontos.map((p) => p.ponto))) e.push("ponto previsto duas vezes");
    return e;
  },
  lote_recortes(o) {
    const e = [];
    o.itens.forEach((it, k) => regiaoCoerente(it.regiao, it.largura, it.altura, e, `itens.${k}: `));
    if (!unicos(o.itens.map((it) => it.recorte))) e.push("recorte repetido no lote");
    return e;
  },
  rotulo_placas(o) {
    const e = [];
    partidaEItem(o, e, "recorte", RE_RECORTE, "recorte");
    situacao(o, e);
    if (o.mascara !== null && !RE_MASCARA.test(o.mascara)) e.push("nome da máscara inválido");
    if ((o.situacao === "ok") !== (o.mascara !== null)) e.push("a máscara vem sempre, e só, com o recorte pintado (não descartado)");
    if (o.mascara === null && o.pixels) e.push("pixels pintados só com a máscara");
    if (o.pixels > o.largura * o.altura) e.push("mais pixels pintados que o recorte tem");
    return e;
  },
  revisao_placas: revisao,
  gabarito_placas(o) {
    const e = [];
    regiaoCoerente(o.regiao, o.largura, o.altura, e);
    if ((o.resposta === "descartar") !== (o.mascara === null)) e.push("a máscara vem sempre, e só, quando a resposta é pintar");
    if (o.resposta === "descartar" && o.oclusores) e.push("um item para descartar não tem o que pintar");
    return e;
  },
};

/**
 * Valida um objeto do tipo dado (estrutura e regras). Devolve o próprio objeto, com os padrões
 * preenchidos, ou lança ErroFormato.
 */
export function validar(tipo, obj) {
  if (!esquemas) throw new Error("os esquemas ainda não foram carregados");
  const esquema = esquemas[tipo];
  if (!esquema) throw new Error(`tipo de arquivo desconhecido: ${tipo}`);
  const erros = validarEsquema(esquema, obj);
  if (!erros.length && REGRAS[tipo]) erros.push(...REGRAS[tipo](obj));
  if (erros.length) throw new ErroFormato(tipo, erros);
  return obj;
}

/** Igual a `validar`, mas devolve a lista de erros em vez de lançar. */
export function conferir(tipo, obj) {
  try {
    validar(tipo, obj);
    return [];
  } catch (e) {
    if (e instanceof ErroFormato) return e.erros;
    throw e;
  }
}

/** Conjunto de uma partida segundo a divisão (o que não está lá é treino). */
export function conjuntoDe(divisao, partida) {
  for (const nome of ["validacao", "teste_congelado", "teste_externo"]) {
    if ((divisao[nome] || []).includes(partida)) return nome;
  }
  return "treino";
}

/** Códigos com um papel na equipe, em ordem. */
export function comPapel(equipe, papel) {
  return equipe.membros.filter((m) => m.papeis.includes(papel)).map((m) => m.codigo).sort();
}
