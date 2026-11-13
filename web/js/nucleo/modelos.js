// Os modelos da pasta da equipe (`modelos/<nome>/`). Cada um é a pasta que o laboratório (exposicao-treino,
// a partir da 0.7.0) exporta: o cartão do modelo (`cartao.json`), a rede em ONNX (`detector.onnx`) e o resto,
// que a página não usa (os pesos do PyTorch, o `modelo.py`, o `CARTAO.md`). Os modelos nunca vão para o
// repositório da página, que é público: chegam pela pasta da equipe, copiados por quem treina — uma vez por
// modelo, não por partida (ADR-0017).
//
// Quando há mais de um, vale o mais novo (pelo `criado_em` do cartão) que a página consegue usar.

import { PONTOS_MARCAVEIS } from "./campo.js";

/** A pasta dos modelos, na raiz da pasta da equipe. */
export const PASTA_MODELOS = "modelos";
/** A pasta de um modelo em `modelos/` (o nome que o laboratório deu na exportação, como detector-v1). */
export const RE_MODELO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Um arquivo da pasta do modelo (o ONNX, o cartão). */
export const RE_ARQUIVO_MODELO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RE_SHA256 = /^[0-9a-f]{64}$/;

/** O que impede a página de rodar o modelo do cartão ([] quando dá). */
export function conferirCartao(c) {
  if (c?.formato !== "cartao-do-modelo/1") return ["não é o cartão de um modelo exportado pelo exposicao-treino (cartao-do-modelo/1)"];
  const e = [];
  const arq = c.arquivos ?? {};
  if (typeof arq.onnx !== "string" || !RE_ARQUIVO_MODELO.test(arq.onnx) || !arq.onnx.endsWith(".onnx")) {
    e.push("o modelo não tem o detector.onnx (o laboratório exporta o ONNX a partir da 0.7.0: exporte de novo)");
  } else if (typeof arq.sha256_onnx !== "string" || !RE_SHA256.test(arq.sha256_onnx)) {
    e.push("o cartão não tem o sha256 do ONNX");
  }
  if (typeof c.nome !== "string" || !c.nome.trim()) e.push("o cartão não tem o nome do modelo");
  if (Number.isNaN(Date.parse(c.criado_em))) e.push("o cartão não tem a data do modelo (criado_em)");
  const k = c.contrato ?? {};
  const forma = k.onnx?.entrada?.forma;
  if (!Array.isArray(forma) || forma.length !== 4 || forma[0] !== 1 || forma[1] !== 3 || !forma.every((v) => Number.isInteger(v) && v > 0)) {
    e.push("a entrada do ONNX não é (1, 3, altura, largura)");
  }
  if (typeof k.onnx?.entrada?.nome !== "string") e.push("o cartão não tem o nome da entrada do ONNX");
  const nomes = k.saidas?.kp?.nomes;
  if (!Array.isArray(nomes) || !nomes.length) e.push("o cartão não tem os nomes dos canais dos pontos");
  if (!(k.saidas?.passo > 0)) e.push("o cartão não tem o passo da saída");
  if (!(k.decodificacao?.nms_celulas >= 0)) e.push("o cartão não tem o raio da supressão (nms_celulas)");
  const marcaveis = k.nomes?.marcaveis;
  if (!Array.isArray(marcaveis)) {
    e.push("o cartão não tem os pontos que se marcam");
  } else {
    const desconhecidos = marcaveis.filter((n) => !PONTOS_MARCAVEIS.includes(n));
    if (desconhecidos.length) e.push(`o modelo marca pontos que esta versão da página não conhece: ${desconhecidos.join(", ")}`);
  }
  return e;
}

/** A versão do modelo nas previsões: os 12 primeiros caracteres do sha256 do ONNX. */
export const versaoDoModelo = (cartao) => cartao.arquivos.sha256_onnx.slice(0, 12);

/** O identificador do modelo no manifesto e no rótulo (`partiu_de.versao`): `<nome>@<versão>`. */
export const idDoModelo = (cartao) => `${cartao.nome}@${versaoDoModelo(cartao)}`;

/**
 * Os modelos da pasta, do mais novo para o mais velho (os que não dão para usar por último):
 * [{nome (a pasta), cartao, erro}] — `erro` diz por que a página não consegue usar aquele.
 */
export async function listarModelos(pasta) {
  const out = [];
  for (const item of await pasta.listar(PASTA_MODELOS)) {
    if (item.tipo !== "pasta" || !RE_MODELO.test(item.nome)) continue;
    let cartao = null;
    let erro = null;
    try {
      cartao = await pasta.lerJson(pasta.cartaoModelo(item.nome));
      const erros = conferirCartao(cartao);
      if (erros.length) erro = erros.join("; ");
      else if (!(await pasta.existe(pasta.arquivoModelo(item.nome, cartao.arquivos.onnx)))) erro = `falta o ${cartao.arquivos.onnx}`;
    } catch (e) {
      erro = e?.name === "NotFoundError" ? "falta o cartao.json" : e?.message || String(e);
    }
    out.push({ nome: item.nome, cartao, erro });
  }
  const quando = (m) => (m.erro ? -Infinity : Date.parse(m.cartao.criado_em));
  return out.sort((a, b) => quando(b) - quando(a) || (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
}

/** O modelo que a página usa: o mais novo que dá para usar, ou null. */
export async function modeloEmUso(pasta) {
  return (await listarModelos(pasta)).find((m) => !m.erro) ?? null;
}

/**
 * Se o quadro da fila começa da previsão de um modelo: os "sem previsão" (a comparação do tempo e das
 * correções) e os da dupla às cegas (a concordância entre duas pessoas que anotaram do zero) ficam do zero.
 */
export const pedePrevisao = (item) => !item.sem_previsao && !item.dupla;
