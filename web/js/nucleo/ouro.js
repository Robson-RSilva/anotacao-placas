// Lotes de ouro tirados do que a equipe já anotou: o gabarito arbitrado — espelho de
// src/anotacao/ouro.py (o `anotacao ouro`); tests/e2e confere que a página e o Python montam os
// mesmos itens da mesma pasta.
//
// Cada imagem aprovada na revisão (a regra do `unificar`) vira um item do gabarito com origem
// "arbitrado", num .zip que entra pela página do gabarito ("Importar lote de ouro (.zip)") como os do
// simulador:
//
// * pontos: os pontos do rótulo aprovado — os rentes à borda (a menos de 3 px, ref. 960) ficam
//   opcionais, como no simulador;
// * placas: a máscara aprovada, com cada pedaço pintado (vizinhos em 8 direções) como uma coisa na
//   frente da placa, de 1 a N, da esquerda para a direita; o recorte descartado (e aprovado) como "o
//   recorte não está na placa" vira um item para descartar. Os outros descartes não viram gabarito.
//
// Só entra a imagem que não vai mais mudar: todo rótulo dela já revisado e, na dupla às cegas, as duas
// pessoas já anotaram. O item nunca vai para quem trabalhou na imagem: quem anotou, revisou ou corrigiu
// fica em `fora_de`. Um em cada três vai para o treino (o lote com "treino" no nome) e os outros para
// os escondidos, por um sorteio fixo pelo item.
//
// Cada rodada leva só o que ainda não foi para nenhum lote: o registro `conjuntos/ouro-reais.json`
// guarda o que já foi, com o id de cada item. Cada .zip é um lote novo (PR1, PR2… nos pontos; PLR1,
// PLR2… nas placas), e os ids nunca se repetem (pontos de g5001 a g5999, placas de g6001 a g6999).

import { REF_W, TAREFAS } from "./convencoes.js";
import { aprovado } from "./filas.js";
import { TIPOS_DA_TAREFA, validar } from "./formatos.js";
import { sha256Hex } from "./hash.js";
import { codificarPng } from "./png.js";
import { foraDaRegiao, mascaraDaRegiao } from "./regiao.js";
import { criarZip } from "./zip.js";

/** As faixas de ids dos itens tirados de rótulos reais (as do simulador: g1xxx pontos, g4xxx placas). */
export const FAIXA = Object.freeze({ pontos: Object.freeze([5001, 5999]), placas: Object.freeze([6001, 6999]) });
/** O começo do nome dos lotes de cada tarefa: PR1-treino, PR1-controle, PLR1-treino… */
export const PREFIXO = Object.freeze({ pontos: "PR", placas: "PLR" });
export const A_CADA_TREINO = 3; // um em cada três itens vai para o treino
export const BORDA_REF = 3; // ponto a menos disto da borda (px, ref. 960): marcar é opcional
export const REGISTRO = "conjuntos/ouro-reais.json";
const DATA_ZIP = new Date(2026, 0, 1); // data fixa nas entradas: o mesmo conteúdo dá os mesmos bytes
const CORES = [[255, 64, 129], [41, 211, 255], [255, 196, 0], [102, 187, 106]];
/** As cores da máscara verdadeira (só para ver o PNG; a página lê os números). */
export const PALETA = Object.freeze([[0, 0, 0], ...Array.from({ length: 255 }, (_, k) => CORES[k % 4])]);

/** Por que um item aprovado ficou fora desta rodada (os mesmos textos do `anotacao ouro`). */
export const FORA = Object.freeze({
  esperando: "esperando revisão (ou a outra pessoa da dupla)",
  descartados: "descartados",
  outroDescarte: "descartados (por outro motivo que não o recorte fora do lugar)",
  semImagem: "sem a imagem (ou de outro tamanho)",
  mascara: "máscara que não serve",
  demais: "coisas demais na frente da placa",
  partida: "partida incompleta ou inválida",
  invalido: "itens que não passam na validação",
  semIds: (tarefa) => `sem ids livres nos ${tarefa}`,
});

