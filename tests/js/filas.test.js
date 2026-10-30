// Filas abertas (sem equipe cadastrada), as mesmas nas duas tarefas: treino e liberação pelo
// gabarito, gabarito escondido a cada 15, devolvidos primeiro, dupla às cegas, de onde a imagem
// começa, revisão cruzada às cegas e partidas incompletas.
import assert from "node:assert/strict";
import { test } from "node:test";

import { INTERVALO_GABARITO, emOrdemDaPessoa, pendentesRevisao, proximo, rotuloAprovado, situacao } from "../../web/js/nucleo/filas.js";
import { REGRA } from "../../web/js/nucleo/gabarito.js";
import { calcularPlacar } from "../../web/js/nucleo/placar.js";
import {
  AGORA,
  PARTIDA,
  criarGabaritoJogadores,
  criarGabaritoPontos,
  criarPartida,
  esquemas,
  gravarJogadores,
  gravarPontos,
  gravarRevisao,
  mascaraVerdadeira,
  pastaExemplo,
} from "./apoio.js";

await esquemas();

const quadro = (k) => `t${String(1000 * (k + 1)).padStart(10, "0")}`;
const PONTOS = [{ ponto: "centro", x: 320, y: 180 }];
/** A resposta certa de um item dos pontos (os que aparecem). */
const certos = (item) => item.pontos.filter((p) => p.visivel).map(({ ponto, x, y }) => ({ ponto, x, y }));

test("fila aberta: cada quadro uma vez, de qualquer pessoa, e sem gabarito não há bloqueio", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}, {}]);
  for (const tarefa of ["pontos", "jogadores"]) {
    const sit = await situacao(indice, tarefa, "RS");
    assert.equal(sit.liberado, true);
    assert.equal(sit.gabarito_total, 0);
  }
  const feitos = [];
  for (let k = 0; k < 2; k++) {
    const item = await proximo(indice, "pontos", "RS");
    assert.equal(item.versao, 1);
    assert.equal(item.tarefa, "pontos");
    assert.deepEqual([item.largura, item.altura, item.gabarito, item.treino], [640, 360, false, false]);
    assert.ok(!feitos.includes(item.quadro));
    assert.equal(item.inicio, null);
    await gravarPontos(pasta, { quadro: item.quadro, pessoa: "RS", pontos: PONTOS, m: k });
    feitos.push(item.quadro);
  }
  // o que falta vai para quem chegar, inclusive alguém que nunca anotou
  const resto = await proximo(indice, "pontos", "ANACLARA");
  assert.ok(!feitos.includes(resto.quadro));
  await gravarPontos(pasta, { quadro: resto.quadro, pessoa: "ANACLARA", pontos: null }); // descartada também conta
  assert.equal(await proximo(indice, "pontos", "RS"), null);
  assert.equal(await proximo(indice, "pontos", "ANACLARA"), null);
  // a outra tarefa tem a fila dela
  assert.equal((await proximo(indice, "jogadores", "RS")).tarefa, "jogadores");
});

test("cada pessoa começa num ponto próprio da fila, para duas pessoas não pegarem o mesmo quadro", () => {
  const itens = Array.from({ length: 50 }, (_, k) => k);
  const a = emOrdemDaPessoa(itens, "A01", "p");
  const b = emOrdemDaPessoa(itens, "A02", "p");
  assert.deepEqual([...a].sort((x, y) => x - y), itens); // todos, uma vez cada
  assert.notEqual(a[0], b[0]);
  assert.deepEqual(emOrdemDaPessoa(itens, "A01", "p"), a); // sempre o mesmo para a mesma pessoa
  assert.equal(a[(a.indexOf(0) + 1) % 50], 1); // e na ordem da partida a partir dali
});

test("fila da 0.2: o quadro atribuído continua só com quem o recebeu", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{ atribuido_a: ["A02"] }], { pacote: "generico/pacote-1.0" }); // manifesto da 0.7
  assert.equal(await proximo(indice, "pontos", "A01"), null);
  assert.equal((await proximo(indice, "pontos", "A02")).quadro, quadro(0));
});

