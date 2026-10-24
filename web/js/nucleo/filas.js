// Filas: o que cada pessoa faz a seguir. Tudo sai dos arquivos e dá o mesmo em qualquer máquina.
// Não há equipe cadastrada: quem anota se identifica por um código (as iniciais, por exemplo).
//
// Câmera (fila aberta)
//   1. quem ainda não foi liberado anota o gabarito, com o resultado na hora (treino);
//   2. depois, um rótulo devolvido na revisão volta primeiro, como versão nova;
//   3. depois, o próximo quadro sorteado que ainda não tem rótulo — ou, nos quadros em dupla às
//      cegas, que ainda não tem rótulos de duas pessoas. Cada pessoa percorre cada partida a partir
//      de um ponto próprio, para duas pessoas trabalhando ao mesmo tempo raramente pegarem o mesmo
//      quadro (se pegarem, o quadro fica com dois rótulos, o que não estraga nada);
//   4. a cada 15 rótulos, um item do gabarito entra escondido na fila.
//
// Revisão cruzada (fila aberta)
//   Qualquer pessoa revisa os rótulos das outras, sem saber de quem são. Um quadro em dupla só vai
//   para a revisão depois dos dois rótulos: quem revisasse antes poderia ser a segunda pessoa a
//   anotá-lo e veria a resposta. Correções feitas na revisão não voltam para a fila.
//
// Filas de partidas importadas pela 0.2 têm quadros atribuídos a pessoas (`atribuido_a`): esses
// continuam só com quem os recebeu.

import { Aleatorio } from "./aleatorio.js";
import { PARTIDA_GABARITO } from "./convencoes.js";
import { liberacao, nTreino, resultados } from "./gabarito.js";
import { sha256Hex } from "./hash.js";
import { cameraPadrao } from "./pacote.js";

export const INTERVALO_GABARITO = 15;

const refDoPacote = (p) => `${p.estadio}/pacote-${p.versao}`;
const ms = (iso) => Date.parse(iso);

/**
 * Medidas do campo para começar: as do rótulo de onde veio a câmera, as mais recentes da partida
 * (nunca de um rótulo do próprio quadro, que na dupla às cegas é a resposta da outra pessoa), ou as
 * do pacote.
 */
function campoInicial(ip, fonte, pacote, quadro) {
  if (fonte?.dados.campo) return fonte.dados.campo;
  let recente = null;
  for (const a of ip?.rotulos ?? []) {
    if (a.quadro === quadro || !a.dados.campo) continue;
    if (!recente || ms(a.dados.criado_em) > ms(recente.dados.criado_em)) recente = a;
  }
  return recente ? recente.dados.campo : pacote.campo;
}

function doRegistro(pacote, w, h) {
  return {
    camera: cameraPadrao(pacote, w, h).paraRotulo(),
    partiu_de: { fonte: "registro", versao: null, referencia: refDoPacote(pacote) },
  };
}

/**
 * De onde o molde abre: a versão devolvida, a previsão, um quadro anotado da mesma tomada ou o
 * registro. Devolve {camera, partiu_de, campo}.
 */
export async function cameraInicial(indice, ip, item, w, h, pacoteRef, anterior = null) {
  const pacote = await indice.pacote(pacoteRef);
  if (anterior && anterior.dados.camera) {
    return {
      camera: anterior.dados.camera,
      partiu_de: { fonte: "rotulo_anterior", versao: null, referencia: anterior.nome },
      campo: campoInicial(ip, anterior, pacote, item.quadro),
    };
  }
  if (item.sem_previsao) return { ...doRegistro(pacote, w, h), campo: campoInicial(ip, null, pacote, item.quadro) };
  let prev = null;
  try {
    prev = await indice.previsao(ip.partida, item.quadro);
  } catch {
    prev = null; // previsão inválida não impede de anotar
  }
  if (prev && prev.camera) {
    return {
      camera: prev.camera,
      partiu_de: { fonte: "modelo", versao: `${prev.fonte}@${prev.versao}`, referencia: null },
      campo: campoInicial(ip, null, pacote, item.quadro),
    };
  }
  // quadro já anotado da mesma tomada (o mais próximo no tempo; nunca o mesmo quadro)
  const fila = await indice.fila(ip.partida);
  const itemDe = new Map(fila.itens.map((it) => [it.quadro, it]));
  let melhor = null;
  for (const a of ip.ultimos().values()) {
    const it = itemDe.get(a.quadro);
    if (a.quadro === item.quadro || !it || it.tomada !== item.tomada || !a.dados.camera) continue;
    const d = Math.abs(it.pts_ms - item.pts_ms);
    if (!melhor || d < melhor.d) melhor = { d, a };
  }
  if (melhor) {
    return {
      camera: melhor.a.dados.camera,
      partiu_de: { fonte: "quadro_anotado", versao: null, referencia: melhor.a.nome },
      campo: campoInicial(ip, melhor.a, pacote, item.quadro),
    };
  }
  return { ...doRegistro(pacote, w, h), campo: campoInicial(ip, null, pacote, item.quadro) };
}

/** Liberação para dados reais e resultado no gabarito. */
export async function situacaoAnotador(indice, pessoa) {
  const itens = await indice.itensGabarito();
  const res = await resultados(indice, pessoa, itens);
  return { ...liberacao(res, itens.length > 0), gabarito_total: itens.length };
}