const contar = (fora, motivo) => {
  fora[motivo] = (fora[motivo] ?? 0) + 1;
};

/** [largura, altura] de um JPEG, pelo cabeçalho (o marcador SOF), ou null quando não é um JPEG legível. */
export function tamanhoJpeg(b) {
  if (!(b && b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return null;
  let p = 2;
  while (p + 3 < b.length) {
    if (b[p] !== 0xff) return null;
    const m = b[p + 1];
    if (m === 0xff) {
      p += 1; // enchimento
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      p += 2; // marcadores sem tamanho
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null; // o fim, ou os dados, antes do tamanho da imagem
    const n = (b[p + 2] << 8) | b[p + 3];
    if (n < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (p + 8 >= b.length) return null;
      const h = (b[p + 5] << 8) | b[p + 6];
      const w = (b[p + 7] << 8) | b[p + 8];
      return w && h ? [w, h] : null;
    }
    p += 2 + n;
  }
  return null;
}

/**
 * Cada pedaço pintado (vizinhos em 8 direções) com um número, de 1 a N, da esquerda para a direita,
 * pelo centro dele (empate: de cima para baixo). Devolve {verdade, n}: n é quantos pedaços há; só os
 * 255 primeiros ganham número.
 */
export function numerar(m, w, h) {
  const rot = new Int32Array(w * h); // o pedaço de cada pixel (0: nenhum), na ordem em que aparecem
  const pedacos = [];
  const pilha = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || rot[i]) continue;
    const k = pedacos.length + 1;
    let sx = 0;
    let sy = 0;
    let area = 0;
    rot[i] = k;
    pilha.push(i);
    while (pilha.length) {
      const j = pilha.pop();
      const x = j % w;
      const y = (j - x) / w;
      sx += x;
      sy += y;
      area += 1;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const v = yy * w + xx;
          if (m[v] && !rot[v]) {
            rot[v] = k;
            pilha.push(v);
          }
        }
      }
    }
    pedacos.push({ k, cx: sx / area, cy: sy / area });
  }
  const ordem = [...pedacos].sort((a, b) => a.cx - b.cx || a.cy - b.cy || a.k - b.k);
  const numero = new Uint8Array(pedacos.length + 1);
  ordem.slice(0, 255).forEach((p, i) => {
    numero[p.k] = i + 1;
  });
  const verdade = new Uint8Array(w * h);
  for (let i = 0; i < rot.length; i++) if (rot[i]) verdade[i] = numero[rot[i]];
  return { verdade, n: pedacos.length };
}

/** O lote do item na rodada: um em cada três no treino, pelo hash do item (o mesmo item, o mesmo lado). */
export function loteDe(tarefa, n, chave) {
  const treino = Number.parseInt(sha256Hex(chave).slice(0, 8), 16) % A_CADA_TREINO === 0;
  return `${PREFIXO[tarefa]}${n}-${treino ? "treino" : "controle"}`;
}

/** Quem anotou, corrigiu ou revisou o item. */
function quemTrabalhou(ip, item) {
  const pessoas = new Set();
  for (const a of ip.rotulos) {
    if (a.quadro !== item) continue;
    pessoas.add(a.pessoa);
    for (const r of ip.revisoesDe.get(a.nome) || []) pessoas.add(r.revisor);
  }
  return [...pessoas].sort();
}

/**
 * Nada mais vai mudar no item: todo rótulo próprio (fora as correções feitas na revisão) já foi
 * revisado e, na dupla às cegas, as duas pessoas já anotaram.
 */
function assentado(ip, item, dupla) {
  const proprios = ip.rotulos.filter((a) => a.quadro === item && a.dados.corrige === null);
  if (proprios.some((a) => ip.ultimaRevisao(a.nome) === null)) return false;
  return !dupla || new Set(proprios.map((a) => a.pessoa)).size >= 2;
}

