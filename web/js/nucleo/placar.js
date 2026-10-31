// Placar simples, calculado dos próprios arquivos de rótulo e revisão — um para cada tarefa.
//
// Ponto só conta depois de aprovado, para velocidade sem qualidade não subir no placar. Nada é
// gravado: cada navegador calcula o seu na hora (um arquivo de cache escrito por várias pessoas
// daria conflito no Drive).
//
// Os tempos são o tempo ativo gravado em cada arquivo (a página só conta enquanto há uso). O tempo
// por imagem é o dos rótulos da própria pessoa: sem os descartes (levam segundos e não dizem quanto
// custa anotar) e sem as correções que ela fez revisando — essas são trabalho de revisão e contam no
// tempo por revisão, junto com as aprovações e as devoluções.

import { Molde } from "./campo.js";
import { REF_W } from "./convencoes.js";
import { arredondar, mediana } from "./estatistica.js";
import { rotuloAprovado } from "./filas.js";
import { REGRA, gabaritoDaPessoa, liberacao, resultados } from "./gabarito.js";
import { mascaraDaRegiao } from "./regiao.js";

const DIA = 86_400_000;
const CAMPO = Molde.doCampo();

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

const lista = (mapa, chave) => {
  if (!mapa.has(chave)) mapa.set(chave, []);
  return mapa.get(chave);
};

/**
 * Concordância de dois rótulos de pontos do mesmo quadro: a distância mediana (px, ref. 960) dos
 * pontos que os dois marcaram — vista do mesmo lado do campo ou do outro, a que casa mais pontos.
 * null quando não há ponto em comum.
 */
export function concordanciaPontos(r1, r2) {
  const escala = REF_W / r1.largura;
  const de2 = new Map(r2.pontos.map((p) => [p.ponto, p]));
  let melhor = null;
  for (const girar of [false, true]) {
    const d = [];
    for (const p of r1.pontos) {
      const q = de2.get(girar ? CAMPO.espelharPonto(p.ponto) : p.ponto);
      if (q) d.push(Math.hypot(p.x - q.x, p.y - q.y) * escala);
    }
    const m = mediana(d);
    if (m !== null && (!melhor || d.length > melhor.n || (d.length === melhor.n && m < melhor.m))) melhor = { n: d.length, m };
  }
  return melhor ? melhor.m : null;
}

/**
 * Concordância de duas pinturas do mesmo recorte: a sobreposição (IoU) dentro da região da placa
 * (`regiao`: 1 dentro, 0 fora; sem ela, o recorte todo), sem a borda de 1 px de cada uma.
 */
export function concordanciaPlacas(a, b, w, h, regiao = null) {
  const borda = (m, x, y) => {
    const v = m[y * w + x] ? 1 : 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && (m[yy * w + xx] ? 1 : 0) !== v) return true;
      }
    }
    return false;
  };
  let inter = 0;
  let uniao = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((!a[i] && !b[i]) || (regiao && !regiao[i])) continue;
      if (borda(a, x, y) || borda(b, x, y)) continue;
      uniao += 1;
      if (a[i] && b[i]) inter += 1;
    }
  }
  return uniao ? inter / uniao : 1;
}

const _concordancias = new WeakMap(); // máscara do primeiro rótulo -> {outra, valor}

/** O que muda de uma tarefa para outra: a concordância dos rótulos às cegas (`item`: o da fila). */
const CONCORDANCIA = {
  pontos: async (a1, a2) => {
    if (a1.dados.situacao !== "ok" || a2.dados.situacao !== "ok") return null;
    return concordanciaPontos(a1.dados, a2.dados);
  },
  placas: async (a1, a2, indice, item) => {
    const [r1, r2] = [a1.dados, a2.dados];
    if (r1.mascara === null || r2.mascara === null || r1.largura !== r2.largura || r1.altura !== r2.altura) return null;
    const dir = indice.pasta.rotulos(a1.partida, "placas");
    const [m1, m2] = [await indice.mascara(`${dir}/${r1.mascara}`), await indice.mascara(`${dir}/${r2.mascara}`)];
    const hit = _concordancias.get(m1); // refeita só quando uma das máscaras muda
    if (hit && hit.outra === m2) return hit.valor;
    const regiao = item.regiao ? mascaraDaRegiao(item.regiao, r1.largura, r1.altura) : null;
    const valor = concordanciaPlacas(m1.dados, m2.dados, r1.largura, r1.altura, regiao);
    _concordancias.set(m1, { outra: m2, valor });
    return valor;
  },
};

