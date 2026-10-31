// O lote de ouro das imagens aprovadas, montado pela página (o botão "Gerar lote de ouro" da central):
// as mesmas regras de tests/test_ouro.py — rodada a rodada, sem repetir item nem id, e nunca para quem
// trabalhou na imagem.

import assert from "node:assert/strict";
import { test } from "node:test";

import { situacao } from "../../web/js/nucleo/filas.js";
import { FORA, gerarLoteReal, lerRegistro, loteDe, numerar, tamanhoJpeg } from "../../web/js/nucleo/ouro.js";
import { decodificarPng } from "../../web/js/nucleo/png.js";
import { importarZip } from "../../web/js/nucleo/transferencia.js";
import { lerZip } from "../../web/js/nucleo/zip.js";
import { PARTIDA, RH, RW, W, H, criarPartida, criarRecortes, gravarPlacas, gravarPontos, gravarRevisao, pastaExemplo } from "./apoio.js";

/** Um JPEG só com o cabeçalho (JFIF e o tamanho, no SOF0): o que o lote precisa ler dele. */
function jpeg(w, h, semente = 0) {
  return Uint8Array.of(
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, semente & 0xff,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  );
}

/**
 * Pontos: aprovado (com um ponto rente à borda), dupla com a segunda pessoa ainda sem revisão, devolvido,
 * descartado e aprovado, corrigido na revisão e sem revisão. Placas: pintado com duas coisas na frente,
 * sem nada na frente, descartado como fora do lugar e descartado por borrão.
 */
async function cenario() {
  const { pasta, indice } = await pastaExemplo();
  const fila = await criarPartida(pasta, [{}, { dupla: true }, {}, {}, {}, {}]);
  const q = fila.itens.map((it) => it.quadro);
  for (const [k, quadro] of q.entries()) await pasta.escrever(pasta.quadro(PARTIDA, quadro), jpeg(W, H, k));
  const pontos = (o) => Object.entries(o).map(([ponto, [x, y]]) => ({ ponto, x, y }));
  const n0 = await gravarPontos(pasta, { quadro: q[0], pessoa: "A01", pontos: pontos({ centro: [320, 180], canto_esq_cab: [1, 200] }) });
  await gravarRevisao(pasta, { quadro: q[0], rotulo: n0, revisor: "A02", m: 10 });
  const n1 = await gravarPontos(pasta, { quadro: q[1], pessoa: "A01", pontos: pontos({ centro: [321, 181] }) });
  await gravarRevisao(pasta, { quadro: q[1], rotulo: n1, revisor: "A03", m: 20 });
  const n1b = await gravarPontos(pasta, { quadro: q[1], pessoa: "A02", pontos: pontos({ centro: [320.5, 180.5] }), m: 5 });
  const n2 = await gravarPontos(pasta, { quadro: q[2], pessoa: "A01", pontos: pontos({ centro: [300, 100] }) });
  await gravarRevisao(pasta, { quadro: q[2], rotulo: n2, revisor: "A02", decisao: "devolver" });
  const n3 = await gravarPontos(pasta, { quadro: q[3], pessoa: "A01", pontos: null });
  await gravarRevisao(pasta, { quadro: q[3], rotulo: n3, revisor: "A02" });
  const n4 = await gravarPontos(pasta, { quadro: q[4], pessoa: "A01", pontos: pontos({ centro: [310, 170] }) });
  await gravarPontos(pasta, { quadro: q[4], pessoa: "A02", pontos: pontos({ centro: [312, 171] }), m: 25, corrige: n4 });
  await gravarRevisao(pasta, { quadro: q[4], rotulo: n4, revisor: "A02", decisao: "corrigir", nova_versao: `${q[4]}__A02__v1.json`, m: 25 });
  const n5 = await gravarPontos(pasta, { quadro: q[5], pessoa: "A01", pontos: pontos({ centro: [330, 190] }) });

  const lote = await criarRecortes(pasta, [{}, {}, {}, {}]);
  const r = lote.itens.map((it) => it.recorte);
  for (const [k, recorte] of r.entries()) await pasta.escrever(pasta.recorte(PARTIDA, recorte), jpeg(RW, RH, 10 + k));
  const m = new Uint8Array(RW * RH);
  for (let y = 20; y < 28; y++) {
    for (let x = 40; x < 50; x++) m[y * RW + x] = 1; // a da direita
    for (let x = 12; x < 20; x++) m[y * RW + x] = 1; // a da esquerda
  }
  const p0 = await gravarPlacas(pasta, { quadro: r[0], pessoa: "A01", mascara: m });
  await gravarRevisao(pasta, { tarefa: "placas", quadro: r[0], rotulo: p0, revisor: "A02", m: 1 });
  const p1 = await gravarPlacas(pasta, { quadro: r[1], pessoa: "A01", mascara: new Uint8Array(RW * RH) });
  await gravarRevisao(pasta, { tarefa: "placas", quadro: r[1], rotulo: p1, revisor: "A02", m: 2 });
  const p2 = await gravarPlacas(pasta, { quadro: r[2], pessoa: "A01", mascara: null, motivo: "placa_fora_do_lugar" });
  await gravarRevisao(pasta, { tarefa: "placas", quadro: r[2], rotulo: p2, revisor: "A02", m: 3 });
  const p3 = await gravarPlacas(pasta, { quadro: r[3], pessoa: "A01", mascara: null, motivo: "borrao" });
  await gravarRevisao(pasta, { tarefa: "placas", quadro: r[3], rotulo: p3, revisor: "A02", m: 4 });
  return { pasta, indice, q, r, nomes: { n1b, n5 } };
}

