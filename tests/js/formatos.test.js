// Validação dos formatos no navegador: a mesma estrutura dos esquemas do Python e as mesmas regras.
import assert from "node:assert/strict";
import { test } from "node:test";

import { validarEsquema } from "../../web/js/nucleo/esquema.js";
import { ErroFormato, MOTIVOS, conferir, tipoDoItem, validar } from "../../web/js/nucleo/formatos.js";
import { WEB, esquemas, lerJson } from "./apoio.js";

await esquemas();

const base = (extra = {}) => ({
  partida: "2026-11-02_arena-x_time-a-time-b",
  anotador: "A03",
  versao: 1,
  ferramenta: "0.10.0",
  criado_em: "2026-11-03T14:05:11.123Z",
  segundos_ativos: 41,
  largura: 1280,
  altura: 720,
  partiu_de: { fonte: "nenhuma" },
  situacao: "ok",
  motivo_descarte: null,
  comentario: "",
  corrige: null,
  ...extra,
});

const pontos = (extra = {}) => ({
  formato: "rotulo.pontos/1",
  manual: "pontos-0.1",
  quadro: "t0001234567",
  pontos: [{ ponto: "ga_dir_frente_cab", x: 512.3, y: 288.1 }, { ponto: "centro", x: 640, y: 360 }],
  ...base(extra),
});

const RECORTE = "t0001234567_opo-03";
const placas = (extra = {}) => ({
  formato: "rotulo.placas/1",
  manual: "placas-0.1",
  recorte: RECORTE,
  mascara: `${RECORTE}__A03__v1.png`,
  pixels: 5000,
  ...base(extra),
});

test("rótulos válidos e padrões preenchidos como no pydantic", () => {
  const r = pontos();
  delete r.formato;
  delete r.corrige;
  delete r.comentario;
  validar("rotulo_pontos", r);
  assert.equal(r.formato, "rotulo.pontos/1");
  assert.equal(r.corrige, null);
  assert.equal(r.comentario, "");
  assert.deepEqual(r.partiu_de, { fonte: "nenhuma", versao: null, referencia: null });
  assert.deepEqual(conferir("rotulo_pontos", pontos({ pontos: [] })), []); // nenhum ponto à vista: vale
  assert.deepEqual(conferir("rotulo_pontos", pontos({ pontos: [], situacao: "descartada", motivo_descarte: "borrao" })), []);
  assert.deepEqual(conferir("rotulo_pontos", pontos({ partida: "gabarito", quadro: "g1001" })), []);
  assert.deepEqual(conferir("rotulo_placas", placas()), []);
  assert.deepEqual(conferir("rotulo_placas", placas({ pixels: 0 })), []);
  assert.deepEqual(conferir("rotulo_placas", placas({ mascara: null, pixels: 0, situacao: "descartada", motivo_descarte: "placa_fora_do_lugar" })), []);
  assert.deepEqual(conferir("rotulo_placas", placas({ partida: "gabarito", recorte: "g4001", mascara: "g4001__A03__v1.png" })), []);
});

test("regras entre campos do rótulo de pontos", () => {
  const casos = [
    [{ pontos: [{ ponto: "canto_qualquer", x: 1, y: 2 }] }, "ponto desconhecido"],
    [{ pontos: [{ ponto: "circ_esq", x: 1, y: 2 }] }, "ponto desconhecido"],
    [{ pontos: [{ ponto: "centro", x: 1, y: 2 }, { ponto: "centro", x: 5, y: 2 }] }, "duas vezes"],
    [{ pontos: [{ ponto: "centro", x: 1281, y: 2 }] }, "fora da imagem"],
    [{ situacao: "descartada" }, "motivo do descarte"],
    [{ motivo_descarte: "borrao" }, "motivo do descarte"],
    [{ situacao: "descartada", motivo_descarte: "borrao" }, "não leva pontos"],
    [{ pontos: [], situacao: "descartada", motivo_descarte: "outro" }, "exige comentário"],
    [{ partida: "outra" }, "partida inválida"],
    [{ quadro: "t12" }, "quadro"],
  ];
  for (const [extra, trecho] of casos) {
    const erros = conferir("rotulo_pontos", pontos(extra));
    assert.ok(erros.some((e) => e.includes(trecho)), `${JSON.stringify(extra)} -> ${erros}`);
  }
});

