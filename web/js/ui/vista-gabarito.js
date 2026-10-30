// Vista "Gabarito": como funciona o teste, a situação de cada tarefa (o botão de fazer o teste), os
// resultados da pessoa item a item (com "Ver", que abre a imagem com a resposta) e os lotes de ouro da
// pasta (e importar um lote em .zip).

import { situacao } from "../nucleo/filas.js";
import { REGRA, motivoJogadores, motivoPontos, resumo } from "../nucleo/gabarito.js";
import { importarZip } from "../nucleo/transferencia.js";
import { celula, el, linhaVazia, local, mensagemDeErro } from "./util.js";
import { vigiar } from "./vigia.js";

const NOME = { pontos: "pontos", jogadores: "jogadores" };

function quando(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export async function montar(raiz, ctx) {
  const $ = (id) => el(id, raiz);
  const { indice } = ctx;
  const pessoa = ctx.pessoa();
  let vivo = true;
  let tarefaRes = local.ler("gabarito-tarefa", "pontos") === "jogadores" ? "jogadores" : "pontos";
  const sits = {};
  $("quem-gabarito").textContent = pessoa ? `Resultados de ${pessoa}` : "Digite o seu código na página central.";
  $("meta-pontos").textContent = `${REGRA.pontos.k} das últimas ${REGRA.pontos.n}`;
  $("meta-jogadores").textContent = `${REGRA.jogadores.k} das últimas ${REGRA.jogadores.n}`;

  function cartao(tarefa, sit) {
    const c = raiz.querySelector(`[data-tarefa=${tarefa}]`);
    const regra = REGRA[tarefa];
    const st = c.querySelector(".st");
    const botao = c.querySelector(".fazer");
    const barra = c.querySelector(".barra-progresso div");
    c.querySelector(".regra").textContent = tarefa === "pontos"
      ? `Um item dá certo sem nenhum ponto trocado, com ${Math.round(100 * regra.cobertura)}% dos pontos que aparecem achados e o erro mediano até ${String(regra.erro_px).replace(".", ",")} px.`
      : `Um item dá certo com cada jogador pintado, ninguém que não é jogador pintado e ${Math.round(100 * regra.iou)}% de sobreposição (1 px de folga na borda).`;
    botao.classList.toggle("desligado", !pessoa || !sit?.gabarito_faltam);
    if (!sit) {
      st.textContent = pessoa ? "—" : "Digite o seu código na página central.";
      return;
    }
    if (!sit.gabarito_total) {
      st.textContent = "Ainda não há gabarito desta tarefa na pasta: importe um lote de ouro (abaixo). Sem gabarito, ninguém passa pelo teste.";
      barra.style.width = "0";
      return;
    }
    const nItens = Math.min(regra.n, sit.ultimos);
    barra.style.width = `${Math.round((100 * (sit.liberado ? regra.k : Math.min(sit.acertos, regra.k))) / regra.k)}%`;
    if (sit.liberado) {
      st.replaceChildren(Object.assign(document.createElement("b"), { className: "res bom", textContent: "Liberado" }), ` — ${sit.acertos} certos nos últimos ${nItens}. ${sit.gabarito_faltam} item(ns) do gabarito ainda não feitos: eles aparecem escondidos no meio das imagens reais.`);
      botao.textContent = "Treinar mais";
    } else {
      st.replaceChildren(Object.assign(document.createElement("b"), { className: "res medio", textContent: "Em teste" }), ` — ${sit.acertos} certo(s) em ${sit.ultimos} feito(s); a meta é ${regra.meta}. ${sit.gabarito_faltam ? `${sit.gabarito_faltam} item(ns) para fazer.` : "O gabarito acabou: fale com quem coordena."}`);
      botao.textContent = sit.n ? "Continuar o teste" : "Fazer o teste";
    }
  }

  function tabela() {
    for (const b of raiz.querySelectorAll("[data-res]")) b.setAttribute("aria-pressed", String(b.dataset.res === tarefaRes));
    const tbody = $("resultados").querySelector("tbody");
    tbody.replaceChildren();
    const sit = sits[tarefaRes];
    if (!sit || !sit.resultados.length) {
      linhaVazia(tbody, 7, pessoa ? `Você ainda não fez nenhum item do gabarito dos ${NOME[tarefaRes]}.` : "Digite o seu código na página central.");
      return;
    }
    const lotes = new Map(sit.itens.map((g) => [g.id, g.lote || "—"]));
    // o mais novo primeiro; os do teste e os escondidos juntos (os escondidos aparecem depois de feitos)
    for (const r of [...sit.resultados].reverse()) {
      const tr = document.createElement("tr");
      const motivo = tarefaRes === "pontos" ? motivoPontos(r.resultado) : motivoJogadores(r.resultado);
      const ok = celula(r.acerto ? "certo" : "errado", `res ${r.acerto ? "bom" : "ruim"}`);
      if (!r.acerto && motivo) ok.title = motivo;
      const ver = document.createElement("td");
      ver.append(Object.assign(document.createElement("a"), { href: `#/${tarefaRes}?ver=${r.item}`, textContent: "Ver", className: "botao pequeno" }));
      tr.append(celula(r.item), celula(lotes.get(r.item) || "—"), celula(quando(r.criado_em)), celula(resumo(tarefaRes, r.resultado)), ok, celula(motivo, "sutil"), ver);
      tbody.append(tr);
    }
  }

  async function lotes() {
    const tbody = $("lotes").querySelector("tbody");
    const linhas = [];
    for (const tarefa of ["pontos", "jogadores"]) {
      const porLote = new Map();
      for (const g of await indice.itensGabarito(tarefa)) {
        const nome = g.lote || "(sem lote)";
        if (!porLote.has(nome)) porLote.set(nome, []);
        porLote.get(nome).push(g.id);
      }
      for (const [nome, ids] of [...porLote.entries()].sort()) {
        const tr = document.createElement("tr");
        ids.sort();
        tr.append(celula(nome), celula(NOME[tarefa]), celula(String(ids.length), "num"), celula(`${ids[0]} a ${ids[ids.length - 1]}`));
        linhas.push(tr);
      }
    }
    if (!vivo) return;
    tbody.replaceChildren(...linhas);
    if (!linhas.length) linhaVazia(tbody, 4, "Nenhum lote de ouro nesta pasta ainda.");
  }

  async function atualizar() {
    await lotes();
    for (const tarefa of ["pontos", "jogadores"]) {
      if (!pessoa) {
        cartao(tarefa, null);
        continue;
      }
      try {
        sits[tarefa] = { ...(await situacao(indice, tarefa, pessoa)), itens: await indice.itensGabarito(tarefa) };
      } catch (e) {
        raiz.querySelector(`[data-tarefa=${tarefa}] .st`).textContent = mensagemDeErro(e);
        continue;
      }
      if (!vivo) return;
      cartao(tarefa, sits[tarefa]);
    }
    tabela();
  }

  for (const b of raiz.querySelectorAll("[data-res]")) {
    b.onclick = () => {
      tarefaRes = b.dataset.res;
      local.gravar("gabarito-tarefa", tarefaRes);
      tabela();
    };
  }
  for (const a of raiz.querySelectorAll(".fazer")) {
    a.addEventListener("click", (e) => {
      if (a.classList.contains("desligado")) e.preventDefault();
    });
  }

  $("importar-lote").onchange = async (e) => {
    const arquivo = e.target.files[0];
    e.target.value = "";
    if (!arquivo) return;
    const status = (t) => {
      $("res-lote").textContent = t;
    };
    status("lendo o .zip…");
    try {
      const r = await importarZip(ctx.pasta, arquivo, (f) => status(`lendo o .zip… ${Math.round(100 * f)}%`));
      const partes = [`${r.gravados} arquivo(s) novo(s)`, `${r.existentes} já existiam`];
      if (r.conflitos.length) partes.push(`${r.conflitos.length} em conflito (ficou o da pasta)`);
      if (r.recusados.length) partes.push(`${r.recusados.length} recusado(s): ${r.recusados.slice(0, 3).map((x) => `${x.caminho} (${x.motivo})`).join("; ")}`);
      status(`${partes.join(", ")}.`);
      await atualizar();
    } catch (erro) {
      status(mensagemDeErro(erro));
    }
  };

  await atualizar();
  const vigia = vigiar(ctx, () => true, atualizar);
  return {
    desmontar() {
      vivo = false;
      vigia.parar();
    },
  };
}