async function placarDaTarefa(indice, agora, tarefa, nomes) {
  const { prontas, problemas } = await indice.partidasProntas(tarefa);
  const semana = agora.getTime() - 7 * DIA;
  const conta = new Map();
  const c = (cod) => {
    if (!conta.has(cod)) {
      conta.set(cod, { rotulos: 0, revisados: 0, aprovados: 0, corrigidos: 0, devolvidos: 0, aprovados_semana: 0, revisoes_feitas: 0, descartadas: 0 });
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
    const { partida: pid, fila, ip } = p;
    for (const a of ip.rotulos) {
      const r = a.dados;
      if (r.corrige !== null) continue; // correção feita revisando: o tempo dela está na revisão
      const s = c(a.pessoa);
      s.rotulos += 1;
      if (r.situacao === "descartada") s.descartadas += 1;
      else lista(temposRot, a.pessoa).push(r.segundos_ativos);
      marcarDia(a.pessoa, r.criado_em);
      const rev = ip.ultimaRevisao(a.nome);
      if (!rev) continue;
      s.revisados += 1;
      s[{ aprovar: "aprovados", corrigir: "corrigidos", devolver: "devolvidos" }[rev.decisao]] += 1;
      if (Date.parse(rev.criado_em) >= semana) {
        somar(revisadosSemana, a.pessoa);
        if (rev.decisao === "aprovar") s.aprovados_semana += 1;
        if (rev.decisao === "devolver") somar(devolvidosSemana, a.pessoa);
      }
    }
    for (const revs of ip.revisoesDe.values()) {
      for (const rv of revs) {
        c(rv.revisor).revisoes_feitas += 1;
        lista(temposRev, rv.revisor).push(rv.segundos_ativos);
        marcarDia(rv.revisor, rv.criado_em);
      }
    }
    // concordância nos rótulos às cegas (itens em dupla): o rótulo de cada pessoa, nunca uma
    // correção que ela fez revisando o da outra
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
        d = await CONCORDANCIA[tarefa](a1, a2, indice, item);
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
    let aprovados = 0;
    let descartados = 0;
    for (const item of fila.itens) {
      const a = rotuloAprovado(ip, item.quadro);
      if (!a) continue;
      aprovados += 1;
      if (a.dados.situacao === "descartada") descartados += 1;
    }
    partidas.push({
      partida: pid,
      sorteados: fila.itens.length,
      anotados: new Set(ip.rotulos.map((a) => a.quadro)).size,
      aprovados,
      descartados,
      pendentes_revisao: pendentes,
    });
  }

  const itensGab = await indice.itensGabarito(tarefa);
  const linhas = [];
  for (const cod of [...new Set([...nomes.keys(), ...conta.keys()])].sort()) {
    const s = c(cod);
    const daPessoa = gabaritoDaPessoa(itensGab, cod);
    const res = await resultados(indice, tarefa, cod, daPessoa);
    const lib = liberacao(res, daPessoa.length > 0, REGRA[tarefa]);
    const marcos = [];
    if (s.aprovados >= 100) marcos.push("100 aprovados");
    if ((revisadosSemana.get(cod) || 0) >= 10 && !(devolvidosSemana.get(cod) || 0)) marcos.push("uma semana sem devolução");
    linhas.push({
      pessoa: cod,
      nome: nomes.get(cod) || "",
      rotulos: s.rotulos,
      descartadas: s.descartadas,
      aprovados: s.aprovados,
      aprovados_semana: s.aprovados_semana,
      devolvidos: s.devolvidos,
      taxa_aprovacao: s.revisados ? arredondar(s.aprovados / s.revisados, 3) : null,
      tempo_mediano_s: medianaCurta(temposRot.get(cod), 0),
      revisoes_feitas: s.revisoes_feitas,
      tempo_mediano_revisao_s: medianaCurta(temposRev.get(cod), 0),
      concordancia: medianaCurta(concord.get(cod), tarefa === "pontos" ? 2 : 3),
      gabarito_n: res.length,
      gabarito_acertos: res.filter((r) => r.acerto).length,
      liberado: lib.liberado,
      dias_seguidos: diasSeguidos(dias.get(cod) || new Set(), agora),
      marcos,
    });
  }
  linhas.sort((x, y) => y.aprovados_semana - x.aprovados_semana || y.aprovados - x.aprovados || (x.pessoa < y.pessoa ? -1 : 1));
  const total = {};
  for (const k of ["sorteados", "anotados", "aprovados", "descartados", "pendentes_revisao"]) total[k] = partidas.reduce((soma, x) => soma + x[k], 0);
  return { equipe: linhas, partidas, total, problemas, gabarito_importado: itensGab.length > 0 };
}

/**
 * Placar da equipe e progresso das partidas, um para cada tarefa: {pontos, placas, problemas}; em
 * cada tarefa, `equipe` tem uma linha por código e `partidas` uma por partida (nas placas, `sorteados`
 * são os recortes dos lotes dela).
 */
export async function calcularPlacar(indice, agora = new Date()) {
  const equipe = await indice.equipe();
  const nomes = new Map(equipe.membros.map((m) => [m.codigo, m.nome]));
  const pontos = await placarDaTarefa(indice, agora, "pontos", nomes);
  const placas = await placarDaTarefa(indice, agora, "placas", nomes);
  return { calculado_em: agora.toISOString(), pontos, placas, problemas: pontos.problemas };
}
