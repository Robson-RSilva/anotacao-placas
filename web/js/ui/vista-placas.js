// Vista "Oclusão nas placas": pega o próximo recorte da fila — uma placa já endireitada, com um pouco
// em volta — e pinta o que está na frente dela (gente, bola, trave, outra placa, grafismo da
// emissora…), só dentro do contorno da placa. O recorte é considerado certo: se ele não está na placa,
// não se ajusta, se descarta. No teste do gabarito, mostra o resultado na hora (o que acertou, o que
// faltou, o que pintou a mais) e a resposta.

import { PARTIDA_GABARITO } from "../nucleo/convencoes.js";
import { proximo, situacao } from "../nucleo/filas.js";
import { REGRA, compararPlacas, motivoPlacas, verdadePlacas } from "../nucleo/gabarito.js";
import { mascaraDaRegiao } from "../nucleo/regiao.js";
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
  const cx = caixas(raiz, "placas");
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
    const { img, url } = await abrirImagem(pasta, { ...prox, tarefa: "placas" });
    if (!vivo) {
      URL.revokeObjectURL(url);
      return false;
    }
    largarPintor();
    soltarImagem();
    urlImagem = url;
    pintor = new Pintor($("tela"), { imagem: img, mascara, regiao: prox.regiao, aoMudar: ferramentas.mostrar });
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
    window.itemPlacas = null;
    if (pintor) pintor.somenteLeitura = true;
    $("resultado").hidden = true;
    const pessoa = ctx.pessoa();
    if (!pessoa) return mostrarVazio("Digite o seu código na página central.");
    if (ver) return verResultado(pessoa);
    const prox = await proximo(indice, "placas", pessoa, { treino: pedirTreino });
    if (!vivo) return;
    if (!prox) {
      const sit = await situacao(indice, "placas", pessoa);
      if (pedirTreino) return mostrarVazio("Você já fez todos os itens do gabarito das placas.", ["#/gabarito", "Ver os resultados"]);
      if (!sit.liberado) return mostrarVazio("O gabarito das placas acabou antes da liberação: fale com quem coordena.", ["#/gabarito", "Ver os resultados"]);
      return mostrarVazio("Nada para pintar agora. Um recorte aparece aqui quando chega um lote de recortes das placas (ou quando uma pintura sua volta da revisão).");
    }
    const mascara = await mascaraInicial(prox);
    if (!vivo || !(await abrirNaTela(prox, mascara))) return;
    $("treino").hidden = !prox.treino;
    $("devolvido").hidden = !prox.devolvido;
    if (prox.devolvido) $("devolvido").textContent = textoDevolvido("placas", prox.devolvido);
    $("partiu").textContent = mascara || prox.partiu_de.fonte !== "modelo" ? textoPartiu("placas", prox.partiu_de) : "";
    $("partiu").hidden = !$("partiu").textContent;
    modoResultado(false);
    tempo.zerar();
    item = { ...prox, pessoa }; // só agora: salvar grava para este recorte, em nome de quem o abriu
    window.itemPlacas = { partida: prox.partida, quadro: prox.quadro, treino: prox.treino, regiao: prox.regiao };
  }

  const abrirProximo = () => carregar().catch((e) => mostrarVazio(mensagemDeErro(e)));

  async function verResultado(pessoa) {
    const g = (await indice.itensGabarito("placas")).find((x) => x.id === ver);
    const ip = await indice.partida(PARTIDA_GABARITO, "placas");
    const a = ip.ultimos().get(`${ver}|${pessoa}`);
    if (!g || !a) return mostrarVazio("Você ainda não fez este item do gabarito.", ["#/gabarito", "Voltar ao gabarito"]);
    let mascara = null;
    if (a.dados.mascara) mascara = (await indice.mascara(`${pasta.rotulos(PARTIDA_GABARITO, "placas")}/${a.dados.mascara}`)).dados;
    const visto = { partida: PARTIDA_GABARITO, quadro: g.id, largura: g.largura, altura: g.altura, regiao: g.regiao };
    if (!(await abrirNaTela(visto, mascara))) return;
    $("treino").hidden = true;
    $("devolvido").hidden = true;
    $("partiu").hidden = true;
    await mostrarResultado(pessoa, a.dados, mascara, g, { soVer: true });
  }

  /** Título e texto do resultado de um item do gabarito, e o mapa do que acertou (ou null). */
  async function avaliar(rotulo, mascara, g) {
    const descartada = rotulo.situacao === "descartada" || !mascara;
    if (g.resposta === "descartar") {
      const certo = descartada && rotulo.motivo_descarte === "placa_fora_do_lugar";
      const motivo = motivoPlacas({ acerto: certo, descartada, resposta: "descartar" });
      return {
        titulo: certo ? "Certo: o recorte não estava na placa" : "Errado: o recorte não estava na placa",
        texto: certo
          ? "Este recorte não pega a placa: descartar (“o recorte não está na placa”) era a resposta."
          : `${motivo.charAt(0).toUpperCase()}${motivo.slice(1)}. Quando o contorno não está na placa, o recorte não se ajusta: descarte.`,
        mapa: null,
        resposta: null,
      };
    }
    const verdade = await verdadePlacas(indice, g);
    const resposta = verdade.dados.map((v) => (v >= 1 && v <= g.oclusores ? 1 : 0));
    if (descartada) {
      return { titulo: "Errado: o recorte foi descartado", texto: "Este recorte estava na placa: descartar conta como erro.", mapa: null, resposta };
    }
    const r = compararPlacas(mascara, verdade.dados, g.largura, g.altura, g.oclusores, mascaraDaRegiao(g.regiao, g.largura, g.altura));
    const n = r.oclusores.filter((j) => !j.pequeno).length;
    const meta = `${Math.round(100 * REGRA.placas.iou)}%`;
    const partes = [
      n
        ? `Na frente da placa: ${n - r.faltaram.length} de ${n} pintado(s), com ${Math.round(100 * r.iou)}% de sobreposição (a meta é ${meta}).`
        : `Não havia nada na frente da placa${r.iou < 1 ? ", e algo foi pintado" : ""}.`,
    ];
    const motivo = motivoPlacas({ ...r, descartada: false, resposta: "pintar" });
    if (!r.acerto && n) partes.push(`${motivo.charAt(0).toUpperCase()}${motivo.slice(1)}.`);
    return { titulo: r.acerto ? "Certo" : "Errado", texto: partes.join(" "), mapa: mapaDoResultado(mascara, verdade.dados, r.borda, g.oclusores), resposta };
  }

  async function mostrarResultado(pessoa, rotulo, mascara, g, { soVer = false } = {}) {
    const av = await avaliar(rotulo, mascara, g);
    const titulo = $("resultado-titulo");
    titulo.textContent = av.titulo;
    titulo.className = av.titulo.startsWith("Certo") ? "certo" : "errado";
    $("resultado-texto").textContent = av.texto;
    if (!soVer) {
      const sit = await situacao(indice, "placas", pessoa);
      $("resultado-texto").append(` ${textoLiberacao("placas", sit)}`);
    }
    resultado = { minha: mascara, resposta: av.resposta, mapa: av.mapa, vendo: "resultado" };
    $("proximo").hidden = soVer;
    $("voltar-gabarito").hidden = !soVer;
    $("ver-resposta").hidden = !av.resposta; // no recorte para descartar, não há o que mostrar
    modoResultado(true);
    mostrarVisao(av.mapa ? "resultado" : "minha");
    if (!soVer) $("proximo").focus();
  }

  function mostrarVisao(qual) {
    resultado.vendo = qual;
    $("legenda-resultado").hidden = qual !== "resultado"; // as cores do resultado só valem nele
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
    if (!resultado || !pintor || !resultado.resposta) return;
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
      const { rotulo, mascara } = await salvarRotulo(indice, "placas", feito.pessoa, {
        partida: feito.partida,
        quadro: feito.quadro,
        largura: feito.largura,
        altura: feito.altura,
        regiao: feito.regiao,
        partiu_de: feito.partiu_de,
        segundos_ativos: tempo.segundos(),
        ...dados,
      });
      item = null;
      ctx.registrarCodigo(feito.pessoa);
      if (feito.treino) {
        const g = (await indice.itensGabarito("placas")).find((x) => x.id === feito.quadro);
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
      const ok = await cx.confirmar("Salvar sem nada pintado?", "Salve sem pintar só quando nada cobre a placa. Se o recorte não está na placa (ou não dá para ver), descarte.");
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
