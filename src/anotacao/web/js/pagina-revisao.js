// Página "Revisão cruzada": mostra o rótulo de outra pessoa, sem o nome, e grava a decisão.

import { api, carregarImagem, el, formatarTempo, numero } from "./api.js";
import { Camera } from "./camera.js";
import { Molde } from "./campo.js";
import { Editor } from "./editor.js";
import { TempoAtivo } from "./tempo.js";

const SITUACOES = {
  ok: "Câmera certa",
  sem_marcacoes: "Sem marcações suficientes",
  impossivel_transicao: "Impossível: transição ou grafismo",
  impossivel_borrao: "Impossível: borrão",
  duvida: "Dúvida",
};
const FONTES = {
  modelo: "previsão do modelo",
  quadro_anotado: "quadro já anotado da tomada",
  registro: "câmera do registro",
  rotulo_anterior: "versão anterior",
  rotulo_revisado: "revisão",
  nenhuma: "nada",
};

let editor = null;
let item = null;
let enviando = false;
const tempo = new TempoAtivo({ aoTique: (s) => { el("tempo").textContent = formatarTempo(s); } });

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

function listarPinos() {
  const lista = el("pinos");
  lista.replaceChildren();
  for (const r of editor.residuos()) {
    const li = document.createElement("li");
    const nome = document.createElement("span");
    nome.textContent = r.pino.tipo === "ponto" ? r.pino.nome : `linha ${r.pino.elemento}`;
    const res = document.createElement("span");
    res.className = `res ${r.px <= 2 ? "bom" : r.px <= 5 ? "medio" : "ruim"}`;
    res.textContent = `${numero(r.px, 1)} px`;
    li.append(nome, res);
    lista.append(li);
  }
}

function modo(nome) {
  el("secao-devolver").hidden = nome !== "devolver";
  el("secao-corrigir").hidden = nome !== "corrigir";
  el("decidir").hidden = nome === "corrigir";
  if (editor) {
    editor.somenteLeitura = nome !== "corrigir";
    editor.desenhar();
  }
}

async function carregar() {
  el("erro").textContent = "";
  let r;
  try {
    r = await api.get("/api/fila/revisao");
  } catch (e) {
    mostrarVazio(e.message);
    return;
  }
  el("pendentes").textContent = r.pendentes ? `${r.pendentes} na fila` : "";
  if (!r.item) {
    mostrarVazio("Nenhum rótulo esperando a sua revisão.");
    return;
  }
  item = r.item;
  const rot = item.rotulo;
  const [pac, img] = await Promise.all([api.get(item.pacote_url), carregarImagem(item.imagem_url)]);
  const molde = new Molde(pac.campo);
  const cam = rot.camera
    ? Camera.deRotulo(rot.camera, img.naturalWidth, img.naturalHeight)
    : Camera.olharPara(pac.pacote.cameras[0].T, [0, 0, 0], 40, img.naturalWidth, img.naturalHeight);
  if (editor) editor.destruir();
  editor = new Editor(el("tela"), { imagem: img, molde, placas: pac.pacote.placas, camera: cam, somenteLeitura: true,
    aoMudar: listarPinos, aoPassar: (n) => { el("dica").textContent = n || ""; } });
  window.editor = editor;
  editor.definir(cam, editor.pinosDoRotulo(rot));
  el("r-situacao").textContent = SITUACOES[rot.situacao] || rot.situacao;
  el("r-residuo").textContent = rot.residuo_mediano_px === null ? "—" : `${numero(rot.residuo_mediano_px, 2)} px`;
  el("r-partiu").textContent = FONTES[rot.partiu_de] || rot.partiu_de;
  el("r-comentario").textContent = rot.comentario || "—";
  el("comentario-dev").value = "";
  el("comentario-corr").value = "";
  el("situacao-corr").value = rot.situacao === "duvida" ? "ok" : rot.situacao;
  el("painel").hidden = false;
  el("vazio").hidden = true;
  modo("ver");
  tempo.zerar();
}

async function enviar(corpo) {
  if (enviando) return;
  enviando = true;
  el("erro").textContent = "";
  try {
    await api.post("/api/revisoes/camera", { ref: item.ref, segundos_ativos: tempo.segundos(), ...corpo });
    await carregar();
  } catch (e) {
    el("erro").textContent = e.message;
  } finally {
    enviando = false;
  }
}

el("aprovar").onclick = () => enviar({ decisao: "aprovar" });
el("devolver").onclick = () => modo("devolver");
el("corrigir").onclick = () => modo("corrigir");
el("virar").onclick = () => editor && editor.espelhar();
el("desfazer").onclick = () => editor && editor.desfazer();
el("confirmar-devolver").onclick = () => {
  const motivo = el("motivo").value;
  const comentario = el("comentario-dev").value.trim();
  if (motivo === "outro" && !comentario) {
    el("erro").textContent = "O motivo “outro” precisa de comentário.";
    return;
  }
  enviar({ decisao: "devolver", motivo, comentario });
};
el("salvar-correcao").onclick = () => {
  const sit = el("situacao-corr").value;
  const est = editor.estado();
  const comCamera = sit === "ok";
  enviar({
    decisao: "corrigir",
    comentario: el("comentario-corr").value.trim(),
    correcao: {
      partiu_de: { fonte: "rotulo_revisado" },
      camera: comCamera ? est.camera : null,
      pontos_travados: comCamera ? est.pontos_travados : [],
      linhas_travadas: comCamera ? est.linhas_travadas : [],
      situacao: sit,
      comentario: el("comentario-corr").value.trim(),
      segundos_ativos: tempo.segundos(),
    },
  });
};

window.addEventListener("keydown", (e) => {
  if (!editor || e.target.matches("textarea, input, select") || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (!el("secao-corrigir").hidden) {
    if (k === "f") editor.espelhar();
    return;
  }
  if (k === "a") enviar({ decisao: "aprovar" });
  else if (k === "c") modo("corrigir");
  else if (k === "d") modo("devolver");
  else if (k === "0") editor.ajustarVista();
});

carregar().catch((e) => mostrarVazio(e.message));
