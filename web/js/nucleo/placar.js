// Placar simples, calculado dos próprios arquivos de rótulo e revisão — um para cada tarefa.
//
// Ponto só conta depois de aprovado, para velocidade sem qualidade não subir no placar. Nada é
// gravado: cada navegador calcula o seu na hora (um arquivo de cache escrito por várias pessoas
// daria conflito no Drive).

import { distanciaCameras } from "./avaliacao.js";
import { Molde } from "./campo.js";
import { arredondar, mediana } from "./estatistica.js";
import { cameraAprovada } from "./filas-oclusao.js";
import { REGRA, liberacao, resultados, resultadosOclusao } from "./gabarito.js";
import { Camera } from "./camera.js";
import { compararMascaras, geometria, placasDoRotulo } from "./oclusao.js";

const DIA = 86_400_000;

function diaLocal(data) {
  const d = data instanceof Date ? data : new Date(data);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diasSeguidos(dias, agora) {
  let n = 0;
  let d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 12);
  if (!dias.has(diaLocal(d))) d = new Date(d.getTime() - DIA);
  while (dias.has(diaLocal(d))) {
    n += 1;
    d = new Date(d.getTime() - DIA);
  }
  return n;
}

function medianaCurta(valores, casas = 2) {
  const m = mediana((valores || []).filter((x) => x !== null && Number.isFinite(x)));
  return m === null ? null : arredondar(m, casas);
}

const _concordancias = new WeakMap(); // máscara da primeira pintura -> {outra, valor}

const lista = (mapa, chave) => {
  if (!mapa.has(chave)) mapa.set(chave, []);
  return mapa.get(chave);
};

/** O que muda de uma tarefa para outra: a concordância dos cegos e o gabarito. */
const TAREFA = {
  camera: {
    casas: 2,
    async concordancia(a1, a2, { manifesto: man, pacote }) {
      if (!a1.dados.camera || !a2.dados.camera) return null;
      const m1 = Molde.doRotulo(a1.dados, pacote); // as medidas do campo que cada pessoa usou
      const m2 = Molde.doRotulo(a2.dados, pacote);
      const d = distanciaCameras(a1.dados.camera, a2.dados.camera, pacote, m1, man.video.largura, man.video.altura, m2);
      return d ? d[0] : null;
    },
    async gabarito(indice, cod, itens) {
      return liberacao(await resultados(indice, cod, itens), itens.length > 0, REGRA.camera);
    },
  },
  oclusao: {
    casas: 4,
    /** As duas máscaras, nas placas da primeira pintura, com a tolerância de 1 px na borda. */
    async concordancia(a1, a2, { pacote }, indice) {
      const [r1, r2] = [a1.dados, a2.dados];
      if (r1.mascara === null || r2.mascara === null || r1.largura !== r2.largura || r1.altura !== r2.altura) return null;
      const dir = indice.pasta.rotulos(a1.partida, "oclusao");
      const [m1, m2] = [await indice.mascara(`${dir}/${r1.mascara}`), await indice.mascara(`${dir}/${r2.mascara}`)];
      const hit = _concordancias.get(m1); // refeita só quando uma das máscaras muda
      if (hit && hit.outra === m2) return hit.valor;
      const geo = geometria(Camera.deRotulo(r1.camera, r1.largura, r1.altura), placasDoRotulo(r1, pacote), r1.largura, r1.altura);
      const valor = compararMascaras(m1.dados, m2.dados, geo).maxima;
      _concordancias.set(m1, { outra: m2, valor });
      return valor;
    },
    async gabarito(indice, cod, itens) {
      return liberacao(await resultadosOclusao(indice, cod, itens), itens.length > 0, REGRA.oclusao);
    },
  },
};

