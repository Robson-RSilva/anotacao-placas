// Filas da oclusão nas placas: os quadros cuja câmera já foi aprovada, para pintar o que cobre as
// placas, e a revisão cruzada da pintura. Tudo sai dos arquivos e dá o mesmo em qualquer máquina.
//
// Oclusão (fila aberta)
//   1. quem ainda não foi liberado pinta o gabarito da oclusão, com o resultado na hora (treino);
//   2. depois, uma pintura devolvida na revisão volta primeiro, como versão nova;
//   3. depois, o próximo quadro com a câmera aprovada e alguma placa para pintar, que ainda não tem
//      pintura — ou, nos quadros em dupla às cegas, que ainda não tem as de duas pessoas. A câmera é
//      a aprovada primeiro na revisão cruzada (ou a correção de quem revisou), a mesma do `unificar`;
//   4. a cada 15 pinturas, um item do gabarito da oclusão entra escondido na fila.
//
// As placas vêm do pacote do estádio, quando ele tem as placas do levantamento; sem elas, das faixas
// de placas (oclusao.js), com as medidas da última pintura da partida — quem pinta ajusta no primeiro
// quadro, e os seguintes já abrem certos.

import { Aleatorio } from "./aleatorio.js";
import { Camera } from "./camera.js";
import { PARTIDA_GABARITO, mascaraDe } from "./convencoes.js";
import { INTERVALO_GABARITO, emOrdemDaPessoa, precisam, quemAnotou } from "./filas.js";
import { REGRA, liberacao, nTreino, resultadosOclusao } from "./gabarito.js";
import { faixasPadrao, placasDasFaixas, temPlacaParaPintar } from "./oclusao.js";

const ms = (iso) => Date.parse(iso);

/**
 * O rótulo de câmera aprovado do quadro (o aprovado primeiro na revisão, ou a correção de quem
 * revisou), com situação "câmera certa"; null quando ainda não há — a regra do `unificar`.
 */
export function cameraAprovada(ip, quadro) {
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
  if (!melhor || melhor.a.dados.situacao !== "ok" || !melhor.a.dados.camera) return null;
  return melhor.a;
}

/** As medidas das faixas da pintura mais recente da partida (nunca de uma pintura do próprio quadro). */
export function faixasRecentes(ipOc, quadro) {
  let recente = null;
  for (const a of ipOc.rotulos) {
    if (a.quadro === quadro || !a.dados.faixas) continue;
    if (!recente || ms(a.dados.criado_em) > ms(recente.dados.criado_em)) recente = a;
  }
  return recente ? recente.dados.faixas : null;
}

/** As partidas prontas, com o índice da oclusão de cada uma (`ipOc`). */
async function partidasComOclusao(indice) {
  const { prontas } = await indice.partidasProntas();
  const out = [];
  for (const p of prontas) out.push({ ...p, ipOc: await indice.partida(p.partida, "oclusao") });
  return out;
}

async function itemGabarito(indice, pessoa, g, treino) {
  const versao = await indice.pasta.proximaVersao(indice.pasta.rotulos(PARTIDA_GABARITO, "oclusao"), g.id, pessoa);
  const pacote = await indice.pacote(g.pacote);
  return {
    tarefa: "oclusao",
    partida: PARTIDA_GABARITO,
    quadro: g.id,
    versao,
    largura: g.largura,
    altura: g.altura,
    pacote: g.pacote,
    camera: g.camera,
    camera_de: null,
    campo: g.campo ?? pacote.campo,
    placas_de: "gabarito",
    faixas: null,
    placas: g.placas,
    mascara_inicial: null,
    partiu_de: { fonte: "nenhuma", versao: null, referencia: null },
    dupla: false,
    sem_previsao: false,
    devolvido: null,
    treino,
  };
}

/**
 * O item de um quadro da partida, ou null quando não há o que pintar (a câmera ainda não foi
 * aprovada, ou nenhuma placa aparece alta o bastante). `anterior` é a versão devolvida.
 */