test("regras entre campos do rótulo das placas", () => {
  const casos = [
    [{ mascara: null, pixels: 0 }, "a máscara vem sempre"],
    [{ situacao: "descartada", motivo_descarte: "borrao" }, "a máscara vem sempre"],
    [{ mascara: null, pixels: 4, situacao: "descartada", motivo_descarte: "borrao" }, "pixels pintados só"],
    [{ mascara: "x.png" }, "nome da máscara"],
    [{ pixels: 1280 * 720 + 1 }, "mais pixels"],
    [{ recorte: "t0001234567" }, "recorte inválido"], // um quadro, não um recorte
    [{ recorte: "t0001234567_opo-03-muito-comprido-para-um-recorte-de-placa" }, "no máximo 48"],
    [{ mascara: null, pixels: 0, situacao: "descartada", motivo_descarte: "grafismo" }, "fora de"], // nas placas, se pinta
    [{ quadro: "t0001234567" }, "campo desconhecido"],
  ];
  for (const [extra, trecho] of casos) {
    const erros = conferir("rotulo_placas", placas(extra));
    assert.ok(erros.some((e) => e.includes(trecho)), `${JSON.stringify(extra)} -> ${erros}`);
  }
});

test("lote de recortes: a região dentro do recorte e cada recorte uma vez", () => {
  const item = {
    recorte: RECORTE,
    largura: 300,
    altura: 70,
    regiao: [[10, 8], [290, 8], [290, 62], [10, 62]],
    placa: [[10, 8], [290, 8], [290, 62], [10, 62]],
    no_quadro: [[512.2, 100.5], [903, 120.25], [902.5, 160], [511, 141]],
  };
  const lote = { formato: "recortes.lote/1", partida: "2026-11-02_arena-x_time-a-time-b", lote: "r1", criado_em: "2026-11-03T14:05:11Z", origem: "simulador", gerador: "teste", itens: [item] };
  const ok = structuredClone(lote);
  assert.deepEqual(conferir("lote_recortes", ok), []);
  assert.deepEqual([ok.itens[0].dupla, ok.itens[0].sem_previsao], [false, false]); // os padrões
  const com = (mudanca) => ({ ...structuredClone(lote), itens: [{ ...structuredClone(item), ...mudanca }] });
  const casos = [
    [com({ regiao: [[10, 8], [310, 8], [290, 62]] }), "sai do recorte"],
    [com({ regiao: [[10, 8], [20, 8], [30, 8]] }), "não tem área"],
    [com({ regiao: [[10, 8], [20, 8]] }), "no mínimo 3"],
    [com({ placa: [[10, 8], [290, 8], [290, 62]] }), "no mínimo 4"],
    [com({ no_quadro: [[1, 2], [3, 4], [5, 6], [7, "x"]] }), "esperado number"],
    [com({ recorte: "t0001234567" }), "fora do padrão"],
    [{ ...structuredClone(lote), itens: [item, item] }, "recorte repetido"],
    [{ ...structuredClone(lote), lote: "R1" }, "fora do padrão"],
    [{ ...structuredClone(lote), itens: [] }, "no mínimo 1"],
  ];
  for (const [obj, trecho] of casos) {
    const erros = conferir("lote_recortes", obj);
    assert.ok(erros.some((e) => e.includes(trecho)), `${trecho} -> ${erros}`);
  }
});