test("treino com gabarito até a liberação; depois um escondido a cada 15", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, Array.from({ length: 40 }, () => ({})));
  const itens = await criarGabaritoPontos(pasta, 14);
  // quem começa vê gabarito de treino
  let item = await proximo(indice, "pontos", "A01");
  assert.deepEqual([item.partida, item.treino, item.gabarito, item.largura], ["gabarito", true, true, 640]);
  // 10 certos liberam
  const ids = Object.keys(itens);
  for (let k = 0; k < REGRA.pontos.n; k++) await gravarPontos(pasta, { partida: "gabarito", quadro: ids[k], pessoa: "A01", pontos: certos(itens[ids[k]]), m: k });
  const sit = await situacao(indice, "pontos", "A01");
  assert.equal(sit.liberado, true);
  assert.deepEqual([sit.gabarito_feitos, sit.gabarito_faltam, sit.acertos], [10, 4, 10]);
  for (let k = 0; k < INTERVALO_GABARITO - 1; k++) await gravarPontos(pasta, { quadro: quadro(k), pessoa: "A01", m: 20 + k });
  item = await proximo(indice, "pontos", "A01");
  assert.ok(item.partida === PARTIDA && !item.treino, "14 reais: ainda não é a vez do gabarito");
  await gravarPontos(pasta, { quadro: quadro(14), pessoa: "A01", m: 40 });
  item = await proximo(indice, "pontos", "A01");
  assert.ok(item.partida === "gabarito" && item.gabarito && !item.treino, "o 16º item é um gabarito escondido");
  await gravarPontos(pasta, { partida: "gabarito", quadro: item.quadro, pessoa: "A01", pontos: certos(itens[item.quadro]), m: 41 });
  item = await proximo(indice, "pontos", "A01");
  assert.equal(item.partida, PARTIDA, "depois do escondido, volta para os reais até mais 15");
  // "fazer o teste" depois de liberado: só itens do gabarito, com o resultado na hora
  item = await proximo(indice, "pontos", "A01", { treino: true });
  assert.ok(item.partida === "gabarito" && item.treino);
});

test("errar o gabarito não libera; o treino usa primeiro o lote de treino", async () => {
  const { pasta, indice } = await pastaExemplo();
  const controle = await criarGabaritoPontos(pasta, 4, { lote: "P2-variado", primeiro: 1101 });
  const treino = await criarGabaritoPontos(pasta, 12);
  const ids = Object.keys(treino);
  const primeiro = await proximo(indice, "pontos", "A02");
  assert.ok(ids.includes(primeiro.quadro), "o primeiro item do treino vem do lote de treino");
  for (let k = 0; k < 10; k++) {
    // marca tudo 3 px ao lado (4,5 px na referência 960): fora da meta
    const longe = certos(treino[ids[k]]).map((p) => ({ ...p, x: p.x + 3 }));
    await gravarPontos(pasta, { partida: "gabarito", quadro: ids[k], pessoa: "A02", pontos: longe, m: k });
  }
  const sit = await situacao(indice, "pontos", "A02");
  assert.equal(sit.liberado, false);
  assert.equal(sit.acertos, 0);
  assert.match(sit.motivo, /0 certos nos últimos 10/);
  const item = await proximo(indice, "pontos", "A02");
  assert.equal(item.treino, true);
  assert.ok(!ids.slice(0, 10).includes(item.quadro));
  assert.ok(ids.includes(item.quadro), "os dois que sobraram do treino vêm antes dos de controle");
  assert.ok(Object.keys(controle).length === 4);
});