async function montar(indice, p, item, pessoa, anterior, devolvido) {
  const aprovada = cameraAprovada(p.ip, item.quadro);
  if (!aprovada) return null;
  const w = p.manifesto.video.largura;
  const h = p.manifesto.video.altura;
  const campo = aprovada.dados.campo ?? p.pacote.campo;
  const placasDe = p.pacote.placas.length ? "pacote" : "faixas";
  const recentes = placasDe === "faixas" ? anterior?.dados.faixas ?? faixasRecentes(p.ipOc, item.quadro) : null;
  const faixas = placasDe === "faixas" ? recentes ?? faixasPadrao() : null;
  const placas = placasDe === "pacote" ? p.pacote.placas : placasDasFaixas(campo, faixas);
  if (!anterior && !temPlacaParaPintar(Camera.deRotulo(aprovada.dados.camera, w, h), placas, w, h)) return null;
  const versoes = p.ipOc.versoes(item.quadro, pessoa); // inclui as correções: o nome do arquivo novo não pode repetir
  const pasta = indice.pasta;
  const dir = pasta.rotulos(p.partida, "oclusao");
  let mascara_inicial = null;
  let partiu_de = { fonte: "nenhuma", versao: null, referencia: null };
  if (anterior) {
    partiu_de = { fonte: "rotulo_anterior", versao: null, referencia: anterior.nome };
    if (anterior.dados.mascara) mascara_inicial = `${dir}/${mascaraDe(anterior.nome)}`;
  } else if (!item.sem_previsao && (await pasta.existe(pasta.previsaoOclusao(p.partida, item.quadro)))) {
    partiu_de = { fonte: "modelo", versao: null, referencia: null };
    mascara_inicial = pasta.previsaoOclusao(p.partida, item.quadro);
  }
  return {
    tarefa: "oclusao",
    partida: p.partida,
    quadro: item.quadro,
    versao: Math.max(versoes.length ? versoes[versoes.length - 1].versao + 1 : 1, await pasta.proximaVersao(dir, item.quadro, pessoa)),
    largura: w,
    altura: h,
    pacote: p.manifesto.pacote,
    camera: aprovada.dados.camera,
    camera_de: aprovada.nome,
    campo,
    placas_de: placasDe,
    faixas,
    faixas_padrao: placasDe === "faixas" && !recentes, // a primeira pintura da partida: confira as faixas
    placas: placasDe === "pacote" ? p.pacote.placas : null,
    mascara_inicial,
    partiu_de,
    dupla: item.dupla,
    sem_previsao: item.sem_previsao,
    devolvido,
    treino: false,
  };
}

/** Liberação da pessoa para pintar os quadros reais, pelo gabarito da oclusão. */
export async function situacaoOclusao(indice, pessoa) {
  const itens = await indice.itensGabarito("oclusao");
  const res = await resultadosOclusao(indice, pessoa, itens);
  return { ...liberacao(res, itens.length > 0, REGRA.oclusao), gabarito_total: itens.length };
}

/**
 * O próximo item da pessoa na tarefa de oclusão, ou null. O item diz a partida, o quadro, a versão a
 * gravar, o tamanho da imagem, a câmera aprovada, de onde vêm as placas (e as faixas), a máscara de
 * partida e se é treino.
 */
