// Vistas "Revisão às cegas" (pontos e placas): o próximo rótulo de outra pessoa, sem dizer de quem
// é. Quem revisa aprova, corrige (a correção vira uma versão nova, com a autoria de quem revisou) ou
// devolve com um motivo (o rótulo volta para quem anotou).

import { descricaoPonto } from "../nucleo/campo.js";
import { pendentesRevisao } from "../nucleo/filas.js";
import { MOTIVOS } from "../nucleo/formatos.js";
import { ForaDaFila, salvarRevisao } from "../nucleo/rotulos.js";
import { Mapa } from "./mapa.js";
import { Marcador } from "./marcador.js";
import { Pintor } from "./pintor.js";
import { abrirImagem, caixas, escrevendo, textoSituacao } from "./tarefa.js";
import { TempoAtivo } from "./tempo.js";
import { el, formatarTempo, local, mensagemDeErro, numero } from "./util.js";
import { vigiar } from "./vigia.js";
import { ligarFerramentas } from "./vista-placas.js";

const PARTIU = { nenhuma: "do zero", modelo: "de um modelo", rotulo_anterior: "da versão anterior (devolvida)", rotulo_revisado: "de uma revisão" };

async function montarRevisao(raiz, ctx, tarefa) {
  const $ = (id) => el(id, raiz);
  const { pasta, indice } = ctx;
  const pontos = tarefa === "pontos";
  const cx = caixas(raiz, tarefa);
  let tela = null; // o Marcador (pontos) ou o Pintor (placas)
  let atual = null; // {arquivo, rotulo, mascara, regiao, pessoa}
  let urlImagem = null;
  let enviando = false;
  let vivo = true;
  const tempo = new TempoAtivo({ aoTique: (s) => { $("tempo").textContent = formatarTempo(s); } });
  $("motivo").replaceChildren(...Object.entries(MOTIVOS[tarefa]).map(([v, t]) => new Option(t, v)));

  const corrigindo = () => !$("secao-corrigir").hidden;
  const ferramentas = pontos ? null : ligarFerramentas(raiz, $, () => tela);
  const mapa = pontos
    ? new Mapa($("mapa"), {
      giro: Number(local.ler("giro-mapa", "0")) || 0,
      aoEscolher: (nome) => {
        if (tela && corrigindo()) tela.escolher(nome);
      },
      aoPassar: (nome) => {
        if (!tela) return;
        tela.destaque = nome;
        tela.desenhar();
        $("dica").textContent = nome ? descricaoPonto(nome) : "";
        mapa.atualizar({ destaque: nome });
      },
    })
    : null;

  function atualizarPontos() {
    if (!tela || !pontos) return;
    const lista = tela.lista();
    $("r-pontos").textContent = atual ? `${atual.rotulo.pontos.length} marcado(s)${corrigindo() ? ` · na correção: ${lista.length}` : ""}` : "";
    mapa.atualizar({ estados: new Map(lista.map((p) => [p.ponto, "marcado"])), selecionado: tela.selecionado });
    const e = $("escolha");
    if (!corrigindo()) e.textContent = "Passe o mouse num ponto (na imagem ou no mapa) para ver o nome.";
    else if (tela.pendente) e.textContent = "Qual ponto é este? Clique nele no mapa. (Esc cancela)";
    else if (tela.selecionado) e.textContent = `${descricaoPonto(tela.selecionado)} — clique na imagem onde ele está.`;
    else e.textContent = "Escolha um ponto no mapa e clique no lugar dele na imagem.";
    const ul = $("lista-pontos");
    ul.replaceChildren();
    for (const p of lista) {
      const li = document.createElement("li");
      const nome = Object.assign(document.createElement("button"), { type: "button", className: "nome-ponto", textContent: p.ponto, title: descricaoPonto(p.ponto) });
      nome.onclick = () => tela.escolher(p.ponto);
      const tirar = Object.assign(document.createElement("button"), { type: "button", className: "x", textContent: "×", title: "Apagar o ponto" });
      tirar.onclick = () => tela.apagar(p.ponto);
      li.append(nome, tirar);
      ul.append(li);
    }
  }

  function soltarImagem() {
    if (urlImagem) URL.revokeObjectURL(urlImagem);
    urlImagem = null;
  }

  function largarTela() {
    if (!tela) return;
    tela.destruir();
    tela = null;
    window.revisando = null;
    const c = $("tela");
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }

  function mostrarVazio(texto) {
    largarTela();
    soltarImagem();
    $("painel").hidden = true;
    $("vazio").hidden = false;
    $("vazio").textContent = texto;
  }

  function modo(qual) {
    $("decidir").hidden = qual !== "ver";
    $("secao-devolver").hidden = qual !== "devolver";
    $("secao-corrigir").hidden = qual !== "corrigir";
    if (tela) {
      tela.somenteLeitura = qual !== "corrigir";
      if (qual !== "corrigir") {
        // voltou: a correção começada some
        if (pontos) tela.definir(atual?.rotulo.pontos ?? []);
        else tela.definir(atual?.mascara ?? null);
      }
      tela.desenhar();
    }
    if (qual === "corrigir") $("comentario-corr").value = "";
    if (pontos) atualizarPontos();
    else ferramentas.mostrar();
  }

  async function carregar() {
    $("erro").textContent = "";
    atual = null;
    window.itemRevisao = null;
    if (tela) tela.somenteLeitura = true;
    const pessoa = ctx.pessoa();
    if (!pessoa) return mostrarVazio("Digite o seu código na página central.");
    const pend = await pendentesRevisao(indice, tarefa, pessoa);
    if (!vivo) return;
    $("pendentes").textContent = pend.length ? `${pend.length} esperando revisão` : "";
    if (!pend.length) {
      return mostrarVazio(pontos ? "Nenhum rótulo de pontos de outra pessoa esperando revisão." : "Nenhuma pintura de placa de outra pessoa esperando revisão.");
    }
    const { arquivo, rotulo, item: daFila } = pend[0];
    const regiao = pontos ? null : daFila?.regiao ?? null;
    const item = { tarefa, partida: arquivo.partida, quadro: arquivo.quadro, largura: rotulo.largura, altura: rotulo.altura };
    const { img, url } = await abrirImagem(pasta, item);
    let mascara = null;
    if (!pontos && rotulo.mascara) mascara = (await indice.mascara(`${pasta.rotulos(arquivo.partida, tarefa)}/${rotulo.mascara}`)).dados;
    if (!vivo) {
      URL.revokeObjectURL(url);
      return;
    }
    largarTela();
    soltarImagem();
    urlImagem = url;
    if (pontos) {
      tela = new Marcador($("tela"), {
        imagem: img,
        pontos: rotulo.pontos,
        somenteLeitura: true,
        aoMudar: atualizarPontos,
        aoPassar: (nome) => {
          $("dica").textContent = nome ? descricaoPonto(nome) : "";
          mapa.atualizar({ destaque: nome });
        },
        aoPendente: atualizarPontos,
      });
    } else {
      tela = new Pintor($("tela"), { imagem: img, mascara, regiao, somenteLeitura: true, aoMudar: ferramentas.mostrar });
      $("r-pixels").textContent = rotulo.mascara ? (rotulo.pixels ? `${numero(rotulo.pixels, 0)} pixels` : "nada (nada na frente da placa)") : "—";
    }
    window.revisando = tela; // ajuda a depurar e a testar
    $("r-situacao").textContent = textoSituacao(rotulo, tarefa);
    $("r-partiu").textContent = PARTIU[rotulo.partiu_de.fonte] || rotulo.partiu_de.fonte;
    $("r-comentario").textContent = rotulo.comentario || "—";
    $("comentario-dev").value = "";
    $("painel").hidden = false;
    $("vazio").hidden = true;
    atual = { arquivo, rotulo, mascara, regiao, pessoa };
    window.itemRevisao = { partida: arquivo.partida, quadro: arquivo.quadro, rotulo: arquivo.nome };
    modo("ver");
    tempo.zerar();
  }

  const abrirProximo = () => carregar().catch((e) => mostrarVazio(mensagemDeErro(e)));

  async function enviar(decisao) {
    if (!atual || enviando || cx.aberta()) return;
    if (ctx.pessoa() !== atual.pessoa) {
      await abrirProximo();
      $("erro").textContent = "A pessoa escolhida mudou em outra aba.";
      return;
    }
    enviando = true;
    $("erro").textContent = "";
    try {
      await salvarRevisao(indice, tarefa, atual.pessoa, atual.arquivo, { ...decisao, segundos_ativos: tempo.segundos() });
      ctx.registrarCodigo(atual.pessoa);
      await abrirProximo();
    } catch (e) {
      if (e instanceof ForaDaFila) {
        await abrirProximo();
        $("erro").textContent = "Esse rótulo já foi revisado por outra pessoa; abri o próximo.";
      } else {
        $("erro").textContent = mensagemDeErro(e);
      }
    } finally {
      enviando = false;
    }
  }

  async function salvarCorrecao() {
    if (!atual || !tela || enviando || cx.aberta()) return;
    const comentario = $("comentario-corr").value.trim();
    if (pontos) {
      if (tela.pendente) {
        $("erro").textContent = "Falta dizer qual é o ponto marcado com “?”: clique nele no mapa (ou Esc para cancelar).";
        return;
      }
      const lista = tela.lista();
      if (!lista.length && !(await cx.confirmar("Salvar a correção sem nenhum ponto?", "Só quando nenhum ponto do campo aparece na imagem."))) return;
      await enviar({ decisao: "corrigir", correcao: { pontos: lista, situacao: "ok", motivo_descarte: null, comentario, segundos_ativos: tempo.segundos() } });
      return;
    }
    if (tela.laco) {
      $("erro").textContent = "Feche o laço (no primeiro ponto, com dois cliques ou Enter) ou cancele com Esc.";
      return;
    }
    if (!tela.pixels() && !(await cx.confirmar("Salvar a correção sem nada pintado?", "Só quando nada cobre a placa."))) return;
    await enviar({ decisao: "corrigir", correcao: { mascara: tela.mascara(), regiao: atual.regiao, situacao: "ok", motivo_descarte: null, comentario, segundos_ativos: tempo.segundos() } });
  }

  async function corrigirComDescarte() {
    if (!atual || enviando || cx.aberta()) return;
    const d = await cx.pedirDescarte();
    if (!d) return;
    const correcao = { situacao: "descartada", motivo_descarte: d.motivo, comentario: d.comentario, segundos_ativos: tempo.segundos() };
    await enviar({ decisao: "corrigir", correcao: pontos ? { ...correcao, pontos: [] } : { ...correcao, mascara: null } });
  }

  const aoTrocarPessoa = (e) => {
    if ((e.key === null || e.key === "anotacao.pessoa") && atual && ctx.pessoa() !== atual.pessoa) abrirProximo();
  };
  window.addEventListener("storage", aoTrocarPessoa);

  $("aprovar").onclick = () => enviar({ decisao: "aprovar" });
  $("corrigir").onclick = () => modo("corrigir");
  $("devolver").onclick = () => modo("devolver");
  for (const b of raiz.querySelectorAll("[data-voltar]")) b.onclick = () => modo("ver");
  $("confirmar-devolver").onclick = () => {
    const motivo = $("motivo").value;
    const comentario = $("comentario-dev").value.trim();
    if (motivo === "outro" && !comentario) {
      $("erro").textContent = "“Outro” precisa de comentário.";
      return;
    }
    enviar({ decisao: "devolver", motivo, comentario });
  };
  $("salvar-correcao").onclick = salvarCorrecao;
  $("descartar").onclick = corrigirComDescarte;
  if (pontos) {
    $("desfazer").onclick = () => tela?.desfazer();
    $("girar").onclick = () => {
      mapa.girar();
      local.gravar("giro-mapa", mapa.giro);
    };
  }

  const teclas = (e) => {
    if (!tela || cx.aberta() || escrevendo(e)) return;
    const editar = corrigindo();
    if (!pontos && ferramentas.tecla(e, { editar })) return;
    if (pontos && e.key === " ") {
      e.preventDefault();
      tela.espaco = e.type === "keydown";
      return;
    }
    if (e.type !== "keydown") return;
    const k = e.key.toLowerCase();
    if (pontos) {
      if (editar && (e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) tela.refazer();
        else tela.desfazer();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === "r") return $("girar").click();
      if (k === "0") return tela.ajustarVista();
      if (k === "+" || k === "=") return tela.aproximar(1.25);
      if (k === "-") return tela.aproximar(0.8);
      if (k === "h") {
        tela.mostrarPontos = !tela.mostrarPontos;
        return tela.desenhar();
      }
      if (k === "l") {
        tela.mostrarNomes = !tela.mostrarNomes;
        return tela.desenhar();
      }
      if (editar) {
        if (k === "escape") tela.cancelar();
        else if ((k === "delete" || k === "backspace") && (tela.destaque ?? tela.selecionado)) {
          e.preventDefault();
          tela.apagar(tela.destaque ?? tela.selecionado);
        }
        return;
      }
    } else if (e.ctrlKey || e.metaKey || e.altKey || editar) {
      return;
    }
    // vendo: as decisões
    if (!$("secao-devolver").hidden) return;
    if (k === "a") enviar({ decisao: "aprovar" });
    else if (k === "c") modo("corrigir");
    else if (k === "d") modo("devolver");
  };
  window.addEventListener("keydown", teclas);
  window.addEventListener("keyup", teclas);

  await abrirProximo();
  // sem nada para revisar, a página confere sozinha se chegou algo (de outro computador, pelo Drive)
  const vigia = vigiar(ctx, () => !atual && !enviando && !$("vazio").hidden, abrirProximo);

  return {
    desmontar() {
      vivo = false;
      vigia.parar();
      window.removeEventListener("keydown", teclas);
      window.removeEventListener("keyup", teclas);
      window.removeEventListener("storage", aoTrocarPessoa);
      tempo.destruir();
      cx.destruir();
      mapa?.destruir();
      largarTela();
      soltarImagem();
    },
  };
}

export const revisaoPontos = { CLASSE: "pagina-editor", montar: (raiz, ctx) => montarRevisao(raiz, ctx, "pontos") };
export const revisaoPlacas = { CLASSE: "pagina-editor", montar: (raiz, ctx) => montarRevisao(raiz, ctx, "placas") };