function observacao(chave, escolhido) {
  const como = escolhido.decisao === "corrigir" ? "corrigido" : "aprovado";
  return `rótulo real: ${chave}, ${escolhido.a.nome}, ${como} por ${escolhido.revisor}`;
}

async function lerBytes(pasta, caminho) {
  const f = await pasta.arquivo(caminho);
  return f ? new Uint8Array(await f.arrayBuffer()) : null;
}

/** A imagem tem o tamanho esperado? (e é um JPEG legível) */
function imagemServe(jpg, largura, altura) {
  const t = jpg && tamanhoJpeg(jpg);
  return Boolean(t && t[0] === largura && t[1] === altura);
}

async function candidatosPontos(indice, pid, fila, registrados, fora) {
  const ip = await indice.partida(pid, "pontos");
  const out = [];
  for (const item of fila.itens) {
    const q = item.quadro;
    const chave = `${pid}/${q}`;
    if (registrados.has(chave)) continue; // já foi para um lote
    const escolhido = aprovado(ip, q);
    if (!escolhido) continue;
    if (!assentado(ip, q, item.dupla)) {
      contar(fora, FORA.esperando);
      continue;
    }
    const r = escolhido.a.dados;
    if (r.situacao === "descartada") {
      contar(fora, FORA.descartados);
      continue;
    }
    const jpg = await lerBytes(indice.pasta, indice.pasta.quadro(pid, q));
    if (!imagemServe(jpg, r.largura, r.altura)) {
      contar(fora, FORA.semImagem);
      continue;
    }
    out.push({
      tarefa: "pontos",
      chave,
      quando: escolhido.quando,
      dados: { rotulo: r, observacao: observacao(chave, escolhido), fora_de: quemTrabalhou(ip, q), jpg },
    });
  }
  return out;
}

/** A máscara aprovada da placa: {m} ou {erro} — do tamanho do recorte, só 0 e 1, nada fora da região. */
async function mascaraDaPlaca(indice, caminho, r, regiao) {
  let m;
  try {
    m = await indice.mascara(caminho);
  } catch (e) {
    return { erro: `máscara ilegível: ${e.message}` };
  }
  if (m.largura !== r.largura || m.altura !== r.altura) return { erro: "a máscara não tem o tamanho do recorte" };
  if (m.dados.some((v) => v > 1)) return { erro: "a máscara tem valores além de 0 e 1" };
  if (foraDaRegiao(m.dados, mascaraDaRegiao(regiao, r.largura, r.altura))) return { erro: "a máscara tem pintura fora da região da placa" };
  return { m: m.dados };
}

async function candidatosPlacas(indice, pid, registrados, fora) {
  const rec = await indice.recortes(pid);
  const ip = await indice.partida(pid, "placas");
  const dir = indice.pasta.rotulos(pid, "placas");
  const out = [];
  for (const [recorte, { item: it }] of rec.itens) {
    const chave = `${pid}/${recorte}`;
    if (registrados.has(chave)) continue;
    const escolhido = aprovado(ip, recorte);
    if (!escolhido) continue;
    if (!assentado(ip, recorte, it.dupla)) {
      contar(fora, FORA.esperando);
      continue;
    }
    const r = escolhido.a.dados;
    const descartar = r.situacao === "descartada";
    if (descartar && r.motivo_descarte !== "placa_fora_do_lugar") {
      contar(fora, FORA.outroDescarte);
      continue;
    }
    const jpg = await lerBytes(indice.pasta, indice.pasta.recorte(pid, recorte));
    if (!imagemServe(jpg, it.largura, it.altura)) {
      contar(fora, FORA.semImagem);
      continue;
    }
    let verdade = null;
    let n = 0;
    if (!descartar) {
      if (r.largura !== it.largura || r.altura !== it.altura) {
        contar(fora, FORA.mascara);
        continue;
      }
      const { m, erro } = await mascaraDaPlaca(indice, `${dir}/${r.mascara}`, r, it.regiao);
      if (erro) {
        contar(fora, FORA.mascara);
        continue;
      }
      ({ verdade, n } = numerar(m, r.largura, r.altura));
      if (n > 255) {
        contar(fora, FORA.demais);
        continue;
      }
    }
    out.push({
      tarefa: "placas",
      chave,
      quando: escolhido.quando,
      dados: { item: it, verdade, n, observacao: observacao(chave, escolhido), fora_de: quemTrabalhou(ip, recorte), jpg },
    });
  }
  return out;
}

