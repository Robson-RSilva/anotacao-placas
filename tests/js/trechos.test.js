// Trechos do vídeo escritos pela pessoa na importação, e o plano do que decodificar em cada um.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ErroTrechos,
  formatarTempo,
  formatarTrechos,
  lerTempo,
  lerTrechos,
  mesmosTrechos,
  tempoExato,
  trechosParaTexto,
} from "../../web/js/nucleo/trechos.js";
import { gruposDaPassada, planejarTrechos } from "../../web/js/video/importar.js";
import { abrirMp4, apresentacao } from "../../web/js/video/mp4.js";
import { FIXTURES, lerJson } from "./apoio.js";

const ref = lerJson(new URL("convencoes.json", FIXTURES));

test("tempo: h:mm:ss, mm:ss ou segundos, com fração", () => {
  assert.equal(lerTempo("1:05:00"), 3900);
  assert.equal(lerTempo("65:00"), 3900);
  assert.equal(lerTempo("90:00"), 5400); // o segundo tempo inteiro em minutos
  assert.equal(lerTempo(" 3900 "), 3900);
  assert.equal(lerTempo("0:00:01.5"), 1.5);
  for (const ruim of ["", "1:60", "1:5:70", "1:2:3:4", "-5", "1,5", "abc", "1:"]) assert.ok(Number.isNaN(lerTempo(ruim)), ruim);
  assert.equal(formatarTempo(3900), "1:05:00");
  assert.equal(formatarTempo(300.4), "5:00");
  assert.equal(formatarTempo(59.6), "1:00");
});

test("trechos: separadores, ordem, junção dos que se sobrepõem e vazio = o vídeo inteiro", () => {
  assert.equal(lerTrechos(""), null);
  assert.equal(lerTrechos("  ,; \n"), null);
  assert.equal(lerTrechos(undefined), null);
  assert.deepEqual(lerTrechos("0:05:00-0:50:00, 1:05:00-1:50:00"), [[300, 3000], [3900, 6600]]);
  assert.deepEqual(lerTrechos("1:05:00 – 1:50:00; 0:05:00 — 0:50:00"), [[300, 3000], [3900, 6600]]);
  assert.deepEqual(lerTrechos("5:00 a 50:00\n65:00 até 110:00"), [[300, 3000], [3900, 6600]]);
  assert.deepEqual(lerTrechos("5:00 ATÉ 6:00"), [[300, 360]]);
  assert.deepEqual(lerTrechos("5:00 até 6:00"), [[300, 360]]); // "é" escrito com acento combinado
  assert.deepEqual(lerTrechos("10-20, 15-30, 30-40, 50-60"), [[10, 40], [50, 60]]);
  assert.deepEqual(lerTrechos("0-10, 2-3"), [[0, 10]]);
});

test("os trechos e os tempos exatos dão o mesmo que no Python (o comando de baixar lê o que a página escreve)", () => {
  for (const [texto, esperado] of ref.trechos) {
    if (esperado === "erro") assert.throws(() => lerTrechos(texto), ErroTrechos, JSON.stringify(texto));
    else assert.deepEqual(lerTrechos(texto), esperado, JSON.stringify(texto));
  }
  for (const [s, texto] of ref.tempo_exato) assert.equal(tempoExato(s), texto, String(s));
  const t = [[2.2, 3.8], [300, 3000], [3900, 6600.25]];
  assert.equal(trechosParaTexto(t), "0:02.2-0:03.8, 5:00-50:00, 1:05:00-1:50:00.25");
  assert.deepEqual(lerTrechos(trechosParaTexto(t)), t);
  assert.ok(mesmosTrechos(t, [[2.2, 3.8], [300, 3000], [3900, 6600.2504]]));
  assert.ok(!mesmosTrechos(t, [[2.2, 3.8], [300, 3000]]));
  assert.ok(!mesmosTrechos(t, [[2.2, 3.8], [300, 3001], [3900, 6600.25]]));
});

test("trechos que não dá para ler, ou ao contrário, dizem qual é", () => {
  assert.throws(() => lerTrechos("0:05:00"), (e) => e instanceof ErroTrechos && e.message.includes("“0:05:00”"));
  assert.throws(() => lerTrechos("5:00-50:00, primeiro tempo"), /“primeiro tempo”/);
  assert.throws(() => lerTrechos("5:00a50:00"), ErroTrechos);
  assert.throws(() => lerTrechos("1:70-2:00"), ErroTrechos);
  assert.throws(() => lerTrechos("50:00-5:00"), /termina antes de começar/);
  assert.throws(() => lerTrechos("5:00-5:00"), /termina antes de começar/);
  assert.equal(formatarTrechos([[300, 3000], [3900, 6600]]), "5:00–50:00, 1:05:00–1:50:00");
  assert.equal(formatarTrechos(null), "");
});

