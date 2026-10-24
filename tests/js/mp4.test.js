// O leitor de MP4 acha as mesmas amostras que o ffprobe (posição, tamanho, quadro-chave e tempo).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { lerOrigem } from "../../web/js/nucleo/convencoes.js";
import { ErroVideo, abrirMp4, apresentacao } from "../../web/js/video/mp4.js";
import { FIXTURES, lerJson } from "./apoio.js";

const PASTA = new URL("video/", FIXTURES);
const esperado = lerJson(new URL("esperado.json", PASTA));

const leitor = (bytes) => ({ tamanho: bytes.length, ler: async (pos, n) => bytes.subarray(pos, pos + n) });

for (const [nome, ref] of Object.entries(esperado)) {
  test(`amostras de ${nome} iguais às do ffprobe`, async () => {
    const bytes = new Uint8Array(readFileSync(new URL(nome, PASTA)));
    const f = await abrirMp4(leitor(bytes));
    assert.equal(f.amostras.length, ref.pacotes.length);
    assert.equal(f.largura, ref.largura);
    assert.equal(f.altura, ref.altura);
    if (ref.codec === "h264") {
      assert.match(f.codec, /^avc1\.[0-9A-F]{6}$/);
      assert.equal(f.descricao[0], 1); // configurationVersion do avcC
    } else {
      assert.match(f.codec, /^av01\.0\.\d{2}M\.08$/);
    }
    f.amostras.forEach((a, i) => {
      const p = ref.pacotes[i];
      assert.equal(a.offset, p.pos, `posição da amostra ${i}`);
      assert.equal(a.tamanho, p.tamanho, `tamanho da amostra ${i}`);
      assert.equal(a.sync, p.chave, `quadro-chave ${i}`);
    });
    const ap = apresentacao(f);
    const pts = ref.pacotes.filter((p) => !p.descartado).map((p) => p.pts_ms).sort((a, b) => a - b);
    const t0 = pts[0];
    assert.equal(ap.ordem.length, pts.length);
    ap.ptsMs.forEach((v, k) => assert.ok(Math.abs(v - (pts[k] - t0)) < 1e-6, `pts do quadro ${k}: ${v} x ${pts[k] - t0}`));
    // o tempo de cada amostra para o decodificador bate com a ordem de apresentação
    ap.ordem.forEach((i, k) => assert.equal(ap.tsUs[i], Math.round(ap.ptsMs[k] * 1000)));
    assert.equal(f.fragmentado, nome.includes("fragmentado"));
  });
}

test("arquivo cortado: as amostras que passam do fim ficam de fora", async () => {
  for (const nome of ["h264_inicio.mp4", "h264_fragmentado.mp4", "h264_fragmentado_som_antes.mp4"]) {
    const bytes = new Uint8Array(readFileSync(new URL(nome, PASTA)));
    const ref = esperado[nome].pacotes;
    const fim = ref[Math.floor(ref.length / 2)].pos + 5; // no meio de uma amostra
    const f = await abrirMp4(leitor(bytes.subarray(0, fim)));
    const inteiras = ref.filter((p) => p.pos + p.tamanho <= fim).length;
    assert.ok(inteiras > 0 && inteiras < ref.length, nome);
    assert.equal(f.amostras.length, inteiras, nome);
    // num fragmentado, os fragmentos que nem chegaram a ser gravados não contam
    assert.ok(f.cortadas > 0 && f.cortadas <= ref.length - inteiras, nome);
    if (!f.fragmentado) assert.equal(f.cortadas, ref.length - inteiras, nome);
    assert.ok(f.amostras.every((a) => a.offset + a.tamanho <= fim), nome);
  }
  const inteiro = await abrirMp4(leitor(new Uint8Array(readFileSync(new URL("h264_inicio.mp4", PASTA)))));
  assert.equal(inteiro.cortadas, 0);
});

test("arquivo sem índice ou que não é MP4", async () => {
  const bytes = new Uint8Array(readFileSync(new URL("h264_b.mp4", PASTA)));
  const semMoov = bytes.subarray(0, 200); // corta no meio dos dados
  await assert.rejects(abrirMp4(leitor(semMoov)), ErroVideo);
  const mkv = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x23, 0x42, 0x86]);
  await assert.rejects(abrirMp4(leitor(mkv)), /não parece um arquivo MP4/);
});

test("o comentário do MP4 traz a origem gravada pelo anotacao baixar", async () => {
  const abrir = async (nome) => abrirMp4(leitor(new Uint8Array(readFileSync(new URL(nome, PASTA)))));
  const baixado = await abrir("h264_baixado.mp4");
  const origem = lerOrigem(baixado.comentario);
  assert.deepEqual(origem, {
    fonte: "youtube",
    id: "dQw4w9WgXcQ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    trechos: [[300, 3000], [3900, 6600.25]],
  });
  for (const nome of ["h264_b.mp4", "h264_inicio.mp4", "av1.mp4"]) assert.equal(lerOrigem((await abrir(nome)).comentario), null, nome);
  // comentário de outro programa, ou quebrado: não é origem
  assert.equal(lerOrigem("gravado no celular"), null);
  assert.equal(lerOrigem('anotacao/1 {"fonte":"youtube"'), null);
  assert.equal(lerOrigem('anotacao/1 {"fonte":"youtube","id":"x","trechos":[[5,1]]}').trechos, null);
  assert.equal(lerOrigem('anotacao/1 {"fonte":"youtube","id":"x","trechos":[]}').trechos, null);
});