test("estrutura: tipos, limites, padrões e campos desconhecidos", () => {
  const casos = [
    [{ versao: 0 }, "versao: deve ser ≥ 1"],
    [{ versao: 1.5 }, "versao: esperado integer"],
    [{ anotador: "a03" }, "fora do padrão"],
    [{ criado_em: "ontem" }, "data e hora inválida"],
    [{ extra: 1 }, "campo desconhecido"],
    [{ situacao: "talvez" }, "fora de"],
    [{ motivo_descarte: "preguica", situacao: "descartada", pontos: [] }, "fora de"],
  ];
  for (const [extra, trecho] of casos) {
    const erros = conferir("rotulo_pontos", pontos(extra));
    assert.ok(erros.some((e) => e.includes(trecho)), `${JSON.stringify(extra)} -> ${erros}`);
  }
  const semX = pontos();
  delete semX.pontos[0].x;
  assert.ok(conferir("rotulo_pontos", semX).some((e) => e.includes("pontos")));
  assert.throws(() => validar("rotulo_pontos", pontos({ versao: -1 })), ErroFormato);
});

test("revisão: motivo da tarefa só ao devolver, nova versão só ao corrigir", () => {
  for (const tarefa of ["pontos", "placas"]) {
    const rev = {
      formato: `revisao.${tarefa}/1`,
      partida: "2026-11-02_arena-x_time-a-time-b",
      ...(tarefa === "pontos" ? { quadro: "t0001234567" } : { recorte: RECORTE }),
      rotulo: "t0001234567__A03__v1.json",
      revisor: "A05",
      versao: 1,
      decisao: "aprovar",
      motivo: null,
      comentario: "",
      nova_versao: null,
      ferramenta: "0.10.0",
      manual: "revisao-0.4",
      criado_em: "2026-11-03T15:20:00Z",
      segundos_ativos: 9,
    };
    const tipo = `revisao_${tarefa}`;
    const motivo = Object.keys(MOTIVOS[tarefa])[0];
    const alheio = Object.keys(MOTIVOS[tarefa === "pontos" ? "placas" : "pontos"])[0];
    assert.deepEqual(conferir(tipo, { ...rev }), []);
    assert.ok(conferir(tipo, { ...rev, decisao: "devolver" }).length);
    assert.deepEqual(conferir(tipo, { ...rev, decisao: "devolver", motivo }), []);
    assert.deepEqual(conferir(tipo, { ...rev, decisao: "devolver", motivo: "descarte_errado" }), []);
    assert.ok(conferir(tipo, { ...rev, decisao: "devolver", motivo: alheio }).length, alheio);
    assert.ok(conferir(tipo, { ...rev, decisao: "devolver", motivo: "outro" }).some((e) => e.includes("comentário")));
    assert.ok(conferir(tipo, { ...rev, decisao: "corrigir" }).length);
    assert.deepEqual(conferir(tipo, { ...rev, decisao: "corrigir", nova_versao: "t0001234567__A05__v1.json" }), []);
  }
});

test("itens do gabarito: o formato diz a tarefa; os das versões anteriores ficam de fora", () => {
  const g = {
    formato: "gabarito.pontos/1",
    id: "g1001",
    lote: "P1-treino",
    imagem: "g1001.jpg",
    largura: 1280,
    altura: 720,
    pontos: [{ ponto: "centro", x: 640, y: 360, visivel: true }, { ponto: "meio_cab", x: 650, y: 700, visivel: false }],
    origem: "simulador",
  };
  assert.deepEqual(conferir("gabarito_pontos", { ...g }), []);
  assert.ok(conferir("gabarito_pontos", { ...g, pontos: [{ ponto: "centro", x: 1, y: 1 }] }).length); // falta "visivel"
  assert.ok(conferir("gabarito_pontos", { ...g, pontos: [g.pontos[0], g.pontos[0]] }).some((e) => e.includes("duas vezes")));
  assert.deepEqual(tipoDoItem(g), { tarefa: "pontos", tipo: "gabarito_pontos" });
  assert.deepEqual(tipoDoItem({ formato: "gabarito.placas/1" }), { tarefa: "placas", tipo: "gabarito_placas" });
  assert.equal(tipoDoItem({ formato: "gabarito.camera/1" }), null);
  assert.equal(tipoDoItem({ formato: "gabarito.jogadores/1" }), null); // da 0.8: só os jogadores
  assert.equal(tipoDoItem({ formato: "gabarito.pessoas/1" }), null); // da 0.9: as pessoas no quadro inteiro
  const regiao = [[10, 8], [290, 8], [290, 62], [10, 62]];
  const j = { formato: "gabarito.placas/1", id: "g4001", imagem: "g4001.jpg", mascara: "g4001.png", largura: 300, altura: 70, regiao, oclusores: 3, origem: "simulador" };
  const ok = structuredClone(j);
  assert.deepEqual(conferir("gabarito_placas", ok), []);
  assert.equal(ok.resposta, "pintar"); // o padrão
  assert.deepEqual(conferir("gabarito_placas", { ...structuredClone(j), mascara: null, oclusores: 0, resposta: "descartar" }), []);
  assert.ok(conferir("gabarito_placas", { ...structuredClone(j), oclusores: 256 }).length);
  assert.ok(conferir("gabarito_placas", { ...structuredClone(j), resposta: "descartar" }).some((e) => e.includes("a máscara vem sempre")));
  assert.ok(conferir("gabarito_placas", { ...structuredClone(j), mascara: null, resposta: "descartar" }).some((e) => e.includes("não tem o que pintar")));
  assert.ok(conferir("gabarito_placas", { ...structuredClone(j), regiao: [[10, 8], [301, 8], [290, 62]] }).some((e) => e.includes("sai do recorte")));
  assert.ok(conferir("gabarito_placas", { ...structuredClone(j), pessoas: 1 }).some((e) => e.includes("campo desconhecido")));
});

