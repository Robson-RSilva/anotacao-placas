// Vista "Importar partida": cadastro e vídeo, o conjunto da partida e a detecção; o processamento roda num
// worker, que continua mesmo quando a pessoa volta para a página central.

import { isoComFuso, slug } from "../nucleo/convencoes.js";
import { listarModelos } from "../nucleo/modelos.js";
import { ErroTrechos, lerTrechos } from "../nucleo/trechos.js";
import { el, formatarDuracao, lerInteiro, mensagemDeErro, numero } from "./util.js";

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
      job.podeSubstituir = Boolean(m.podeSubstituir); // a partida já existe, mas ninguém começou a usá-la
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

const NOMES_CONJUNTOS = { treino: "treino", validacao: "validação", teste_congelado: "teste congelado", teste_externo: "teste externo" };
const ehTeste = (conjunto) => conjunto === "teste_congelado" || conjunto === "teste_externo";

/** O resumo da importação: o que foi lido, o que saiu e quanto tempo levou. */
function resumo(r) {
  const tomadas = contar(r.n_tomadas, "tomada", "tomadas");
  const lido =
    r.n_nos_trechos === null
      ? `${contar(r.n_quadros_video, "quadro lido", "quadros lidos")}, ${tomadas}`
      : `${contar(r.n_nos_trechos, "quadro lido", "quadros lidos")} nos trechos (o vídeo tem ${numero(r.n_quadros_video, 0)}), ${tomadas}`;
  const frases = [`Pronto: ${r.partida} — ${lido}, ${contar(r.n_sorteados, "quadro sorteado", "quadros sorteados")}.`];
  if (r.n_rajadas) {
    const ficou = r.n_rajadas === 1 ? "ficou" : "ficaram";
    frases.push(`${contar(r.n_rajadas, "rajada de cortes", "rajadas de cortes")} (vinhetas, grafismos animados) ${ficou} fora do sorteio.`);
  }
  if (r.n_sorteio < r.alvo) {
    const dica = r.n_nos_trechos === null ? "" : " Para mais quadros, use trechos maiores.";
    frases.push(`Saíram menos que os ${numero(r.alvo, 0)} pedidos: o sorteio tira no máximo 1 quadro por tomada (2 nas de 6 s ou mais).${dica}`);
  }
  if (r.n_nao_extraidos) {
    frases.push(`${contar(r.n_nao_extraidos, "quadro sorteado não pôde ser extraído", "quadros sorteados não puderam ser extraídos")} e ficou de fora.`);
  }
  const d = r.deteccao;
  if (d && d.previstos) {
    const zero = d.ficaram_do_zero ? ` (${contar(d.ficaram_do_zero, "ficou", "ficaram")} do zero: sem previsão ou dupla às cegas)` : "";
    frases.push(`Detecção (${d.modelo}): ${contar(d.previstos, "quadro chegou", "quadros chegaram")} com pontos, ${numero(d.pontos / d.previstos, 1)} por quadro${zero}, em ${formatarDuracao(d.segundos)}.`);
    if (d.erro) frases.push(`${d.erro}.`);
  } else if (d) {
    frases.push(`A detecção não rodou (${d.erro || "nenhum quadro pedia previsão"}): dá para gerar as previsões depois, na página da partida.`);
  }
  frases.push(
    r.divisao_erro
      ? `A partida não entrou na divisão (${r.divisao_erro}): marque o conjunto dela na coordenação.`
      : `Conjunto: ${NOMES_CONJUNTOS[r.conjunto] ?? r.conjunto}.`,
  );
  frases.push(`A importação levou ${formatarDuracao(r.segundos)}.`);
  return frases.join(" ");
}

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
  let ouvinte = null;

  const suportado = typeof VideoDecoder !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined";
  if (!suportado) {
    $("erro-importar").textContent = "Este navegador não processa vídeo aqui: use o Chrome ou o Edge atualizados no computador.";
    $("processar").disabled = true;
  }

  // ------------------------------------------------------------------ o conjunto e a detecção
  let modelo = null; // o modelo de `modelos/` que a detecção usa (o mais novo que dá para usar)
  let semModelo = "procurando os modelos da pasta…";
  function mostrarDeteccao({ mudouConjunto = false } = {}) {
    const caixa = $("deteccao");
    const conjunto = form.elements.conjunto.value;
    if (mudouConjunto) caixa.checked = Boolean(modelo) && !ehTeste(conjunto); // no teste, a recomendação é do zero
    caixa.disabled = !modelo || Boolean(ctx.importacao?.worker);
    if (!modelo) caixa.checked = false;
    $("nome-modelo").textContent = modelo ? `(${modelo.nome})` : "";
    const frases = [];
    if (!modelo) frases.push(semModelo);
    else if (caixa.checked) {
      frases.push(`Os quadros chegam com os pontos do ${modelo.nome} de escore 0,5 ou mais, para quem anota conferir e corrigir; os "sem previsão" e os da dupla às cegas ficam do zero. Leva cerca de 1 s por quadro, na CPU.`);
    } else frases.push("Sem detecção: os quadros chegam sem pontos.");
    if (ehTeste(conjunto)) {
      frases.push("No teste, a recomendação é anotar do zero: os pontos sugeridos puxam o clique para onde o modelo pôs, justo na margem que decide se uma câmera conta como certa.");
    }
    $("dica-deteccao").textContent = frases.join(" ");
  }
  async function procurarModelos() {
    try {
      const lista = await listarModelos(ctx.pasta);
      modelo = lista.find((m) => !m.erro) ?? null;
      const quebrado = lista.find((m) => m.erro);
      semModelo = quebrado
        ? `Sem detecção: modelos/${quebrado.nome}: ${quebrado.erro}.`
        : 'Sem detecção: não há modelo em "modelos" na pasta da equipe. Para os quadros chegarem com os pontos, copie para lá a pasta que o laboratório exporta (exportados/<nome>, com o detector.onnx).';
    } catch (e) {
      modelo = null;
      semModelo = `Sem detecção: não consegui ler os modelos da pasta (${mensagemDeErro(e)}).`;
    }
    mostrarDeteccao({ mudouConjunto: true });
  }
  form.elements.conjunto.onchange = () => mostrarDeteccao({ mudouConjunto: true });
  $("deteccao").onchange = () => mostrarDeteccao();

  function mostrar(job) {
    const rodando = Boolean(job?.worker);
    for (const campo of form.elements) {
      if (campo.id !== "cancelar") campo.disabled = rodando || (campo.id === "processar" && !suportado) || (campo.id === "deteccao" && !modelo);
    }
    $("cancelar").hidden = !rodando;
    $("substituir").hidden = rodando || !job?.podeSubstituir;
    $("progresso").hidden = !job;
    if (!job) return;
    const frac = job.resultado ? 1 : job.frac || 0;
    $("barra").style.width = `${Math.round(100 * frac)}%`;
    $("etapa").textContent = rodando ? `${job.etapa} ${Math.round(100 * frac)}%${falta(job)}` : job.resultado ? "pronto" : "parou";
    $("erro-importar").textContent = job.erro || "";
    if (job.resultado) {
      $("res-importar").replaceChildren(
        `${resumo(job.resultado)} `,
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
  mostrarDeteccao();
  procurarModelos();

  /** Lê o formulário e começa a importação; `substituir`: apaga a importação anterior desta partida. */
  function enviar(substituir) {
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
    // um campo de texto, e não "number": no Chrome, o clique perto das setinhas e a roda do mouse
    // mudam o número de um campo "number" sem a pessoa perceber
    const alvo = lerInteiro(f.get("alvo"), 1, 5000);
    if (alvo === null) {
      $("erro-importar").textContent = "Quadros a sortear: um número inteiro de 1 a 5000.";
      form.elements.alvo.focus();
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
    const conjunto = String(f.get("conjunto") || "treino");
    const usarModelo = modelo && $("deteccao").checked ? modelo.nome : null;
    $("res-importar").textContent = "";
    acompanhar(iniciarImportacao(ctx, { arquivo, cadastro, trechos, alvo, conjunto, modelo: usarModelo, substituir }));
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    enviar(false);
  };
  $("substituir").onclick = () => {
    const ok = confirm(
      "Apagar a importação anterior desta partida (tomadas, fila e quadros sorteados) e importar de novo? " +
        "Faça isso só se ninguém começou a anotá-la em outro computador.",
    );
    if (ok) enviar(true);
  };
  $("cancelar").onclick = () => ctx.importacao?.worker?.postMessage({ tipo: "cancelar" });

  return {
    desmontar() {
      if (ouvinte) ctx.importacao?.ouvintes.delete(ouvinte);
    },
  };
}
