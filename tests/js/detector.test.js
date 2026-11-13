// O detector no navegador contra o laboratório: a preparação da imagem (igual, byte a byte, à do OpenCV), a
// decodificação dos mapas (a do `modelo.py`) e a rede rodando no ONNX Runtime Web — com os casos gerados
// pelo próprio laboratório (scripts/casos_do_detector.py: uma rede pequena com pesos sorteados).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import {
  CORTE_ESCORE,
  decodificar,
  janelaBase,
  paraTensor,
  pontosParaGravar,
  prepararEntrada,
  prepararImagem,
  reduzirArea,
} from "../../web/js/nucleo/detector.js";
import { conferirCartao, idDoModelo, listarModelos, modeloEmUso, pedePrevisao } from "../../web/js/nucleo/modelos.js";
import { Pasta } from "../../web/js/nucleo/pasta.js";
import { ErroDetector, abrirDetector, preverQuadros, usarWasm } from "../../web/js/video/previsao.js";
import { FIXTURES, PARTIDA, PastaMemoria, criarPartida, esquemas, lerJson, pastaExemplo } from "./apoio.js";

await esquemas();

const DIR = new URL("detector/", FIXTURES);
const casos = lerJson(new URL("casos.json", DIR));
const cartao = lerJson(new URL("cartao.json", DIR));
const onnx = readFileSync(new URL("detector.onnx", DIR));
const [IW, IH] = casos.entrada;
const bytes = (b64) => new Uint8Array(gunzipSync(Buffer.from(b64, "base64")));

/** A imagem dos casos (rampas com o ruído de um hash dos índices), como `imagem_conta` do gerador. */
function imagemConta(w, h) {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let v = (Math.imul(x, 2654435761 | 0) + Math.imul(y, 2246822519 | 0) + Math.imul(c, 3266489917 | 0)) >>> 0;
        v = (v ^ (v >>> 15)) >>> 0;
        v = Math.imul(v, 2246822519 | 0) >>> 0;
        v = (v ^ (v >>> 13)) >>> 0;
        out[(y * w + x) * 3 + c] = ((x * 3 + y * 5 + c * 50) % 192) + ((v >>> 24) % 64);
      }
    }
  }
  return out;
}

const paraRgba = (bgr, n) => {
  const rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    rgba[4 * i] = bgr[3 * i + 2];
    rgba[4 * i + 1] = bgr[3 * i + 1];
    rgba[4 * i + 2] = bgr[3 * i];
    rgba[4 * i + 3] = 255;
  }
  return rgba;
};

test("a janela: a proporção da entrada, centrada, com a imagem inteira dentro", () => {
  const [a, b, c, d] = janelaBase(1920, 1080, 896, 504); // 16:9: a imagem inteira, sem faixas
  assert.ok(Math.abs(a) < 1e-9 && Math.abs(b) < 1e-9 && c === 1920 && Math.abs(d - 1080) < 1e-9);
  const [x0, y0, bw, bh] = janelaBase(1440, 1080, 896, 504); // 4:3: faixas dos lados
  assert.deepEqual([x0, y0, bh], [-240, 0, 1080]);
  assert.ok(Math.abs(bw - 1920) < 1e-9);
});

test("a imagem de entrada da rede é a do OpenCV, byte a byte, em todos os caminhos do preparar", () => {
  assert.equal(casos.preparacao.length, 7);
  for (const c of casos.preparacao) {
    const { imagem, janela } = prepararImagem(imagemConta(c.largura, c.altura), c.largura, c.altura, IW, IH);
    const esperado = bytes(c.entrada_bgr);
    let diferentes = 0;
    for (let i = 0; i < esperado.length; i++) if (imagem[i] !== esperado[i]) diferentes += 1;
    assert.equal(diferentes, 0, `${c.nome}: ${diferentes} bytes diferentes do OpenCV`);
    janela.forEach((v, i) => assert.ok(Math.abs(v - c.janela[i]) < 1e-12, `${c.nome}: janela ${janela} ≠ ${c.janela}`));
  }
});

test("o tensor: BGR em planos, dividido por 255; do RGBA do canvas dá o mesmo", () => {
  const img = Uint8Array.of(10, 20, 30, 255, 0, 128);
  const t = paraTensor(img, 2, 1);
  assert.deepEqual([...t], [10 / 255, 255 / 255, 20 / 255, 0, 30 / 255, 128 / 255].map(Math.fround));
  const c = casos.preparacao[0];
  const bgr = imagemConta(c.largura, c.altura);
  const { tensor, janela } = prepararEntrada(paraRgba(bgr, c.largura * c.altura), c.largura, c.altura, IW, IH);
  assert.deepEqual([...tensor], [...paraTensor(bytes(c.entrada_bgr), IW, IH)]);
  assert.deepEqual(janela, c.janela);
});