test("manifesto: o das partidas importadas até a 0.7 (com o pacote do estádio) ainda vale", () => {
  const man = {
    formato: "manifesto.partida/1",
    partida: "2026-11-02_a_b-c",
    cadastro: {
      estadio: "a",
      emissora: "X",
      competicao: "Y",
      data_hora: "2026-11-02T16:00:00-03:00",
      mandante: "B",
      visitante: "C",
      iluminacao: "dia",
      chuva: false,
    },
    video: { nome_original: "a.mp4", sha256: "0".repeat(64), bytes: 1, duracao_s: 1, fps: 25, largura: 640, altura: 360, n_quadros: 25 },
    pre_processamento: { ferramenta: "0.10.0", criado_em: "2026-11-02T16:00:00Z", segundos: 1, parametros: {} },
  };
  assert.deepEqual(conferir("manifesto", structuredClone(man)), []);
  assert.deepEqual(conferir("manifesto", { ...structuredClone(man), pacote: "generico/pacote-1.0" }), []);
  assert.ok(conferir("manifesto", { ...structuredClone(man), pacote: "../x" }).length);
});

test("equipe e divisão; regras de unicidade", () => {
  const equipe = { formato: "equipe/1", membros: [{ codigo: "A01", nome: "A", papeis: ["anotador"] }, { codigo: "A01", nome: "B", papeis: ["revisor"] }] };
  assert.ok(conferir("equipe", equipe).includes("códigos repetidos na equipe"));
  const div = { validacao: ["2026-11-02_a_b-c"], teste_congelado: ["2026-11-02_a_b-c"], teste_externo: [] };
  assert.ok(conferir("divisao", div)[0].includes("mais de um conjunto"));
});

test("tuplas (prefixItems) e dicionários (additionalProperties)", () => {
  const esq = lerJson(new URL("esquemas/tomadas.partida.json", WEB));
  const ok = { partida: "2026-11-02_a_b-c", cortes: [3], transicoes: [[1, 4]], tomadas: [] };
  assert.deepEqual(validarEsquema(esq, ok), []);
  assert.ok(validarEsquema(esq, { ...ok, transicoes: [[1]] }).length);
  assert.ok(validarEsquema(esq, { ...ok, transicoes: [[1, "x"]] }).length);
  const man = lerJson(new URL("esquemas/manifesto.partida.json", WEB));
  const pp = man.$defs.PreProcessamento;
  const raiz = { ...man, ...pp };
  assert.deepEqual(validarEsquema(raiz, { ferramenta: "x", criado_em: "2026-01-01T00:00:00Z", segundos: 1, parametros: { a: 1, b: "x", c: true } }), []);
  assert.ok(validarEsquema(raiz, { ferramenta: "x", criado_em: "2026-01-01T00:00:00Z", segundos: 1, parametros: { a: [1] } }).length);
});
