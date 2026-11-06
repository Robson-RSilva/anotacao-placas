// Vista "Partida": o que uma partida importada tem — os quadros sorteados e os recortes das placas, com as
// anotações desenhadas por cima; cada versão de cada rótulo, com as revisões; os arquivos — e o que se
// faz com ela: editar uma anotação (na página de marcar ou na de pintar), excluir quadros, recortes, um
// lote ou a partida inteira, e baixar tudo num .zip.
//
// #/partida?id=<partida>[&aba=quadros|recortes|arquivos][&ver=<quadro ou recorte>]

import { descricaoPonto } from "../nucleo/campo.js";
import {
  ESTADOS,
  arquivosDaPartida,
  carregarPartida,
  excluirLote,
  excluirPartida,
  excluirQuadros,
  excluirRecortes,
  oQueSaiJunto,
  situacaoDoItem,
} from "../nucleo/partida.js";
import { MOTIVOS } from "../nucleo/formatos.js";
import { exportarZip } from "../nucleo/transferencia.js";
import { formatarTempo as tempoDoVideo } from "../nucleo/trechos.js";
import { Marcador } from "./marcador.js";
import { Pintor } from "./pintor.js";
import { caixas, escrevendo, parametros, textoSituacao } from "./tarefa.js";
import { baixar, celula, el, formatarDuracao, imagemDoArquivo, linhaVazia, mensagemDeErro, numero } from "./util.js";

const MINIATURA = 320; // px de largura das miniaturas
const COR_PONTO = "#4fc3f7";
const PARTIU = { nenhuma: "do zero", modelo: "de um modelo", rotulo_anterior: "da versão anterior", rotulo_revisado: "de outro rótulo (correção)" };
const DECISAO = { aprovar: "aprovado", corrigir: "corrigido", devolver: "devolvido" };

const plural = (n, um, varios) => `${numero(n, 0)} ${n === 1 ? um : varios}`;
const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const tamanho = (b) => (b < 1024 ? `${b} B` : b < 2 ** 20 ? `${numero(b / 1024, 0)} KB` : `${numero(b / 2 ** 20, 1)} MB`);

/** O tempo do quadro no vídeo, com o décimo de segundo: "2:00:47.4". */
export function tempoDoQuadro(ptsMs) {
  return `${tempoDoVideo(Math.floor(ptsMs / 1000))}.${Math.floor((ptsMs % 1000) / 100)}`;
}

/** Uma lista de definição (dt/dd) com os pares [rótulo, valor] que têm valor. */
function ficha(pares, dl = document.createElement("dl")) {
  dl.className = "ficha";
  dl.replaceChildren();
  for (const [k, v] of pares) {
    if (v === null || v === undefined || v === "") continue;
    dl.append(Object.assign(document.createElement("dt"), { textContent: k }), Object.assign(document.createElement("dd"), { textContent: v }));
  }
  return dl;
}

