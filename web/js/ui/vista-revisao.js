// Vista "Revisão cruzada": mostra o rótulo de outra pessoa, sem o nome, e grava a decisão.

import { Camera } from "../nucleo/camera.js";
import { Molde } from "../nucleo/campo.js";
import { pendentesRevisao } from "../nucleo/filas.js";
import { cameraPadrao } from "../nucleo/pacote.js";
import { salvarRevisao } from "../nucleo/rotulos.js";
import { Editor } from "./editor.js";
import { TempoAtivo } from "./tempo.js";
import { el, formatarTempo, imagemDoArquivo, mensagemDeErro, numero } from "./util.js";

export const CLASSE = "pagina-editor";

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

export async function montar(raiz, ctx) {
  const $ = (id) => el(id, raiz);
  const { pasta, indice } = ctx;
  let editor = null;
  let atual = null; // {arquivo, rotulo}
  let urlImagem = null;
  let enviando = false;
  const tempo = new TempoAtivo({ aoTique: (s) => { $("tempo").textContent = formatarTempo(s); } });

  function soltarImagem() {
    if (urlImagem) URL.revokeObjectURL(urlImagem);
    urlImagem = null;
  }

  function mostrarVazio(texto) {
    if (editor) {
      editor.destruir();
      editor = null;
      window.editor = null;
      const c = $("tela");
      c.getContext("2d").clearRect(0, 0, c.width, c.height);
    }
    soltarImagem();
    $("painel").hidden = true;
    $("vazio").hidden = false;
    $("vazio").textContent = texto;
  }

  function listarPinos() {
    const lista = $("pinos");
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
    $("secao-devolver").hidden = nome !== "devolver";
    $("secao-corrigir").hidden = nome !== "corrigir";
    $("decidir").hidden = nome !== "ver";
    if (editor) {
      editor.somenteLeitura = nome !== "corrigir";
      editor.desenhar();
    }
  }

  async function carregar() {
    $("erro").textContent = "";
    const pessoa = ctx.pessoa();
    const membro = (await indice.equipe()).membros.find((m) => m.codigo === pessoa);
    if (!membro) return mostrarVazio("Escolha o seu código na página central.");
    if (!membro.papeis.includes("revisor")) return mostrarVazio("Você não está como revisor na equipe.");
    const pend = await pendentesRevisao(indice, pessoa);
    $("pendentes").textContent = pend.length ? `${pend.length} na fila` : "";
    if (!pend.length) return mostrarVazio("Nenhum rótulo esperando a sua revisão.");
    atual = pend[0];
    const rot = atual.rotulo;
    const man = await indice.manifesto(atual.arquivo.partida);
    const pacote = await indice.pacote(man.pacote);
    const arquivo = await pasta.arquivo(pasta.quadro(atual.arquivo.partida, atual.arquivo.quadro));
    if (!arquivo) return mostrarVazio("A imagem deste quadro ainda não chegou na pasta (o Drive terminou de sincronizar?).");
    soltarImagem();
    const { img, url } = await imagemDoArquivo(arquivo);
    urlImagem = url;
    const cam = rot.camera
      ? Camera.deRotulo(rot.camera, img.naturalWidth, img.naturalHeight)
      : cameraPadrao(pacote, img.naturalWidth, img.naturalHeight);
    if (editor) editor.destruir();
    editor = new Editor($("tela"), {
      imagem: img,
      molde: Molde.doPacote(pacote),
      placas: pacote.placas,
      camera: cam,
      somenteLeitura: true,
      aoMudar: listarPinos,
      aoPassar: (n) => { $("dica").textContent = n || ""; },
    });
    window.editor = editor;
    editor.definir(cam, editor.pinosDoRotulo(rot));
    $("r-situacao").textContent = SITUACOES[rot.situacao] || rot.situacao;
    $("r-residuo").textContent = rot.residuo_mediano_px === null ? "—" : `${numero(rot.residuo_mediano_px, 2)} px`;
    $("r-partiu").textContent = FONTES[rot.partiu_de.fonte] || rot.partiu_de.fonte;
    $("r-comentario").textContent = rot.comentario || "—";
    $("comentario-dev").value = "";
    $("comentario-corr").value = "";
    $("situacao-corr").value = rot.situacao === "duvida" ? "ok" : rot.situacao;
    $("painel").hidden = false;
    $("vazio").hidden = true;
    modo("ver");
    tempo.zerar();
  }

  async function enviar(decisao) {
    if (enviando || !atual) return;
    enviando = true;
    $("erro").textContent = "";
    try {
      await salvarRevisao(indice, ctx.pessoa(), atual.arquivo, { ...decisao, segundos_ativos: tempo.segundos() });
      await carregar();
    } catch (e) {
      $("erro").textContent = mensagemDeErro(e);
    } finally {
      enviando = false;
    }
  }

  $("aprovar").onclick = () => enviar({ decisao: "aprovar" });
  $("devolver").onclick = () => modo("devolver");
  $("corrigir").onclick = () => modo("corrigir");
  for (const b of raiz.querySelectorAll("[data-voltar]")) {
    b.onclick = () => {
      if (editor && atual) editor.definir(atual.rotulo.camera ? Camera.deRotulo(atual.rotulo.camera, editor.w, editor.h) : editor.camInicial, editor.pinosDoRotulo(atual.rotulo));
      modo("ver");
    };
  }
  $("virar").onclick = () => editor && editor.espelhar();
  $("desfazer").onclick = () => editor && editor.desfazer();
  $("confirmar-devolver").onclick = () => {
    const motivo = $("motivo").value;
    const comentario = $("comentario-dev").value.trim();
    if (motivo === "outro" && !comentario) {
      $("erro").textContent = "O motivo “outro” precisa de comentário.";
      return;
    }
    enviar({ decisao: "devolver", motivo, comentario });
  };
  $("salvar-correcao").onclick = () => {
    const sit = $("situacao-corr").value;
    const est = editor.estado();
    const comCamera = sit === "ok";
    const comentario = $("comentario-corr").value.trim();
    enviar({
      decisao: "corrigir",
      comentario,
      correcao: {
        camera: comCamera ? est.camera : null,
        pontos_travados: comCamera ? est.pontos_travados : [],
        linhas_travadas: comCamera ? est.linhas_travadas : [],
        situacao: sit,
        comentario,
        segundos_ativos: tempo.segundos(),
      },
    });
  };

  const teclas = (e) => {
    if (!editor || e.target.matches("textarea, input, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (!$("secao-corrigir").hidden) {
      if (k === "f") editor.espelhar();
      return;
    }
    if (!$("secao-devolver").hidden) return;
    if (k === "a") enviar({ decisao: "aprovar" });
    else if (k === "c") modo("corrigir");
    else if (k === "d") modo("devolver");
    else if (k === "0") editor.ajustarVista();
  };
  window.addEventListener("keydown", teclas);

  await carregar().catch((e) => mostrarVazio(mensagemDeErro(e)));

  return {
    desmontar() {
      window.removeEventListener("keydown", teclas);
      tempo.destruir();
      if (editor) editor.destruir();
      window.editor = null;
      soltarImagem();
    },
  };
}
