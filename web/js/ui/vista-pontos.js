// Vista "Pontos do campo": pega a próxima imagem da fila e marca, direto nela, cada ponto do campo que
// aparece — escolhendo no mapa qual é. No teste do gabarito, mostra o resultado na hora e a resposta.

import { Molde, descricaoPonto } from "../nucleo/campo.js";
import { PARTIDA_GABARITO } from "../nucleo/convencoes.js";
import { proximo, situacao } from "../nucleo/filas.js";
import { compararPontos, motivoPontos } from "../nucleo/gabarito.js";
import { salvarRotulo } from "../nucleo/rotulos.js";
import { Mapa } from "./mapa.js";
import { Marcador } from "./marcador.js";
import { abrirImagem, caixas, escrevendo, parametros, textoDevolvido, textoLiberacao, textoPartiu } from "./tarefa.js";
import { TempoAtivo } from "./tempo.js";
import { el, formatarTempo, local, mensagemDeErro, numero } from "./util.js";
import { vigiar } from "./vigia.js";

export const CLASSE = "pagina-editor";

const CAMPO = Molde.doCampo();

/** O que o marcador e o mapa mostram do resultado de um item: os pontos, a resposta e o que faltou. */
export function resultadoNaTela(r, item) {
  const nomeDaPessoa = (nome) => (r.girado ? CAMPO.espelharPonto(nome) : nome);
  const faltou = new Set(r.faltaram);
  const verdadeiros = item.pontos.filter((p) => p.visivel || r.pontos.some((m) => m.como === p.ponto)).map((p) => ({ ...p, ponto: nomeDaPessoa(p.ponto), faltou: faltou.has(nomeDaPessoa(p.ponto)) }));
  const estados = new Map(r.pontos.map((p) => [p.ponto, p.estado]));
  for (const nome of faltou) estados.set(nome, "faltou");
  return { pontos: r.pontos, verdadeiros, estados };
}

