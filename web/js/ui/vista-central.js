// Vista central: quem está anotando, filas, partidas, placar e a pasta de trabalho.

import { codigoPessoa } from "../nucleo/convencoes.js";
import { pendentesRevisao, situacaoAnotador } from "../nucleo/filas.js";
import { calcularPlacar } from "../nucleo/placar.js";
import { exportarZip, importarZip, soDaPessoa } from "../nucleo/transferencia.js";
import { espaco } from "./armazenamento.js";
import { baixar, carimbo, celula, el, formatarTempo, linhaVazia, mensagemDeErro, numero } from "./util.js";
import { vigiar } from "./vigia.js";

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
  // monta a central de novo — a não ser que a pessoa já tenha ido para outra página
  const recarregar = () => {
    if (vivo && /^#?\/?$/.test(location.hash)) ctx.ir("#/");
  };

  $("pasta-nome").textContent = ctx.modo === "navegador" ? "Armazenamento deste navegador" : `Pasta «${pasta.nome}»`;
  $("trocar-pasta").onclick = () => ctx.trocarPasta();

  if (!(await pasta.ehPastaDeTrabalho())) {
    $("aviso-vazia").hidden = false;
    $("conteudo-central").hidden = true;
    $("pessoa").disabled = true;
    $("nome-vazia").textContent = ctx.modo === "navegador"
      ? "O armazenamento deste navegador está vazio. Crie a pasta, comece pelo exemplo, ou traga a cópia da pasta (.zip) que outra pessoa mandou."
      : `A pasta «${pasta.nome}» ainda não tem os arquivos da anotação. Se for a pasta da equipe no Drive, espere ele terminar de sincronizar (a página percebe sozinha); se for uma pasta nova, crie a pasta de trabalho.`;
    $("criar-vazia").onclick = async () => {
      await pasta.criar();
      ctx.ir("#/");
    };
    $("criar-exemplo").onclick = async () => {
      await criarExemplo(pasta);
      ctx.ir("#/");
    };
    $("trocar-vazia").onclick = () => ctx.trocarPasta();
    $("trazer-zip-vazia").onchange = async (e) => {
      const arquivo = e.target.files[0];
      e.target.value = "";
      if (!arquivo) return;
      $("res-vazia").textContent = "lendo o .zip…";
      try {
        const r = await importarZip(pasta, arquivo, (f) => {
          $("res-vazia").textContent = `lendo o .zip… ${Math.round(100 * f)}%`;
        });
        await pasta.criar(); // o que faltar para ser uma pasta de trabalho
        $("res-vazia").textContent = `${r.gravados} arquivo(s) trazido(s).`;
        recarregar();
      } catch (erro) {
        $("res-vazia").textContent = mensagemDeErro(erro);
      }
    };
    // a pasta da equipe ainda sincronizando: quando o Drive trouxer os arquivos, a central aparece
    const vigia = vigiar(ctx, () => true, async () => {
      if (await pasta.ehPastaDeTrabalho()) recarregar();
    });
    return {
      desmontar() {
        vivo = false;
        vigia.parar();
      },
    };
  }

  // ------------------------------------------------------------------ quem está anotando
  // não há equipe cadastrada: cada pessoa digita o próprio código (as iniciais, por exemplo); os
  // nomes de equipe.json, quando houver, só aparecem nas sugestões e no placar
  const equipe = await indice.equipe();
  const nomes = new Map(equipe.membros.map((m) => [m.codigo, m.nome]));
  const pessoa = ctx.pessoa();
  const campo = $("pessoa");
  campo.value = pessoa || "";
  const sugerir = (codigos) => {
    $("pessoas").replaceChildren(...[...codigos].sort().map((c) => Object.assign(document.createElement("option"), {
      value: c,
      label: nomes.get(c) || "",
    })));
  };
  sugerir(new Set(nomes.keys()));
  let sugeridos = [...nomes.keys()].sort().join(",");
  $("form-pessoa").onsubmit = (e) => {
    e.preventDefault();
    campo.blur(); // o "change" confirma
  };
  campo.onchange = () => {
    const c = codigoPessoa(campo.value);
    if (campo.value.trim() && !c) {
      $("dica-pessoa").textContent = "use de 2 a 10 letras e números, começando por letra";
      return;
    }
    campo.value = c || "";
    $("dica-pessoa").textContent = c ? "" : "digite o seu código para começar";
    if (c === pessoa) return;
    ctx.definirPessoa(c);
    // só depois: o Enter também envia o formulário, que precisa continuar na página até lá
    setTimeout(recarregar, 0);
  };
  if (!pessoa) $("dica-pessoa").textContent = "digite o seu código para começar";
  for (const id of ["ir-camera", "ir-revisao"]) {
    $(id).classList.toggle("desligado", !pessoa);
    $(id).addEventListener("click", (e) => {
      if (e.currentTarget.classList.contains("desligado")) e.preventDefault();
    });
  }
  $("baixar-meus").disabled = !pessoa;

  const projeto = await pasta.lerProjeto().catch(() => null);
  if (projeto?.manual_url) {
    $("manual").href = projeto.manual_url;
    $("manual").hidden = false;
  }
  if (projeto?.nome) raiz.querySelector(".barra h1").textContent = `Anotação · ${projeto.nome}`;

  // ------------------------------------------------------------------ o mesmo código em outro computador
  // duas pessoas com o mesmo código gravariam os mesmos nomes de arquivo (o Drive guardaria só um) e
  // uma não revisaria a outra; a mesma pessoa em dois computadores é normal — ela confirma uma vez
  async function conferirCodigo() {
    if (!pessoa) return;
    const aviso = $("aviso-codigo");
    try {
      const outros = await ctx.outrosComputadores(pessoa);
      if (!vivo) return;
      if (outros.length && !ctx.codigoConfirmado(pessoa)) {
        const desde = outros.map((d) => d.criado_em).sort()[0];
        $("texto-aviso-codigo").textContent = `O código ${pessoa} também é usado em outro computador (desde ${new Date(desde).toLocaleDateString("pt-BR")}). `
          + "Se é outra pessoa, escolha outro código no alto da página: com o mesmo código, as duas gravariam os mesmos arquivos e uma não revisaria a outra. "
          + "Se é você em outro computador, tudo bem — só não anote nos dois ao mesmo tempo.";
        aviso.hidden = false;
        return; // não registra este computador até a pessoa confirmar (ou salvar algo com o código)
      }
      aviso.hidden = true;
      await ctx.registrarCodigo(pessoa);
    } finally {
      aviso.dataset.codigo = pessoa; // conferido (os testes esperam por isto)
    }
  }
  $("sou-eu").onclick = async () => {
    ctx.confirmarCodigo(pessoa);
    $("aviso-codigo").hidden = true;
    await ctx.registrarCodigo(pessoa);
  };

  // ------------------------------------------------------------------ situação de cada tarefa
  async function atualizarSituacao() {
    if (!pessoa) {
      $("st-camera").textContent = "Digite o seu código no alto da página.";
      $("st-revisao").textContent = "—";
      return;
    }
    const [sit, pend] = await Promise.allSettled([situacaoAnotador(indice, pessoa), pendentesRevisao(indice, pessoa)]);
    if (!vivo) return;
    if (sit.status === "fulfilled") {
      const s = sit.value;
      $("st-camera").textContent = s.liberado
        ? s.gabarito_total ? `Liberado (gabarito: ${numero(s.mediana_px, 1)} px).` : "Pode anotar."
        : `Em treino: ${s.motivo}.`;
    } else {
      $("st-camera").textContent = mensagemDeErro(sit.reason);
    }
    if (pend.status === "fulfilled") {
      const n = pend.value.length;
      $("st-revisao").textContent = n ? `${n} rótulo(s) de outras pessoas esperando revisão.` : "Nada esperando revisão.";
    } else {
      $("st-revisao").textContent = mensagemDeErro(pend.reason);
    }
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
  async function preencherTabelas() {
    let pl;
    try {
      pl = await calcularPlacar(indice);
    } catch (e) {
      if (!vivo) return;
      tPartidas.replaceChildren();
      linhaVazia(tPartidas, 7, mensagemDeErro(e));
      return;
    }
    if (!vivo) return;
    const linhasPartidas = [];
    for (const p of pl.problemas) {
      // incompleta (ainda sincronizando) ou com arquivo inválido: fica fora das filas até se resolver
      const aviso = celula(`fora das filas: ${p.erro}`, "erro");
      aviso.colSpan = 6;
      const tr = document.createElement("tr");
      tr.append(celula(p.partida), aviso);
      linhasPartidas.push(tr);
    }
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
      linhasPartidas.push(tr);
    }
    if (!vivo) return;
    tPartidas.replaceChildren(...linhasPartidas);
    if (!linhasPartidas.length) linhaVazia(tPartidas, 7, "Nenhuma partida importada ainda.");
    const linhasPlacar = [];
    const codigos = new Set([...nomes.keys(), ...pl.pessoas.map((x) => x.pessoa)]); // quem já anotou nesta pasta
    const chave = [...codigos].sort().join(",");
    if (chave !== sugeridos) {
      sugeridos = chave;
      sugerir(codigos); // só quando muda: trocar as sugestões fecharia a lista aberta de quem está digitando
    }
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
      linhasPlacar.push(tr);
    }
    tPlacar.replaceChildren(...linhasPlacar);
    if (!linhasPlacar.length) linhaVazia(tPlacar, 9, "Ninguém anotou ainda.");
  }

  // o que outras pessoas fazem nos computadores delas chega pela pasta sincronizada
  const atualizar = () => Promise.allSettled([atualizarSituacao(), preencherTabelas(), conferirCodigo()]);
  atualizar();
  const vigia = vigiar(ctx, () => true, atualizar);

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
      if (r.conflitos.length) {
        partes.push(`${r.conflitos.length} em conflito — já havia um arquivo com o mesmo nome e outro conteúdo, e ficou o da pasta: ${r.conflitos.slice(0, 3).join("; ")}`);
      }
      if (r.recusados.length) partes.push(`${r.recusados.length} recusado(s): ${r.recusados.slice(0, 3).map((x) => `${x.caminho} (${x.motivo})`).join("; ")}`);
      status(`${partes.join(", ")}.`);
      if (r.gravados) setTimeout(recarregar, 1500);
    } catch (erro) {
      status(mensagemDeErro(erro));
    }
  };

  return {
    desmontar() {
      vivo = false;
      vigia.parar();
      if (ouvinte) imp.ouvintes.delete(ouvinte);
    },
  };
}