test("a INTER_AREA só reduz; no mesmo tamanho, copia", () => {
  const img = Uint8Array.from({ length: 12 }, (_, i) => i);
  assert.deepEqual([...reduzirArea(img, 2, 2, 2, 2)], [...img]);
  assert.throws(() => reduzirArea(img, 2, 2, 4, 4), /só reduz/);
});

/** Mapas sintéticos (K canais de h × w): os logits num valor baixo, com os picos pedidos. */
function mapas(K, h, w, picos) {
  const kp = new Float32Array(K * h * w).fill(-8);
  const off = new Float32Array(2 * h * w).fill(0.5);
  for (const { k, jx, jy, logit, ox = 0.5, oy = 0.5 } of picos) {
    kp[k * h * w + jy * w + jx] = logit;
    off[jy * w + jx] = ox;
    off[h * w + jy * w + jx] = oy;
  }
  return { kp, off, altura: h, largura: w };
}

test("a decodificação: um ponto por canal, o corte, só os marcáveis, a supressão e a volta pela janela", () => {
  const k = cartao.contrato;
  const nome = (n) => k.saidas.kp.nomes.indexOf(n);
  const h = 36;
  const w = 64;
  const s = mapas(k.saidas.kp.nomes.length, h, w, [
    { k: nome("centro"), jx: 30, jy: 20, logit: 3, ox: 0.25, oy: 0.75 },
    { k: nome("meio_cab"), jx: 31, jy: 21, logit: 1 }, // a 1,4 célula do centro, escore menor: sai na supressão
    { k: nome("penalti_dir"), jx: 50, jy: 10, logit: -0.5 }, // escore 0,38: abaixo do corte
    { k: nome("circ_esq"), jx: 5, jy: 5, logit: 4 }, // não se marca
    { k: nome("canto_esq_cab"), jx: 2, jy: 30, logit: 2 },
  ]);
  const janela = [-40, 0, 0.4, 0.4];
  const pontos = decodificar(s, k, janela, CORTE_ESCORE);
  assert.deepEqual(
    pontos.map((p) => p.ponto),
    ["canto_esq_cab", "centro"], // na ordem dos canais
  );
  const c = pontos[1];
  assert.equal(c.x, ((30 + 0.25) * 2) / 0.4 - 40);
  assert.equal(c.y, ((20 + 0.75) * 2) / 0.4);
  assert.equal(c.escore, Math.fround(1 / (1 + Math.exp(-3))));
  // sem corte, o pênalti entra; o meio continua fora (perto do centro, que tem escore maior)
  assert.deepEqual(
    decodificar(s, k, janela, 0).map((p) => p.ponto).filter((n) => ["centro", "meio_cab", "penalti_dir"].includes(n)),
    ["centro", "penalti_dir"],
  );
});

test("a decodificação: no empate da sigmoide saturada, vale a primeira célula (como no PyTorch)", () => {
  const k = cartao.contrato;
  const c = k.saidas.kp.nomes.indexOf("centro");
  const s = mapas(k.saidas.kp.nomes.length, 4, 8, [
    { k: c, jx: 6, jy: 1, logit: 17.5 },
    { k: c, jx: 2, jy: 3, logit: 25 }, // logit maior, mas a sigmoide em float32 dá 1 nos dois
  ]);
  const [p] = decodificar(s, k, [0, 0, 1, 1], 0.5).filter((x) => x.ponto === "centro");
  assert.deepEqual([p.x, p.y, p.escore], [13, 3, 1]);
});

test("o que se grava: só os pontos dentro da imagem, com 2 casas, por nome", () => {
  const pontos = [
    { ponto: "meio_cab", x: 10.123456, y: 5.5, escore: 0.9 },
    { ponto: "centro", x: 241, y: 3, escore: 0.9 }, // fora (a imagem tem 240 de largura)
    { ponto: "canto_esq_cab", x: 0, y: 180, escore: 0.9 }, // na borda: vale
  ];
  assert.deepEqual(pontosParaGravar(pontos, 240, 180), [
    { ponto: "canto_esq_cab", x: 0, y: 180 },
    { ponto: "meio_cab", x: 10.12, y: 5.5 },
  ]);
});

// ------------------------------------------------------------------------------------- a rede de verdade
// no Node, o fetch não lê arquivos: o motor do ONNX Runtime vai em bytes (no navegador, ele mesmo busca)
const VENDOR = new URL("../../web/vendor/onnxruntime-web/", import.meta.url);
usarWasm(readFileSync(new URL("ort-wasm-simd-threaded.wasm", VENDOR)));
let ort = null;
async function sessao() {
  if (!ort) {
    ort = await import(new URL("ort.wasm.bundle.min.js", VENDOR).href);
    ort.env.wasm.wasmBinary = readFileSync(new URL("ort-wasm-simd-threaded.wasm", VENDOR));
    ort.env.wasm.numThreads = 1;
  }
  return ort.InferenceSession.create(onnx, { executionProviders: ["wasm"] });
}

