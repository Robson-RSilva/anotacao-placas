// O painel da oclusão, compartilhado pela pintura e pela correção na revisão: ferramentas, classes,
// camadas, faixas de placas, a lista das placas do quadro e as teclas.

import { CLASSE, CLASSES, erroNasFaixas } from "../nucleo/oclusao.js";
import { numero } from "./util.js";

const CLASSE_DA_TECLA = Object.fromEntries(CLASSES.filter((c) => c.tecla).map((c) => [c.tecla, c.valor]));

/** Fração (0 a 1) como porcentagem curta: 0,734 -> "73%". */
export const porcento = (f) => (f === null || f === undefined ? "—" : `${numero(100 * f, 0)}%`);

/** Diferença entre duas pinturas, em porcentagem da placa, com uma casa: 0,032 -> "3,2%". */
export const diferenca = (f) => (f === null || f === undefined ? "—" : `${numero(100 * f, 1)}%`);

/**
 * Liga as ferramentas, as classes, o tamanho do pincel e as camadas ao pintor do momento. Devolve
 * {mostrar()}, que põe o painel igual ao pintor.
 */
export function ligarFerramentas(raiz, $, pintorAtual) {
  const radios = () => [...raiz.querySelectorAll("input[name=classe]")];
  const mostrar = () => {
    const p = pintorAtual();
    if (!p) return;
    for (const b of raiz.querySelectorAll("[data-ferramenta]")) b.setAttribute("aria-pressed", String(b.dataset.ferramenta === p.ferramenta));
    for (const r of radios()) r.checked = Number(r.value) === p.classe;
    $("raio").value = String(p.raio);
    $("raio-valor").textContent = `${p.raio} px`;
    $("ver-pintura").checked = p.mostrarPintura;
    $("ver-contornos").checked = p.mostrarContornos;
    $("ver-molde").checked = p.mostrarMolde;
  };
  for (const b of raiz.querySelectorAll("[data-ferramenta]")) {
    b.onclick = () => {
      const p = pintorAtual();
      if (!p) return;
      p.ferramenta = b.dataset.ferramenta;
      p.cancelarLaco();
      mostrar();
    };
  }
  for (const r of radios()) {
    r.onchange = () => {
      const p = pintorAtual();
      if (p && r.checked && !r.disabled) p.classe = Number(r.value);
      mostrar();
    };
  }
  $("raio").oninput = () => {
    const p = pintorAtual();
    if (!p) return;
    p.raio = Number($("raio").value);
    mostrar();
    p.desenhar();
  };
  const camada = (id, chave) => {
    $(id).onchange = () => {
      const p = pintorAtual();
      if (!p) return;
      p[chave] = $(id).checked;
      p.desenhar();
    };
  };
  camada("ver-pintura", "mostrarPintura");
  camada("ver-contornos", "mostrarContornos");
  camada("ver-molde", "mostrarMolde");
  $("desfazer").onclick = () => pintorAtual()?.desfazer();
  $("refazer").onclick = () => pintorAtual()?.refazer();
  return { mostrar };
}

/** "Não é placa" só vale nas faixas de placas (no pacote e no gabarito, as placas são exatas). */
export function permitirNaoPlaca(raiz, pintor, permitir) {
  const r = raiz.querySelector(`input[name=classe][value="${CLASSE.NAO_PLACA}"]`);
  r.disabled = !permitir;
  r.closest("label").hidden = !permitir;
  pintor.semNaoPlaca = !permitir;
  if (!permitir && pintor.classe === CLASSE.NAO_PLACA) pintor.classe = CLASSE.PESSOA;
}

const CAMPOS_FAIXA = ["distancia", "altura", "comprimento", "vao"];

/** Resumo curto das faixas: "laterais a 4 m · fundos a 5 m". */
export function resumoFaixas(f) {
  const um = (nome, x) => (x.ligada ? `${nome} a ${numero(x.distancia, 1)} m` : `sem ${nome}`);
  return `${um("laterais", f.laterais)} · ${um("fundos", f.fundos)}`;
}

/** Mostra as medidas das faixas nos campos do painel (comprimento vazio: de canto a canto). */
export function mostrarFaixas($, faixas) {
  if ($("resumo-faixas")) $("resumo-faixas").textContent = `(${resumoFaixas(faixas)})`;
  for (const [lado, f] of [["lat", faixas.laterais], ["fun", faixas.fundos]]) {
    for (const campo of CAMPOS_FAIXA) {
      const v = f[campo] ?? (campo === "vao" ? 0 : null);
      if (document.activeElement !== $(`${lado}-${campo}`)) $(`${lado}-${campo}`).value = v === null ? "" : String(v);
    }
    $(`${lado}-ligada`).checked = f.ligada;
  }
}