test("gabarito dos jogadores: a pintura certa libera depois de 5", async () => {
  const { pasta, indice } = await pastaExemplo();
  const itens = await criarGabaritoJogadores(pasta, 6);
  const ids = Object.keys(itens);
  const v = mascaraVerdadeira();
  const certa = v.map((x) => (x === 1 || x === 2 ? 1 : 0));
  for (let k = 0; k < 5; k++) {
    const item = await proximo(indice, "jogadores", "A01");
    assert.ok(item.treino && ids.includes(item.quadro));
    assert.deepEqual([item.largura, item.altura], [64, 48]);
    await gravarJogadores(pasta, { partida: "gabarito", quadro: item.quadro, pessoa: "A01", mascara: certa, largura: 64, altura: 48, m: k });
  }
  const sit = await situacao(indice, "jogadores", "A01");
  assert.equal(sit.liberado, true);
  assert.equal(sit.resultados.length, 5);
  assert.ok(sit.resultados.every((r) => r.acerto && r.resultado.iou === 1));
  // descartar um item do gabarito conta como erro
  await gravarJogadores(pasta, { partida: "gabarito", quadro: ids[5], pessoa: "A02", mascara: null, largura: 64, altura: 48 });
  const s2 = await situacao(indice, "jogadores", "A02");
  assert.equal(s2.resultados[0].acerto, false);
  assert.equal(s2.resultados[0].resultado.descartada, true);
});

test("devolvido volta primeiro, como versão nova, partindo da versão anterior", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}, {}]);
  const nome = await gravarPontos(pasta, { quadro: quadro(0), pessoa: "A01", pontos: PONTOS });
  await gravarRevisao(pasta, { quadro: quadro(0), rotulo: nome, revisor: "A02", decisao: "devolver", comentario: "o centro está 4 px acima" });
  const item = await proximo(indice, "pontos", "A01");
  assert.equal(item.quadro, quadro(0));
  assert.equal(item.versao, 2);
  assert.deepEqual(item.devolvido, { motivo: "ponto_fora_do_lugar", comentario: "o centro está 4 px acima" });
  assert.equal(item.partiu_de.fonte, "rotulo_anterior");
  assert.equal(item.partiu_de.referencia, nome);
  assert.deepEqual(item.inicio, PONTOS);
  // nos jogadores, começa da máscara devolvida
  const m = new Uint8Array(640 * 360);
  m[5] = 1;
  const nomeJ = await gravarJogadores(pasta, { quadro: quadro(1), pessoa: "A01", mascara: m });
  await gravarRevisao(pasta, { tarefa: "jogadores", quadro: quadro(1), rotulo: nomeJ, revisor: "A02", decisao: "devolver" });
  const itemJ = await proximo(indice, "jogadores", "A01");
  assert.equal(itemJ.inicio, `${pasta.rotulos(PARTIDA, "jogadores")}/${nomeJ.replace(".json", ".png")}`);
});

test("de onde a imagem começa: a previsão do modelo, a não ser nos quadros sem previsão", async () => {
  const { pasta, indice } = await pastaExemplo();
  const fila = await criarPartida(pasta, [{}, { sem_previsao: true }]);
  for (const it of fila.itens) {
    await pasta.gravar("previsao_pontos", pasta.previsaoPontos(PARTIDA, it.quadro), {
      formato: "previsao.pontos/1",
      partida: PARTIDA,
      quadro: it.quadro,
      fonte: "detector_A",
      versao: "3f9c",
      pontos: PONTOS,
    });
    await pasta.escrever(pasta.previsaoJogadores(PARTIDA, it.quadro), Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10));
  }
  // A01 pega os dois quadros, um depois do outro
  const vistos = { pontos: new Map(), jogadores: new Map() };
  for (const tarefa of ["pontos", "jogadores"]) {
    for (let k = 0; k < 2; k++) {
      const it = await proximo(indice, tarefa, "A01");
      vistos[tarefa].set(it.quadro, it);
      if (tarefa === "pontos") await gravarPontos(pasta, { quadro: it.quadro, pessoa: "A01", pontos: PONTOS, m: k });
      else await gravarJogadores(pasta, { quadro: it.quadro, pessoa: "A01", mascara: new Uint8Array(640 * 360), m: k });
    }
  }
  const [q0, q1] = fila.itens.map((it) => it.quadro);
  assert.deepEqual(vistos.pontos.get(q0).partiu_de, { fonte: "modelo", versao: "detector_A@3f9c", referencia: null });
  assert.deepEqual(vistos.pontos.get(q0).inicio, PONTOS);
  assert.equal(vistos.pontos.get(q1).partiu_de.fonte, "nenhuma");
  assert.equal(vistos.pontos.get(q1).inicio, null);
  assert.equal(vistos.jogadores.get(q0).inicio, pasta.previsaoJogadores(PARTIDA, q0));
  assert.equal(vistos.jogadores.get(q0).partiu_de.fonte, "modelo");
  assert.equal(vistos.jogadores.get(q1).inicio, null);
});