export async function proximoOclusao(indice, pessoa) {
  const itensGab = await indice.itensGabarito("oclusao");
  const ipGab = await indice.partida(PARTIDA_GABARITO, "oclusao");
  const feitos = new Set(ipGab.rotulos.filter((a) => a.pessoa === pessoa).map((a) => a.quadro));
  const pendentesGab = new Aleatorio(`gabarito-oclusao:${pessoa}`).embaralhar(itensGab.filter((g) => !feitos.has(g.id)));
  const res = await resultadosOclusao(indice, pessoa, itensGab);
  const lib = liberacao(res, itensGab.length > 0, REGRA.oclusao);
  if (!lib.liberado) return pendentesGab.length ? itemGabarito(indice, pessoa, pendentesGab[0], true) : null;

  const treino = nTreino(res, REGRA.oclusao);
  const liberadoEm = treino > 0 ? ms(res[treino - 1].criado_em) : -Infinity;
  const partidas = await partidasComOclusao(indice);
  let nReais = 0;
  for (const { ipOc } of partidas) {
    nReais += ipOc.rotulos.filter(
      (a) => a.pessoa === pessoa && a.versao === 1 && a.dados.corrige === null && ms(a.dados.criado_em) > liberadoEm,
    ).length;
  }

  let candidato = null;
  // 1) devolvidos primeiro: a última versão da pessoa no quadro voltou da revisão
  for (const p of partidas) {
    for (const item of p.fila.itens) {
      const minhas = p.ipOc.versoes(item.quadro, pessoa).filter((a) => a.dados.corrige === null);
      if (!minhas.length) continue;
      const ultima = minhas[minhas.length - 1];
      const rev = p.ipOc.ultimaRevisao(ultima.nome);
      if (rev?.decisao !== "devolver") continue;
      candidato = await montar(indice, p, item, pessoa, ultima, { motivo: rev.motivo, comentario: rev.comentario });
      if (candidato) break;
    }
    if (candidato) break;
  }
  // 2) o próximo quadro com câmera aprovada que ainda precisa de pintura (e que a pessoa não pintou)
  for (const p of candidato ? [] : partidas) {
    for (const item of emOrdemDaPessoa(p.fila.itens, pessoa, p.partida)) {
      const pintaram = quemAnotou(p.ipOc, item.quadro);
      if (pintaram.has(pessoa) || pintaram.size >= precisam(item)) continue;
      candidato = await montar(indice, p, item, pessoa, null, null);
      if (candidato) break;
    }
    if (candidato) break;
  }

  const escondidosFeitos = treino < 0 ? 0 : res.length - treino;
  if (candidato && pendentesGab.length && nReais >= INTERVALO_GABARITO * (escondidosFeitos + 1)) {
    return itemGabarito(indice, pessoa, pendentesGab[0], false);
  }
  return candidato;
}

/** Pinturas esperando revisão que a pessoa pode revisar: [{arquivo, rotulo}], na ordem das partidas. */
export async function pendentesRevisaoOclusao(indice, pessoa) {
  const out = [];
  for (const { partida, fila, ipOc } of await partidasComOclusao(indice)) {
    const itemDe = new Map(fila.itens.map((it) => [it.quadro, it]));
    const aRevisar = [...ipOc.ultimosProprios().values()].filter((a) => {
      if (a.pessoa === pessoa || (ipOc.revisoesDe.get(a.nome) || []).length) return false;
      const item = itemDe.get(a.quadro);
      // dupla às cegas: só depois das duas pinturas (antes, quem revisasse poderia ser a segunda pessoa)
      return !item?.dupla || quemAnotou(ipOc, a.quadro).size >= 2;
    });
    aRevisar.sort((x, y) => (x.quadro < y.quadro ? -1 : x.quadro > y.quadro ? 1 : x.pessoa < y.pessoa ? -1 : 1));
    for (const a of emOrdemDaPessoa(aRevisar, pessoa, partida)) out.push({ arquivo: a, rotulo: a.dados });
  }
  return out;
}

/** Quadros de cada partida com a câmera aprovada (os que podem ter pintura): Map partida -> Set de quadros. */
export async function quadrosComCameraAprovada(indice) {
  const out = new Map();
  for (const { partida, fila, ip } of (await indice.partidasProntas()).prontas) {
    out.set(partida, new Set(fila.itens.filter((it) => cameraAprovada(ip, it.quadro)).map((it) => it.quadro)));
  }
  return out;
}
