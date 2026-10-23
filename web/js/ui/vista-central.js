// Vista central: quem está anotando, filas, partidas, placar e a pasta de trabalho.

import { pendentesRevisao, situacaoAnotador } from "../nucleo/filas.js";
import { calcularPlacar } from "../nucleo/placar.js";
import { exportarZip, importarZip, soDaPessoa } from "../nucleo/transferencia.js";
import { espaco } from "./armazenamento.js";
import { baixar, carimbo, celula, el, formatarTempo, linhaVazia, mensagemDeErro, numero } from "./util.js";

const porcento = (a, b) => (b ? `${a} (${Math.round((100 * a) / b)}%)` : String(a));

async function criarExemplo(pasta) {
  await pasta.criar();
  const ler = async (nome) => (await fetch(new URL(`../../exemplo/${nome}`, import.meta.url))).json();
  const pacote = await ler("pacote.json");
  const caminho = pasta.pacote(pacote.estadio, pacote.versao);
  if (!(await pasta.existe(caminho))) await pasta.gravar("pacote", caminho, pacote);
  const equipe = await pasta.lerEquipe();
  if (!equipe.membros.length) await pasta.gravar("equipe", "equipe.json", await ler("equipe.json"), { sobrescrever: true });
}

export async function montar(raiz, ctx) {
  const { pasta, indice } = ctx;
  const $ = (id) => el(id, raiz);
  let vivo = true;

  $("pasta-nome").textContent = ctx.modo === "navegador" ? "Armazenamento deste navegador" : `Pasta «${pasta.nome}»`;
  $("trocar-pasta").onclick = () => ctx.trocarPasta();

  if (!(await pasta.ehPastaDeTrabalho())) {
    $("aviso-vazia").hidden = false;
    $("conteudo-central").hidden = true;
    $("pessoa").disabled = true;
    $("nome-vazia").textContent = ctx.modo === "navegador"
      ? "O armazenamento deste navegador está vazio. Crie a pasta e traga os arquivos num .zip, ou comece pelo exemplo."
      : `A pasta «${pasta.nome}» não tem equipe.json. Se for a pasta da equipe, confira se o Drive terminou de sincronizar.`;
    $("criar-vazia").onclick = async () => {
      await pasta.criar();
      ctx.ir("#/coordenacao");
    };
    $("criar-exemplo").onclick = async () => {
      await criarExemplo(pasta);
      ctx.ir("#/");
    };
    $("trocar-vazia").onclick = () => ctx.trocarPasta();
    return null;
  }

  // ------------------------------------------------------------------ quem está anotando
  const equipe = await indice.equipe();
  const codigos = new Set(equipe.membros.map((m) => m.codigo));
  let pessoa = ctx.pessoa();
  if (pessoa && !codigos.has(pessoa)) pessoa = null;
  const sel = $("pessoa");
  sel.replaceChildren(new Option("escolha…", ""), ...equipe.membros.map((m) => new Option(`${m.codigo} · ${m.nome}`, m.codigo)));
  sel.value = pessoa || "";
  sel.onchange = () => {
    ctx.definirPessoa(sel.value);
    ctx.ir("#/");
  };
  const membro = equipe.membros.find((m) => m.codigo === pessoa) || null;
  $("ir-camera").classList.toggle("desligado", !membro || !membro.papeis.includes("anotador"));
  $("ir-revisao").classList.toggle("desligado", !membro || !membro.papeis.includes("revisor"));
  for (const id of ["ir-camera", "ir-revisao"]) {
    $(id).addEventListener("click", (e) => {
      if (e.currentTarget.classList.contains("desligado")) e.preventDefault();
    });
  }
  $("baixar-meus").disabled = !membro;

  const projeto = await pasta.lerProjeto().catch(() => null);
  if (projeto?.manual_url) {
    $("manual").href = projeto.manual_url;
    $("manual").hidden = false;
  }
  if (projeto?.nome) raiz.querySelector(".barra h1").textContent = `Anotação · ${projeto.nome}`;

  // ------------------------------------------------------------------ situação de cada tarefa
  if (!equipe.membros.length) {
    $("st-camera").textContent = "A equipe está vazia: cadastre as pessoas em Coordenação.";
  } else if (!membro) {
    $("st-camera").textContent = "Escolha o seu código no alto da página.";
  } else if (!membro.papeis.includes("anotador")) {
    $("st-camera").textContent = "Você não está como anotador na equipe.";
  } else {
    situacaoAnotador(indice, membro.codigo).then((s) => {
      if (!vivo) return;
      $("st-camera").textContent = s.liberado
        ? s.gabarito_total ? `Liberado (gabarito: ${numero(s.mediana_px, 1)} px).` : "Liberado (sem gabarito importado)."
        : `Em treino: ${s.motivo}.`;
    }, (e) => {
      $("st-camera").textContent = mensagemDeErro(e);
    });
  }
  if (!membro) $("st-revisao").textContent = "—";
  else if (!membro.papeis.includes("revisor")) $("st-revisao").textContent = "Você não é revisor.";
  else {
    pendentesRevisao(indice, membro.codigo).then((p) => {
      if (vivo) $("st-revisao").textContent = `${p.length} rótulo(s) esperando você.`;
    }, (e) => {
      $("st-revisao").textContent = mensagemDeErro(e);
    });
  }

  // ------------------------------------------------------------------ importação em curso
  const imp = ctx.importacao;
  let ouvinte = null;
  if (imp?.worker) {
    const aviso = document.createElement("a");
    aviso.className = "faixa bloco";
    aviso.href = "#/importar";
    ouvinte = () => {
      aviso.textContent = imp.worker
        ? `Importando: ${imp.etapa || "começando"} ${Math.round(100 * (imp.frac || 0))}%`
        : "Importação terminada: veja o resultado.";
    };
    ouvinte();
    imp.ouvintes.add(ouvinte);
    $("conteudo-central").prepend(aviso);
  }

  // ------------------------------------------------------------------ partidas e placar
  const tPartidas = $("partidas").querySelector("tbody");
  const tPlacar = $("placar").querySelector("tbody");
  linhaVazia(tPartidas, 7, "calculando…");
  linhaVazia(tPlacar, 9, "calculando…");
  calcularPlacar(indice).then(async (pl) => {
    if (!vivo) return;
    tPartidas.replaceChildren();
    if (!pl.partidas.length) linhaVazia(tPartidas, 7, "Nenhuma partida importada ainda.");
    for (const g of [...pl.partidas].reverse()) {
      const c = (await indice.manifesto(g.partida)).cadastro;
      const tr = document.createElement("tr");
      tr.append(
        celula(g.partida),
        celula(c.emissora),
        celula(`${c.iluminacao}${c.chuva ? ", chuva" : ""}`),
        celula(String(g.sorteados), "num"),
        celula(porcento(g.anotados, g.sorteados), "num"),
        celula(porcento(g.aprovados, g.sorteados), "num"),
        celula(String(g.pendentes_revisao), "num"),
      );
      tPartidas.append(tr);
    }
    tPlacar.replaceChildren();
    if (!pl.pessoas.length) linhaVazia(tPlacar, 9, "Ninguém na equipe ainda.");
    for (const p of pl.pessoas) {
      const tr = document.createElement("tr");
      const gab = p.gabarito_n ? `${numero(p.gabarito_mediana_px, 1)} px (${p.gabarito_n})` : "—";
      tr.append(
        celula(`${p.pessoa}${p.nome ? ` · ${p.nome}` : ""}`),
        celula(String(p.aprovados_semana), "num"),
        celula(String(p.aprovados), "num"),
        celula(p.taxa_aprovacao === null ? "—" : `${Math.round(100 * p.taxa_aprovacao)}%`, "num"),
        celula(p.tempo_mediano_s === null ? "—" : formatarTempo(p.tempo_mediano_s), "num"),
        celula(p.concordancia_px === null ? "—" : `${numero(p.concordancia_px, 1)} px`, "num"),
        celula(gab + (p.liberado ? "" : " · em treino")),
        celula(String(p.dias_seguidos), "num"),
        celula(p.marcos.join(", ") || "—"),
      );
      tPlacar.append(tr);
    }
  }, (e) => {
    tPartidas.replaceChildren();
    linhaVazia(tPartidas, 7, mensagemDeErro(e));
  });

  // ------------------------------------------------------------------ pasta de trabalho
  if (ctx.modo === "navegador") {
    espaco().then((e) => {
      if (!e || !vivo) return;
      const mb = (v) => `${numero(v / 2 ** 20, 0)} MB`;
      $("pasta-modo").textContent = `· ${mb(e.usado)} usados de ${mb(e.total)}${e.persistente ? "" : " · o navegador pode apagar se faltar espaço: baixe cópias"}`;
    });
  } else {
    $("pasta-modo").textContent = "· no seu computador";
  }
  const status = (t) => {
    $("res-pasta").textContent = t;
  };
  const exportar = async (filtro, nome) => {
    status("montando o .zip…");
    try {
      const { blob, n } = await exportarZip(pasta, filtro, (f) => status(`montando o .zip… ${Math.round(100 * f)}%`));
      baixar(blob, nome);
      status(`${n} arquivo(s) no .zip.`);
    } catch (e) {
      status(mensagemDeErro(e));
    }
  };
  $("baixar-meus").onclick = () => exportar(soDaPessoa(pessoa), `anotacao-${pessoa}-${carimbo()}.zip`);
  $("baixar-tudo").onclick = () => exportar(() => true, `anotacao-pasta-${carimbo()}.zip`);
  $("trazer-zip").onchange = async (e) => {
    const arquivo = e.target.files[0];
    e.target.value = "";
    if (!arquivo) return;
    status("lendo o .zip…");
    try {
      const r = await importarZip(pasta, arquivo, (f) => status(`lendo o .zip… ${Math.round(100 * f)}%`));
      const partes = [`${r.gravados} arquivo(s) novo(s)`, `${r.existentes} já existiam`];
      if (r.recusados.length) partes.push(`${r.recusados.length} recusado(s): ${r.recusados.slice(0, 3).map((x) => `${x.caminho} (${x.motivo})`).join("; ")}`);
      status(`${partes.join(", ")}.`);
      if (r.gravados) setTimeout(() => vivo && ctx.ir("#/"), 1500);
    } catch (erro) {
      status(mensagemDeErro(erro));
    }
  };

  return {
    desmontar() {
      vivo = false;
      if (ouvinte) imp.ouvintes.delete(ouvinte);
    },
  };
}
