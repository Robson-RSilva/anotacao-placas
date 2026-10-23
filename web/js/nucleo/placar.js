// Placar simples, calculado dos próprios arquivos de rótulo e revisão.
//
// Ponto só conta depois de aprovado, para velocidade sem qualidade não subir no placar. Nada é
// gravado: cada navegador calcula o seu na hora (um arquivo de cache escrito por várias pessoas
// daria conflito no Drive).

import { distanciaCameras } from "./avaliacao.js";
import { Molde } from "./campo.js";
import { arredondar, mediana } from "./estatistica.js";
import { liberacao, resultados } from "./gabarito.js";

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

function medianaCurta(valores) {
  const m = mediana((valores || []).filter((x) => x !== null && Number.isFinite(x)));
  return m === null ? null : arredondar(m, 2);
}

const lista = (mapa, chave) => {
  if (!mapa.has(chave)) mapa.set(chave, []);
  return mapa.get(chave);
};

/** Placar da equipe e progresso das partidas. */
export async function calcularPlacar(indice, agora = new Date()) {
  const semana = agora.getTime() - 7 * DIA;
  const equipe = await indice.equipe();
  const nomes = new Map(equipe.membros.map((m) => [m.codigo, m.nome]));
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
  const { prontas, problemas } = await indice.partidasProntas();
  for (const { partida: pid, manifesto: man, fila, pacote, ip } of prontas) {
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
    const molde = Molde.doPacote(pacote);
    for (const item of fila.itens) {
      if (!item.dupla || item.atribuido_a.length < 2) continue;
      const a1 = ultimos.get(`${item.quadro}|${item.atribuido_a[0]}`);
      const a2 = ultimos.get(`${item.quadro}|${item.atribuido_a[1]}`);
      if (!a1 || !a2 || !a1.dados.camera || !a2.dados.camera) continue;
      const d = distanciaCameras(a1.dados.camera, a2.dados.camera, pacote, molde, man.video.largura, man.video.altura);
      if (d) {
        lista(concord, a1.pessoa).push(d[0]);
        lista(concord, a2.pessoa).push(d[0]);
      }
    }
    let pendentes = 0;
    for (const a of ultimos.values()) if (!(ip.revisoesDe.get(a.nome) || []).length) pendentes += 1;
    partidas.push({
      partida: pid,
      sorteados: fila.itens.length,
      anotados: new Set(ip.rotulos.map((a) => a.quadro)).size,
      aprovados: aprovadoQuadro.size,
      pendentes_revisao: pendentes,
    });
  }

  const itensGab = await indice.itensGabarito();
  const temGabarito = itensGab.length > 0;
  const linhas = [];
  for (const cod of [...new Set([...nomes.keys(), ...conta.keys()])].sort()) {
    const s = c(cod);
    const lib = liberacao(await resultados(indice, cod, itensGab), temGabarito);
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
      concordancia_px: medianaCurta(concord.get(cod)),
      gabarito_n: lib.n,
      gabarito_mediana_px: lib.mediana_px === null ? null : arredondar(lib.mediana_px, 2),
      liberado: lib.liberado,
      dias_seguidos: diasSeguidos(dias.get(cod) || new Set(), agora),
      marcos,
    });
  }
  linhas.sort((x, y) => y.aprovados_semana - x.aprovados_semana || y.aprovados - x.aprovados || (x.pessoa < y.pessoa ? -1 : 1));
  const total = {};
  for (const k of ["sorteados", "anotados", "aprovados", "pendentes_revisao"]) total[k] = partidas.reduce((s, x) => s + x[k], 0);
  return { calculado_em: agora.toISOString(), pessoas: linhas, partidas, total, gabarito_importado: temGabarito, problemas };
}