function itemPontos(gid, lote, d) {
  const r = d.rotulo;
  const borda = (BORDA_REF * r.largura) / REF_W;
  return {
    formato: "gabarito.pontos/1",
    id: gid,
    lote,
    imagem: `${gid}.jpg`,
    largura: r.largura,
    altura: r.altura,
    pontos: r.pontos.map((p) => ({ ponto: p.ponto, x: p.x, y: p.y, visivel: Math.min(p.x, p.y, r.largura - p.x, r.altura - p.y) >= borda })),
    origem: "arbitrado",
    observacao: d.observacao,
    fora_de: d.fora_de,
  };
}

function itemPlacas(gid, lote, d) {
  const it = d.item;
  const descartar = d.verdade === null;
  return {
    formato: "gabarito.placas/1",
    id: gid,
    lote,
    imagem: `${gid}.jpg`,
    mascara: descartar ? null : `${gid}.png`,
    largura: it.largura,
    altura: it.altura,
    regiao: it.regiao,
    oclusores: d.n,
    resposta: descartar ? "descartar" : "pintar",
    origem: "arbitrado",
    observacao: d.observacao,
    fora_de: d.fora_de,
  };
}

const registroVazio = () => ({ formato: "ouro.reais/1", rodadas: [], itens: { pontos: {}, placas: {} } });

/**
 * O registro do que já foi para algum lote de ouro (vazio, quando ainda não há). Um registro vazio no
 * disco (o Drive ainda trazendo) ou estragado para tudo: sem ele, os ids recomeçariam.
 */
export async function lerRegistro(pasta) {
  const nome = REGISTRO.split("/").pop();
  const achado = (await pasta.listar("conjuntos")).find((i) => i.tipo === "arquivo" && i.nome === nome);
  if (!achado) return registroVazio();
  const f = await achado.alca.getFile();
  if (!f.size) throw new Error(`${REGISTRO} ainda está chegando pelo Drive: tente de novo daqui a pouco.`);
  let reg;
  try {
    reg = JSON.parse(await f.text());
  } catch (e) {
    throw new Error(`${REGISTRO}: JSON inválido (${e.message}).`);
  }
  const ehMapa = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
  if (reg?.formato !== "ouro.reais/1" || !Array.isArray(reg.rodadas) || !ehMapa(reg.itens) || !TAREFAS.every((t) => ehMapa(reg.itens[t]))) {
    throw new Error(`${REGISTRO} não é um registro de lotes de ouro.`);
  }
  for (const t of TAREFAS) {
    if (!Object.values(reg.itens[t]).every((g) => typeof g === "string" && /^g\d{4}$/.test(g))) throw new Error(`${REGISTRO}: id inválido nos ${t}.`);
  }
  return reg;
}

/** Os ids da faixa de cada tarefa que já estão no gabarito da pasta (para nunca repetir um id). */
async function idsNaPasta(pasta) {
  const out = { pontos: [], placas: [] };
  for (const item of await pasta.listar("gabarito/itens")) {
    const m = /^g(\d{4})\.json$/.exec(item.nome);
    if (item.tipo !== "arquivo" || !m) continue;
    const v = Number(m[1]);
    for (const t of TAREFAS) if (v >= FAIXA[t][0] && v <= FAIXA[t][1]) out[t].push(v);
  }
  return out;
}

const porChave = (a, b) => a.quando - b.quando || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0);

/**
 * Uma rodada: um .zip com os itens aprovados que ainda não foram para nenhum lote, gravado em
 * `conjuntos/ouro-reais-<n>.zip`, e o registro atualizado. Devolve {n, arquivo (o caminho na pasta, ou
 * null quando não havia nada novo), nome, blob, itens, porTarefa: {pontos, placas}, porLote: {lote:
 * itens}, fora: {motivo: itens}}.
 */
