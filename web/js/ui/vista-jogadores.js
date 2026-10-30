// Vista "Jogadores": pega a próxima imagem da fila e pinta todos os jogadores dela. No teste do
// gabarito, mostra o resultado na hora (o que acertou, o que faltou, o que pintou a mais) e a resposta.

import { PARTIDA_GABARITO } from "../nucleo/convencoes.js";
import { proximo, situacao } from "../nucleo/filas.js";
import { compararJogadores, motivoJogadores, verdadeJogadores } from "../nucleo/gabarito.js";
import { salvarRotulo } from "../nucleo/rotulos.js";
import { Pintor, mapaDoResultado } from "./pintor.js";
import { abrirImagem, caixas, escrevendo, parametros, textoDevolvido, textoLiberacao, textoPartiu } from "./tarefa.js";
import { TempoAtivo } from "./tempo.js";
import { el, formatarTempo, mensagemDeErro } from "./util.js";
import { vigiar } from "./vigia.js";

export const CLASSE = "pagina-editor";

/**
 * Liga os botões de ferramenta (pincel, laço, borracha, tamanho, desfazer, pintura) ao pintor do
 * momento. Devolve {mostrar, tecla}: `mostrar()` põe os botões de acordo com o pintor; `tecla(e)`
 * trata as teclas do pintor e devolve true quando a tecla era dele.
 */
export function ligarFerramentas(raiz, $, pintorAtual) {
  const mostrar = () => {
    const p = pintorAtual();
    if (!p) return;
    for (const b of raiz.querySelectorAll("[data-ferramenta]")) b.setAttribute("aria-pressed", String(b.dataset.ferramenta === p.ferramenta));
    $("borracha").setAttribute("aria-pressed", String(p.apagando));
    $("raio").value = p.raio;
    $("raio-valor").textContent = `${p.raio} px`;
    if ($("ver-pintura")) $("ver-pintura").checked = p.mostrarPintura;
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
  $("borracha").onclick = () => {
    const p = pintorAtual();
    if (!p) return;
    p.apagando = !p.apagando;
    mostrar();
    p.desenhar();
  };
  $("raio").oninput = () => {
    const p = pintorAtual();
    if (!p) return;
    p.raio = Number($("raio").value);
    mostrar();
  };
  $("desfazer").onclick = () => pintorAtual()?.desfazer();
  $("refazer").onclick = () => pintorAtual()?.refazer();
  if ($("ver-pintura")) {
    $("ver-pintura").onchange = () => {
      const p = pintorAtual();
      if (!p) return;
      p.mostrarPintura = $("ver-pintura").checked;
      p.desenhar();
    };
  }
  const tecla = (e, { editar = true } = {}) => {
    const p = pintorAtual();
    if (!p) return false;
    const k = e.key;
    if (k === " ") {
      e.preventDefault();
      p.espaco = e.type === "keydown";
      p.desenhar();
      return true;
    }
    if (e.type !== "keydown") return false;
    if (editar && (e.ctrlKey || e.metaKey) && k.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) p.refazer();
      else p.desfazer();
      return true;
    }
    if (editar && (e.ctrlKey || e.metaKey) && k.toLowerCase() === "y") {
      e.preventDefault();
      p.refazer();
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k === "h" || k === "H") p.mostrarPintura = !p.mostrarPintura;
    else if (k === "0") p.ajustarVista();
    else if (k === "+" || k === "=") p.aproximar(1.25);
    else if (k === "-") p.aproximar(0.8);
    else if (!editar) return false;
    else if (k === "Escape" && p.laco) p.cancelarLaco();
    else if (k === "Enter" && p.laco) p.fecharLaco();
    else if (k === "Backspace" && p.laco) p.tirarPontoDoLaco();
    else if (k === "b" || k === "B") p.ferramenta = "pincel";
    else if (k === "l" || k === "L") p.ferramenta = "laco";
    else if (k === "e" || k === "E") p.apagando = !p.apagando;
    else if (k === "[") p.raio = Math.max(1, p.raio - (p.raio > 10 ? 2 : 1));
    else if (k === "]") p.raio = Math.min(30, p.raio + (p.raio >= 10 ? 2 : 1));
    else return false;
    e.preventDefault();
    mostrar();
    p.desenhar();
    return true;
  };
  return { mostrar, tecla };
}

