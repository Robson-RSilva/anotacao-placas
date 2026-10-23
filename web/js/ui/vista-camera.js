// Vista "Câmera do quadro": pega o próximo item da fila, abre o editor e grava o rótulo.

import { Camera } from "../nucleo/camera.js";
import { Molde } from "../nucleo/campo.js";
import { proximoCamera, situacaoAnotador } from "../nucleo/filas.js";
import { LIMITE_LIBERACAO_PX, compararComGabarito } from "../nucleo/gabarito.js";
import { alvoDoRegistro } from "../nucleo/pacote.js";
import { salvarRotulo } from "../nucleo/rotulos.js";
import { Editor } from "./editor.js";
import { TempoAtivo } from "./tempo.js";
import { el, formatarTempo, imagemDoArquivo, mensagemDeErro, numero } from "./util.js";

export const CLASSE = "pagina-editor";

const MOTIVOS = {
  lado_trocado: "lado trocado",
  molde_fora_da_tolerancia: "molde fora da tolerância",
  ponto_em_marca_coberta: "ponto travado em marca coberta",
  deveria_ser_sem_marcacoes: "deveria ser \"sem marcações suficientes\"",
  outro: "outro",
};

export async function montar(raiz, ctx) {
  const $ = (id) => el(id, raiz);
  const { pasta, indice } = ctx;
  let editor = null;
  let item = null;
  let pacote = null;
  let urlImagem = null;
  let salvando = false;
  const tempo = new TempoAtivo({ aoTique: (s) => { $("tempo").textContent = formatarTempo(s); } });

  const situacao = () => raiz.querySelector("input[name=situacao]:checked").value;

  function cameraDoRegistro(nome) {
    const reg = pacote.cameras.find((c) => c.nome === nome) || pacote.cameras[0];
    return Camera.olharPara(reg.T, alvoDoRegistro(pacote, reg), 40, editor.w, editor.h);
  }

  function atualizarPainel() {
    const res = editor.residuos();
    const nP = editor.pinos.filter((p) => p.tipo === "ponto").length;
    const nL = editor.pinos.filter((p) => p.tipo === "linha").length;
    $("n-pinos").textContent = editor.pinos.length ? `(${editor.pinos.length})` : "";
    const lista = $("pinos");
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
      li.append(nome, valor, b);
      lista.append(li);
    }
    const okPontos = nP >= 3 || (nP >= 2 && nL >= 1);
    const vals = res.map((r) => r.px).filter(Number.isFinite).sort((a, b) => a - b);
    const mediana = vals.length ? vals[Math.floor((vals.length - 1) / 2)] : null;
    $("ck-pontos").className = okPontos ? "ok" : "";
    $("ck-residuo").className = mediana !== null && mediana <= 2 ? "ok" : "";
    $("ck-residuo").textContent = `molde a até 2 px dos travados${mediana !== null ? ` (agora ${numero(mediana, 1)} px)` : ""}`;
  }

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

  async function carregar() {
    $("erro").textContent = "";
    const pessoa = ctx.pessoa();
    const membro = (await indice.equipe()).membros.find((m) => m.codigo === pessoa);
    if (!membro) return mostrarVazio("Escolha o seu código na página central.");
    if (!membro.papeis.includes("anotador")) return mostrarVazio("Você não está como anotador na equipe.");
    item = await proximoCamera(indice, pessoa);
    if (!item) {
      const sit = await situacaoAnotador(indice, pessoa);
      return mostrarVazio(sit.liberado ? "Nada na sua fila agora." : "O gabarito acabou antes da liberação: fale com quem coordena.");
    }
    pacote = await indice.pacote(item.pacote);
    const arquivo = await pasta.arquivo(pasta.quadro(item.partida, item.quadro));
    if (!arquivo) return mostrarVazio("A imagem deste quadro ainda não chegou na pasta (o Drive terminou de sincronizar?).");
    soltarImagem();
    const { img, url } = await imagemDoArquivo(arquivo);
    urlImagem = url;
    const cam = Camera.deRotulo(item.camera_inicial, img.naturalWidth, img.naturalHeight);
    if (editor) editor.destruir();
    editor = new Editor($("tela"), {
      imagem: img,
      molde: Molde.doPacote(pacote),
      placas: pacote.placas,
      camera: cam,
      aoMudar: atualizarPainel,
      aoPassar: (nome) => { $("dica").textContent = nome || ""; },
    });
    window.editor = editor; // ajuda a depurar e a testar
    const sel = $("registro");
    sel.replaceChildren(...pacote.cameras.map((c) => new Option(`${c.nome} (${c.tipo})`, c.nome)));
    const perto = pacote.cameras.reduce((a, c) => (Math.hypot(...c.T.map((v, i) => v - cam.C[i])) < Math.hypot(...a.T.map((v, i) => v - cam.C[i])) ? c : a));
    sel.value = perto.nome;
    $("treino").hidden = !item.treino;
    const dev = $("devolvido");
    dev.hidden = !item.devolvido;
    if (item.devolvido) {
      dev.textContent = `Devolvido na revisão: ${MOTIVOS[item.devolvido.motivo] || item.devolvido.motivo}`
        + (item.devolvido.comentario ? ` — “${item.devolvido.comentario}”` : "");
    }
    raiz.querySelector("input[name=situacao][value=ok]").checked = true;
    $("comentario").value = "";
    $("ck-lado").checked = false;
    $("painel").hidden = false;
    $("vazio").hidden = true;
    tempo.zerar();
    atualizarPainel();
  }

  async function salvar() {
    if (!editor || salvando) return;
    const sit = situacao();
    const comentario = $("comentario").value.trim();
    $("erro").textContent = "";
    if (sit === "duvida" && !comentario) {
      $("erro").textContent = "Dúvida precisa de comentário.";
      return;
    }
    const est = editor.estado();
    const comCamera = sit === "ok" || (sit === "duvida" && editor.pinos.length > 0);
    if (sit === "ok") {
      if (!$("ck-lado").checked) {
        $("erro").textContent = "Confira o lado numa placa estática e marque a caixa.";
        return;
      }
      const pendente = ["ck-pontos", "ck-residuo"].filter((id) => $(id).className !== "ok");
      if (pendente.length && !window.confirm("O quadro ainda não cumpre o “pronto quando”. Salvar mesmo assim?")) return;
    }
    salvando = true;
    try {
      const pessoa = ctx.pessoa();
      const { rotulo } = await salvarRotulo(indice, pessoa, {
        partida: item.partida,
        quadro: item.quadro,
        pacote: item.pacote,
        largura: editor.w,
        altura: editor.h,
        partiu_de: item.partiu_de,
        camera: comCamera ? est.camera : null,
        pontos_travados: comCamera ? est.pontos_travados : [],
        linhas_travadas: comCamera ? est.linhas_travadas : [],
        situacao: sit,
        comentario,
        segundos_ativos: tempo.segundos(),
      });
      if (item.treino) {
        const g = (await indice.itensGabarito()).find((x) => x.id === item.quadro);
        const d = await compararComGabarito(indice, rotulo.camera, g);
        const s = await situacaoAnotador(indice, pessoa);
        const ok = d.mediana_px !== null && d.mediana_px <= LIMITE_LIBERACAO_PX;
        $("modal-titulo").textContent = ok ? "Dentro da tolerância" : "Fora da tolerância";
        $("modal-texto").textContent = (d.mediana_px === null
          ? "Sem câmera para comparar."
          : `Diferença para a câmera verdadeira: ${numero(d.mediana_px, 1)} px na mediana (p90 ${numero(d.p90_px, 1)} px).`)
          + (s.liberado ? " Você está liberado para os dados reais." : ` ${s.motivo.charAt(0).toUpperCase()}${s.motivo.slice(1)}.`);
        $("modal").hidden = false;
        $("modal-ok").focus();
      } else {
        await carregar();
      }
    } catch (e) {
      $("erro").textContent = mensagemDeErro(e);
    } finally {
      salvando = false;
    }
  }

  $("salvar").onclick = salvar;
  $("virar").onclick = () => editor && editor.espelhar();
  $("desfazer").onclick = () => editor && editor.desfazer();
  $("recomecar").onclick = () => editor && editor.recomecar(cameraDoRegistro($("registro").value));
  $("modal-ok").onclick = async () => {
    $("modal").hidden = true;
    await carregar().catch((e) => mostrarVazio(mensagemDeErro(e)));
  };

  const teclas = (e) => {
    if (!editor || !$("modal").hidden || e.target.matches("textarea, input[type=text], select")) return;
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
