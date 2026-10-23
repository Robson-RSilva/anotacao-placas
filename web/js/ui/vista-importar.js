// Vista "Importar partida": cadastro e vídeo; o processamento roda num worker, que continua mesmo
// quando a pessoa volta para a página central.

import { isoComFuso, partesPacote } from "../nucleo/convencoes.js";
import { el, mensagemDeErro, numero } from "./util.js";

function iniciarImportacao(ctx, mensagem) {
  const worker = new Worker(new URL("../video/trabalhador.js", import.meta.url), { type: "module" });
  const job = { worker, etapa: "começando", frac: 0, resultado: null, erro: null, ouvintes: new Set() };
  ctx.importacao = job;
  const avisar = () => {
    for (const f of job.ouvintes) f();
  };
  const terminar = () => {
    worker.terminate();
    job.worker = null;
    avisar();
  };
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.tipo === "progresso") {
      job.etapa = m.etapa;
      job.frac = m.frac;
      avisar();
    } else if (m.tipo === "fim") {
      job.resultado = m.resultado;
      terminar();
    } else if (m.tipo === "erro") {
      job.erro = m.nome === "AbortError" ? "importação cancelada" : mensagemDeErro({ name: m.nome, message: m.mensagem });
      terminar();
    }
  };
  worker.onerror = (e) => {
    job.erro = e.message || "falha ao processar o vídeo";
    terminar();
  };
  worker.postMessage({ tipo: "importar", raiz: ctx.pasta.raiz, ...mensagem });
  return job;
}

export async function montar(raiz, ctx) {
  const $ = (id) => el(id, raiz);
  const form = $("form-importar");
  const pacotes = await ctx.pasta.listarPacotes();
  form.querySelector("select[name=pacote]").replaceChildren(...pacotes.map((p) => new Option(p, p)));
  let ouvinte = null;

  const suportado = typeof VideoDecoder !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined";
  if (!suportado) {
    $("erro-importar").textContent = "Este navegador não processa vídeo aqui: use o Chrome ou o Edge atualizados no computador.";
    $("processar").disabled = true;
  } else if (!pacotes.length) {
    $("erro-importar").textContent = "Não há pacote de estádio na pasta de trabalho: acrescente em Coordenação.";
    $("processar").disabled = true;
  } else if (!(await ctx.indice.equipe()).membros.some((m) => m.papeis.includes("anotador"))) {
    $("erro-importar").textContent = "A equipe não tem anotadores: cadastre em Coordenação antes de importar.";
    $("processar").disabled = true;
  }

  function mostrar(job) {
    const rodando = Boolean(job?.worker);
    for (const campo of form.elements) if (campo.id !== "cancelar") campo.disabled = rodando || (campo.id === "processar" && !suportado);
    $("cancelar").hidden = !rodando;
    $("progresso").hidden = !job;
    if (!job) return;
    const frac = job.resultado ? 1 : job.frac || 0;
    $("barra").style.width = `${Math.round(100 * frac)}%`;
    $("etapa").textContent = rodando ? `${job.etapa} ${Math.round(100 * frac)}%` : job.resultado ? "pronto" : "parou";
    $("erro-importar").textContent = job.erro || "";
    if (job.resultado) {
      const r = job.resultado;
      $("res-importar").replaceChildren(
        `Pronto: ${r.partida} — ${numero(r.n_quadros_video, 0)} quadros lidos, ${r.n_tomadas} tomadas, ${r.n_sorteados} quadros sorteados em ${numero(r.segundos, 0)} s. `,
        Object.assign(document.createElement("a"), { href: "#/", textContent: "Voltar para a central" }),
      );
    } else {
      $("res-importar").textContent = rodando ? "Pode voltar para a central: a importação continua nesta aba." : "";
    }
  }

  const acompanhar = (job) => {
    if (ouvinte) ctx.importacao?.ouvintes.delete(ouvinte);
    ouvinte = () => mostrar(job);
    job.ouvintes.add(ouvinte);
    mostrar(job);
  };
  if (ctx.importacao) acompanhar(ctx.importacao);

  form.onsubmit = (e) => {
    e.preventDefault();
    if (ctx.importacao?.worker) return;
    const f = new FormData(form);
    const arquivo = f.get("video");
    if (!arquivo || !arquivo.size) {
      $("erro-importar").textContent = "Escolha o arquivo de vídeo.";
      return;
    }
    const [estadio, versao] = partesPacote(String(f.get("pacote")));
    const cadastro = {
      estadio,
      pacote_versao: versao,
      emissora: String(f.get("emissora")).trim(),
      competicao: String(f.get("competicao")).trim(),
      data_hora: isoComFuso(String(f.get("data_hora"))),
      mandante: String(f.get("mandante")).trim(),
      visitante: String(f.get("visitante")).trim(),
      iluminacao: String(f.get("iluminacao")),
      chuva: f.get("chuva") === "on",
      observacoes: String(f.get("observacoes") || "").trim(),
    };
    $("res-importar").textContent = "";
    acompanhar(iniciarImportacao(ctx, { arquivo, cadastro, alvo: Number(f.get("alvo") || 100) }));
  };
  $("cancelar").onclick = () => ctx.importacao?.worker?.postMessage({ tipo: "cancelar" });

  return {
    desmontar() {
      if (ouvinte) ctx.importacao?.ouvintes.delete(ouvinte);
    },
  };
}
