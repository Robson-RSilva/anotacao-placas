// Filas: o que cada pessoa faz a seguir. Tudo sai dos arquivos e dá o mesmo em qualquer máquina.
//
// Câmera
//   1. quem ainda não foi liberado anota o gabarito, com o resultado na hora (treino);
//   2. depois, os quadros atribuídos a ela, na ordem das partidas; um rótulo devolvido volta
//      primeiro, como versão nova;
//   3. a cada 15 rótulos, um item do gabarito entra escondido na fila.
//
// Revisão cruzada
//   Cada rótulo novo tem um revisor sorteado pelo nome do arquivo, entre os revisores que não são o
//   autor. O revisor não vê quem anotou. Correções feitas na revisão não voltam para a fila.

import { Aleatorio } from "./aleatorio.js";
import { PARTIDA_GABARITO } from "./convencoes.js";
import { comPapel } from "./formatos.js";
import { liberacao, nTreino, resultados } from "./gabarito.js";
import { sha256Hex } from "./hash.js";
import { cameraPadrao } from "./pacote.js";

export const INTERVALO_GABARITO = 15;

const refDoPacote = (p) => `${p.estadio}/pacote-${p.versao}`;

function doRegistro(pacote, w, h) {
  return {
    camera: cameraPadrao(pacote, w, h).paraRotulo(),
    partiu_de: { fonte: "registro", versao: null, referencia: refDoPacote(pacote) },
  };
}

/** De onde o molde abre: a versão devolvida, a previsão, um quadro anotado da mesma tomada ou o registro. */
export async function cameraInicial(indice, ip, item, w, h, pacoteRef, anterior = null) {
  if (anterior && anterior.dados.camera) {
    return { camera: anterior.dados.camera, partiu_de: { fonte: "rotulo_anterior", versao: null, referencia: anterior.nome } };
  }
  const pacote = await indice.pacote(pacoteRef);
  if (item.sem_previsao) return doRegistro(pacote, w, h);
  let prev = null;
  try {
    prev = await indice.previsao(ip.partida, item.quadro);
  } catch {
    prev = null; // previsão inválida não impede de anotar
  }
  if (prev && prev.camera) {
    return { camera: prev.camera, partiu_de: { fonte: "modelo", versao: `${prev.fonte}@${prev.versao}`, referencia: null } };
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
    return { camera: melhor.a.dados.camera, partiu_de: { fonte: "quadro_anotado", versao: null, referencia: melhor.a.nome } };
  }
  return doRegistro(pacote, w, h);
}

/** Liberação para dados reais e resultado no gabarito. */
export async function situacaoAnotador(indice, pessoa) {
  const itens = await indice.itensGabarito();
  const res = await resultados(indice, pessoa, itens);
  return { ...liberacao(res, itens.length > 0), gabarito_total: itens.length };
}

async function itemGabarito(indice, pessoa, g, treino) {
  const versao = await indice.pasta.proximaVersao(indice.pasta.rotulos(PARTIDA_GABARITO), g.id, pessoa);
  const { camera, partiu_de } = doRegistro(await indice.pacote(g.pacote), g.largura, g.altura);
  return {
    partida: PARTIDA_GABARITO,
    quadro: g.id,
    versao,
    largura: g.largura,
    altura: g.altura,
    pacote: g.pacote,
    camera_inicial: camera,
    partiu_de,
    dupla: false,
    sem_previsao: false,
    devolvido: null,
    treino,
  };
}

/**
 * O próximo item da pessoa na tarefa de câmera, ou null. O item diz a partida, o quadro, a versão a
 * gravar, o tamanho da imagem, o pacote, a câmera de partida e se é treino com gabarito.
 */
export async function proximoCamera(indice, pessoa) {
  const itensGab = await indice.itensGabarito();
  const ipGab = await indice.partida(PARTIDA_GABARITO);
  const feitos = new Set(ipGab.rotulos.filter((a) => a.pessoa === pessoa).map((a) => a.quadro));
  const pendentesGab = new Aleatorio(`gabarito:${pessoa}`).embaralhar(itensGab.filter((g) => !feitos.has(g.id)));
  const res = await resultados(indice, pessoa, itensGab);
  const lib = liberacao(res, itensGab.length > 0);
  if (!lib.liberado) return pendentesGab.length ? itemGabarito(indice, pessoa, pendentesGab[0], true) : null;

  let nReais = 0;
  let candidato = null;
  for (const pid of await indice.listarPartidas()) {
    const ip = await indice.partida(pid);
    nReais += ip.rotulos.filter((a) => a.pessoa === pessoa && a.versao === 1).length;
    if (candidato) continue;
    const man = await indice.manifesto(pid);
    for (const item of (await indice.fila(pid)).itens) {
      if (!item.atribuido_a.includes(pessoa)) continue;
      const versoes = ip.versoes(item.quadro, pessoa);
      let devolvido = null;
      let anterior = null;
      if (versoes.length) {
        const ultima = versoes[versoes.length - 1];
        const rev = ip.ultimaRevisao(ultima.nome);
        if (!rev || rev.decisao !== "devolver") continue;
        devolvido = { motivo: rev.motivo, comentario: rev.comentario };
        anterior = ultima;
      }
      const w = man.video.largura;
      const h = man.video.altura;
      const { camera, partiu_de } = await cameraInicial(indice, ip, item, w, h, man.pacote, anterior);
      candidato = {
        partida: pid,
        quadro: item.quadro,
        versao: versoes.length ? versoes[versoes.length - 1].versao + 1 : 1,
        largura: w,
        altura: h,
        pacote: man.pacote,
        camera_inicial: camera,
        partiu_de,
        dupla: item.dupla,
        sem_previsao: item.sem_previsao,
        devolvido,
        treino: false,
      };
      break;
    }
  }
  const treino = nTreino(res);
  const escondidosFeitos = treino < 0 ? 0 : res.length - treino;
  if (candidato && pendentesGab.length && nReais >= INTERVALO_GABARITO * (escondidosFeitos + 1)) {
    return itemGabarito(indice, pessoa, pendentesGab[0], false);
  }
  return candidato;
}

/** Revisor de um rótulo: sorteado pelo nome do arquivo entre os revisores que não são o autor. */
export function revisorDesignado(nomeRotulo, autor, revisores, todos) {
  let candidatos = revisores.filter((r) => r !== autor);
  if (!candidatos.length) candidatos = todos.filter((r) => r !== autor);
  if (!candidatos.length) return null;
  const k = Number(BigInt(`0x${sha256Hex(nomeRotulo)}`) % BigInt(candidatos.length));
  return candidatos[k];
}

/** Rótulos esperando a revisão da pessoa: [{arquivo, rotulo}], na ordem das partidas. */
export async function pendentesRevisao(indice, pessoa) {
  const equipe = await indice.equipe();
  const revisores = comPapel(equipe, "revisor");
  const todos = equipe.membros.map((m) => m.codigo).sort();
  const out = [];
  for (const pid of await indice.listarPartidas()) {
    const ip = await indice.partida(pid);
    for (const a of ip.ultimos().values()) {
      if (a.pessoa === pessoa || (ip.revisoesDe.get(a.nome) || []).length) continue;
      if (a.dados.corrige !== null) continue;
      if (revisorDesignado(a.nome, a.pessoa, revisores, todos) === pessoa) out.push({ arquivo: a, rotulo: a.dados });
    }
  }
  return out;
}