/** O conteúdo do .zip: {json: id -> objeto, bin: nome -> bytes, nomes: na ordem do .zip}. */
async function abrir(blob) {
  const out = { json: {}, bin: {}, nomes: [] };
  for await (const e of lerZip(blob)) {
    out.nomes.push(e.caminho);
    const nome = e.caminho.split("/").pop();
    if (nome.endsWith(".json")) out.json[nome.slice(0, -5)] = JSON.parse(new TextDecoder().decode(e.dados));
    else out.bin[nome] = e.dados;
  }
  return out;
}

const iguais = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test("os aprovados viram um lote de ouro, gravado na pasta, com o registro", async () => {
  const { pasta, indice, q, r } = await cenario();
  const rodada = await gerarLoteReal(indice, { agora: new Date("2026-11-04T12:00:00Z") });
  assert.equal(rodada.arquivo, "conjuntos/ouro-reais-1.zip");
  assert.equal(rodada.nome, "ouro-reais-1.zip");
  const gravado = new Uint8Array(await (await pasta.arquivo(rodada.arquivo)).arrayBuffer());
  assert.ok(iguais(gravado, new Uint8Array(await rodada.blob.arrayBuffer())), "o .zip da pasta é o que se baixa");
  const { json, bin, nomes } = await abrir(rodada.blob);
  assert.deepEqual(nomes, [
    "gabarito/itens/g5001.json", "gabarito/itens/g5001.jpg", "gabarito/itens/g5002.json", "gabarito/itens/g5002.jpg",
    "gabarito/itens/g6001.json", "gabarito/itens/g6001.jpg", "gabarito/itens/g6001.png",
    "gabarito/itens/g6002.json", "gabarito/itens/g6002.jpg", "gabarito/itens/g6002.png",
    "gabarito/itens/g6003.json", "gabarito/itens/g6003.jpg",
  ]);
  // pontos na ordem da aprovação: o aprovado aos 10 min (g5001) e o corrigido aos 25 (g5002)
  const g1 = json.g5001;
  assert.equal(g1.origem, "arbitrado");
  assert.deepEqual(g1.pontos, [
    { ponto: "centro", x: 320, y: 180, visivel: true },
    { ponto: "canto_esq_cab", x: 1, y: 200, visivel: false }, // rente à borda (menos de 3 px, ref. 960): opcional
  ]);
  assert.deepEqual(g1.fora_de, ["A01", "A02"]);
  assert.equal(g1.observacao, `rótulo real: ${PARTIDA}/${q[0]}, ${q[0]}__A01__v1.json, aprovado por A02`);
  assert.equal(g1.lote, loteDe("pontos", 1, `${PARTIDA}/${q[0]}`));
  assert.match(g1.lote, /^PR1-(treino|controle)$/);
  assert.ok(iguais(bin["g5001.jpg"], jpeg(W, H, 0)));
  const g2 = json.g5002;
  assert.deepEqual(g2.pontos.map((p) => [p.ponto, p.x]), [["centro", 312]]); // a correção de quem revisou
  assert.equal(g2.observacao, `rótulo real: ${PARTIDA}/${q[4]}, ${q[4]}__A02__v1.json, corrigido por A02`);
  assert.deepEqual(g2.fora_de, ["A01", "A02"]);
  // placas: pintado (duas coisas, numeradas da esquerda para a direita), nada na frente, fora do lugar
  const [p1, p2, p3] = [json.g6001, json.g6002, json.g6003];
  assert.deepEqual([p1.resposta, p1.oclusores, p1.mascara], ["pintar", 2, "g6001.png"]);
  const verdade = await decodificarPng(bin["g6001.png"]);
  assert.deepEqual([verdade.largura, verdade.altura], [RW, RH]);
  assert.deepEqual([verdade.dados[24 * RW + 15], verdade.dados[24 * RW + 45], verdade.dados[10 * RW + 10]], [1, 2, 0]);
  assert.deepEqual([p2.resposta, p2.oclusores], ["pintar", 0]);
  assert.ok((await decodificarPng(bin["g6002.png"])).dados.every((v) => v === 0));
  assert.deepEqual([p3.resposta, p3.oclusores, p3.mascara], ["descartar", 0, null]);
  assert.deepEqual(p1.regiao, [[8, 8], [56, 8], [56, 40], [8, 40]]);
  assert.deepEqual(p1.fora_de, ["A01", "A02"]);
  assert.ok(iguais(bin["g6003.jpg"], jpeg(RW, RH, 12)));
  // o que ficou de fora, e por quê (o devolvido e o sem revisão não têm aprovado: nem contam)
  assert.deepEqual(rodada.fora, { [FORA.esperando]: 1, [FORA.descartados]: 1, [FORA.outroDescarte]: 1 });
  assert.equal(rodada.itens, 5);
  assert.equal(Object.values(rodada.porLote).reduce((a, b) => a + b, 0), 5);
  const reg = await lerRegistro(pasta);
  assert.deepEqual(reg.itens.pontos, { [`${PARTIDA}/${q[0]}`]: "g5001", [`${PARTIDA}/${q[4]}`]: "g5002" });
  assert.deepEqual(reg.itens.placas, Object.fromEntries(r.slice(0, 3).map((x, k) => [`${PARTIDA}/${x}`, `g600${k + 1}`])));
  assert.deepEqual(reg.rodadas, [{ n: 1, criado_em: "2026-11-04T12:00:00.000Z", arquivo: "ouro-reais-1.zip", lotes: rodada.porLote }]);
  assert.deepEqual(Object.keys(rodada.porLote), Object.keys(rodada.porLote).sort());
});