export async function montar(raiz, ctx) {
  const $ = (id) => el(id, raiz);
  const { pasta, indice } = ctx;
  const params = parametros();
  const pid = params.get("id") ?? "";
  const cx = caixas(raiz);
  let vivo = true;
  let dados = null;
  let aba = ["quadros", "recortes", "arquivos"].includes(params.get("aba")) ? params.get("aba") : "quadros";
  let filtro = "todos";
  let loteEscolhido = "";
  let selecionando = false;
  const selecao = new Set();
  let ultimoClicado = null;
  let lista = []; // os itens que aparecem (da aba e do filtro)
  let visor = null; // {k, x, tela, url, opcoes, escolhida}
  let miniaturas = null; // IntersectionObserver

  const mostrarErro = (t) => {
    $("erro-partida").textContent = t;
    $("erro-partida").hidden = !t;
  };
  const status = (t) => {
    $("res-partida").textContent = t;
  };

  let existe = false;
  try {
    existe = (await pasta.listarPartidas()).includes(pid) || Boolean(await pasta.diretorio(pasta.partida(pid)));
  } catch {
    existe = false;
  }
  if (!existe) {
    mostrarErro(pid ? `A partida ${pid} não está na pasta (foi excluída, ou ainda está sincronizando).` : "Faltou dizer qual partida abrir.");
    return {
      desmontar() {
        cx.destruir();
      },
    };
  }

  // ------------------------------------------------------------------ os itens das abas
  function itensDaAba() {
    if (!dados) return [];
    if (aba === "quadros") {
      const man = dados.manifesto;
      return (dados.fila?.itens ?? [])
        .map((it) => ({
          id: it.quadro,
          tarefa: "pontos",
          item: it,
          pts: it.pts_ms,
          largura: man?.video.largura ?? 0,
          altura: man?.video.altura ?? 0,
          regiao: null,
          lote: null,
          sit: situacaoDoItem(dados.ip.pontos, it.quadro, it),
        }))
        .sort((a, b) => a.pts - b.pts);
    }
    if (aba === "recortes") {
      return [...dados.recortes.entries()].map(([recorte, { lote, item }]) => ({
        id: recorte,
        tarefa: "placas",
        item,
        pts: null,
        largura: item.largura,
        altura: item.altura,
        regiao: item.regiao,
        lote,
        sit: situacaoDoItem(dados.ip.placas, recorte, item),
      }));
    }
    return [];
  }

  /** O rótulo que a miniatura mostra: o aprovado, ou o mais recente. */
  const rotuloDaVez = (x) => x.sit.aprovado?.a ?? x.sit.rotulos[x.sit.rotulos.length - 1] ?? null;

  // ------------------------------------------------------------------ a ficha da partida
  function mostrarFicha() {
    const m = dados.manifesto;
    const c = m?.cadastro;
    $("titulo-partida").textContent = c ? `${c.mandante} × ${c.visitante}` : pid;
    $("nome-partida").textContent = pid;
    const blocos = [];
    const bloco = (titulo, pares) => {
      const div = document.createElement("div");
      div.append(Object.assign(document.createElement("h3"), { textContent: titulo }), ficha(pares));
      blocos.push(div);
    };
    if (c) {
      bloco("Jogo", [
        ["Data e hora", new Date(c.data_hora).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" })],
        ["Jogo", `${c.mandante} × ${c.visitante}`],
        ["Estádio", c.estadio],
        ["Competição", c.competicao],
        ["Emissora", c.emissora],
        ["Condições", `${c.iluminacao}${c.chuva ? ", chuva" : ""}`],
        ["Observações", c.observacoes],
      ]);
    }
    if (m) {
      const v = m.video;
      bloco("Vídeo", [
        ["Arquivo", v.nome_original],
        ["Duração", tempoDoVideo(v.duracao_s)],
        ["Imagem", `${v.largura} × ${v.altura}, ${numero(v.fps, 2)} q/s`],
        ["Quadros", numero(v.n_quadros, 0)],
        ["Tamanho", tamanho(v.bytes)],
        ["SHA-256", `${v.sha256.slice(0, 16)}…`],
      ]);
      const pp = m.pre_processamento;
      const par = pp.parametros ?? {};
      const fila = dados.fila?.itens.length;
      bloco("Importação", [
        ["Em", dataHora(pp.criado_em)],
        ["Ferramenta", `v${pp.ferramenta}`],
        ["Levou", pp.segundos ? formatarDuracao(pp.segundos) : null],
        ["Trechos", par.trechos ? String(par.trechos).replaceAll(";", ", ") : "o vídeo inteiro"],
        ["Quadros na fila", fila === undefined ? null : `${numero(fila, 0)}${par.sorteio_alvo ? ` (pedidos: ${numero(par.sorteio_alvo, 0)})` : ""}`],
        ["Tomadas", dados.tomadas ? numero(dados.tomadas.tomadas.length, 0) : null],
        ["Rajadas de cortes", par.rajadas ? numero(par.rajadas, 0) : null],
      ]);
    }
    $("dados-partida").replaceChildren(...blocos);
    $("ficha-partida").hidden = false;
  }

  // ------------------------------------------------------------------ filtros, grade e seleção
  function mostrarAbas() {
    for (const b of raiz.querySelectorAll("[data-aba]")) b.setAttribute("aria-pressed", String(b.dataset.aba === aba));
    $("aba-itens").hidden = aba === "arquivos";
    $("aba-arquivos").hidden = aba !== "arquivos";
    $("n-quadros").textContent = dados?.fila ? `(${numero(dados.fila.itens.length, 0)})` : "";
    $("n-recortes").textContent = dados ? `(${numero(dados.recortes.size, 0)})` : "";
  }

  function mostrarFiltros(todos) {
    const conta = new Map();
    for (const x of todos) conta.set(x.sit.estado, (conta.get(x.sit.estado) ?? 0) + 1);
    if (filtro !== "todos" && !conta.get(filtro)) filtro = "todos";
    const botao = (chave, texto, n) => {
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: `${texto} (${numero(n, 0)})` });
      b.dataset.filtro = chave;
      b.setAttribute("aria-pressed", String(filtro === chave));
      b.onclick = () => {
        filtro = chave;
        mostrarItens();
      };
      return b;
    };
    $("filtros").replaceChildren(botao("todos", "Todos", todos.length), ...Object.entries(ESTADOS).filter(([k]) => conta.get(k)).map(([k, t]) => botao(k, t, conta.get(k))));
    const lote = $("filtro-lote");
    lote.hidden = aba !== "recortes" || !dados.lotes.size;
    if (aba === "recortes") {
      if (loteEscolhido && !dados.lotes.has(loteEscolhido)) loteEscolhido = "";
      lote.replaceChildren(new Option(`todos os lotes (${dados.lotes.size})`, ""), ...[...dados.lotes].map(([l, n]) => new Option(`lote ${l} (${n})`, l)));
      lote.value = loteEscolhido;
    }
  }

  function mostrarItens() {
    if (!dados) return;
    mostrarAbas();
    if (aba === "arquivos") {
      mostrarArquivos();
      return;
    }
    const todos = itensDaAba();
    mostrarFiltros(todos);
    lista = todos.filter((x) => (filtro === "todos" || x.sit.estado === filtro) && (!loteEscolhido || x.lote === loteEscolhido));
    for (const id of [...selecao]) if (!todos.some((x) => x.id === id)) selecao.delete(id);
    miniaturas?.disconnect();
    miniaturas = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          miniaturas.unobserve(e.target);
          const x = lista[Number(e.target.dataset.k)];
          if (x && x.id === e.target.dataset.id) desenharMiniatura(x, e.target.querySelector("canvas")).catch(() => {});
        }
      },
      { rootMargin: "300px" },
    );
    const grade = $("grade");
    grade.classList.toggle("selecionando", selecionando);
    grade.replaceChildren(...lista.map((x, k) => cartao(x, k)));
    for (const c of grade.children) miniaturas.observe(c);
    const vazio = !lista.length;
    $("vazio-itens").hidden = !vazio;
    $("vazio-itens").textContent = aba === "quadros" ? (dados.fila ? "Nenhum quadro aqui." : "A fila da partida não pôde ser lida (veja em Arquivos).") : "Nenhum recorte aqui. Os recortes das placas chegam em lotes, por .zip ou pelo `anotacao recortes`.";
    $("dica-itens").textContent = selecionando
      ? "Clique nos itens para marcar (com Shift, um intervalo). Esc sai da seleção."
      : `Clique ${aba === "quadros" ? "num quadro" : "num recorte"} para ver as anotações de perto, com as versões e as revisões.`;
    $("excluir-lote").hidden = aba !== "recortes" || !loteEscolhido;
    mostrarSelecao();
  }

  function cartao(x, k) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: `item${x.tarefa === "placas" ? " recorte" : ""}` });
    b.dataset.id = x.id;
    b.dataset.k = String(k);
    const cv = document.createElement("canvas");
    const w = MINIATURA;
    const h = Math.max(1, Math.round((MINIATURA * (x.altura || 9)) / (x.largura || 16)));
    cv.width = w;
    cv.height = h;
    cv.style.aspectRatio = `${w} / ${h}`;
    const marca = Object.assign(document.createElement("span"), { className: "marca-selecao" });
    const leg = Object.assign(document.createElement("div"), { className: "legenda-item" });
    leg.append(Object.assign(document.createElement("b"), { textContent: x.tarefa === "pontos" ? tempoDoQuadro(x.pts) : x.id.split("_").slice(1).join("_") }));
    leg.append(Object.assign(document.createElement("span"), { className: `selo ${x.sit.estado}`, textContent: ESTADOS[x.sit.estado] }));
    const texto = (t) => leg.append(Object.assign(document.createElement("span"), { textContent: t }));
    if (x.sit.pessoas.length) texto(x.sit.pessoas.join(", "));
    if (x.item.dupla) texto(x.sit.falta ? `dupla (falta ${x.sit.falta})` : "dupla");
    if (x.tarefa === "placas") texto(`quadro ${tempoDoQuadro(Number(x.id.slice(1, 11)))}`);
    b.title = x.tarefa === "pontos" ? `${x.id} · tomada ${x.item.tomada}` : `${x.id} · lote ${x.lote}`;
    b.append(cv, marca, leg);
    b.classList.toggle("selecionado", selecao.has(x.id));
    b.onclick = (e) => clicar(k, e);
    return b;
  }

  async function desenharMiniatura(x, cv) {
    const c = cv.getContext("2d");
    const f = await pasta.arquivo(pasta.imagem(pid, x.tarefa, x.id));
    if (!f) {
      c.fillStyle = "#cfd6df";
      c.font = "13px system-ui, sans-serif";
      c.fillText("sem a imagem", 10, 22);
      return;
    }
    let bmp;
    try {
      bmp = await createImageBitmap(f, { resizeWidth: cv.width, resizeHeight: cv.height, resizeQuality: "medium" });
    } catch {
      bmp = await createImageBitmap(f);
    }
    if (!cv.isConnected) {
      bmp.close();
      return;
    }
    c.drawImage(bmp, 0, 0, cv.width, cv.height);
    bmp.close();
    if ($("ver-anotacoes").checked) await desenharAnotacao(x, c, cv.width / (x.largura || cv.width), cv.height / (x.altura || cv.height));
  }

  /** A anotação da vez por cima da miniatura (`ex`, `ey`: px da miniatura por px da imagem). */
  async function desenharAnotacao(x, c, ex, ey) {
    const a = rotuloDaVez(x);
    if (x.tarefa === "placas" && x.regiao) {
      c.beginPath();
      x.regiao.forEach(([px, py], k) => (k ? c.lineTo(px * ex, py * ey) : c.moveTo(px * ex, py * ey)));
      c.closePath();
      c.strokeStyle = "#29d3ff";
      c.lineWidth = 1;
      c.stroke();
    }
    if (!a) return;
    if (a.dados.situacao === "descartada") {
      c.fillStyle = "rgba(207,34,46,0.78)";
      c.fillRect(0, 0, c.canvas.width, 18);
      c.fillStyle = "#fff";
      c.font = "600 11px system-ui, sans-serif";
      c.fillText("descartada", 6, 13);
      return;
    }
    if (x.tarefa === "pontos") {
      for (const p of a.dados.pontos) {
        c.beginPath();
        c.arc(p.x * ex, p.y * ey, 3, 0, 2 * Math.PI);
        c.fillStyle = COR_PONTO;
        c.fill();
        c.lineWidth = 1;
        c.strokeStyle = "rgba(0,0,0,0.8)";
        c.stroke();
      }
      return;
    }
    if (!a.dados.mascara) return;
    const m = await indice.mascara(`${pasta.rotulos(pid, "placas")}/${a.dados.mascara}`);
    const camada = new OffscreenCanvas(m.largura, m.altura);
    const cc = camada.getContext("2d");
    const img = cc.createImageData(m.largura, m.altura);
    for (let i = 0; i < m.dados.length; i++) {
      if (!m.dados[i]) continue;
      img.data.set([255, 64, 129, 150], 4 * i);
    }
    cc.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(camada, 0, 0, m.largura * ex, m.altura * ey);
  }

  function clicar(k, e) {
    const x = lista[k];
    if (!x) return;
    if (!selecionando) {
      abrirVisor(k);
      return;
    }
    if (e.shiftKey && ultimoClicado !== null) {
      const [a, b] = [Math.min(ultimoClicado, k), Math.max(ultimoClicado, k)];
      for (let j = a; j <= b; j++) selecao.add(lista[j].id);
    } else if (selecao.has(x.id)) {
      selecao.delete(x.id);
    } else {
      selecao.add(x.id);
    }
    ultimoClicado = k;
    mostrarSelecao();
  }

  function mostrarSelecao() {
    $("selecionar").setAttribute("aria-pressed", String(selecionando));
    $("selecionar").textContent = selecionando ? "Sair da seleção" : "Selecionar";
    $("selecionar-todos").hidden = !selecionando;
    const n = selecao.size;
    $("excluir-selecionados").hidden = !selecionando || !n;
    $("excluir-selecionados").textContent = `Excluir ${plural(n, aba === "quadros" ? "quadro" : "recorte", aba === "quadros" ? "quadros" : "recortes")}…`;
    for (const c of $("grade").children) c.classList.toggle("selecionado", selecao.has(c.dataset.id));
  }

  function sairDaSelecao() {
    selecionando = false;
    selecao.clear();
    ultimoClicado = null;
    $("grade").classList.remove("selecionando");
    mostrarSelecao();
    $("dica-itens").textContent = `Clique ${aba === "quadros" ? "num quadro" : "num recorte"} para ver as anotações de perto, com as versões e as revisões.`;
  }

  // ------------------------------------------------------------------ excluir
  /** Pergunta e exclui itens da aba; devolve true quando excluiu. */
  async function excluirItens(tarefa, ids) {
    if (!ids.length || cx.aberta()) return false;
    const s = oQueSaiJunto(dados, tarefa, ids);
    const nome = tarefa === "pontos" ? ["quadro", "quadros"] : ["recorte", "recortes"];
    const junto = [];
    if (s.rotulos) junto.push(plural(s.rotulos, tarefa === "pontos" ? "rótulo" : "pintura", tarefa === "pontos" ? "rótulos" : "pinturas"));
    if (s.revisoes) junto.push(plural(s.revisoes, "revisão", "revisões"));
    if (s.recortes) junto.push(`${plural(s.recortes, "recorte das placas tirado deles", "recortes das placas tirados deles")} (com o que tinham)`);
    const texto = `${junto.length ? `Sai junto: ${junto.join(", ")}.` : "Nenhum rótulo nem revisão sai junto."} ${tarefa === "pontos" ? "A fila da partida fica sem eles." : "Os lotes ficam sem eles."} Não dá para desfazer pela página (no Drive, os arquivos vão para a lixeira dele).`;
    const ok = await cx.confirmar(`Excluir ${plural(ids.length, ...nome)}?`, texto, { sim: "Excluir", perigo: true });
    if (!ok) return false;
    try {
      const r = tarefa === "pontos" ? await excluirQuadros(pasta, pid, ids) : await excluirRecortes(pasta, pid, ids);
      const n = tarefa === "pontos" ? r.quadros : r.recortes;
      status(`${plural(n, `${nome[0]} excluído`, `${nome[1]} excluídos`)}.`);
    } catch (e) {
      status(mensagemDeErro(e));
      return false;
    }
    await recarregar();
    return true;
  }

  $("selecionar").onclick = () => {
    if (selecionando) {
      sairDaSelecao();
      return;
    }
    selecionando = true;
    mostrarItens();
  };
  $("selecionar-todos").onclick = () => {
    for (const x of lista) selecao.add(x.id);
    mostrarSelecao();
  };
  $("excluir-selecionados").onclick = async () => {
    const ids = lista.filter((x) => selecao.has(x.id)).map((x) => x.id);
    if (await excluirItens(aba === "quadros" ? "pontos" : "placas", ids)) sairDaSelecao();
  };
  $("excluir-lote").onclick = async () => {
    if (!loteEscolhido || cx.aberta()) return;
    const ids = [...dados.recortes].filter(([, v]) => v.lote === loteEscolhido).map(([r]) => r);
    const s = oQueSaiJunto(dados, "placas", ids);
    const ok = await cx.confirmar(
      `Excluir o lote ${loteEscolhido} inteiro?`,
      `São ${plural(ids.length, "recorte", "recortes")}; sai junto: ${plural(s.rotulos, "pintura", "pinturas")} e ${plural(s.revisoes, "revisão", "revisões")}. Não dá para desfazer pela página.`,
      { sim: "Excluir o lote", perigo: true },
    );
    if (!ok) return;
    try {
      const r = await excluirLote(pasta, pid, loteEscolhido);
      status(`Lote ${loteEscolhido} excluído (${plural(r.recortes, "recorte", "recortes")}).`);
      loteEscolhido = "";
    } catch (e) {
      status(mensagemDeErro(e));
    }
    await recarregar();
  };
  $("filtro-lote").onchange = () => {
    loteEscolhido = $("filtro-lote").value;
    mostrarItens();
  };
  $("ver-anotacoes").onchange = () => mostrarItens();
  for (const b of raiz.querySelectorAll("[data-aba]")) {
    b.onclick = () => {
      if (aba === b.dataset.aba) return;
      aba = b.dataset.aba;
      filtro = "todos";
      sairDaSelecao();
      mostrarItens();
    };
  }

  // ------------------------------------------------------------------ a partida inteira
  $("baixar-partida").onclick = async () => {
    status("montando o .zip…");
    try {
      const prefixo = `${pasta.partida(pid)}/`;
      const { blob, n } = await exportarZip(pasta, (c) => c.startsWith(prefixo), (f) => status(`montando o .zip… ${Math.round(100 * f)}%`));
      baixar(blob, `${pid}.zip`);
      status(`${plural(n, "arquivo", "arquivos")} no .zip.`);
    } catch (e) {
      status(mensagemDeErro(e));
    }
  };
  $("excluir-partida").onclick = () => {
    const s = dados;
    const nr = (s.ip.pontos?.rotulos.length ?? 0) + (s.ip.placas?.rotulos.length ?? 0);
    const nv = (s.ip.pontos?.revisoes.length ?? 0) + (s.ip.placas?.revisoes.length ?? 0);
    $("texto-exclusao").textContent = `Excluir a partida inteira apaga a pasta dela: ${plural(s.fila?.itens.length ?? 0, "quadro", "quadros")}, ${plural(s.recortes.size, "recorte", "recortes")} das placas, ${plural(nr, "rótulo", "rótulos")} e ${plural(nv, "revisão", "revisões")} de todas as pessoas. Não dá para desfazer pela página (no Drive, os arquivos vão para a lixeira dele). Se quiser guardar, baixe o .zip antes.`;
    $("nome-confirmacao").value = "";
    $("excluir-de-vez").disabled = true;
    $("confirmar-exclusao").hidden = false;
    $("nome-confirmacao").focus();
  };
  $("nome-confirmacao").oninput = () => {
    $("excluir-de-vez").disabled = $("nome-confirmacao").value.trim() !== pid;
  };
  $("cancelar-exclusao").onclick = () => {
    $("confirmar-exclusao").hidden = true;
  };
  $("excluir-de-vez").onclick = async () => {
    if ($("nome-confirmacao").value.trim() !== pid) return;
    if (ctx.importacao?.worker) {
      status("Há uma importação em andamento nesta aba: espere terminar.");
      return;
    }
    $("excluir-de-vez").disabled = true;
    try {
      await excluirPartida(pasta, pid);
      ctx.ir("#/");
    } catch (e) {
      status(mensagemDeErro(e));
      $("excluir-de-vez").disabled = false;
    }
  };

  // ------------------------------------------------------------------ arquivos
  async function mostrarArquivos() {
    const tbody = $("arquivos").querySelector("tbody");
    tbody.replaceChildren();
    linhaVazia(tbody, 4, "listando…");
    const probl = $("problemas-arquivos");
    probl.hidden = !dados.erros.length;
    probl.replaceChildren();
    if (dados.erros.length) {
      probl.append(Object.assign(document.createElement("b"), { textContent: "Arquivos com problema (ficam fora das filas e do conjunto):" }));
      const ul = Object.assign(document.createElement("ul"), { className: "lista" });
      for (const e of dados.erros) ul.append(Object.assign(document.createElement("li"), { textContent: `${e.oque}: ${e.erro}` }));
      probl.append(ul);
    }
    const arqs = await arquivosDaPartida(pasta, pid);
    if (!vivo || aba !== "arquivos") return;
    $("n-arquivos").textContent = `(${numero(arqs.length, 0)})`;
    tbody.replaceChildren();
    for (const a of arqs) {
      const tr = document.createElement("tr");
      const acoes = celula("");
      const baixarArq = Object.assign(document.createElement("button"), { type: "button", className: "botao pequeno", textContent: "Baixar" });
      baixarArq.onclick = async () => baixar(await a.alca.getFile(), a.caminho.split("/").pop());
      if (a.caminho.endsWith(".json")) {
        const ver = Object.assign(document.createElement("button"), { type: "button", className: "botao pequeno", textContent: "Ver" });
        ver.onclick = () => verJson(a);
        acoes.append(ver, " ");
      }
      acoes.append(baixarArq);
      tr.append(celula(a.relativo), celula(tamanho(a.bytes), "num"), celula(new Date(a.modificado).toLocaleString("pt-BR")), acoes);
      tbody.append(tr);
    }
    if (!arqs.length) linhaVazia(tbody, 4, "A pasta da partida está vazia.");
  }

  async function verJson(a) {
    let texto;
    try {
      texto = JSON.stringify(JSON.parse(await (await a.alca.getFile()).text()), null, 2);
    } catch (e) {
      texto = `não consegui ler: ${mensagemDeErro(e)}`;
    }
    $("titulo-json").textContent = a.relativo;
    $("conteudo-json").textContent = texto;
    $("caixa-json").hidden = false;
    $("fechar-json").focus();
  }
  $("fechar-json").onclick = () => {
    $("caixa-json").hidden = true;
  };

  // ------------------------------------------------------------------ o visor
  async function previsao(x) {
    try {
      if (x.tarefa === "pontos") {
        const p = await indice.previsaoPontos(pid, x.id);
        return p ? { pontos: p.pontos, versao: `${p.fonte}@${p.versao}` } : null;
      }
      const caminho = pasta.previsaoPlacas(pid, x.id);
      return (await pasta.existe(caminho)) ? { caminho } : null;
    } catch {
      return null; // previsão inválida: não aparece
    }
  }

  function textoRevisoes(ip, a, tarefa) {
    return (ip?.revisoesDe.get(a.nome) ?? [])
      .slice()
      .sort((r1, r2) => Date.parse(r1.criado_em) - Date.parse(r2.criado_em))
      .map((r) => `${DECISAO[r.decisao]} por ${r.revisor} em ${dataHora(r.criado_em)}${r.motivo ? ` (${MOTIVOS[tarefa][r.motivo] ?? r.motivo})` : ""}${r.comentario ? ` — “${r.comentario}”` : ""}`);
  }

  /** "AB v2" para o nome de um rótulo do item (ou o próprio nome, se ele não está mais lá). */
  const curto = (x, nome) => {
    const b = x.sit.rotulos.find((a) => a.nome === nome);
    return b ? `${b.pessoa} v${b.versao}` : nome;
  };

  function opcoesDoVisor(x, prev) {
    const ip = x.tarefa === "pontos" ? dados.ip.pontos : dados.ip.placas;
    const out = [];
    for (const a of [...x.sit.rotulos].reverse()) {
      const r = a.dados;
      const oque = r.situacao === "descartada" ? "descartada" : x.tarefa === "pontos" ? plural(r.pontos.length, "ponto", "pontos") : r.pixels ? `${numero(r.pixels, 0)} px pintados` : "nada pintado";
      const rev = ip ? ip.ultimaRevisao(a.nome) : null;
      const corrige = r.corrige ? `correção de ${curto(x, r.corrige)}` : null;
      const situ = corrige ?? (rev ? `${DECISAO[rev.decisao]} por ${rev.revisor}` : "sem revisão");
      out.push({ chave: a.nome, tipo: "rotulo", a, titulo: `${a.pessoa} v${a.versao}${x.sit.aprovado?.a.nome === a.nome ? " · a aprovada" : ""}`, sub: `${dataHora(r.criado_em)} · ${oque} · ${situ}` });
    }
    if (prev) out.push({ chave: "modelo", tipo: "modelo", prev, titulo: x.tarefa === "pontos" ? "Previsão de um modelo" : "Pré-pintura de um modelo", sub: prev.versao ?? "" });
    out.push({ chave: "nada", tipo: "nada", titulo: "Só a imagem", sub: "" });
    return out;
  }

  async function abrirVisor(k) {
    const x = lista[k];
    if (!x) return;
    $("visor-erro").textContent = "";
    let arquivo = null;
    try {
      arquivo = await pasta.arquivo(pasta.imagem(pid, x.tarefa, x.id));
    } catch {
      arquivo = null;
    }
    if (!arquivo) {
      status(`A imagem de ${x.id} não está na pasta (ainda sincronizando?).`);
      return;
    }
    const { img, url } = await imagemDoArquivo(arquivo);
    if (!vivo) {
      URL.revokeObjectURL(url);
      return;
    }
    fecharVisor({ manterAberto: true });
    $("visor").hidden = false;
    document.body.style.overflow = "hidden";
    const canvas = $("tela-visor");
    const tela = x.tarefa === "pontos"
      ? new Marcador(canvas, { imagem: img, pontos: [], somenteLeitura: true, aoPassar: (nome) => { $("visor-dica").textContent = nome ? descricaoPonto(nome) : ""; } })
      : new Pintor(canvas, { imagem: img, mascara: null, regiao: x.regiao, somenteLeitura: true });
    if (x.tarefa === "pontos") tela.mostrarNomes = $("visor-nomes").checked;
    window.visorPartida = tela; // ajuda a depurar e a testar
    const prev = await previsao(x);
    const opcoes = opcoesDoVisor(x, prev);
    visor = { k, x, tela, url, opcoes, escolhida: null };
    $("visor-titulo").textContent = x.tarefa === "pontos" ? `Quadro ${tempoDoQuadro(x.pts)}` : `Recorte ${x.id}`;
    ficha(
      x.tarefa === "pontos"
        ? [
          ["Quadro", x.id],
          ["Tempo no vídeo", tempoDoQuadro(x.pts)],
          ["Tomada", tomadaDe(x.item.tomada)],
          ["Situação", textoEstado(x)],
          ["Fila", [x.item.dupla ? "dupla às cegas" : "", x.item.sem_previsao ? "começa sem previsão" : ""].filter(Boolean).join(", ") || null],
        ]
        : [
          ["Recorte", x.id],
          ["Lote", x.lote],
          ["Tamanho", `${x.largura} × ${x.altura}`],
          ["Situação", textoEstado(x)],
          ["Fila", [x.item.dupla ? "dupla às cegas" : "", x.item.sem_previsao ? "começa sem a pré-pintura" : ""].filter(Boolean).join(", ") || null],
        ],
      $("visor-ficha"),
    );
    $("visor-posicao").textContent = `${k + 1} de ${lista.length}`;
    $("visor-anterior").disabled = k === 0;
    $("visor-proximo").disabled = k === lista.length - 1;
    const padrao = x.sit.aprovado?.a.nome ?? opcoes[0].chave;
    await escolher(padrao);
  }

  function tomadaDe(id) {
    const t = dados.tomadas?.tomadas.find((tt) => tt.id === id);
    if (!t) return String(id);
    const zoom = { aberto: "plano aberto", medio: "plano médio", fechado: "plano fechado" }[t.zoom] ?? t.zoom;
    return `${id} · ${tempoDoQuadro(t.inicio_ms)} a ${tempoDoQuadro(t.fim_ms)} (${numero((t.fim_ms - t.inicio_ms) / 1000, 1)} s) · ${zoom}`;
  }

  function textoEstado(x) {
    const s = x.sit;
    const ap = s.aprovado;
    if (ap) return `${ESTADOS[s.estado]} — ${ap.decisao === "corrigir" ? `correção de ${ap.a.pessoa}` : `${ap.a.pessoa} v${ap.a.versao}, aprovado por ${ap.revisor}`}`;
    return ESTADOS[s.estado] + (s.falta ? ` (dupla: falta ${plural(s.falta, "pessoa", "pessoas")})` : "");
  }

  async function escolher(chave) {
    if (!visor) return;
    const { x, tela, opcoes } = visor;
    const op = opcoes.find((o) => o.chave === chave) ?? opcoes[opcoes.length - 1];
    visor.escolhida = op.chave;
    const caixa = $("visor-versoes");
    caixa.replaceChildren(
      ...opcoes.map((o) => {
        const l = document.createElement("label");
        l.className = o.chave === op.chave ? "escolhida" : "";
        const r = Object.assign(document.createElement("input"), { type: "radio", name: "versao-visor", value: o.chave, checked: o.chave === op.chave });
        r.onchange = () => escolher(o.chave);
        const t = document.createElement("span");
        t.append(Object.assign(document.createElement("b"), { textContent: o.titulo }));
        if (o.sub) t.append(document.createElement("br"), Object.assign(document.createElement("span"), { className: "sutil", textContent: o.sub }));
        l.append(r, t);
        return l;
      }),
    );
    const det = $("visor-detalhe");
    det.replaceChildren();
    const linha = (texto) => det.append(Object.assign(document.createElement("p"), { textContent: texto }));
    try {
      if (x.tarefa === "pontos") {
        const pontos = op.tipo === "rotulo" ? op.a.dados.pontos : op.tipo === "modelo" ? op.prev.pontos : [];
        tela.definir(pontos);
        if (pontos.length) det.append(Object.assign(document.createElement("p"), { className: "pontos-lista", textContent: pontos.map((p) => p.ponto).join(", ") }));
      } else {
        let m = null;
        if (op.tipo === "rotulo" && op.a.dados.mascara) m = (await indice.mascara(`${pasta.rotulos(pid, "placas")}/${op.a.dados.mascara}`)).dados;
        if (op.tipo === "modelo") m = (await indice.mascara(op.prev.caminho)).dados;
        if (visor?.escolhida !== op.chave) return; // escolheram outra enquanto a máscara abria
        tela.definir(m);
      }
    } catch (e) {
      $("visor-erro").textContent = `Não consegui mostrar esta anotação: ${mensagemDeErro(e)}`;
    }
    if (op.tipo === "rotulo") {
      const r = op.a.dados;
      const ip = x.tarefa === "pontos" ? dados.ip.pontos : dados.ip.placas;
      linha(`${textoSituacao(r, x.tarefa)}${r.comentario ? ` — “${r.comentario}”` : ""}`);
      linha(`Por ${op.a.pessoa}, em ${dataHora(r.criado_em)}, em ${formatarDuracao(r.segundos_ativos)} de uso; começou ${PARTIU[r.partiu_de.fonte] ?? r.partiu_de.fonte}.`);
      if (r.corrige) linha(`Corrige ${curto(x, r.corrige)}.`);
      const revs = textoRevisoes(ip, op.a, x.tarefa);
      linha(revs.length ? `Revisão: ${revs.join("; ")}.` : r.corrige ? "Correção: vale como revisão." : "Ainda sem revisão.");
    } else if (op.tipo === "modelo") {
      linha(x.tarefa === "pontos" ? "O que um modelo previu para este quadro (é de onde a anotação começa)." : "A pré-pintura de um modelo para este recorte.");
    }
    $("visor-editar").title = textoEditar(op);
  }

  function textoEditar(op) {
    const base = op.tipo === "rotulo" ? `a partir do rótulo de ${op.a.pessoa} (v${op.a.versao})` : op.tipo === "modelo" ? "a partir da previsão" : "do zero";
    return `Abre na página de ${visor.x.tarefa === "pontos" ? "marcar" : "pintar"}, ${base}.`;
  }

  function fecharVisor({ manterAberto = false } = {}) {
    if (visor) {
      visor.tela.destruir();
      URL.revokeObjectURL(visor.url);
      visor = null;
      window.visorPartida = null;
    }
    if (manterAberto) return;
    $("visor").hidden = true;
    document.body.style.overflow = "";
  }

  function editar() {
    if (!visor) return;
    if (!ctx.pessoa()) {
      $("visor-erro").textContent = "Para editar, digite o seu código na página central.";
      return;
    }
    const { x, escolhida } = visor;
    const campo = x.tarefa === "pontos" ? "quadro" : "recorte";
    ctx.ir(`#/${x.tarefa}?editar=${encodeURIComponent(pid)}&${campo}=${encodeURIComponent(x.id)}&de=${encodeURIComponent(escolhida)}`);
  }

  async function excluirDoVisor() {
    if (!visor) return;
    const { k, x } = visor;
    if (!(await excluirItens(x.tarefa, [x.id]))) return;
    if (!lista.length) fecharVisor();
    else await abrirVisor(Math.min(k, lista.length - 1));
  }

  $("fechar-visor").onclick = () => fecharVisor();
  $("visor-anterior").onclick = () => visor && abrirVisor(visor.k - 1);
  $("visor-proximo").onclick = () => visor && abrirVisor(visor.k + 1);
  $("visor-editar").onclick = editar;
  $("visor-excluir").onclick = excluirDoVisor;
  $("visor-baixar").onclick = async () => {
    if (!visor) return;
    const f = await pasta.arquivo(pasta.imagem(pid, visor.x.tarefa, visor.x.id));
    if (f) baixar(f, `${visor.x.id}.jpg`);
  };
  $("visor-nomes").onchange = () => {
    if (visor?.x.tarefa !== "pontos") return;
    visor.tela.mostrarNomes = $("visor-nomes").checked;
    visor.tela.desenhar();
  };
  $("visor-mostrar").onchange = () => {
    if (!visor) return;
    if (visor.x.tarefa === "pontos") visor.tela.mostrarPontos = $("visor-mostrar").checked;
    else visor.tela.mostrarPintura = $("visor-mostrar").checked;
    visor.tela.desenhar();
  };

  const teclas = (e) => {
    if (e.type !== "keydown" || cx.aberta() || escrevendo(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!$("caixa-json").hidden) {
      if (e.key === "Escape") $("caixa-json").hidden = true;
      return;
    }
    if (!visor) {
      if (e.key === "Escape" && selecionando) sairDaSelecao();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === "escape") fecharVisor();
    else if (k === "arrowleft" && visor.k > 0) abrirVisor(visor.k - 1);
    else if (k === "arrowright" && visor.k < lista.length - 1) abrirVisor(visor.k + 1);
    else if (k === "e") editar();
    else if (k === "delete") excluirDoVisor();
    else if (k === "l" && visor.x.tarefa === "pontos") {
      $("visor-nomes").checked = !$("visor-nomes").checked;
      $("visor-nomes").dispatchEvent(new Event("change"));
    } else if (k === "h") {
      $("visor-mostrar").checked = !$("visor-mostrar").checked;
      $("visor-mostrar").dispatchEvent(new Event("change"));
    } else if (k === "0") visor.tela.ajustarVista();
    else return;
    e.preventDefault();
  };
  window.addEventListener("keydown", teclas);

  // ------------------------------------------------------------------ carregar
  async function recarregar() {
    try {
      dados = await carregarPartida(indice, pid);
    } catch (e) {
      mostrarErro(mensagemDeErro(e));
      return;
    }
    if (!vivo) return;
    mostrarErro(dados.manifesto ? "" : "O manifesto da partida não pôde ser lido: a partida fica fora das filas até isso se resolver (veja em Arquivos).");
    mostrarFicha();
    $("secao-itens").hidden = false;
    mostrarItens();
  }

  await recarregar();
  const ver = params.get("ver");
  if (ver && dados) {
    if (aba !== "quadros" && aba !== "recortes") aba = ver.includes("_") ? "recortes" : "quadros";
    if (!lista.some((x) => x.id === ver) && aba === "quadros" && ver.includes("_")) {
      aba = "recortes";
      mostrarItens();
    }
    const k = lista.findIndex((x) => x.id === ver);
    if (k >= 0) await abrirVisor(k);
  }

  return {
    desmontar() {
      vivo = false;
      miniaturas?.disconnect();
      fecharVisor();
      window.removeEventListener("keydown", teclas);
      cx.destruir();
    },
  };
}