export async function gerarLoteReal(indice, { agora = new Date() } = {}) {
  const pasta = indice.pasta;
  const registro = await lerRegistro(pasta);
  const n = registro.rodadas.length + 1;
  const rodada = { n, arquivo: null, nome: null, blob: null, itens: 0, porTarefa: { pontos: 0, placas: 0 }, porLote: {}, fora: {} };
  const registrados = Object.fromEntries(TAREFAS.map((t) => [t, new Set(Object.keys(registro.itens[t]))]));
  const candidatos = [];
  for (const pid of await pasta.listarPartidas()) {
    let fila;
    try {
      await indice.manifesto(pid);
      fila = await indice.fila(pid);
    } catch {
      contar(rodada.fora, FORA.partida); // incompleta (ainda sincronizando) ou inválida: fica para a próxima
      continue;
    }
    candidatos.push(...(await candidatosPontos(indice, pid, fila, registrados.pontos, rodada.fora)));
    candidatos.push(...(await candidatosPlacas(indice, pid, registrados.placas, rodada.fora)));
  }
  if (!candidatos.length) return rodada;

  const naPasta = await idsNaPasta(pasta);
  const entradas = [];
  const novos = { pontos: {}, placas: {} };
  for (const tarefa of TAREFAS) {
    const [primeiro, ultimo] = FAIXA[tarefa];
    let proximo = [...Object.values(registro.itens[tarefa]).map((g) => Number(g.slice(1))), ...naPasta[tarefa]].reduce((a, b) => Math.max(a, b), primeiro - 1) + 1;
    for (const c of candidatos.filter((x) => x.tarefa === tarefa).sort(porChave)) {
      if (proximo > ultimo) {
        contar(rodada.fora, FORA.semIds(tarefa));
        continue;
      }
      const gid = `g${String(proximo).padStart(4, "0")}`;
      const lote = loteDe(tarefa, n, c.chave);
      const item = tarefa === "pontos" ? itemPontos(gid, lote, c.dados) : itemPlacas(gid, lote, c.dados);
      try {
        validar(TIPOS_DA_TAREFA[tarefa].gabarito, item);
      } catch {
        contar(rodada.fora, FORA.invalido);
        continue;
      }
      proximo += 1;
      entradas.push({ caminho: `gabarito/itens/${gid}.json`, dados: `${JSON.stringify(item, null, 2)}\n`, data: DATA_ZIP });
      entradas.push({ caminho: `gabarito/itens/${gid}.jpg`, dados: c.dados.jpg, data: DATA_ZIP });
      if (item.mascara) {
        const png = await codificarPng(c.dados.verdade, item.largura, item.altura, PALETA);
        entradas.push({ caminho: `gabarito/itens/${gid}.png`, dados: png, data: DATA_ZIP });
      }
      novos[tarefa][c.chave] = gid;
      rodada.porLote[lote] = (rodada.porLote[lote] ?? 0) + 1;
      rodada.porTarefa[tarefa] += 1;
      rodada.itens += 1;
    }
  }
  if (!entradas.length) return rodada;

  const nome = `ouro-reais-${n}.zip`;
  const blob = await criarZip(entradas);
  // um .zip desta rodada sem ela no registro é sobra de uma gravação interrompida: o registro manda
  await pasta.escrever(`conjuntos/${nome}`, blob, { sobrescrever: true });
  for (const t of TAREFAS) Object.assign(registro.itens[t], novos[t]);
  const lotes = Object.fromEntries(Object.entries(rodada.porLote).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  registro.rodadas.push({ n, criado_em: agora.toISOString(), arquivo: nome, lotes });
  await pasta.escreverJson(REGISTRO, registro, { sobrescrever: true });
  return { ...rodada, porLote: lotes, arquivo: `conjuntos/${nome}`, nome, blob };
}