async function placarDaTarefa(indice, agora, tarefa, prontas, nomes) {
  const regra = TAREFA[tarefa];
  const semana = agora.getTime() - 7 * DIA;
  const conta = new Map();
  const c = (cod) => {
    if (!conta.has(cod)) {
      conta.set(cod, { rotulos: 0, revisados: 0, aprovados: 0, corrigidos: 0, devolvidos: 0, aprovados_semana: 0, revisoes_feitas: 0 });
    }
    return conta.get(cod);
  };
  const temposRot = new Map();
  const temposRev = new Map();
  const dias = new Map();
  const concord = new Map();
  const revisadosSemana = new Map();
  const devolvidosSemana = new Map();
  const marcarDia = (cod, iso) => {
    if (!dias.has(cod)) dias.set(cod, new Set());
    dias.get(cod).add(diaLocal(iso));
  };
  const somar = (mapa, cod) => mapa.set(cod, (mapa.get(cod) || 0) + 1);

  const partidas = [];
  for (const p of prontas) {
    const { partida: pid, fila } = p;
    const ip = tarefa === "camera" ? p.ip : await indice.partida(pid, tarefa);
    const aprovadoQuadro = new Set();
    for (const a of ip.rotulos) {
      const r = a.dados;
      const s = c(a.pessoa);
      s.rotulos += 1;
      lista(temposRot, a.pessoa).push(r.segundos_ativos);
      marcarDia(a.pessoa, r.criado_em);
      if (r.corrige !== null) aprovadoQuadro.add(a.quadro);
      const rev = ip.ultimaRevisao(a.nome);
      if (!rev) continue;
      s.revisados += 1;
      s[{ aprovar: "aprovados", corrigir: "corrigidos", devolver: "devolvidos" }[rev.decisao]] += 1;
      if (Date.parse(rev.criado_em) >= semana) {
        somar(revisadosSemana, a.pessoa);
        if (rev.decisao === "aprovar") s.aprovados_semana += 1;
        if (rev.decisao === "devolver") somar(devolvidosSemana, a.pessoa);
      }
      if (rev.decisao === "aprovar") aprovadoQuadro.add(a.quadro);
    }
    for (const revs of ip.revisoesDe.values()) {
      for (const rv of revs) {
        c(rv.revisor).revisoes_feitas += 1;
        lista(temposRev, rv.revisor).push(rv.segundos_ativos);
        marcarDia(rv.revisor, rv.criado_em);
      }
    }
    // concordância nos rótulos cegos (quadros em dupla): o rótulo de cada pessoa, nunca uma correção
    // que ela fez revisando o da outra
    const ultimos = ip.ultimosProprios();
    const doQuadro = new Map();
    for (const a of ultimos.values()) lista(doQuadro, a.quadro).push(a);
    for (const item of fila.itens) {
      if (!item.dupla) continue;
      // as duas primeiras pessoas que anotaram o quadro
      const [a1, a2] = (doQuadro.get(item.quadro) || []).sort((x, y) => Date.parse(x.dados.criado_em) - Date.parse(y.dados.criado_em));
      if (!a1 || !a2) continue;
      let d = null;
      try {
        d = await regra.concordancia(a1, a2, p, indice);
      } catch {
        d = null; // uma máscara ilegível (ou ainda sincronizando) fica fora da concordância
      }
      if (d !== null) {
        lista(concord, a1.pessoa).push(d);
        lista(concord, a2.pessoa).push(d);
      }
    }
    let pendentes = 0;
    for (const a of ultimos.values()) if (!(ip.revisoesDe.get(a.nome) || []).length) pendentes += 1;
    const linha = {
      partida: pid,
      sorteados: fila.itens.length,
      anotados: new Set(ip.rotulos.map((a) => a.quadro)).size,
      aprovados: aprovadoQuadro.size,
      pendentes_revisao: pendentes,
    };
    if (tarefa === "oclusao") {
      // o que dá para pintar: os quadros com a câmera aprovada; e os que voltaram com "câmera errada"
      linha.elegiveis = fila.itens.filter((it) => cameraAprovada(p.ip, it.quadro)).length;
      linha.camera_errada = new Set([...ultimos.values()].filter((a) => a.dados.situacao === "camera_errada").map((a) => a.quadro)).size;
    }
    partidas.push(linha);
  }

  const itensGab = await indice.itensGabarito(tarefa);
  const temGabarito = itensGab.length > 0;
  const linhas = [];
  for (const cod of [...new Set([...nomes.keys(), ...conta.keys()])].sort()) {
    const s = c(cod);
    const lib = await regra.gabarito(indice, cod, itensGab);
    const marcos = [];
    if (s.aprovados >= 100) marcos.push("100 aprovados");
    if ((revisadosSemana.get(cod) || 0) >= 10 && !(devolvidosSemana.get(cod) || 0)) marcos.push("uma semana sem devolução");
    linhas.push({
      pessoa: cod,
      nome: nomes.get(cod) || "",
      rotulos: s.rotulos,
      aprovados: s.aprovados,
      aprovados_semana: s.aprovados_semana,
      devolvidos: s.devolvidos,
      taxa_aprovacao: s.revisados ? arredondar(s.aprovados / s.revisados, 3) : null,
      tempo_mediano_s: medianaCurta(temposRot.get(cod)),
      revisoes_feitas: s.revisoes_feitas,
      tempo_mediano_revisao_s: medianaCurta(temposRev.get(cod)),
      concordancia_px: tarefa === "camera" ? medianaCurta(concord.get(cod)) : null,
      concordancia: medianaCurta(concord.get(cod), regra.casas),
      gabarito_n: lib.n,
      gabarito_mediana_px: tarefa === "camera" && lib.mediana !== null ? arredondar(lib.mediana, 2) : null,
      gabarito_mediana: lib.mediana === null ? null : arredondar(lib.mediana, regra.casas),
      liberado: lib.liberado,
      dias_seguidos: diasSeguidos(dias.get(cod) || new Set(), agora),
      marcos,
    });
  }
  linhas.sort((x, y) => y.aprovados_semana - x.aprovados_semana || y.aprovados - x.aprovados || (x.pessoa < y.pessoa ? -1 : 1));
  const total = {};
  for (const k of Object.keys(partidas[0] ?? { sorteados: 0, anotados: 0, aprovados: 0, pendentes_revisao: 0 })) {
    if (k !== "partida") total[k] = partidas.reduce((soma, x) => soma + x[k], 0);
  }
  for (const k of ["sorteados", "anotados", "aprovados", "pendentes_revisao"]) total[k] ??= 0;
  return { pessoas: linhas, partidas, total, gabarito_importado: temGabarito };
}

/**
 * Placar da equipe e progresso das partidas: o da câmera no nível de cima (como sempre) e o da
 * oclusão em `oclusao`, com a mesma forma.
 */
export async function calcularPlacar(indice, agora = new Date()) {
  const equipe = await indice.equipe();
  const nomes = new Map(equipe.membros.map((m) => [m.codigo, m.nome]));
  const { prontas, problemas } = await indice.partidasProntas();
  const camera = await placarDaTarefa(indice, agora, "camera", prontas, nomes);
  const oclusao = await placarDaTarefa(indice, agora, "oclusao", prontas, nomes);
  return { calculado_em: agora.toISOString(), ...camera, problemas, oclusao };
}