/** As medidas que estão nos campos do painel (e o problema nelas, ou null). */
export function lerFaixas($) {
  const numeroOu = (id, vazio) => ($(id).value.trim() === "" ? vazio : Number($(id).value));
  const f = (lado) => ({
    distancia: Number($(`${lado}-distancia`).value),
    altura: Number($(`${lado}-altura`).value),
    comprimento: numeroOu(`${lado}-comprimento`, null),
    vao: numeroOu(`${lado}-vao`, 0),
    ligada: $(`${lado}-ligada`).checked,
  });
  const faixas = { laterais: f("lat"), fundos: f("fun") };
  return { faixas, erro: erroNasFaixas(faixas) };
}

/** Liga os campos das faixas: `aoMudar(faixas)` quando as medidas mudam e são aceitas. */
export function ligarFaixas($, aoMudar, aoErro) {
  const mudar = () => {
    const { faixas, erro } = lerFaixas($);
    if (erro) {
      aoErro(`${erro.charAt(0).toUpperCase()}${erro.slice(1)}.`);
      return;
    }
    if ($("resumo-faixas")) $("resumo-faixas").textContent = `(${resumoFaixas(faixas)})`;
    aoMudar(faixas);
  };
  for (const lado of ["lat", "fun"]) {
    for (const campo of [...CAMPOS_FAIXA, "ligada"]) $(`${lado}-${campo}`).onchange = mudar;
  }
}

/** A lista das placas do quadro, com a fração livre de cada uma. */
export function listarPlacas(ul, placas) {
  ul.replaceChildren();
  if (!placas.length) {
    ul.append(Object.assign(document.createElement("li"), { className: "sutil", textContent: "Nenhuma placa na imagem." }));
    return;
  }
  for (const p of placas) {
    const li = document.createElement("li");
    const nome = document.createElement("span");
    nome.textContent = p.id;
    const valor = document.createElement("span");
    if (p.pequena) {
      valor.className = "sutil";
      valor.textContent = "pequena demais";
    } else {
      valor.className = `res ${p.livre_frac >= 0.999 ? "" : p.livre_frac >= 0.5 ? "medio" : "ruim"}`;
      valor.textContent = `livre ${porcento(p.livre_frac)}`;
    }
    li.append(nome, valor);
    ul.append(li);
  }
}

/**
 * As teclas do pintor (devolve true quando a tecla era dele). Os números escolhem a classe, E apaga,
 * B e L trocam a ferramenta, [ e ] mudam o pincel, H, O e M mostram e escondem as camadas.
 */
export function teclaDoPintor(e, pintor, mostrar) {
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) pintor.refazer();
    else pintor.desfazer();
    return true;
  }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "y") {
    e.preventDefault();
    pintor.refazer();
    return true;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (k === " ") {
    e.preventDefault();
    pintor.espaco = e.type === "keydown";
    pintor.desenhar();
    return true;
  }
  if (e.type !== "keydown") return false;
  if (k === "Escape" && pintor.laco) pintor.cancelarLaco();
  else if (k === "Enter" && pintor.laco) pintor.fecharLaco();
  else if (k === "Backspace" && pintor.laco) pintor.tirarPontoDoLaco();
  else if (CLASSE_DA_TECLA[k] !== undefined && !(CLASSE_DA_TECLA[k] === CLASSE.NAO_PLACA && pintor.semNaoPlaca)) pintor.classe = CLASSE_DA_TECLA[k];
  else if (k === "e" || k === "E") pintor.classe = CLASSE.LIVRE;
  else if (k === "b" || k === "B") pintor.ferramenta = "pincel";
  else if (k === "l" || k === "L") pintor.ferramenta = "laco";
  else if (k === "[") pintor.raio = Math.max(1, pintor.raio - (pintor.raio > 10 ? 2 : 1));
  else if (k === "]") pintor.raio = Math.min(40, pintor.raio + (pintor.raio >= 10 ? 2 : 1));
  else if (k === "h" || k === "H") pintor.mostrarPintura = !pintor.mostrarPintura;
  else if (k === "o" || k === "O") pintor.mostrarContornos = !pintor.mostrarContornos;
  else if (k === "m" || k === "M") pintor.mostrarMolde = !pintor.mostrarMolde;
  else if (k === "0") pintor.ajustarVista();
  else if (k === "+" || k === "=") pintor.aproximar(1.25);
  else if (k === "-") pintor.aproximar(0.8);
  else return false;
  e.preventDefault();
  mostrar();
  pintor.desenhar();
  return true;
}
