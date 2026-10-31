// Vista "Coordenação" (opcional): nomes, projeto, gabarito (itens soltos) e divisão por partida.

import { RE_GABARITO, codigoPessoa } from "../nucleo/convencoes.js";
import { ErroFormato, conferir, conjuntoDe, tipoDoItem, validar } from "../nucleo/formatos.js";
import { REGRA } from "../nucleo/gabarito.js";
import { ehPng } from "../nucleo/png.js";
import { celula, el, linhaVazia, mensagemDeErro } from "./util.js";

const CONJUNTOS = { treino: "treino", validacao: "validação", teste_congelado: "teste congelado", teste_externo: "teste externo" };

async function lerJsonDoArquivo(arquivo) {
  try {
    return JSON.parse(await arquivo.text());
  } catch (e) {
    throw new Error(`${arquivo.name}: não é um JSON válido (${e.message})`);
  }
}

export async function montar(raiz, ctx) {
  const $ = (id) => el(id, raiz);
  const { pasta, indice } = ctx;
  if (!(await pasta.ehPastaDeTrabalho())) await pasta.criar();

  // ------------------------------------------------------------------ nomes (opcional)
  // não há equipe a cadastrar: quem anota digita o código na página central; aqui só se dá um nome
  // ao código, para o placar
  const tEquipe = $("equipe").querySelector("tbody");
  function linhaMembro(m = { codigo: "", nome: "" }) {
    const tr = document.createElement("tr");
    const entrada = (valor, attrs, rotulo) => {
      const td = document.createElement("td");
      const i = Object.assign(document.createElement("input"), { value: valor, ...attrs });
      i.setAttribute("aria-label", rotulo);
      td.append(i);
      return td;
    };
    const remover = document.createElement("td");
    const b = Object.assign(document.createElement("button"), { type: "button", className: "x", textContent: "×", title: "Tirar" });
    b.onclick = () => tr.remove();
    remover.append(b);
    tr.append(
      entrada(m.codigo, { placeholder: "RS", maxLength: 10, size: 8, className: "codigo" }, "código"),
      entrada(m.nome, { placeholder: "Nome" }, "nome"),
      remover,
    );
    tEquipe.append(tr);
  }
  const equipe = await indice.equipe();
  for (const m of equipe.membros) linhaMembro(m);
  if (!equipe.membros.length) linhaMembro();
  $("mais-membro").onclick = () => linhaMembro();
  $("salvar-equipe").onclick = async () => {
    $("erro-equipe").textContent = "";
    const membros = [...tEquipe.querySelectorAll("tr")]
      .map((tr) => {
        const [codigo, nome] = [...tr.querySelectorAll("input")].map((i) => i.value.trim());
        return { codigo: codigoPessoa(codigo) ?? codigo.toUpperCase(), nome, papeis: ["anotador", "revisor"] };
      })
      .filter((m) => m.codigo || m.nome);
    try {
      await pasta.gravar("equipe", "equipe.json", { formato: "equipe/1", membros }, { sobrescrever: true });
      $("erro-equipe").className = "sutil";
      $("erro-equipe").textContent = "Nomes salvos.";
    } catch (e) {
      $("erro-equipe").className = "erro";
      $("erro-equipe").textContent = e instanceof ErroFormato ? e.erros.join("; ") : mensagemDeErro(e);
    }
  };

  // ------------------------------------------------------------------ projeto
  const projeto = await pasta.lerProjeto();
  const fp = $("form-projeto");
  fp.elements.nome.value = projeto.nome;
  fp.elements.manual_url.value = projeto.manual_url;
  fp.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await pasta.gravar(
        "projeto",
        "projeto.json",
        { formato: "projeto/1", nome: fp.elements.nome.value.trim(), manual_url: fp.elements.manual_url.value.trim() },
        { sobrescrever: true },
      );
      $("erro-projeto").className = "sutil";
      $("erro-projeto").textContent = "Salvo.";
    } catch (erro) {
      $("erro-projeto").className = "erro";
      $("erro-projeto").textContent = erro instanceof ErroFormato ? "o link precisa começar com https://" : mensagemDeErro(erro);
    }
  };

  // ------------------------------------------------------------------ gabarito
  async function contarGabarito() {
    const partes = [];
    for (const [tarefa, nome] of [["pontos", "Pontos"], ["placas", "Pintura das placas"]]) {
      const itens = await indice.itensGabarito(tarefa);
      const r = REGRA[tarefa];
      partes.push(itens.length
        ? `${nome}: ${itens.length} itens. Quem começa faz o teste (a meta: ${r.meta}); depois, um item escondido a cada 15 imagens.`
        : `${nome}: sem gabarito, ninguém passa pelo teste antes das imagens reais.`);
    }
    $("st-gabarito").textContent = partes.join(" ");
  }
  await contarGabarito();
  $("arquivos-gabarito").onchange = async (e) => {
    const arquivos = [...e.target.files];
    e.target.value = "";
    $("erro-gabarito").textContent = "";
    const porNome = new Map(arquivos.map((a) => [a.name, a]));
    const problemas = [];
    let novos = 0;
    for (const a of arquivos.filter((x) => /^g\d{4}\.json$/.test(x.name))) {
      try {
        const bruto = await lerJsonDoArquivo(a);
        const doItem = tipoDoItem(bruto);
        if (!doItem) throw new Error("item de uma versão anterior (câmera, oclusão, jogadores ou pessoas): esta versão não usa");
        const g = validar(doItem.tipo, bruto);
        if (!RE_GABARITO.test(g.id) || `${g.id}.json` !== a.name) throw new Error("o nome do arquivo precisa ser o id do item");
        const img = porNome.get(g.imagem);
        if (!img) throw new Error(`falta a imagem ${g.imagem}`);
        const cabeca = new Uint8Array(await img.slice(0, 3).arrayBuffer());
        if (!(cabeca[0] === 0xff && cabeca[1] === 0xd8 && cabeca[2] === 0xff)) throw new Error(`${g.imagem} precisa ser JPEG`);
        const mascara = doItem.tarefa === "placas" && g.mascara ? porNome.get(g.mascara) : null;
        if (doItem.tarefa === "placas" && g.mascara) {
          if (!mascara) throw new Error(`falta a máscara ${g.mascara}`);
          if (!ehPng(new Uint8Array(await mascara.slice(0, 8).arrayBuffer()))) throw new Error(`${g.mascara} precisa ser PNG`);
        }
        if (await pasta.existe(pasta.itemGabarito(g.id))) continue;
        await pasta.escrever(pasta.quadro("gabarito", g.id), img, { sobrescrever: true });
        if (mascara) await pasta.escrever(pasta.mascaraGabarito(g.id), mascara, { sobrescrever: true });
        await pasta.gravar(doItem.tipo, pasta.itemGabarito(g.id), { ...g, imagem: `${g.id}.jpg`, ...(mascara ? { mascara: `${g.id}.png` } : {}) });
        novos += 1;
      } catch (erro) {
        problemas.push(`${a.name}: ${erro instanceof ErroFormato ? erro.erros.join("; ") : mensagemDeErro(erro)}`);
      }
    }
    await contarGabarito();
    $("erro-gabarito").className = problemas.length ? "erro" : "sutil";
    $("erro-gabarito").textContent = [`${novos} item(ns) novo(s).`, ...problemas.slice(0, 5)].join(" ");
  };

  // ------------------------------------------------------------------ divisão
  const tDivisao = $("divisao").querySelector("tbody");
  const divisao = await indice.divisao();
  const partidas = await pasta.listarPartidas();
  if (!partidas.length) linhaVazia(tDivisao, 2, "Nenhuma partida importada ainda.");
  for (const pid of partidas) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    const sel = document.createElement("select");
    sel.dataset.partida = pid;
    sel.setAttribute("aria-label", `conjunto de ${pid}`);
    sel.replaceChildren(...Object.entries(CONJUNTOS).map(([v, t]) => new Option(t, v)));
    sel.value = conjuntoDe(divisao, pid);
    td.append(sel);
    tr.append(celula(pid), td);
    tDivisao.append(tr);
  }
  $("salvar-divisao").onclick = async () => {
    const nova = { formato: "divisao/1", validacao: [], teste_congelado: [], teste_externo: [] };
    // partidas que não estão nesta pasta continuam onde estavam
    for (const k of ["validacao", "teste_congelado", "teste_externo"]) nova[k] = divisao[k].filter((p) => !partidas.includes(p));
    for (const sel of tDivisao.querySelectorAll("select")) if (sel.value !== "treino") nova[sel.value].push(sel.dataset.partida);
    const erros = conferir("divisao", nova);
    if (erros.length) {
      $("erro-divisao").className = "erro";
      $("erro-divisao").textContent = erros.join("; ");
      return;
    }
    try {
      await pasta.gravar("divisao", "divisao.json", nova, { sobrescrever: true });
      $("erro-divisao").className = "sutil";
      $("erro-divisao").textContent = "Divisão salva.";
    } catch (e) {
      $("erro-divisao").className = "erro";
      $("erro-divisao").textContent = mensagemDeErro(e);
    }
  };
}
