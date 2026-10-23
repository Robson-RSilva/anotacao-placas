// Página "Câmera do quadro": pega o próximo item da fila, abre o editor e salva o rótulo.

import { api, carregarImagem, el, formatarTempo, numero } from "./api.js";
import { Camera } from "./camera.js";
import { Molde } from "./campo.js";
import { Editor } from "./editor.js";
import { TempoAtivo } from "./tempo.js";

const MOTIVOS = {
  lado_trocado: "lado trocado",
  molde_fora_da_tolerancia: "molde fora da tolerância",
  ponto_em_marca_coberta: "ponto travado em marca coberta",
  deveria_ser_sem_marcacoes: "deveria ser \"sem marcações suficientes\"",
  outro: "outro",
};

let editor = null;
let item = null;
let pacote = null;
let salvando = false;
const tempo = new TempoAtivo({ aoTique: (s) => { el("tempo").textContent = formatarTempo(s); } });

function situacao() {
  return document.querySelector("input[name=situacao]:checked").value;
}

function alvoInicial(reg) {
  if (reg.tipo === "fundo") return [Math.sign(reg.T[0]) * (pacote.campo.comprimento / 3), 0, 0];
  return [0, 0, 0];
}

function cameraDoRegistro(nome) {
  const reg = pacote.cameras.find((c) => c.nome === nome) || pacote.cameras[0];
  return Camera.olharPara(reg.T, alvoInicial(reg), 40, item.largura, item.altura);
}

function atualizarPainel() {
  const res = editor.residuos();
  const nP = editor.pinos.filter((p) => p.tipo === "ponto").length;
  const nL = editor.pinos.filter((p) => p.tipo === "linha").length;
  el("n-pinos").textContent = editor.pinos.length ? `(${editor.pinos.length})` : "";
  const lista = el("pinos");
  lista.replaceChildren();
  if (!res.length) {
    const li = document.createElement("li");
    li.className = "sutil";
    li.textContent = "Arraste ou clique num ponto do molde para travar.";
    lista.append(li);
  }
  for (const r of res) {
    const li = document.createElement("li");
    const nome = document.createElement("span");
    nome.textContent = r.pino.tipo === "ponto" ? r.pino.nome : `linha ${r.pino.elemento}`;
    const valor = document.createElement("span");
    valor.className = `res ${r.px <= 2 ? "bom" : r.px <= 5 ? "medio" : "ruim"}`;
    valor.textContent = `${numero(r.px, 1)} px`;
    li.append(nome, valor);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "x";
    b.title = "Destravar";
    b.textContent = "×";
    b.onclick = () => {
      editor._guardar();
      editor.pinos = editor.pinos.filter((p) => p !== r.pino);
      editor._assentar();
      editor._mudou();
    };
    li.append(b);
    lista.append(li);
  }
  const okPontos = nP >= 3 || (nP >= 2 && nL >= 1);
  const vals = res.map((r) => r.px).filter(Number.isFinite).sort((a, b) => a - b);
  const mediana = vals.length ? vals[Math.floor((vals.length - 1) / 2)] : null;
  el("ck-pontos").className = okPontos ? "ok" : "";
  el("ck-residuo").className = mediana !== null && mediana <= 2 ? "ok" : "";
  el("ck-residuo").textContent = `molde a até 2 px dos travados${mediana !== null ? ` (agora ${numero(mediana, 1)} px)` : ""}`;
}

function mostrarVazio(texto) {
  if (editor) {
    editor.destruir();
    editor = null;
    window.editor = null;
    const c = el("tela");
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }
  el("painel").hidden = true;
  el("vazio").hidden = false;
  el("vazio").textContent = texto;
}