const leitor = (bytes) => ({ tamanho: bytes.length, ler: async (pos, n) => bytes.subarray(pos, pos + n) });
async function abrir(nome) {
  const faixa = await abrirMp4(leitor(new Uint8Array(readFileSync(new URL(`video/${nome}`, FIXTURES)))));
  return { faixa, ap: apresentacao(faixa) };
}
const marcados = (v) => [...v].flatMap((x, i) => (x ? [i] : []));
const faixaDe = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

test("plano dos trechos: só os quadros de dentro, decodificados do quadro-chave anterior", async () => {
  // 25 quadros/s, quadros-chave nas amostras 0, 10 e 20, sem quadros B
  const { faixa, ap } = await abrir("h264_inicio.mp4");
  const p = planejarTrechos([[0.3, 0.5]], faixa, ap);
  assert.deepEqual(marcados(p.dentro), [8, 9, 10, 11, 12]); // 0,32 s a 0,48 s
  assert.equal(p.n_dentro, 5);
  assert.deepEqual(marcados(p.precisa), faixaDe(0, 20)); // do quadro-chave 0 até antes do seguinte ao fim (20)
  assert.deepEqual(p.limites, [8, 13]);
  // dois trechos: cada um com o seu pedaço, e o que fica entre eles nem é lido
  const d = planejarTrechos([[0, 0.1], [0.82, 2]], faixa, ap);
  assert.deepEqual(marcados(d.dentro), [0, 1, 2, ...faixaDe(21, 26)]);
  assert.deepEqual(marcados(d.precisa), [...faixaDe(0, 10), ...faixaDe(20, 26)]);
  assert.deepEqual(d.limites, [0, 3, 21, 26]);
  // o fim não entra: 0,32 s a 0,48 s são os quadros 8 a 11
  assert.deepEqual(marcados(planejarTrechos([[0.32, 0.48]], faixa, ap).dentro), [8, 9, 10, 11]);
  // fora do vídeo: nada
  const fora = planejarTrechos([[5, 6]], faixa, ap);
  assert.equal(fora.n_dentro, 0);
  assert.deepEqual(fora.limites, []);
  assert.deepEqual(marcados(fora.precisa), []);
});

test("plano dos trechos com quadros B: a ordem de decodificação não é a de exibição", async () => {
  // quadros-chave nas amostras 0, 8, 16 e 24; as amostras 8 a 11 exibem 0,32 / 0,44 / 0,36 / 0,40 s
  const { faixa, ap } = await abrir("h264_b.mp4");
  const p = planejarTrechos([[0.34, 0.45]], faixa, ap);
  assert.deepEqual(marcados(p.dentro), [9, 10, 11]);
  assert.deepEqual(p.dentro.reduce((s, x, k) => (x ? [...s, ap.ordem[k]] : s), []).sort((a, b) => a - b), [9, 10, 11]);
  assert.deepEqual(marcados(p.precisa), faixaDe(8, 16)); // o grupo inteiro, a partir do quadro-chave 8
  assert.deepEqual(p.limites, [9, 12]);
});

test("depois de voltar a um quadro-chave aceito, só os grupos próximos vão na mesma passada", () => {
  // quadros-chave a cada 0,5 s (amostras 0, 12, 24, ...), 25 quadros/s
  const tsUs = Array.from({ length: 3000 }, (_, i) => i * 40_000);
  const sincronos = Array.from({ length: 250 }, (_, p) => 12 * p);
  const g = (p, ultimo) => ({ p, ultimo });
  // primeiro trecho: grupos que começam 0,8 s e 11 s depois do último alvo do anterior; o segundo
  // trecho começa 84 s depois
  const grupos = [g(10, 125), g(12, 150), g(35, 425), g(210, 2525), g(212, 2550)];
  assert.equal(gruposDaPassada(grupos, sincronos, tsUs), 3);
  assert.equal(gruposDaPassada(grupos.slice(3), sincronos, tsUs), 2);
  assert.equal(gruposDaPassada(grupos, sincronos, tsUs, 1e6), 2);
  assert.equal(gruposDaPassada([g(10, 125)], sincronos, tsUs), 1);
});