test("cada rodada leva só o que é novo; sem nada novo, nada se grava", async () => {
  const { pasta, indice, q, nomes } = await cenario();
  await gerarLoteReal(indice);
  const nada = await gerarLoteReal(indice);
  assert.equal(nada.arquivo, null);
  assert.equal(nada.n, 2);
  assert.equal((await lerRegistro(pasta)).rodadas.length, 1);
  assert.equal(await pasta.arquivo("conjuntos/ouro-reais-2.zip"), null);
  // a dupla fica assentada (a revisão da segunda pessoa) e outro quadro é aprovado
  await gravarRevisao(pasta, { quadro: q[1], rotulo: nomes.n1b, revisor: "A01", m: 40 });
  await gravarRevisao(pasta, { quadro: q[5], rotulo: nomes.n5, revisor: "A02", m: 30 });
  const rodada = await gerarLoteReal(indice);
  assert.equal(rodada.arquivo, "conjuntos/ouro-reais-2.zip");
  const { json } = await abrir(rodada.blob);
  assert.deepEqual(Object.keys(json), ["g5003", "g5004"]); // os ids continuam; nada da primeira rodada se repete
  assert.deepEqual(json.g5003.fora_de, ["A01", "A02", "A03"]); // a dupla, aprovada aos 20 min
  assert.match(json.g5003.lote, /^PR2-/);
  assert.deepEqual(json.g5004.fora_de, ["A01", "A02"]);
  assert.deepEqual((await lerRegistro(pasta)).rodadas.map((x) => x.n), [1, 2]);
});

test("o mesmo conteúdo dá os mesmos bytes", async () => {
  const a = await cenario();
  const b = await cenario();
  const za = new Uint8Array(await (await gerarLoteReal(a.indice)).blob.arrayBuffer());
  const zb = new Uint8Array(await (await gerarLoteReal(b.indice)).blob.arrayBuffer());
  assert.ok(iguais(za, zb));
});

