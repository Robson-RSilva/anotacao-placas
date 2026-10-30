// Filas: o que cada pessoa faz a seguir, em cada tarefa (pontos e pessoas). Tudo sai dos arquivos e
// dá o mesmo em qualquer máquina. Não há equipe cadastrada: quem anota se identifica por um código
// (as iniciais, por exemplo).
//
// Anotar (fila aberta, a mesma regra nas duas tarefas)
//   1. quem ainda não foi liberado anota o gabarito da tarefa, com o resultado na hora (treino);
//   2. depois, um rótulo devolvido na revisão volta primeiro, como versão nova;
//   3. depois, o próximo quadro sorteado que ainda não tem rótulo — ou, nos quadros em dupla às
//      cegas, que ainda não tem rótulos de duas pessoas. Cada pessoa percorre cada partida a partir
//      de um ponto próprio, para duas pessoas trabalhando ao mesmo tempo raramente pegarem o mesmo
//      quadro (se pegarem, o quadro fica com dois rótulos, o que não estraga nada);
//   4. a cada 15 rótulos, um item do gabarito entra escondido na fila.
//
// Revisão cruzada às cegas (fila aberta)
//   Qualquer pessoa revisa os rótulos das outras, sem saber de quem são. Um quadro em dupla só vai
//   para a revisão depois dos dois rótulos: quem revisasse antes poderia ser a segunda pessoa a
//   anotá-lo e veria a resposta. Correções feitas na revisão não voltam para a fila.
//
// Filas de partidas importadas pela 0.2 têm quadros atribuídos a pessoas (`atribuido_a`): esses
// continuam só com quem os recebeu.

import { Aleatorio } from "./aleatorio.js";
import { PARTIDA_GABARITO } from "./convencoes.js";
import { REGRA, liberacao, nTreino, resultados } from "./gabarito.js";
import { sha256Hex } from "./hash.js";

export const INTERVALO_GABARITO = 15;

const ms = (iso) => Date.parse(iso);

/** Os itens a partir de um ponto próprio da pessoa (o mesmo sempre, diferente entre as pessoas). */
export function emOrdemDaPessoa(itens, pessoa, partida) {
  if (itens.length < 2) return itens;
  const k = Number(BigInt(`0x${sha256Hex(`${pessoa}|${partida}`).slice(0, 12)}`) % BigInt(itens.length));
  return [...itens.slice(k), ...itens.slice(0, k)];
}

/** Pessoas com rótulo próprio no quadro (sem contar as correções feitas na revisão). */
export function quemAnotou(ip, quadro) {
  return new Set(ip.rotulos.filter((a) => a.quadro === quadro && a.dados.corrige === null).map((a) => a.pessoa));
}

/** Quantas pessoas precisam anotar o quadro: duas na dupla às cegas, uma nos outros. */
export const precisam = (item) => (item.dupla ? 2 : 1);

/**
 * O rótulo aprovado do quadro (o aprovado primeiro na revisão, ou a correção de quem revisou), ou
 * null — a regra do `unificar`.
 */
export function rotuloAprovado(ip, quadro) {
  const candidatos = ip.rotulos
    .filter((a) => a.quadro === quadro)
    .sort((x, y) => (x.pessoa < y.pessoa ? -1 : x.pessoa > y.pessoa ? 1 : x.versao - y.versao));
  let melhor = null;
  for (const a of candidatos) {
    let quando;
    if (a.dados.corrige !== null) {
      quando = ms(a.dados.criado_em);
    } else {
      const rev = ip.ultimaRevisao(a.nome);
      if (rev?.decisao !== "aprovar") continue;
      quando = ms(rev.criado_em);
    }
    if (!melhor || quando < melhor.quando) melhor = { quando, a };
  }
  return melhor ? melhor.a : null;
}

/** Liberação da pessoa para as imagens reais da tarefa, e o resultado dela no gabarito. */
export async function situacao(indice, tarefa, pessoa) {
  const itens = await indice.itensGabarito(tarefa);
  const res = await resultados(indice, tarefa, pessoa, itens);
  const feitos = new Set(res.map((r) => r.item));
  return {
    ...liberacao(res, itens.length > 0, REGRA[tarefa]),
    gabarito_total: itens.length,
    gabarito_feitos: feitos.size,
    gabarito_faltam: itens.filter((g) => !feitos.has(g.id)).length,
    resultados: res,
  };
}