test("revisão às cegas: qualquer pessoa menos o autor, cada rótulo uma vez, correções fora", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, Array.from({ length: 12 }, () => ({})));
  const nomes = [];
  for (let k = 0; k < 12; k++) nomes.push(await gravarPontos(pasta, { quadro: quadro(k), pessoa: "A01", pontos: k === 3 ? null : PONTOS, m: k }));
  assert.equal((await pendentesRevisao(indice, "pontos", "A01")).length, 0);
  assert.equal((await pendentesRevisao(indice, "jogadores", "A02")).length, 0);
  const deA02 = await pendentesRevisao(indice, "pontos", "A02");
  const deRS = await pendentesRevisao(indice, "pontos", "RS");
  assert.deepEqual([...deA02.map((p) => p.arquivo.nome)].sort(), [...nomes].sort()); // o descarte também se revisa
  assert.deepEqual([...deRS.map((p) => p.arquivo.nome)].sort(), [...nomes].sort());
  assert.notEqual(deA02[0].arquivo.nome, deRS[0].arquivo.nome, "cada revisor começa num ponto próprio");
  // revisado sai da fila de todos; a correção do revisor não volta para revisão
  const { arquivo } = deA02[0];
  await gravarRevisao(pasta, { quadro: arquivo.quadro, rotulo: arquivo.nome, revisor: "A02", decisao: "corrigir", nova_versao: `${arquivo.quadro}__A02__v1.json` });
  await gravarPontos(pasta, { quadro: arquivo.quadro, pessoa: "A02", pontos: PONTOS, corrige: arquivo.nome });
  for (const p of ["A02", "RS", "A01"]) {
    const depois = await pendentesRevisao(indice, "pontos", p);
    assert.equal(depois.length, p === "A01" ? 0 : 11);
    assert.ok(!depois.some((x) => x.arquivo.nome === arquivo.nome || x.arquivo.pessoa === "A02"));
  }
  const ip = await indice.partida(PARTIDA, "pontos");
  assert.equal(rotuloAprovado(ip, arquivo.quadro).pessoa, "A02"); // a correção vale como aprovada
});

test("dupla às cegas: duas pessoas anotam do zero, e a revisão só vem depois das duas", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{ dupla: true }]);
  const q = quadro(0);
  assert.equal((await proximo(indice, "pontos", "A01")).quadro, q);
  const doA01 = await gravarPontos(pasta, { quadro: q, pessoa: "A01", pontos: PONTOS, m: 1 });
  assert.equal(await proximo(indice, "pontos", "A01"), null);
  // ninguém revisa ainda: quem revisasse poderia ser a segunda pessoa e veria a resposta
  assert.deepEqual(await pendentesRevisao(indice, "pontos", "A02"), []);
  assert.deepEqual(await pendentesRevisao(indice, "pontos", "RS"), []);
  const item = await proximo(indice, "pontos", "A02");
  assert.equal(item.quadro, q);
  assert.equal(item.inicio, null); // nunca parte do rótulo do outro no mesmo quadro
  const doA02 = await gravarPontos(pasta, { quadro: q, pessoa: "A02", pontos: [{ ponto: "centro", x: 321, y: 180 }], m: 2 });
  assert.equal(await proximo(indice, "pontos", "RS"), null, "duas pessoas já anotaram");
  const nomes = async (p) => (await pendentesRevisao(indice, "pontos", p)).map((x) => x.arquivo.nome).sort();
  assert.deepEqual(await nomes("A02"), [doA01]);
  assert.deepEqual(await nomes("A01"), [doA02]);
  assert.deepEqual(await nomes("RS"), [doA01, doA02].sort());
  // A02 corrige o de A01: a correção (versão 2 de A02) não esconde o rótulo de A02, que segue esperando revisão
  await gravarPontos(pasta, { quadro: q, pessoa: "A02", pontos: PONTOS, versao: 2, corrige: doA01, m: 3 });
  await gravarRevisao(pasta, { quadro: q, rotulo: doA01, revisor: "A02", decisao: "corrigir", nova_versao: `${q}__A02__v2.json`, m: 3 });
  assert.deepEqual(await nomes("A01"), [doA02]);
  assert.equal(await proximo(indice, "pontos", "A02"), null);
  // a concordância das duas pessoas entra no placar: 1 px de 640 = 1,5 px na referência 960
  const pl = await calcularPlacar(indice, AGORA);
  assert.equal(pl.pontos.pessoas.find((p) => p.pessoa === "A01").concordancia, 1.5);
});