async function itemGabarito(indice, pessoa, g, treino) {
  const versao = await indice.pasta.proximaVersao(indice.pasta.rotulos(PARTIDA_GABARITO), g.id, pessoa);
  const pacote = await indice.pacote(g.pacote);
  const { camera, partiu_de } = doRegistro(pacote, g.largura, g.altura);
  return {
    partida: PARTIDA_GABARITO,
    quadro: g.id,
    versao,
    largura: g.largura,
    altura: g.altura,
    pacote: g.pacote,
    camera_inicial: camera,
    partiu_de,
    campo: pacote.campo,
    dupla: false,
    sem_previsao: false,
    devolvido: null,
    treino,
  };
}

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
 * O próximo item da pessoa na tarefa de câmera, ou null. O item diz a partida, o quadro, a versão a
 * gravar, o tamanho da imagem, o pacote, a câmera e as medidas do campo de partida e se é treino.
 */
export async function proximoCamera(indice, pessoa) {
  const itensGab = await indice.itensGabarito();
  const ipGab = await indice.partida(PARTIDA_GABARITO);
  const feitos = new Set(ipGab.rotulos.filter((a) => a.pessoa === pessoa).map((a) => a.quadro));
  const pendentesGab = new Aleatorio(`gabarito:${pessoa}`).embaralhar(itensGab.filter((g) => !feitos.has(g.id)));
  const res = await resultados(indice, pessoa, itensGab);
  const lib = liberacao(res, itensGab.length > 0);
  if (!lib.liberado) return pendentesGab.length ? itemGabarito(indice, pessoa, pendentesGab[0], true) : null;

  // os itens escondidos contam a partir da liberação: rótulos reais de antes (feitos quando ainda
  // não havia gabarito) não viram uma rajada de itens do gabarito em seguida
  const treino = nTreino(res);
  const liberadoEm = treino > 0 ? ms(res[treino - 1].criado_em) : -Infinity;
  const { prontas } = await indice.partidasProntas();
  let nReais = 0;
  for (const { ip } of prontas) {
    nReais += ip.rotulos.filter(
      (a) => a.pessoa === pessoa && a.versao === 1 && a.dados.corrige === null && ms(a.dados.criado_em) > liberadoEm,
    ).length;
  }

  const montar = async ({ partida, manifesto: man, ip }, item, anterior, devolvido) => {
    const w = man.video.largura;
    const h = man.video.altura;
    const { camera, partiu_de, campo } = await cameraInicial(indice, ip, item, w, h, man.pacote, anterior);
    const versoes = ip.versoes(item.quadro, pessoa); // inclui as correções: o nome do arquivo novo não pode repetir
    return {
      partida,
      quadro: item.quadro,
      versao: versoes.length ? versoes[versoes.length - 1].versao + 1 : 1,
      largura: w,
      altura: h,
      pacote: man.pacote,
      camera_inicial: camera,
      partiu_de,
      campo,
      dupla: item.dupla,
      sem_previsao: item.sem_previsao,
      devolvido,
      treino: false,
    };
  };

  let candidato = null;
  // 1) devolvidos primeiro: a última versão da pessoa no quadro voltou da revisão
  for (const p of prontas) {
    for (const item of p.fila.itens) {
      const minhas = p.ip.versoes(item.quadro, pessoa).filter((a) => a.dados.corrige === null);
      if (!minhas.length) continue;
      const ultima = minhas[minhas.length - 1];
      const rev = p.ip.ultimaRevisao(ultima.nome);
      if (rev?.decisao !== "devolver") continue;
      candidato = await montar(p, item, ultima, { motivo: rev.motivo, comentario: rev.comentario });
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
      candidato = await montar(p, item, null, null);
      break;
    }
    if (candidato) break;
  }

  const escondidosFeitos = treino < 0 ? 0 : res.length - treino;
  if (candidato && pendentesGab.length && nReais >= INTERVALO_GABARITO * (escondidosFeitos + 1)) {
    return itemGabarito(indice, pessoa, pendentesGab[0], false);
  }
  return candidato;
}

/** Rótulos esperando revisão que a pessoa pode revisar: [{arquivo, rotulo}], na ordem das partidas. */
export async function pendentesRevisao(indice, pessoa) {
  const out = [];
  for (const { partida, fila, ip } of (await indice.partidasProntas()).prontas) {
    const itemDe = new Map(fila.itens.map((it) => [it.quadro, it]));
    // as correções não são revisadas, e uma correção não esconde o rótulo da própria pessoa no quadro
    const aRevisar = [...ip.ultimosProprios().values()].filter((a) => {
      if (a.pessoa === pessoa || (ip.revisoesDe.get(a.nome) || []).length) return false;
      const item = itemDe.get(a.quadro);
      // dupla às cegas: só depois dos dois rótulos (antes, quem revisasse poderia ser a segunda pessoa)
      return !item?.dupla || quemAnotou(ip, a.quadro).size >= 2;
    });
    aRevisar.sort((x, y) => (x.quadro < y.quadro ? -1 : x.quadro > y.quadro ? 1 : x.pessoa < y.pessoa ? -1 : 1));
    for (const a of emOrdemDaPessoa(aRevisar, pessoa, partida)) out.push({ arquivo: a, rotulo: a.dados });
  }
  return out;
}