test("a rede no ONNX Runtime Web dá os pontos do modelo.py (com o corte da página e sem corte)", async () => {
  const s = await sessao();
  const k = cartao.contrato;
  for (const c of casos.rede) {
    const n = c.largura * c.altura;
    const { tensor, janela } = prepararEntrada(paraRgba(imagemConta(c.largura, c.altura), n), c.largura, c.altura, IW, IH);
    const r = await s.run({ [k.onnx.entrada.nome]: new ort.Tensor("float32", tensor, [1, 3, IH, IW]) });
    const saidas = { kp: r.kp.data, off: r.off.data, altura: r.kp.dims[2], largura: r.kp.dims[3] };
    for (const [limiar, esperado] of [
      [CORTE_ESCORE, c.pontos_com_corte],
      [0, c.pontos_sem_corte],
    ]) {
      const pontos = decodificar(saidas, k, janela, limiar);
      assert.deepEqual(
        pontos.map((p) => p.ponto),
        esperado.map((p) => p.ponto),
        `${c.nome}, limiar ${limiar}`,
      );
      pontos.forEach((p, i) => {
        const e = esperado[i];
        assert.ok(Math.abs(p.x - e.x) < 1e-3 && Math.abs(p.y - e.y) < 1e-3, `${c.nome} ${p.ponto}: (${p.x}, ${p.y}) ≠ (${e.x}, ${e.y})`);
        assert.ok(Math.abs(p.escore - e.escore) < 1e-5, `${c.nome} ${p.ponto}: escore ${p.escore} ≠ ${e.escore}`);
      });
    }
  }
  await s.release();
});

// ------------------------------------------------------------------------------------- o modelo na pasta
test("o cartão do modelo: o que a página precisa para rodar", () => {
  assert.deepEqual(conferirCartao(cartao), []);
  assert.equal(idDoModelo(cartao), `detector-teste@${cartao.arquivos.sha256_onnx.slice(0, 12)}`);
  assert.match(conferirCartao({ formato: "outro" })[0], /não é o cartão/);
  const semOnnx = structuredClone(cartao);
  delete semOnnx.arquivos.onnx; // exportado antes da 0.7.0 do laboratório
  assert.match(conferirCartao(semOnnx).join(), /a partir da 0\.7\.0/);
  const estranho = structuredClone(cartao);
  estranho.contrato.nomes.marcaveis.push("bandeira_de_escanteio");
  assert.match(conferirCartao(estranho).join(), /não conhece: bandeira_de_escanteio/);
});

/** Uma pasta com os modelos `{nome: cartão}` em modelos/ (o ONNX da fixture em cada um). */
async function pastaComModelos(modelos) {
  const pasta = new Pasta(new PastaMemoria());
  await pasta.criar();
  for (const [nome, c] of Object.entries(modelos)) {
    if (c) await pasta.escreverJson(pasta.cartaoModelo(nome), c);
    await pasta.escrever(pasta.arquivoModelo(nome, "detector.onnx"), new Uint8Array(onnx));
  }
  return pasta;
}

test("os modelos da pasta: vale o mais novo que dá para usar", async () => {
  const velho = { ...structuredClone(cartao), nome: "velho", criado_em: "2026-01-01T00:00:00+00:00" };
  const novo = { ...structuredClone(cartao), nome: "novo", criado_em: "2026-11-01T00:00:00+00:00" };
  const quebrado = { ...structuredClone(cartao), criado_em: "2026-12-01T00:00:00+00:00" };
  quebrado.arquivos = { ...quebrado.arquivos, onnx: undefined };
  const pasta = await pastaComModelos({ "detector-v0": velho, "detector-v1": novo, "detector-v2": quebrado, "sem-cartao": null });
  const lista = await listarModelos(pasta);
  assert.deepEqual(
    lista.map((m) => [m.nome, Boolean(m.erro)]),
    [["detector-v1", false], ["detector-v0", false], ["detector-v2", true], ["sem-cartao", true]],
  );
  assert.equal(lista.find((m) => m.nome === "sem-cartao").erro, "falta o cartao.json");
  assert.equal((await modeloEmUso(pasta)).nome, "detector-v1");
  assert.equal(await modeloEmUso(new Pasta(new PastaMemoria())), null); // sem a pasta modelos/
});