test("os itens escondidos do gabarito contam a partir da liberação", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, Array.from({ length: 140 }, () => ({})));
  // 100 rótulos reais feitos quando ainda não havia gabarito
  for (let k = 0; k < 100; k++) await gravarPontos(pasta, { quadro: quadro(k), pessoa: "A01", m: k });
  const itens = await criarGabaritoPontos(pasta, 20);
  const ids = Object.keys(itens);
  let item = await proximo(indice, "pontos", "A01");
  assert.ok(item.partida === "gabarito" && item.treino, "com gabarito novo, primeiro o treino");
  for (let k = 0; k < REGRA.pontos.n; k++) await gravarPontos(pasta, { partida: "gabarito", quadro: ids[k], pessoa: "A01", pontos: certos(itens[ids[k]]), m: 200 + k });
  // liberado: volta para os reais, sem uma rajada de escondidos por causa dos 100 de antes
  for (let k = 0; k < INTERVALO_GABARITO; k++) {
    item = await proximo(indice, "pontos", "A01");
    assert.ok(item.partida === PARTIDA, `real ${k + 1} depois da liberação`);
    await gravarPontos(pasta, { quadro: item.quadro, pessoa: "A01", m: 300 + k });
  }
  item = await proximo(indice, "pontos", "A01");
  assert.ok(item.partida === "gabarito" && !item.treino, "depois de 15 reais, um escondido");
  await gravarPontos(pasta, { partida: "gabarito", quadro: item.quadro, pessoa: "A01", pontos: certos(itens[item.quadro]), m: 400 });
  assert.equal((await proximo(indice, "pontos", "A01")).partida, PARTIDA, "e só um");
});

test("partida incompleta ou inválida não trava as filas nem o placar", async () => {
  const { pasta, indice } = await pastaExemplo();
  await criarPartida(pasta, [{}]);
  const semFila = "2026-11-05_estadio-sintetico_time-c-time-d";
  await criarPartida(pasta, [{}], { partida: semFila });
  await pasta.apagar(pasta.fila(semFila)); // a fila ainda não sincronizou
  const vazia = "2026-11-06_estadio-sintetico_time-e-time-f";
  await criarPartida(pasta, [{}], { partida: vazia });
  await pasta.escrever(pasta.manifesto(vazia), "", { sobrescrever: true }); // escrita interrompida
  assert.deepEqual(await pasta.listarPartidas(), [PARTIDA, semFila]);
  assert.equal((await proximo(indice, "pontos", "A01")).partida, PARTIDA);
  const nome = await gravarPontos(pasta, { quadro: quadro(0), pessoa: "A01", pontos: PONTOS });
  assert.deepEqual((await pendentesRevisao(indice, "pontos", "A02")).map((p) => p.arquivo.nome), [nome]);
  const pl = await calcularPlacar(indice, AGORA);
  assert.deepEqual(pl.pontos.partidas.map((p) => p.partida), [PARTIDA]);
  assert.equal(pl.problemas.length, 1);
  assert.equal(pl.problemas[0].partida, semFila);
  assert.match(pl.problemas[0].erro, /fila\.json/);
});