async function carregar() {
  el("erro").textContent = "";
  let r;
  try {
    r = await api.get("/api/fila/camera");
  } catch (e) {
    mostrarVazio(e.message);
    return;
  }
  if (!r.item) {
    mostrarVazio(r.motivo);
    return;
  }
  item = r.item;
  const [pac, img] = await Promise.all([api.get(item.pacote_url), carregarImagem(item.imagem_url)]);
  pacote = pac.pacote;
  const molde = new Molde(pac.campo);
  const cam = Camera.deRotulo(item.camera_inicial, img.naturalWidth, img.naturalHeight);
  if (editor) editor.destruir();
  editor = new Editor(el("tela"), { imagem: img, molde, placas: pacote.placas, camera: cam,
    aoMudar: atualizarPainel, aoPassar: (nome) => { el("dica").textContent = nome || ""; } });
  window.editor = editor; // ajuda a depurar e a testar
  const sel = el("registro");
  sel.replaceChildren(...pacote.cameras.map((c) => new Option(`${c.nome} (${c.tipo})`, c.nome)));
  // pré-seleciona a câmera do registro mais perto da câmera de partida
  const perto = pacote.cameras.reduce((a, c) => (Math.hypot(...c.T.map((v, i) => v - cam.C[i]))
    < Math.hypot(...a.T.map((v, i) => v - cam.C[i])) ? c : a));
  sel.value = perto.nome;
  el("treino").hidden = !item.treino;
  const dev = el("devolvido");
  dev.hidden = !item.devolvido;
  if (item.devolvido) {
    dev.textContent = `Devolvido na revisão: ${MOTIVOS[item.devolvido.motivo] || item.devolvido.motivo}`
      + (item.devolvido.comentario ? ` — “${item.devolvido.comentario}”` : "");
  }
  document.querySelector("input[name=situacao][value=ok]").checked = true;
  el("comentario").value = "";
  el("ck-lado").checked = false;
  el("painel").hidden = false;
  el("vazio").hidden = true;
  tempo.zerar();
  atualizarPainel();
}

async function salvar() {
  if (!editor || salvando) return;
  const sit = situacao();
  const comentario = el("comentario").value.trim();
  el("erro").textContent = "";
  if (sit === "duvida" && !comentario) {
    el("erro").textContent = "Dúvida precisa de comentário.";
    return;
  }
  const est = editor.estado();
  const comCamera = sit === "ok" || (sit === "duvida" && editor.pinos.length > 0);
  if (sit === "ok") {
    if (!el("ck-lado").checked) {
      el("erro").textContent = "Confira o lado numa placa estática e marque a caixa.";
      return;
    }
    const pendente = ["ck-pontos", "ck-residuo"].filter((id) => el(id).className !== "ok");
    if (pendente.length && !window.confirm("O quadro ainda não cumpre o “pronto quando”. Salvar mesmo assim?")) return;
  }
  salvando = true;
  try {
    const corpo = {
      partiu_de: item.partiu_de,
      camera: comCamera ? est.camera : null,
      pontos_travados: comCamera ? est.pontos_travados : [],
      linhas_travadas: comCamera ? est.linhas_travadas : [],
      situacao: sit,
      comentario,
      segundos_ativos: tempo.segundos(),
    };
    const r = await api.post(`/api/rotulos/camera?ficha_token=${encodeURIComponent(item.ficha)}`, corpo);
    if (r.gabarito) {
      const g = r.gabarito;
      el("modal-titulo").textContent = g.ok ? "Dentro da tolerância" : "Fora da tolerância";
      const sitAn = g.situacao;
      el("modal-texto").textContent = (g.mediana_px === null
        ? "Sem câmera para comparar."
        : `Diferença para a câmera verdadeira: ${numero(g.mediana_px, 1)} px na mediana (p90 ${numero(g.p90_px, 1)} px).`)
        + (sitAn.liberado ? " Você está liberado para os dados reais." : ` ${sitAn.motivo}.`);
      el("modal").hidden = false;
      el("modal-ok").focus();
    } else {
      await carregar();
    }
  } catch (e) {
    el("erro").textContent = e.message;
  } finally {
    salvando = false;
  }
}

el("salvar").onclick = salvar;
el("virar").onclick = () => editor && editor.espelhar();
el("desfazer").onclick = () => editor && editor.desfazer();
el("recomecar").onclick = () => editor && editor.recomecar(cameraDoRegistro(el("registro").value));
el("modal-ok").onclick = async () => {
  el("modal").hidden = true;
  await carregar();
};

window.addEventListener("keydown", (e) => {
  if (!editor || e.target.matches("textarea, input[type=text], select")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    editor.desfazer();
  } else if (e.ctrlKey || e.metaKey || e.altKey) {
    return;
  } else if (e.key === "f" || e.key === "F") {
    editor.espelhar();
  } else if (e.key === "s" || e.key === "S") {
    e.preventDefault();
    salvar();
  } else if (e.key === "0") {
    editor.ajustarVista();
  } else if (e.key === "l" || e.key === "L") {
    editor.mostrarNomes = !editor.mostrarNomes;
    editor.desenhar();
  } else if (e.key === "p" || e.key === "P") {
    editor.mostrarPlacas = !editor.mostrarPlacas;
    editor.desenhar();
  } else if (e.key === "+" || e.key === "=") {
    editor.aproximar(1.25);
  } else if (e.key === "-") {
    editor.aproximar(0.8);
  }
});

carregar().catch((e) => mostrarVazio(e.message));