export async function montar(raiz, ctx) {
  const $ = (id) => el(id, raiz);
  const { pasta, indice } = ctx;
  const params = parametros();
  const pedirTreino = params.has("treino");
  const ver = params.get("ver");
  const cx = caixas(raiz);
  let pintor = null;
  let item = null;
  let urlImagem = null;
  let salvando = false;
  let resultado = null; // depois de um item do teste: {minha, resposta, mapa, vendo}
  let vivo = true;
  const tempo = new TempoAtivo({ aoTique: (s) => { $("tempo").textContent = formatarTempo(s); } });
  const ferramentas = ligarFerramentas(raiz, $, () => pintor);

  function soltarImagem() {
    if (urlImagem) URL.revokeObjectURL(urlImagem);
    urlImagem = null;
  }

  function largarPintor() {
    if (!pintor) return;
    pintor.destruir();
    pintor = null;
    window.pintor = null;
    const c = $("tela");
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }

  function mostrarVazio(texto, link = null) {
    largarPintor();
    soltarImagem();
    $("painel").hidden = true;
    $("vazio").hidden = false;
    $("vazio").replaceChildren(texto);
    if (link) $("vazio").append(" ", Object.assign(document.createElement("a"), { href: link[0], textContent: link[1] }));
  }

  function modoResultado(ligado) {
    $("resultado").hidden = !ligado;
    $("edicao").hidden = ligado;
    if (pintor) {
      pintor.somenteLeitura = ligado;
      pintor.desenhar();
    }
  }

  async function abrirNaTela(prox, mascara) {
    const { img, url } = await abrirImagem(pasta, prox);
    if (!vivo) {
      URL.revokeObjectURL(url);
      return false;
    }
    largarPintor();
    soltarImagem();
    urlImagem = url;
    pintor = new Pintor($("tela"), { imagem: img, mascara, aoMudar: ferramentas.mostrar });
    window.pintor = pintor; // ajuda a depurar e a testar
    $("painel").hidden = false;
    $("vazio").hidden = true;
    ferramentas.mostrar();
    return true;
  }

  async function mascaraInicial(prox) {
    if (!prox.inicio) return null;
    try {
      const m = await indice.mascara(prox.inicio);
      return m.largura === prox.largura && m.altura === prox.altura ? m.dados : null;
    } catch {
      return null; // a máscara de partida ilegível não impede de pintar
    }
  }

  async function carregar() {
    $("erro").textContent = "";
    item = null;
    resultado = null;
    window.itemJogadores = null;
    if (pintor) pintor.somenteLeitura = true;
    $("resultado").hidden = true;
    const pessoa = ctx.pessoa();
    if (!pessoa) return mostrarVazio("Digite o seu código na página central.");
    if (ver) return verResultado(pessoa);
    const prox = await proximo(indice, "jogadores", pessoa, { treino: pedirTreino });
    if (!vivo) return;
    if (!prox) {
      const sit = await situacao(indice, "jogadores", pessoa);
      if (pedirTreino) return mostrarVazio("Você já fez todos os itens do gabarito dos jogadores.", ["#/gabarito", "Ver os resultados"]);
      if (!sit.liberado) return mostrarVazio("O gabarito dos jogadores acabou antes da liberação: fale com quem coordena.", ["#/gabarito", "Ver os resultados"]);
      return mostrarVazio("Nada para pintar agora. Uma imagem aparece aqui quando uma partida é importada (ou quando uma pintura sua volta da revisão).");
    }
    const mascara = await mascaraInicial(prox);
    if (!vivo || !(await abrirNaTela(prox, mascara))) return;
    $("treino").hidden = !prox.treino;
    $("devolvido").hidden = !prox.devolvido;
    if (prox.devolvido) $("devolvido").textContent = textoDevolvido("jogadores", prox.devolvido);
    $("partiu").textContent = mascara || prox.partiu_de.fonte !== "modelo" ? textoPartiu("jogadores", prox.partiu_de) : "";
    $("partiu").hidden = !$("partiu").textContent;
    modoResultado(false);
    tempo.zerar();
    item = { ...prox, pessoa }; // só agora: salvar grava para esta imagem, em nome de quem a abriu
    window.itemJogadores = { partida: prox.partida, quadro: prox.quadro, treino: prox.treino };
  }

  const abrirProximo = () => carregar().catch((e) => mostrarVazio(mensagemDeErro(e)));

  async function verResultado(pessoa) {
    const g = (await indice.itensGabarito("jogadores")).find((x) => x.id === ver);
    const ip = await indice.partida(PARTIDA_GABARITO, "jogadores");
    const a = ip.ultimos().get(`${ver}|${pessoa}`);
    if (!g || !a) return mostrarVazio("Você ainda não fez este item do gabarito.", ["#/gabarito", "Voltar ao gabarito"]);
    let mascara = null;
    if (a.dados.mascara) mascara = (await indice.mascara(`${pasta.rotulos(PARTIDA_GABARITO, "jogadores")}/${a.dados.mascara}`)).dados;
    const visto = { partida: PARTIDA_GABARITO, quadro: g.id, largura: g.largura, altura: g.altura };
    if (!(await abrirNaTela(visto, mascara))) return;
    $("treino").hidden = true;
    $("devolvido").hidden = true;
    $("partiu").hidden = true;
    await mostrarResultado(pessoa, a.dados, mascara, g, { soVer: true });
  }

  async function mostrarResultado(pessoa, rotulo, mascara, g, { soVer = false } = {}) {
    const verdade = await verdadeJogadores(indice, g);
    const resposta = verdade.dados.map((v) => (v >= 1 && v <= g.jogadores ? 1 : 0));
    const titulo = $("resultado-titulo");
    let mapaRes = null;
    if (rotulo.situacao === "descartada" || !mascara) {
      titulo.textContent = "Errado: a imagem foi descartada";
      $("resultado-texto").textContent = "Esta imagem tinha resposta: descartar conta como erro.";
    } else {
      const r = compararJogadores(mascara, verdade.dados, g.largura, g.altura, g.jogadores);
      const n = r.jogadores.filter((j) => !j.pequeno).length;
      titulo.textContent = r.acerto ? "Certo" : "Errado";
      const partes = [`Você pintou ${n - r.faltaram.length} dos ${n} jogadores, com ${Math.round(100 * r.iou)}% de sobreposição (a meta é 80%).`];
      if (!r.acerto) partes.push(`${motivoJogadores(r).charAt(0).toUpperCase()}${motivoJogadores(r).slice(1)}.`);
      $("resultado-texto").textContent = partes.join(" ");
      mapaRes = mapaDoResultado(mascara, verdade.dados, r.borda, g.jogadores);
    }
    titulo.className = titulo.textContent.startsWith("Certo") ? "certo" : "errado";
    if (!soVer) {
      const sit = await situacao(indice, "jogadores", pessoa);
      $("resultado-texto").append(` ${textoLiberacao("jogadores", sit)}`);
    }
    resultado = { minha: mascara, resposta, mapa: mapaRes, vendo: "resultado" };
    $("proximo").hidden = soVer;
    $("voltar-gabarito").hidden = !soVer;
    modoResultado(true);
    mostrarVisao("resultado");
    if (!soVer) $("proximo").focus();
  }

  function mostrarVisao(qual) {
    resultado.vendo = qual;
    if (qual === "resposta") {
      pintor.mostrarResultado(null);
      pintor.definir(resultado.resposta);
      $("ver-resposta").textContent = "Ver a minha pintura";
    } else if (qual === "minha") {
      pintor.mostrarResultado(null);
      pintor.definir(resultado.minha);
      $("ver-resposta").textContent = resultado.mapa ? "Ver o resultado" : "Ver a resposta";
    } else {
      pintor.definir(resultado.minha);
      pintor.mostrarResultado(resultado.mapa);
      $("ver-resposta").textContent = "Ver a resposta";
    }
  }

  function alternarResposta() {
    if (!resultado || !pintor) return;
    const ordem = resultado.mapa ? ["resultado", "resposta", "minha"] : ["minha", "resposta"];
    mostrarVisao(ordem[(ordem.indexOf(resultado.vendo) + 1) % ordem.length]);
  }

  async function gravar(dados) {
    if (!pintor || !item || salvando || resultado) return;
    if (ctx.pessoa() !== item.pessoa) {
      await abrirProximo();
      $("erro").textContent = "A pessoa escolhida mudou em outra aba; esta é a imagem dela.";
      return;
    }
    salvando = true;
    const feito = item;
    try {
      const { rotulo, mascara } = await salvarRotulo(indice, "jogadores", feito.pessoa, {
        partida: feito.partida,
        quadro: feito.quadro,
        largura: feito.largura,
        altura: feito.altura,
        partiu_de: feito.partiu_de,
        segundos_ativos: tempo.segundos(),
        ...dados,
      });
      item = null;
      ctx.registrarCodigo(feito.pessoa);
      if (feito.treino) {
        const g = (await indice.itensGabarito("jogadores")).find((x) => x.id === feito.quadro);
        await mostrarResultado(feito.pessoa, rotulo, mascara, g);
      } else {
        await abrirProximo();
      }
    } catch (e) {
      if (item) $("erro").textContent = mensagemDeErro(e);
      else mostrarVazio(`A pintura foi gravada, mas: ${mensagemDeErro(e)}`);
    } finally {
      salvando = false;
    }
  }

  async function salvar() {
    if (!pintor || !item || salvando || resultado || cx.aberta()) return;
    $("erro").textContent = "";
    if (pintor.laco) {
      $("erro").textContent = "Feche o laço (no primeiro ponto, com dois cliques ou Enter) ou cancele com Esc.";
      return;
    }
    if (!pintor.pixels()) {
      const ok = await cx.confirmar("Salvar sem nenhum jogador?", "Salve sem pintar só quando não há jogador na imagem. Se a imagem não dá para anotar, descarte.");
      if (!ok) return;
    }
    await gravar({ mascara: pintor.mascara(), situacao: "ok", motivo_descarte: null, comentario: "" });
  }

  async function descartar() {
    if (!pintor || !item || salvando || resultado || cx.aberta()) return;
    const d = await cx.pedirDescarte();
    if (d) await gravar({ mascara: null, situacao: "descartada", motivo_descarte: d.motivo, comentario: d.comentario });
  }

  const aoTrocarPessoa = (e) => {
    if ((e.key === null || e.key === "anotacao.pessoa") && item && ctx.pessoa() !== item.pessoa) abrirProximo();
  };
  window.addEventListener("storage", aoTrocarPessoa);

  $("salvar").onclick = salvar;
  $("descartar").onclick = descartar;
  $("ver-resposta").onclick = alternarResposta;
  $("proximo").onclick = () => abrirProximo();

  const teclas = (e) => {
    if (!pintor || cx.aberta() || escrevendo(e)) return;
    if (ferramentas.tecla(e, { editar: !resultado })) return;
    if (e.type !== "keydown" || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (resultado) {
      if (k === "n" && !$("proximo").hidden) abrirProximo();
      else if (k === "v") alternarResposta();
      return;
    }
    if (k === "s") {
      e.preventDefault();
      salvar();
    } else if (k === "d") {
      e.preventDefault();
      descartar();
    }
  };
  window.addEventListener("keydown", teclas);
  window.addEventListener("keyup", teclas);

  await abrirProximo();
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
      largarPintor();
      soltarImagem();
    },
  };
}
