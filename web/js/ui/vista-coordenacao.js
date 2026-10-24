// Vista "Coordenação" (opcional): nomes, projeto, pacotes de estádio, gabarito e divisão por partida.

import { RE_GABARITO, codigoPessoa } from "../nucleo/convencoes.js";
import { ErroFormato, conferir, conjuntoDe, validar } from "../nucleo/formatos.js";
import { validarGeometria } from "../nucleo/pacote.js";
import { ArquivoExiste } from "../nucleo/pasta.js";
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

  // ------------------------------------------------------------------ pacotes
  async function listarPacotes() {
    const lista = $("pacotes");
    lista.replaceChildren();
    const refs = await pasta.listarPacotes();
    if (!refs.length) lista.append(Object.assign(document.createElement("li"), { className: "sutil", textContent: "Nenhum pacote ainda." }));
    for (const ref of refs) {
      const p = await indice.pacote(ref).catch(() => null);
      const li = document.createElement("li");
      li.textContent = p ? `${ref} — ${p.nome}: campo ${p.campo.comprimento} × ${p.campo.largura} m, ${p.placas.length} placas, ${p.cameras.length} câmeras` : `${ref} (inválido)`;
      lista.append(li);
    }
  }
  await listarPacotes();
  $("arquivo-pacote").onchange = async (e) => {
    const arquivo = e.target.files[0];
    e.target.value = "";
    if (!arquivo) return;
    $("erro-pacote").textContent = "";
    try {
      const p = validar("pacote", await lerJsonDoArquivo(arquivo));
      const erros = validarGeometria(p);
      if (erros.length) throw new Error(erros.join("; "));
      await pasta.gravar("pacote", pasta.pacote(p.estadio, p.versao), p);
      await listarPacotes();
    } catch (erro) {
      $("erro-pacote").textContent = erro instanceof ArquivoExiste
        ? "este pacote já existe: medida nova vira versão nova"
        : erro instanceof ErroFormato ? erro.erros.join("; ") : mensagemDeErro(erro);
    }
  };

  // ------------------------------------------------------------------ gabarito
  async function contarGabarito() {
    const itens = await indice.itensGabarito("camera");
    const oclusao = await indice.itensGabarito("oclusao");
    const partes = [
      itens.length
        ? `Câmera: ${itens.length} itens. Quem começa anota até a mediana dos últimos 10 ficar em até 2 px; depois, um escondido a cada 15 rótulos.`
        : "Câmera: sem gabarito, ninguém passa por treino antes dos dados reais.",
      oclusao.length
        ? `Oclusão: ${oclusao.length} itens. Quem começa pinta até a mediana dos últimos 5 ficar em até 5% de cada placa diferente da resposta (com 1 px de tolerância na borda); depois, um escondido a cada 15 pinturas.`
        : "Oclusão: sem gabarito, ninguém passa por treino antes dos quadros reais.",
    ];
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
        const tipo = bruto?.formato === "gabarito.oclusao/1" ? "gabarito_oclusao" : "gabarito";
        const g = validar(tipo, bruto);
        if (!RE_GABARITO.test(g.id) || `${g.id}.json` !== a.name) throw new Error("o nome do arquivo precisa ser o id do item");
        const img = porNome.get(g.imagem);
        if (!img) throw new Error(`falta a imagem ${g.imagem}`);
        const cabeca = new Uint8Array(await img.slice(0, 3).arrayBuffer());
        if (!(cabeca[0] === 0xff && cabeca[1] === 0xd8 && cabeca[2] === 0xff)) throw new Error(`${g.imagem} precisa ser JPEG`);
        const mascara = tipo === "gabarito_oclusao" ? porNome.get(g.mascara) : null;
        if (tipo === "gabarito_oclusao") {
          if (!mascara) throw new Error(`falta a máscara ${g.mascara}`);
          if (!ehPng(new Uint8Array(await mascara.slice(0, 8).arrayBuffer()))) throw new Error(`${g.mascara} precisa ser PNG`);
        }
        if (!(await pasta.existe(pasta.pacoteRef(g.pacote)))) throw new Error(`o pacote ${g.pacote} não está na pasta`);
        if (await pasta.existe(pasta.itemGabarito(g.id))) continue;
        await pasta.escrever(pasta.quadro("gabarito", g.id), img, { sobrescrever: true });
        if (mascara) await pasta.escrever(pasta.mascaraGabarito(g.id), mascara, { sobrescrever: true });
        await pasta.gravar(tipo, pasta.itemGabarito(g.id), { ...g, imagem: `${g.id}.jpg`, ...(mascara ? { mascara: `${g.id}.png` } : {}) });
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