test("abrir o modelo: confere o sha256 do ONNX e abre a sessão no ONNX Runtime Web", async () => {
  const pasta = await pastaComModelos({ "detector-teste": cartao });
  const d = await abrirDetector(pasta, "detector-teste");
  assert.deepEqual([d.fonte, d.versao, d.id], ["detector-teste", cartao.arquivos.sha256_onnx.slice(0, 12), idDoModelo(cartao)]);
  await d.fechar();
  await pasta.escrever(pasta.arquivoModelo("detector-teste", "detector.onnx"), new Uint8Array(onnx.subarray(0, 1000)), { sobrescrever: true });
  await assert.rejects(abrirDetector(pasta, "detector-teste"), (e) => e instanceof ErroDetector && /sha256 não bate/.test(e.message));
  await assert.rejects(abrirDetector(pasta, "nao-existe"), (e) => e instanceof ErroDetector && /falta o cartao.json/.test(e.message));
});

// ------------------------------------------------------------------------------------- as previsões
/** Um detector de mentira: os mesmos pontos em todo quadro (ou falha nos quadros pedidos). */
function detectorFalso({ falhar = new Set() } = {}) {
  const vistos = [];
  return {
    fonte: "detector-teste",
    versao: "a7b398163c80",
    vistos,
    async prever(blob) {
      const q = blob.name ?? "";
      vistos.push(q);
      if ([...falhar].some((f) => q.startsWith(f))) throw new Error("a rede caiu");
      return { pontos: [{ ponto: "centro", x: 320, y: 180 }], largura: 640, altura: 360 };
    },
  };
}

test("as previsões dos quadros: os sem previsão e os da dupla ficam do zero; o resto ganha os pontos", async () => {
  const { pasta } = await pastaExemplo();
  const fila = await criarPartida(pasta, [{}, { sem_previsao: true }, { dupla: true }, {}, {}]);
  for (const it of fila.itens) await pasta.escrever(pasta.quadro(PARTIDA, it.quadro), new Uint8Array([255, 216, 255]));
  const q = fila.itens.map((it) => it.quadro);
  assert.deepEqual(fila.itens.map(pedePrevisao), [true, false, false, true, true]);
  const det = detectorFalso();
  const progresso = [];
  const r = await preverQuadros(pasta, PARTIDA, fila.itens, det, { pular: new Set([q[4]]), aoProgresso: (f) => progresso.push(f) });
  assert.deepEqual([r.previstos, r.pontos, r.ficaram_do_zero, r.pulados, r.falhas], [2, 2, 2, 1, 0]);
  assert.deepEqual(progresso, [0, 0.5, 1]);
  assert.deepEqual(await pasta.lerJson(pasta.previsaoPontos(PARTIDA, q[0])), { formato: "previsao.pontos/1", partida: PARTIDA, quadro: q[0], fonte: "detector-teste", versao: "a7b398163c80", pontos: [{ ponto: "centro", x: 320, y: 180 }] });
  for (const k of [1, 2, 4]) assert.equal(await pasta.existe(pasta.previsaoPontos(PARTIDA, q[k])), false);
  // de novo, mantendo as que já existem: nada a fazer
  const de_novo = await preverQuadros(pasta, PARTIDA, fila.itens, det, { manter: async (x) => pasta.existe(pasta.previsaoPontos(PARTIDA, x)) });
  assert.deepEqual([de_novo.previstos, de_novo.mantidos], [1, 2]); // só o q[4], que antes tinha sido pulado
});

test("as previsões: um quadro que falha fica sem; três falhas seguidas logo no começo param tudo", async () => {
  const { pasta } = await pastaExemplo();
  const fila = await criarPartida(pasta, [{}, {}, {}, {}]);
  for (const it of fila.itens) await pasta.escrever(pasta.quadro(PARTIDA, it.quadro), new Uint8Array([255, 216, 255]));
  const q = fila.itens.map((it) => it.quadro);
  const r = await preverQuadros(pasta, PARTIDA, fila.itens, detectorFalso({ falhar: new Set([q[1]]) }));
  assert.deepEqual([r.previstos, r.falhas, r.erro], [3, 1, "a rede caiu"]);
  await assert.rejects(
    preverQuadros(pasta, PARTIDA, fila.itens, detectorFalso({ falhar: new Set(["t"]) })),
    (e) => e instanceof ErroDetector && /falhou nos primeiros quadros: a rede caiu/.test(e.message),
  );
  // quadro sem imagem (ainda sincronizando): fica para a próxima
  await pasta.apagar(pasta.quadro(PARTIDA, q[3]));
  const sem = await preverQuadros(pasta, PARTIDA, fila.itens, detectorFalso());
  assert.deepEqual([sem.previstos, sem.sem_imagem], [3, 1]);
});
