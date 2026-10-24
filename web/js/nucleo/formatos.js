// Formatos dos arquivos — os mesmos de src/anotacao/formatos.py. A estrutura vem dos JSON Schemas
// gerados pelo Python (web/esquemas/); as regras entre campos (os `model_validator`) estão aqui.

import { construirCampo, erroNasMedidas } from "./campo.js";
import { ladoCanonico } from "./camera.js";
import { RE_GABARITO, RE_PARTIDA, RE_QUADRO } from "./convencoes.js";
import { validarEsquema } from "./esquema.js";

/** Tipo de arquivo -> nome do esquema. */
export const ESQUEMAS = Object.freeze({
  projeto: "projeto.json",
  pacote: "pacote.estadio.json",
  equipe: "equipe.json",
  divisao: "divisao.json",
  manifesto: "manifesto.partida.json",
  tomadas: "tomadas.partida.json",
  fila: "fila.partida.json",
  previsao: "previsao.camera.json",
  rotulo: "rotulo.camera.json",
  revisao: "revisao.camera.json",
  gabarito: "gabarito.camera.json",
  dispositivo: "pessoa.dispositivo.json",
});

export const SITUACOES = Object.freeze(["ok", "sem_marcacoes", "impossivel_transicao", "impossivel_borrao", "duvida"]);
export const SEM_CAMERA = Object.freeze(["sem_marcacoes", "impossivel_transicao", "impossivel_borrao"]);
export const MOTIVOS = Object.freeze([
  "lado_trocado",
  "molde_fora_da_tolerancia",
  "ponto_em_marca_coberta",
  "deveria_ser_sem_marcacoes",
  "outro",
]);

const CAMPO_PADRAO = construirCampo(105, 68);
export const NOMES_PONTOS = new Set(CAMPO_PADRAO.pontos.map((p) => p.nome));
export const NOMES_ELEMENTOS = new Set(CAMPO_PADRAO.elementos.map((e) => e.nome));

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

const REGRAS = {
  pacote(o) {
    const e = [];
    if (!unicos(o.placas.map((p) => p.id))) e.push("IDs de placa repetidos");
    if (!unicos(o.cameras.map((c) => c.nome))) e.push("nomes de câmera repetidos");
    return e;
  },
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
  rotulo(o) {
    const e = [];
    if (!(RE_PARTIDA.test(o.partida) || o.partida === "gabarito")) e.push("partida inválida");
    if (!(RE_QUADRO.test(o.quadro) || RE_GABARITO.test(o.quadro))) e.push("quadro inválido");
    if (o.situacao === "ok" && o.camera === null) e.push("situação 'ok' exige a câmera");
    if (SEM_CAMERA.includes(o.situacao) && o.camera !== null) e.push(`situação '${o.situacao}' não leva câmera`);
    if (o.situacao === "duvida" && !o.comentario.trim()) e.push("'dúvida' exige comentário");
    if (o.camera !== null) {
      const esperado = ladoCanonico(o.camera.C) ? "canonico" : "espelhado";
      if (o.lado !== esperado) e.push(`lado deveria ser '${esperado}' para esta câmera`);
    } else if (o.lado !== null) {
      e.push("lado só existe com câmera");
    }
    for (const p of o.pontos_travados) if (!NOMES_PONTOS.has(p.ponto)) e.push(`ponto-chave desconhecido: ${p.ponto}`);
    for (const l of o.linhas_travadas) if (!NOMES_ELEMENTOS.has(l.elemento)) e.push(`elemento desconhecido: ${l.elemento}`);
    return e;
  },
  gabarito(o) {
    const c = o.campo;
    return c && erroNasMedidas(c.comprimento, c.largura)
      ? ["medidas do campo fora do que a página aceita: comprimento de 90 a 120 m, largura de 45 a 90 m e mais comprido que largo"]
      : [];
  },
  revisao(o) {
    const e = [];
    if ((o.decisao === "devolver") !== (o.motivo !== null)) e.push("motivo é obrigatório ao devolver, e só ao devolver");
    if ((o.decisao === "corrigir") !== (o.nova_versao !== null)) {
      e.push("nova_versao é obrigatória ao corrigir, e só ao corrigir");
    }
    if (o.motivo === "outro" && !o.comentario.trim()) e.push("motivo 'outro' exige comentário");
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
