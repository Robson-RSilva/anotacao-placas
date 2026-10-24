// Vista "Câmera do quadro": pega o próximo item da fila, abre o editor e grava o rótulo.

import { Camera } from "../nucleo/camera.js";
import { Molde } from "../nucleo/campo.js";
import { proximoCamera, situacaoAnotador } from "../nucleo/filas.js";
import { LIMITE_LIBERACAO_PX, compararComGabarito } from "../nucleo/gabarito.js";
import { alvoDoRegistro } from "../nucleo/pacote.js";
import { salvarRotulo } from "../nucleo/rotulos.js";
import { Editor } from "./editor.js";
import { ligarMedidas } from "./medidas.js";
import { TempoAtivo } from "./tempo.js";
import { vigiar } from "./vigia.js";
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

  const mostrarMedidas = ligarMedidas($, () => editor);

  function atualizarPainel() {
    mostrarMedidas();
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
    // o que está na tela não pode ser salvo para o próximo quadro, nem se ele falhar ao abrir
    item = null;
    const pessoa = ctx.pessoa();
    if (!pessoa) return mostrarVazio("Digite o seu código na página central.");
    const proximo = await proximoCamera(indice, pessoa);
    if (!proximo) {
      const sit = await situacaoAnotador(indice, pessoa);
      return mostrarVazio(sit.liberado ? "Nada na sua fila agora." : "O gabarito acabou antes da liberação: fale com quem coordena.");
    }
    const pacoteDoItem = await indice.pacote(proximo.pacote);
    const arquivo = await pasta.arquivo(pasta.quadro(proximo.partida, proximo.quadro));
    if (!arquivo) return mostrarVazio("A imagem deste quadro ainda não chegou na pasta (o Drive terminou de sincronizar?).");
    const { img, url } = await imagemDoArquivo(arquivo);
    soltarImagem();
    urlImagem = url;
    pacote = pacoteDoItem;
    const cam = Camera.deRotulo(proximo.camera_inicial, img.naturalWidth, img.naturalHeight);
    if (editor) editor.destruir();
    editor = null;
    window.editor = null;
    const campo = proximo.campo ?? pacote.campo;
    editor = new Editor($("tela"), {
      imagem: img,
      molde: Molde.doCampo(campo.comprimento, campo.largura),
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
    $("treino").hidden = !proximo.treino;
    const dev = $("devolvido");
    dev.hidden = !proximo.devolvido;
    if (proximo.devolvido) {
      dev.textContent = `Devolvido na revisão: ${MOTIVOS[proximo.devolvido.motivo] || proximo.devolvido.motivo}`
        + (proximo.devolvido.comentario ? ` — “${proximo.devolvido.comentario}”` : "");
    }
    raiz.querySelector("input[name=situacao][value=ok]").checked = true;
    $("comentario").value = "";
    $("ck-lado").checked = false;
    $("ck-lado-item").hidden = !pacote.placas.length; // sem placas no molde (campo genérico), não há como conferir
    mostrarMedidas();
    $("painel").hidden = false;
    $("vazio").hidden = true;
    tempo.zerar();
    atualizarPainel();
    item = { ...proximo, pessoa }; // só agora: salvar grava para este quadro, em nome de quem o abriu
  }

  const abrirProximo = () => carregar().catch((e) => mostrarVazio(mensagemDeErro(e)));

  async function salvar() {
    if (!editor || !item || salvando || !$("modal").hidden) return;
    if (ctx.pessoa() !== item.pessoa) {
      // trocaram a pessoa em outra aba: este quadro era de outra pessoa
      await abrirProximo();
      $("erro").textContent = "A pessoa escolhida mudou em outra aba; este é o quadro dela.";
      return;
    }
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
      if (pacote.placas.length && !$("ck-lado").checked) {
        $("erro").textContent = "Confira o lado numa placa estática e marque a caixa.";
        return;
      }
      const pendente = ["ck-pontos", "ck-residuo"].filter((id) => $(id).className !== "ok");
      if (pendente.length && !window.confirm("O quadro ainda não cumpre o “pronto quando”. Salvar mesmo assim?")) return;
    }
    salvando = true;
    const feito = item;
    try {
      const { rotulo } = await salvarRotulo(indice, feito.pessoa, {
        partida: feito.partida,
        quadro: feito.quadro,
        pacote: feito.pacote,
        largura: editor.w,
        altura: editor.h,
        partiu_de: feito.partiu_de,
        campo: { comprimento: editor.molde.L, largura: editor.molde.W },
        camera: comCamera ? est.camera : null,
        pontos_travados: comCamera ? est.pontos_travados : [],
        linhas_travadas: comCamera ? est.linhas_travadas : [],
        situacao: sit,
        comentario,
        segundos_ativos: tempo.segundos(),
      });
      item = null; // gravado: daqui não se salva de novo este quadro
      ctx.registrarCodigo(feito.pessoa); // o código passa a constar como usado neste computador
      if (feito.treino) {
        const g = (await indice.itensGabarito()).find((x) => x.id === feito.quadro);
        const d = await compararComGabarito(indice, rotulo.camera, g, rotulo.campo);
        const s = await situacaoAnotador(indice, feito.pessoa);
        const ok = d.mediana_px !== null && d.mediana_px <= LIMITE_LIBERACAO_PX;
        $("modal-titulo").textContent = ok ? "Dentro da tolerância" : "Fora da tolerância";
        $("modal-texto").textContent = (d.mediana_px === null
          ? "Sem câmera para comparar."
          : `Diferença para a câmera verdadeira: ${numero(d.mediana_px, 1)} px na mediana (p90 ${numero(d.p90_px, 1)} px).`)
          + (s.liberado ? " Você está liberado para os dados reais." : ` ${s.motivo.charAt(0).toUpperCase()}${s.motivo.slice(1)}.`);
        $("modal").hidden = false;
        $("modal-ok").focus();
      } else {
        await abrirProximo();
      }
    } catch (e) {
      if (item) $("erro").textContent = mensagemDeErro(e); // não gravou: dá para tentar de novo
      else mostrarVazio(`O rótulo foi gravado, mas: ${mensagemDeErro(e)}`);
    } finally {
      salvando = false;
    }
  }

  // a pessoa escolhida mudou em outra aba: o quadro aberto não é mais de quem está aqui
  const aoTrocarPessoa = (e) => {
    if ((e.key === null || e.key === "anotacao.pessoa") && item && ctx.pessoa() !== item.pessoa) abrirProximo();
  };
  window.addEventListener("storage", aoTrocarPessoa);

  $("salvar").onclick = salvar;
  $("virar").onclick = () => editor && editor.espelhar();
  $("desfazer").onclick = () => editor && editor.desfazer();
  $("recomecar").onclick = () => editor && editor.recomecar(cameraDoRegistro($("registro").value));
  $("modal-ok").onclick = async () => {
    $("modal").hidden = true;
    await abrirProximo();
  };

  const teclas = (e) => {
    if (!editor || !$("modal").hidden || e.target.matches("textarea, input[type=text], input[type=number], select")) return;
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

  await abrirProximo();
  // sem nada na fila, a página confere sozinha se chegou algo (um devolvido, uma partida nova)
  const vigia = vigiar(ctx, () => !item && !salvando && !$("vazio").hidden && $("modal").hidden, abrirProximo);

  return {
    desmontar() {
      vigia.parar();
      window.removeEventListener("keydown", teclas);
      window.removeEventListener("storage", aoTrocarPessoa);
      tempo.destruir();
      if (editor) editor.destruir();
      window.editor = null;
      soltarImagem();
    },
  };
}