const ehTreino = (g) => /treino/i.test(g.lote || "");

/**
 * Os itens do gabarito que a pessoa ainda não fez, na ordem em que entram: os dos lotes de treino
 * primeiro no treino, e os outros primeiro nos escondidos (cada pessoa num sorteio próprio).
 */
async function pendentesDoGabarito(indice, tarefa, pessoa, itens, treino) {
  const ip = await indice.partida(PARTIDA_GABARITO, tarefa);
  const feitos = new Set(ip.rotulos.filter((a) => a.pessoa === pessoa).map((a) => a.quadro));
  const pendentes = new Aleatorio(`gabarito:${tarefa}:${pessoa}`).embaralhar(itens.filter((g) => !feitos.has(g.id)));
  const primeiro = (g) => (ehTreino(g) === treino ? 0 : 1);
  return pendentes.map((g, i) => ({ g, i })).sort((a, b) => primeiro(a.g) - primeiro(b.g) || a.i - b.i).map((x) => x.g);
}

async function itemDoGabarito(indice, tarefa, pessoa, g, treino) {
  const versao = await indice.pasta.proximaVersao(indice.pasta.rotulos(PARTIDA_GABARITO, tarefa), g.id, pessoa);
  return {
    tarefa,
    partida: PARTIDA_GABARITO,
    quadro: g.id,
    versao,
    largura: g.largura,
    altura: g.altura,
    inicio: null,
    partiu_de: { fonte: "nenhuma", versao: null, referencia: null },
    dupla: false,
    sem_previsao: false,
    devolvido: null,
    gabarito: true,
    treino,
  };
}

/**
 * De onde a imagem começa: a versão devolvida, a previsão de um modelo ou nada. Devolve {inicio,
 * partiu_de}; `inicio` é a lista de pontos (pontos) ou o caminho de uma máscara (pessoas), ou null.
 */
async function comecarDe(indice, tarefa, partida, item, anterior) {
  const pasta = indice.pasta;
  if (anterior) {
    const partiu = { fonte: "rotulo_anterior", versao: null, referencia: anterior.nome };
    if (tarefa === "pontos") return { inicio: anterior.dados.pontos, partiu_de: partiu };
    return { inicio: anterior.dados.mascara ? `${pasta.rotulos(partida, tarefa)}/${anterior.dados.mascara}` : null, partiu_de: partiu };
  }
  if (!item.sem_previsao) {
    if (tarefa === "pontos") {
      let prev = null;
      try {
        prev = await indice.previsaoPontos(partida, item.quadro);
      } catch {
        prev = null; // previsão inválida não impede de anotar
      }
      if (prev && prev.pontos.length) return { inicio: prev.pontos, partiu_de: { fonte: "modelo", versao: `${prev.fonte}@${prev.versao}`, referencia: null } };
    } else if (await pasta.existe(pasta.previsaoPessoas(partida, item.quadro))) {
      return { inicio: pasta.previsaoPessoas(partida, item.quadro), partiu_de: { fonte: "modelo", versao: null, referencia: null } };
    }
  }
  return { inicio: null, partiu_de: { fonte: "nenhuma", versao: null, referencia: null } };
}

async function montar(indice, tarefa, pessoa, { partida, manifesto: man, ip }, item, anterior, devolvido) {
  const { inicio, partiu_de } = await comecarDe(indice, tarefa, partida, item, anterior);
  const versoes = ip.versoes(item.quadro, pessoa); // inclui as correções: o nome do arquivo novo não pode repetir
  const dir = indice.pasta.rotulos(partida, tarefa);
  return {
    tarefa,
    partida,
    quadro: item.quadro,
    versao: Math.max(versoes.length ? versoes[versoes.length - 1].versao + 1 : 1, await indice.pasta.proximaVersao(dir, item.quadro, pessoa)),
    largura: man.video.largura,
    altura: man.video.altura,
    inicio,
    partiu_de,
    dupla: item.dupla,
    sem_previsao: item.sem_previsao,
    devolvido,
    gabarito: false,
    treino: false,
  };
}

/**
 * O próximo item da pessoa na tarefa, ou null. O item diz a partida (ou "gabarito"), o quadro, a
 * versão a gravar, o tamanho da imagem, de onde começa e se é treino. Com `{treino: true}`, só itens
 * do gabarito, com o resultado na hora (o "fazer o teste" da página do gabarito).
 */