test("os ids nunca repetem os que já estão no gabarito da pasta, nem com o registro perdido", async () => {
  const { pasta, indice } = await cenario();
  await gerarLoteReal(indice);
  const zip = await pasta.arquivo("conjuntos/ouro-reais-1.zip");
  const r = await importarZip(pasta, zip);
  assert.equal(r.gravados, 12);
  await pasta.apagar("conjuntos/ouro-reais.json"); // o registro se perdeu
  const de_novo = await gerarLoteReal(indice);
  const { json } = await abrir(de_novo.blob);
  assert.deepEqual(Object.keys(json), ["g5003", "g5004", "g6004", "g6005", "g6006"]); // repete as imagens, nunca os ids
});

test("o lote entra pelo gabarito e não vale para quem trabalhou nas imagens", async () => {
  const { pasta, indice } = await cenario();
  const rodada = await gerarLoteReal(indice);
  const r = await importarZip(pasta, rodada.blob);
  assert.deepEqual([r.gravados, r.conflitos.length, r.recusados.length], [12, 0, 0]);
  const g = await indice.itensGabarito("pontos");
  assert.deepEqual(g.map((x) => x.id), ["g5001", "g5002"]);
  const a01 = await situacao(indice, "pontos", "A01");
  assert.deepEqual([a01.gabarito_total, a01.gabarito_na_pasta], [0, 2]);
  const a03 = await situacao(indice, "pontos", "A03");
  assert.equal(a03.gabarito_total, 2);
  const placas = await situacao(indice, "placas", "A03");
  assert.equal(placas.gabarito_total, 3);
});

test("um registro vazio (o Drive trazendo) ou estragado para tudo", async () => {
  const { pasta, indice } = await cenario();
  await pasta.escrever("conjuntos/ouro-reais.json", "{");
  await assert.rejects(gerarLoteReal(indice), /JSON inválido/);
  const vazio = await (await pasta.diretorio("conjuntos")).getFileHandle("ouro-reais.json");
  await (await vazio.createWritable()).close();
  await assert.rejects(gerarLoteReal(indice), /ainda está chegando/);
  await pasta.escreverJson("conjuntos/ouro-reais.json", { formato: "outro" }, { sobrescrever: true });
  await assert.rejects(gerarLoteReal(indice), /não é um registro/);
  assert.equal(await pasta.arquivo("conjuntos/ouro-reais-1.zip"), null);
});

test("a imagem que falta ou é de outro tamanho fica de fora", async () => {
  const { pasta, indice, q, r } = await cenario();
  await pasta.apagar(pasta.quadro(PARTIDA, q[0]));
  await pasta.escrever(pasta.recorte(PARTIDA, r[1]), jpeg(RW + 1, RH), { sobrescrever: true });
  const rodada = await gerarLoteReal(indice);
  assert.equal(rodada.fora[FORA.semImagem], 2);
  assert.deepEqual(Object.keys((await abrir(rodada.blob)).json), ["g5001", "g6001", "g6002"]);
});

test("tamanho do JPEG pelo cabeçalho", () => {
  assert.deepEqual(tamanhoJpeg(jpeg(640, 360)), [640, 360]);
  assert.deepEqual(tamanhoJpeg(jpeg(4000, 3000)), [4000, 3000]);
  assert.equal(tamanhoJpeg(Uint8Array.of(0x89, 0x50, 0x4e, 0x47)), null);
  assert.equal(tamanhoJpeg(jpeg(640, 360).subarray(0, 24)), null); // cortado antes do tamanho
  assert.equal(tamanhoJpeg(null), null);
});

test("numerar: cada pedaço (vizinhos em 8 direções) da esquerda para a direita", () => {
  const w = 10;
  const h = 6;
  const m = new Uint8Array(w * h);
  const p = (x, y) => {
    m[y * w + x] = 1;
  };
  p(8, 0);
  p(9, 1); // na diagonal: o mesmo pedaço (à direita)
  p(4, 4);
  p(4, 5); // no meio
  p(0, 3); // à esquerda
  const { verdade, n } = numerar(m, w, h);
  assert.equal(n, 3);
  assert.deepEqual([verdade[3 * w], verdade[4 * w + 4], verdade[5 * w + 4], verdade[8], verdade[w + 9]], [1, 2, 2, 3, 3]);
  assert.equal(verdade.filter((v) => v).length, 5);
  assert.deepEqual(numerar(new Uint8Array(w * h), w, h).n, 0);
});