export async function montar(raiz, ctx) {
  const $ = (id) => el(id, raiz);
  const { pasta, indice } = ctx;
  const params = parametros();
  const pedirTreino = params.has("treino");
  const ver = params.get("ver");
  const cx = caixas(raiz);
  let marcador = null;
  let item = null;
  let urlImagem = null;
  let salvando = false;
  let resultado = null; // depois de um item do teste: {minha, resposta, vendo, tela}
  let vivo = true;
  const tempo = new TempoAtivo({ aoTique: (s) => { $("tempo").textContent = formatarTempo(s); } });

  const mapa = new Mapa($("mapa"), {
    giro: Number(local.ler("giro-mapa", "0")) || 0,
    aoEscolher: (nome) => {
      if (!marcador || resultado || marcador.somenteLeitura) return;
      $("erro").textContent = "";
      marcador.escolher(nome);
    },
    aoPassar: (nome) => {
      if (!marcador) return;
      marcador.destaque = nome;
      marcador.desenhar();
      $("dica").textContent = nome ? descricaoPonto(nome) : "";
      mapa.atualizar({ destaque: nome });
    },
  });

  function escreverEscolha() {
    const e = $("escolha");
    if (!marcador || resultado) {
      e.textContent = "";
      return;
    }
    if (marcador.pendente) e.textContent = "Qual ponto é este? Clique nele no mapa. (Esc cancela)";
    else if (marcador.selecionado) {
      const ja = marcador.pontos.has(marcador.selecionado);
      e.textContent = `${descricaoPonto(marcador.selecionado)} — clique na imagem onde ele está${ja ? " (já marcado: o clique muda de lugar)" : ""}.`;
    } else e.textContent = "Escolha um ponto no mapa e clique no lugar dele na imagem (ou o contrário).";
    e.classList.toggle("pedindo", Boolean(marcador.pendente || marcador.selecionado));
  }

  function atualizarPainel() {
    if (!marcador) return;
    const lista = marcador.lista();
    $("n-pontos").textContent = `(${lista.length})`;
    const ul = $("lista-pontos");
    ul.replaceChildren();
    if (!lista.length) ul.append(Object.assign(document.createElement("li"), { className: "sutil", textContent: "Nenhum ponto marcado ainda." }));
    for (const p of lista) {
      const li = document.createElement("li");
      const nome = Object.assign(document.createElement("button"), { type: "button", className: "nome-ponto", textContent: p.ponto, title: descricaoPonto(p.ponto) });
      nome.onclick = () => {
        if (!resultado) marcador.escolher(p.ponto);
      };
      const tirar = Object.assign(document.createElement("button"), { type: "button", className: "x", textContent: "×", title: "Apagar o ponto" });
      tirar.onclick = () => marcador.apagar(p.ponto);
      tirar.hidden = Boolean(resultado);
      li.append(nome, tirar);
      ul.append(li);
    }
    if (!resultado) mapa.atualizar({ estados: new Map(lista.map((p) => [p.ponto, "marcado"])), selecionado: marcador.selecionado });
    escreverEscolha();
  }

  function soltarImagem() {
    if (urlImagem) URL.revokeObjectURL(urlImagem);
    urlImagem = null;
  }

  function largarMarcador() {
    if (!marcador) return;
    marcador.destruir();
    marcador = null;
    window.marcador = null;
    const c = $("tela");
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }

  function mostrarVazio(texto, link = null) {
    largarMarcador();
    soltarImagem();
    $("painel").hidden = true;
    $("vazio").hidden = false;
    $("vazio").replaceChildren(texto);
    if (link) $("vazio").append(" ", Object.assign(document.createElement("a"), { href: link[0], textContent: link[1] }));
  }

  function modoResultado(ligado) {
    $("resultado").hidden = !ligado;
    $("edicao").hidden = ligado;
    if (marcador) marcador.somenteLeitura = ligado;
  }

  async function abrirNaTela(proximoItem, pontosIniciais) {
    const { img, url } = await abrirImagem(pasta, proximoItem);
    if (!vivo) {
      URL.revokeObjectURL(url);
      return false;
    }
    largarMarcador();
    soltarImagem();
    urlImagem = url;
    marcador = new Marcador($("tela"), {
      imagem: img,
      pontos: pontosIniciais ?? [],
      aoMudar: atualizarPainel,
      aoPassar: (nome) => {
        $("dica").textContent = nome ? descricaoPonto(nome) : "";
        mapa.atualizar({ destaque: nome });
      },
      aoPendente: escreverEscolha,
    });
    marcador.mostrarNomes = $("ver-nomes").checked;
    window.marcador = marcador; // ajuda a depurar e a testar
    $("painel").hidden = false;
    $("vazio").hidden = true;
    return true;
  }

  async function carregar() {
    $("erro").textContent = "";
    // o que está na tela não pode ser salvo para a próxima imagem, nem se ela falhar ao abrir
    item = null;
    resultado = null;
    window.itemPontos = null;
    if (marcador) marcador.somenteLeitura = true;
    $("resultado").hidden = true;
    const pessoa = ctx.pessoa();
    if (!pessoa) return mostrarVazio("Digite o seu código na página central.");
    if (ver) return verResultado(pessoa);
    const prox = await proximo(indice, "pontos", pessoa, { treino: pedirTreino });
    if (!vivo) return; // a pessoa já saiu da página
    if (!prox) {
      const sit = await situacao(indice, "pontos", pessoa);
      if (pedirTreino) return mostrarVazio("Você já fez todos os itens do gabarito dos pontos.", ["#/gabarito", "Ver os resultados"]);
      if (!sit.liberado) return mostrarVazio("O gabarito dos pontos acabou antes da liberação: fale com quem coordena.", ["#/gabarito", "Ver os resultados"]);
      return mostrarVazio("Nada para marcar agora. Uma imagem aparece aqui quando uma partida é importada (ou quando um rótulo seu volta da revisão).");
    }
    if (!(await abrirNaTela(prox, prox.inicio))) return;
    $("treino").hidden = !prox.treino;
    $("devolvido").hidden = !prox.devolvido;
    if (prox.devolvido) $("devolvido").textContent = textoDevolvido("pontos", prox.devolvido);
    $("partiu").textContent = textoPartiu("pontos", prox.partiu_de);
    $("partiu").hidden = !$("partiu").textContent;
    modoResultado(false);
    tempo.zerar();
    atualizarPainel();
    item = { ...prox, pessoa }; // só agora: salvar grava para esta imagem, em nome de quem a abriu
    window.itemPontos = { partida: prox.partida, quadro: prox.quadro, treino: prox.treino };
  }

  const abrirProximo = () => carregar().catch((e) => mostrarVazio(mensagemDeErro(e)));

  async function verResultado(pessoa) {
    const g = (await indice.itensGabarito("pontos")).find((x) => x.id === ver);
    const ip = await indice.partida(PARTIDA_GABARITO, "pontos");
    const a = ip.ultimos().get(`${ver}|${pessoa}`);
    if (!g || !a) return mostrarVazio("Você ainda não fez este item do gabarito.", ["#/gabarito", "Voltar ao gabarito"]);
    const visto = { partida: PARTIDA_GABARITO, quadro: g.id, largura: g.largura, altura: g.altura };
    if (!(await abrirNaTela(visto, a.dados.pontos))) return;
    $("treino").hidden = true;
    $("devolvido").hidden = true;
    $("partiu").hidden = true;
    await mostrarResultado(pessoa, a.dados, g, { soVer: true });
  }

  async function mostrarResultado(pessoa, rotulo, g, { soVer = false } = {}) {
    const titulo = $("resultado-titulo");
    if (rotulo.situacao === "descartada") {
      titulo.textContent = "Errado: a imagem foi descartada";
      $("resultado-texto").textContent = "Esta imagem tinha resposta: descartar conta como erro.";
      resultado = { minha: [], resposta: g.pontos.filter((p) => p.visivel), vendo: "minha", tela: null };
    } else {
      const r = compararPontos(rotulo.pontos, g);
      const tela = resultadoNaTela(r, g);
      titulo.textContent = r.acerto ? "Certo" : "Errado";
      const erro = r.erro_mediano_px === null ? "" : `, com erro mediano de ${numero(r.erro_mediano_px, 1)} px (a meta é até 2 px)`;
      const partes = [`Você achou ${r.achados} dos ${r.visiveis} pontos que aparecem${erro}.`];
      if (!r.acerto) partes.push(`${motivoPontos(r).charAt(0).toUpperCase()}${motivoPontos(r).slice(1)}.`);
      if (r.girado) partes.push("Os nomes estão como vistos do outro lado do campo — vale igual.");
      $("resultado-texto").textContent = partes.join(" ");
      const nomeDaPessoa = (nome) => (r.girado ? CAMPO.espelharPonto(nome) : nome);
      resultado = {
        minha: rotulo.pontos,
        resposta: g.pontos.filter((p) => p.visivel).map((p) => ({ ...p, ponto: nomeDaPessoa(p.ponto) })),
        vendo: "minha",
        tela,
      };
    }
    titulo.className = titulo.textContent.startsWith("Certo") ? "certo" : "errado";
    if (!soVer) {
      const sit = await situacao(indice, "pontos", pessoa);
      $("resultado-texto").append(` ${textoLiberacao("pontos", sit)}`);
    }
    $("proximo").hidden = soVer;
    $("voltar-gabarito").hidden = !soVer;
    modoResultado(true);
    mostrarMinha();
    if (!soVer) $("proximo").focus();
  }

  function mostrarMinha() {
    marcador.resultado = resultado.tela ? { pontos: resultado.tela.pontos, verdadeiros: resultado.tela.verdadeiros } : null;
    marcador.definir(resultado.minha);
    mapa.atualizar({ estados: resultado.tela?.estados ?? new Map(), selecionado: null });
    $("ver-resposta").textContent = "Ver a resposta";
    resultado.vendo = "minha";
    atualizarPainel();
  }

  function alternarResposta() {
    if (!resultado || !marcador) return;
    if (resultado.vendo === "resposta") {
      mostrarMinha();
      return;
    }
    marcador.resultado = null;
    marcador.definir(resultado.resposta);
    mapa.atualizar({ estados: new Map(resultado.resposta.map((p) => [p.ponto, "certo"])), selecionado: null });
    $("ver-resposta").textContent = "Ver o meu";
    resultado.vendo = "resposta";
    atualizarPainel();
  }

  async function gravar(dados) {
    if (!marcador || !item || salvando || resultado) return;
    if (ctx.pessoa() !== item.pessoa) {
      // trocaram a pessoa em outra aba: esta imagem era de outra pessoa
      await abrirProximo();
      $("erro").textContent = "A pessoa escolhida mudou em outra aba; esta é a imagem dela.";
      return;
    }
    salvando = true;
    const feito = item;
    try {
      const { rotulo } = await salvarRotulo(indice, "pontos", feito.pessoa, {
        partida: feito.partida,
        quadro: feito.quadro,
        largura: feito.largura,
        altura: feito.altura,
        partiu_de: feito.partiu_de,
        segundos_ativos: tempo.segundos(),
        ...dados,
      });
      item = null; // gravado: daqui não se salva de novo esta imagem
      ctx.registrarCodigo(feito.pessoa);
      if (feito.treino) {
        const g = (await indice.itensGabarito("pontos")).find((x) => x.id === feito.quadro);
        await mostrarResultado(feito.pessoa, rotulo, g);
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

  async function salvar() {
    if (!marcador || !item || salvando || resultado || cx.aberta()) return;
    $("erro").textContent = "";
    if (marcador.pendente) {
      $("erro").textContent = "Falta dizer qual é o ponto marcado com “?”: clique nele no mapa (ou Esc para cancelar).";
      return;
    }
    const pontos = marcador.lista();
    if (!pontos.length) {
      const ok = await cx.confirmar("Salvar sem nenhum ponto?", "Salve sem pontos só quando nenhum ponto do campo aparece na imagem (um close, a torcida). Se a imagem não dá para anotar, descarte.");
      if (!ok) return;
    }
    await gravar({ pontos, situacao: "ok", motivo_descarte: null, comentario: "" });
  }

  async function descartar() {
    if (!marcador || !item || salvando || resultado || cx.aberta()) return;
    const d = await cx.pedirDescarte();
    if (d) await gravar({ pontos: [], situacao: "descartada", motivo_descarte: d.motivo, comentario: d.comentario });
  }

  // a pessoa escolhida mudou em outra aba: a imagem aberta não é mais de quem está aqui
  const aoTrocarPessoa = (e) => {
    if ((e.key === null || e.key === "anotacao.pessoa") && item && ctx.pessoa() !== item.pessoa) abrirProximo();
  };
  window.addEventListener("storage", aoTrocarPessoa);

  $("salvar").onclick = salvar;
  $("descartar").onclick = descartar;
  $("desfazer").onclick = () => marcador?.desfazer();
  $("ver-resposta").onclick = alternarResposta;
  $("proximo").onclick = () => abrirProximo();
  $("girar").onclick = () => {
    mapa.girar();
    local.gravar("giro-mapa", mapa.giro);
  };
  $("ver-nomes").onchange = () => {
    if (!marcador) return;
    marcador.mostrarNomes = $("ver-nomes").checked;
    marcador.desenhar();
  };

  const teclas = (e) => {
    if (!marcador || cx.aberta() || escrevendo(e)) return;
    if (e.key === " ") {
      e.preventDefault();
      marcador.espaco = e.type === "keydown";
      return;
    }
    if (e.type !== "keydown") return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      if (!resultado) (e.shiftKey ? marcador.refazer() : marcador.desfazer());
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === "y") {
      e.preventDefault();
      if (!resultado) marcador.refazer();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === "r") $("girar").click();
    else if (k === "0") marcador.ajustarVista();
    else if (k === "+" || k === "=") marcador.aproximar(1.25);
    else if (k === "-") marcador.aproximar(0.8);
    else if (k === "h") {
      marcador.mostrarPontos = !marcador.mostrarPontos;
      marcador.desenhar();
    } else if (k === "l") {
      $("ver-nomes").checked = !$("ver-nomes").checked;
      $("ver-nomes").dispatchEvent(new Event("change"));
    } else if (resultado) {
      if (k === "n" && !$("proximo").hidden) abrirProximo();
      else if (k === "v") alternarResposta();
    } else if (k === "s") {
      e.preventDefault();
      salvar();
    } else if (k === "d") {
      e.preventDefault();
      descartar();
    } else if (k === "escape") {
      marcador.cancelar();
    } else if (k === "delete" || k === "backspace") {
      const alvo = marcador.destaque ?? marcador.selecionado;
      if (alvo) {
        e.preventDefault();
        marcador.apagar(alvo);
        if (marcador.selecionado === alvo) marcador.selecionado = null;
        atualizarPainel();
      }
    }
  };
  window.addEventListener("keydown", teclas);
  window.addEventListener("keyup", teclas);

  await abrirProximo();
  // sem nada na fila, a página confere sozinha se chegou algo (uma partida nova, um devolvido)
  const vigia = vigiar(ctx, () => !ver && !item && !salvando && !$("vazio").hidden, abrirProximo);

  return {
    desmontar() {
      vivo = false;
      vigia.parar();
      window.removeEventListener("keydown", teclas);
      window.removeEventListener("keyup", teclas);
      window.removeEventListener("storage", aoTrocarPessoa);
      tempo.destruir();
      cx.destruir();
      mapa.destruir();
      largarMarcador();
      soltarImagem();
    },
  };
}