export async function proximo(indice, tarefa, pessoa, { treino: pedirTreino = false } = {}) {
  const regra = REGRA[tarefa];
  const itensGab = await indice.itensGabarito(tarefa);
  const res = await resultados(indice, tarefa, pessoa, itensGab);
  const lib = liberacao(res, itensGab.length > 0, regra);
  if (pedirTreino || !lib.liberado) {
    const pendentes = await pendentesDoGabarito(indice, tarefa, pessoa, itensGab, true);
    return pendentes.length ? itemDoGabarito(indice, tarefa, pessoa, pendentes[0], true) : null;
  }

  // os itens escondidos contam a partir da liberação: rótulos reais de antes (feitos quando ainda
  // não havia gabarito) não viram uma rajada de itens do gabarito em seguida
  const treino = nTreino(res, regra);
  const liberadoEm = treino > 0 ? ms(res[treino - 1].criado_em) : -Infinity;
  const { prontas } = await indice.partidasProntas(tarefa);
  let nReais = 0;
  for (const { ip } of prontas) {
    nReais += ip.rotulos.filter(
      (a) => a.pessoa === pessoa && a.versao === 1 && a.dados.corrige === null && ms(a.dados.criado_em) > liberadoEm,
    ).length;
  }

  let candidato = null;
  // 1) devolvidos primeiro: a última versão da pessoa no quadro voltou da revisão
  for (const p of prontas) {
    for (const item of p.fila.itens) {
      const minhas = p.ip.versoes(item.quadro, pessoa).filter((a) => a.dados.corrige === null);
      if (!minhas.length) continue;
      const ultima = minhas[minhas.length - 1];
      const rev = p.ip.ultimaRevisao(ultima.nome);
      if (rev?.decisao !== "devolver") continue;
      candidato = await montar(indice, tarefa, pessoa, p, item, ultima, { motivo: rev.motivo, comentario: rev.comentario });
      break;
    }
    if (candidato) break;
  }
  // 2) o próximo quadro que ainda precisa de rótulo (e que a pessoa ainda não anotou)
  for (const p of candidato ? [] : prontas) {
    for (const item of emOrdemDaPessoa(p.fila.itens, pessoa, p.partida)) {
      if (item.atribuido_a.length && !item.atribuido_a.includes(pessoa)) continue; // fila da 0.2
      const anotaram = quemAnotou(p.ip, item.quadro);
      if (anotaram.has(pessoa)) continue;
      if (!item.atribuido_a.length && anotaram.size >= precisam(item)) continue;
      candidato = await montar(indice, tarefa, pessoa, p, item, null, null);
      break;
    }
    if (candidato) break;
  }

  const escondidosFeitos = treino < 0 ? 0 : res.length - treino;
  if (candidato && nReais >= INTERVALO_GABARITO * (escondidosFeitos + 1)) {
    const pendentes = await pendentesDoGabarito(indice, tarefa, pessoa, itensGab, false);
    if (pendentes.length) return itemDoGabarito(indice, tarefa, pessoa, pendentes[0], false);
  }
  return candidato;
}

/** Rótulos da tarefa esperando revisão que a pessoa pode revisar: [{arquivo, rotulo}], na ordem das partidas. */
export async function pendentesRevisao(indice, tarefa, pessoa) {
  const out = [];
  for (const { partida, fila, ip } of (await indice.partidasProntas(tarefa)).prontas) {
    const itemDe = new Map(fila.itens.map((it) => [it.quadro, it]));
    // as correções não são revisadas, e uma correção não esconde o rótulo da própria pessoa no quadro
    const aRevisar = [...ip.ultimosProprios().values()].filter((a) => {
      if (a.pessoa === pessoa || (ip.revisoesDe.get(a.nome) || []).length) return false;
      const item = itemDe.get(a.quadro);
      if (!item) return false; // um quadro que não está na fila (o `anotacao validar` mostra)
      // dupla às cegas: só depois dos dois rótulos (antes, quem revisasse poderia ser a segunda pessoa)
      return !item.dupla || quemAnotou(ip, a.quadro).size >= 2;
    });
    aRevisar.sort((x, y) => (x.quadro < y.quadro ? -1 : x.quadro > y.quadro ? 1 : x.pessoa < y.pessoa ? -1 : 1));
    for (const a of emOrdemDaPessoa(aRevisar, pessoa, partida)) out.push({ arquivo: a, rotulo: a.dados });
  }
  return out;
}
