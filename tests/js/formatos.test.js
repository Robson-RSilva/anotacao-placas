// Validação dos formatos no navegador: a mesma estrutura dos esquemas do Python e as mesmas regras.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ErroFormato, NOMES_ELEMENTOS, NOMES_PONTOS, conferir, validar } from "../../web/js/nucleo/formatos.js";
import { validarEsquema } from "../../web/js/nucleo/esquema.js";
import { PACOTE, WEB, cameraExemplo, esquemas, lerJson } from "./apoio.js";

await esquemas();

function rotulo(extra = {}) {
  const cam = cameraExemplo();
  return {
    formato: "rotulo.camera/1",
    partida: "2026-11-02_arena-x_time-a-time-b",
    pacote: "arena-x/pacote-1.0",
    quadro: "t0001234567",
    anotador: "A03",
    versao: 1,
    ferramenta: "0.2.0",
    manual: "camera-0.1",
    criado_em: "2026-11-03T14:05:11.123Z",
    segundos_ativos: 41,
    partiu_de: { fonte: "registro" },
    camera: cam.paraRotulo(),
    lado: "canonico",
    pontos_travados: [{ ponto: "ga_dir_frente_cab", x: 512.3, y: 288.1 }],
    linhas_travadas: [{ elemento: "lateral_opo", x: 1210, y: 140.5 }],
    situacao: "ok",
    comentario: "",
    residuo_mediano_px: 0.8,
    corrige: null,
    ...extra,
  };
}

test("nomes de pontos e elementos do molde", () => {
  assert.equal(NOMES_PONTOS.size, 43);
  assert.equal(NOMES_ELEMENTOS.size, 26);
});

test("rótulo válido e padrões preenchidos como no pydantic", () => {
  const r = rotulo();
  delete r.formato;
  delete r.corrige;
  delete r.camera.k1;
  validar("rotulo", r);
  assert.equal(r.formato, "rotulo.camera/1");
  assert.equal(r.corrige, null);
  assert.equal(r.camera.k1, 0);
  assert.deepEqual(r.partiu_de, { fonte: "registro", versao: null, referencia: null });
});

test("regras entre campos do rótulo", () => {
  const casos = [
    [{ camera: null, lado: null }, "situação 'ok' exige a câmera"],
    [{ situacao: "sem_marcacoes" }, "não leva câmera"],
    [{ situacao: "duvida", comentario: "  " }, "exige comentário"],
    [{ lado: "espelhado" }, "lado deveria ser 'canonico'"],
    [{ camera: null, lado: "canonico", situacao: "sem_marcacoes", pontos_travados: [], linhas_travadas: [] }, "lado só existe com câmera"],
    [{ pontos_travados: [{ ponto: "canto_qualquer", x: 1, y: 2 }] }, "ponto-chave desconhecido"],
    [{ linhas_travadas: [{ elemento: "linha_x", x: 1, y: 2 }] }, "elemento desconhecido"],
    [{ partida: "outra" }, "partida inválida"],
  ];
  for (const [extra, trecho] of casos) {
    const erros = conferir("rotulo", rotulo(extra));
    assert.ok(erros.some((e) => e.includes(trecho)), `${JSON.stringify(extra)} -> ${erros}`);
  }
  assert.deepEqual(conferir("rotulo", rotulo({ partida: "gabarito", quadro: "g0001" })), []);
});

test("estrutura: tipos, limites, padrões e campos desconhecidos", () => {
  const casos = [
    [{ versao: 0 }, "versao: deve ser ≥ 1"],
    [{ versao: 1.5 }, "versao: esperado integer"],
    [{ anotador: "a03" }, "fora do padrão"],
    [{ criado_em: "ontem" }, "data e hora inválida"],
    [{ extra: 1 }, "campo desconhecido"],
    [{ situacao: "talvez" }, "fora de"],
  ];
  for (const [extra, trecho] of casos) {
    const erros = conferir("rotulo", rotulo(extra));
    assert.ok(erros.some((e) => e.includes(trecho)), `${JSON.stringify(extra)} -> ${erros}`);
  }
  const semPan = rotulo();
  delete semPan.camera.pan;
  assert.ok(conferir("rotulo", semPan).some((e) => e.includes("camera")));
  const r = rotulo();
  r.camera.hfov_graus = 0.4;
  assert.ok(conferir("rotulo", r).some((e) => e.includes("> 0.5")));
  assert.throws(() => validar("rotulo", rotulo({ versao: -1 })), ErroFormato);
});

test("revisão: motivo só ao devolver, nova versão só ao corrigir", () => {
  const base = {
    formato: "revisao.camera/1",
    partida: "2026-11-02_arena-x_time-a-time-b",
    quadro: "t0001234567",
    rotulo: "t0001234567__A03__v1.json",
    revisor: "A05",
    versao: 1,
    decisao: "aprovar",
    motivo: null,
    comentario: "",
    nova_versao: null,
    ferramenta: "0.2.0",
    manual: "revisao-0.1",
    criado_em: "2026-11-03T15:20:00Z",
    segundos_ativos: 9,
  };
  assert.deepEqual(conferir("revisao", { ...base }), []);
  assert.ok(conferir("revisao", { ...base, decisao: "devolver" }).length);
  assert.deepEqual(conferir("revisao", { ...base, decisao: "devolver", motivo: "lado_trocado" }), []);
  assert.ok(conferir("revisao", { ...base, decisao: "devolver", motivo: "outro" }).some((e) => e.includes("comentário")));
  assert.ok(conferir("revisao", { ...base, decisao: "corrigir" }).length);
  assert.deepEqual(conferir("revisao", { ...base, decisao: "corrigir", nova_versao: "t0001234567__A05__v1.json" }), []);
});

test("pacote, equipe e divisão de exemplo; regras de unicidade", () => {
  assert.deepEqual(conferir("pacote", PACOTE()), []);
  const p = PACOTE();
  p.placas[1].id = p.placas[0].id;
  assert.ok(conferir("pacote", p).includes("IDs de placa repetidos"));
  const equipe = lerJson(new URL("exemplo/equipe.json", WEB));
  assert.deepEqual(conferir("equipe", equipe), []);
  equipe.membros[1].codigo = "A01";
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
