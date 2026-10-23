// Vista "Importar partida": cadastro e vídeo; o processamento roda num worker, que continua mesmo
// quando a pessoa volta para a página central.

import { REF_PACOTE_GENERICO, isoComFuso, partesPacote, slug } from "../nucleo/convencoes.js";
import { ErroTrechos, lerTrechos } from "../nucleo/trechos.js";
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
      if (m.etapa !== job.etapa) job.inicioEtapa = performance.now();
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

const contar = (n, um, varios) => `${numero(n, 0)} ${n === 1 ? um : varios}`;

/** Quanto falta na etapa atual, pelo ritmo até aqui (só depois de um tempo, para não chutar). */
function falta(job) {
  const passou = (performance.now() - (job.inicioEtapa ?? performance.now())) / 1000;
  if (job.frac < 0.03 || job.frac >= 1 || passou < 10) return "";
  const s = (passou * (1 - job.frac)) / job.frac;
  return s < 90 ? " — falta menos de 2 min" : ` — faltam uns ${Math.round(s / 60)} min`;
}

export async function montar(raiz, ctx) {
  const $ = (id) => el(id, raiz);
  const form = $("form-importar");
  // o molde: o campo genérico, ou o pacote de um estádio levantado (quando a pasta tem algum)
  const outros = (await ctx.pasta.listarPacotes()).filter((r) => r !== REF_PACOTE_GENERICO);
  form.querySelector("select[name=pacote]").replaceChildren(
    new Option("Campo genérico", REF_PACOTE_GENERICO),
    ...outros.map((r) => {
      const [estadio, versao] = partesPacote(r);
      return new Option(`${estadio} (v${versao})`, r);
    }),
  );
  $("rotulo-pacote").hidden = !outros.length;
  let ouvinte = null;

  const suportado = typeof VideoDecoder !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined";
  if (!suportado) {
    $("erro-importar").textContent = "Este navegador não processa vídeo aqui: use o Chrome ou o Edge atualizados no computador.";
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
    $("etapa").textContent = rodando ? `${job.etapa} ${Math.round(100 * frac)}%${falta(job)}` : job.resultado ? "pronto" : "parou";
    $("erro-importar").textContent = job.erro || "";
    if (job.resultado) {
      const r = job.resultado;
      const lido = r.n_nos_trechos === null
        ? `${contar(r.n_quadros_video, "quadro lido", "quadros lidos")}, ${contar(r.n_tomadas, "tomada", "tomadas")}`
        : `${contar(r.n_nos_trechos, "quadro lido", "quadros lidos")} nos trechos (o vídeo tem ${numero(r.n_quadros_video, 0)}), ${contar(r.n_tomadas_nos_trechos, "tomada", "tomadas")}`;
      $("res-importar").replaceChildren(
        `Pronto: ${r.partida} — ${lido}, ${contar(r.n_sorteados, "quadro sorteado", "quadros sorteados")} em ${numero(r.segundos, 0)} s. `,
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
    const estadio = slug(String(f.get("estadio") || ""));
    if (estadio === "sem-nome") {
      $("erro-importar").textContent = "Escreva o nome do estádio (ele entra no nome da partida).";
      return;
    }
    let trechos = null;
    try {
      trechos = lerTrechos(f.get("trechos"));
    } catch (erro) {
      if (!(erro instanceof ErroTrechos)) throw erro;
      $("erro-importar").textContent = erro.message;
      return;
    }
    const cadastro = {
      estadio,
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
    const pacote = String(f.get("pacote") || REF_PACOTE_GENERICO);
    acompanhar(iniciarImportacao(ctx, { arquivo, cadastro, pacote, trechos, alvo: Number(f.get("alvo") || 100) }));
  };
  $("cancelar").onclick = () => ctx.importacao?.worker?.postMessage({ tipo: "cancelar" });

  return {
    desmontar() {
      if (ouvinte) ctx.importacao?.ouvintes.delete(ouvinte);
    },
  };
}
