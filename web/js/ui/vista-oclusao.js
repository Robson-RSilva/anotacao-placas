// Vista "Oclusão nas placas": pega o próximo quadro da fila (com a câmera já aprovada), desenha as
// placas pela câmera e grava a pintura do que as cobre. No treino com o gabarito, mostra na hora a
// diferença e a resposta.

import { Camera } from "../nucleo/camera.js";
import { Molde } from "../nucleo/campo.js";
import { proximoOclusao, situacaoOclusao } from "../nucleo/filas-oclusao.js";
import { compararOclusaoComGabarito, verdadeOclusao } from "../nucleo/gabarito.js";
import { LIMITE_OCLUSAO, pintaveis, pinturaDe, placasDasFaixas } from "../nucleo/oclusao.js";
import { salvarRotuloOclusao } from "../nucleo/rotulos-oclusao.js";
import { ligarFaixas, ligarFerramentas, lerFaixas, listarPlacas, mostrarFaixas, permitirNaoPlaca, diferenca, porcento, teclaDoPintor } from "./painel-oclusao.js";
import { Pintor } from "./pintor.js";
import { TempoAtivo } from "./tempo.js";
import { vigiar } from "./vigia.js";
import { el, formatarTempo, imagemDoArquivo, mensagemDeErro } from "./util.js";

export const CLASSE = "pagina-editor";

export const MOTIVOS_OCLUSAO = {
  faixa_fora_das_placas: "faixas fora das placas",
  pintura_fora_da_tolerancia: "pintura fora da tolerância",
  classe_errada: "classe errada",
  camera_errada: "deveria ser \"câmera errada\"",
  outro: "outro",
};

/** As placas que a câmera do item desenha: as do gabarito, as do pacote ou as das faixas. */
export function placasDoItem(item, pacote, faixas = item.faixas) {
  if (item.placas_de === "faixas") return placasDasFaixas(item.campo ?? pacote.campo, faixas);
  return item.placas ?? pacote.placas;
}

/** O retângulo (na imagem) das placas que se pintam, para aproximar a vista. */
export function caixaDasPlacas(pintor) {
  const ks = new Set(pintaveis(pintor.geo.info).map((p) => p.k));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const { k, pol } of pintor.geo.contornos) {
    if (!ks.has(k)) continue;
    for (const [x, y] of pol) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (!(x1 > x0)) return null;
  return [Math.max(0, x0), Math.max(0, y0), Math.min(pintor.w, x1), Math.min(pintor.h, y1)];
}

export async function montar(raiz, ctx) {
  const $ = (id) => el(id, raiz);
  const { pasta, indice } = ctx;
  let pintor = null;
  let item = null;
  let urlImagem = null;
  let salvando = false;
  let resultado = null; // depois de um item de treino: {minha, verdade, vendo}
  let vivo = true;
  const tempo = new TempoAtivo({ aoTique: (s) => { $("tempo").textContent = formatarTempo(s); } });
  const ferramentas = ligarFerramentas(raiz, $, () => pintor);
  const situacao = () => raiz.querySelector("input[name=situacao]:checked").value;

  function atualizarPainel() {
    if (!pintor) return;
    const est = pintor.estatisticas();
    listarPlacas($("lista-placas"), est);
    const n = est.filter((p) => !p.pequena).length;
    const pequenas = est.length - n;
    $("n-placas").textContent = est.length ? `(${n} para pintar${pequenas ? `, ${pequenas} pequena${pequenas > 1 ? "s" : ""} demais` : ""})` : "";
    $("ck-pintaveis").className = n ? "ok" : "";
    ferramentas.mostrar();
  }

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

  function mostrarVazio(texto) {
    largarPintor();
    soltarImagem();
    $("painel").hidden = true;
    $("vazio").hidden = false;
    $("vazio").textContent = texto;
  }

  function modoResultado(ligado) {
    $("resultado").hidden = !ligado;
    $("edicao").hidden = ligado;
    if (pintor) {
      pintor.somenteLeitura = ligado;
      pintor.desenhar();
    }
  }

  async function carregar() {
    $("erro").textContent = "";
    // o que está na tela não pode ser salvo para o próximo quadro, nem se ele falhar ao abrir; e não
    // se pinta mais nele enquanto o próximo carrega
    item = null;
    resultado = null;
    window.itemOclusao = null;
    if (pintor) pintor.somenteLeitura = true;
    $("resultado").hidden = true;
    const pessoa = ctx.pessoa();
    if (!pessoa) return mostrarVazio("Digite o seu código na página central.");
    const proximo = await proximoOclusao(indice, pessoa);
    if (!vivo) return; // a pessoa já saiu da página
    if (!proximo) {
      const sit = await situacaoOclusao(indice, pessoa);
      return mostrarVazio(sit.liberado
        ? "Nada para pintar agora. Um quadro entra aqui depois que a câmera dele é aprovada na revisão cruzada."
        : "O gabarito da oclusão acabou antes da liberação: fale com quem coordena.");
    }
    const pacote = await indice.pacote(proximo.pacote);
    const arquivo = await pasta.arquivo(pasta.quadro(proximo.partida, proximo.quadro));
    if (!arquivo) return mostrarVazio("A imagem deste quadro ainda não chegou na pasta (o Drive terminou de sincronizar?).");
    const { img, url } = await imagemDoArquivo(arquivo);
    soltarImagem();
    urlImagem = url;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w !== proximo.largura || h !== proximo.altura) return mostrarVazio("A imagem deste quadro não tem o tamanho do vídeo da partida.");
    let pintura = null;
    if (proximo.mascara_inicial) {
      try {
        const m = await indice.mascara(proximo.mascara_inicial);
        if (m.largura === w && m.altura === h) pintura = pinturaDe(m.dados);
      } catch {
        pintura = null; // a máscara de partida ilegível não impede de pintar
      }
    }
    if (!vivo) return;
    largarPintor();
    const campo = proximo.campo ?? pacote.campo;
    pintor = new Pintor($("tela"), {
      imagem: img,
      camera: Camera.deRotulo(proximo.camera, w, h),
      placas: placasDoItem(proximo, pacote),
      molde: Molde.doCampo(campo.comprimento, campo.largura),
      pintura,
      aoMudar: atualizarPainel,
      aoPassar: (t) => { $("dica").textContent = t || ""; },
    });
    window.pintor = pintor; // ajuda a depurar e a testar
    permitirNaoPlaca(raiz, pintor, proximo.placas_de === "faixas");
    $("secao-faixas").hidden = proximo.placas_de !== "faixas";
    $("secao-faixas").open = Boolean(proximo.faixas_padrao); // a primeira pintura da partida: confira as faixas
    if (proximo.faixas) mostrarFaixas($, proximo.faixas);
    $("treino").hidden = !proximo.treino;
    const dev = $("devolvido");
    dev.hidden = !proximo.devolvido;
    if (proximo.devolvido) {
      dev.textContent = `Devolvido na revisão: ${MOTIVOS_OCLUSAO[proximo.devolvido.motivo] || proximo.devolvido.motivo}`
        + (proximo.devolvido.comentario ? ` — “${proximo.devolvido.comentario}”` : "");
    }
    $("partiu").textContent = proximo.partiu_de.fonte === "modelo" ? "Começa com a pintura de um modelo: corrija o que estiver errado." : "";
    $("partiu").hidden = !$("partiu").textContent;
    raiz.querySelector("input[name=situacao][value=ok]").checked = true;
    $("comentario").value = "";
    $("ck-conferi").checked = false;
    $("painel").hidden = false;
    $("vazio").hidden = true;
    modoResultado(false);
    tempo.zerar();
    atualizarPainel();
    item = { ...proximo, pessoa }; // só agora: salvar grava para este quadro, em nome de quem o abriu
    window.itemOclusao = { partida: proximo.partida, quadro: proximo.quadro, treino: proximo.treino };
  }

  const abrirProximo = () => carregar().catch((e) => mostrarVazio(mensagemDeErro(e)));

  async function mostrarResultado(feito, rotulo) {
    const g = (await indice.itensGabarito("oclusao")).find((x) => x.id === feito.quadro);
    const d = await compararOclusaoComGabarito(indice, rotulo, g);
    const verdade = await verdadeOclusao(indice, g);
    const s = await situacaoOclusao(indice, feito.pessoa);
    const ok = d.maxima !== null && d.maxima <= LIMITE_OCLUSAO;
    $("resultado-titulo").textContent = ok ? "Dentro da tolerância" : "Fora da tolerância";
    $("resultado-texto").textContent = (d.maxima === null
      ? "Sem pintura para comparar."
      : `Na placa mais diferente, ${diferenca(d.maxima)} da área ficou diferente da resposta, fora da tolerância de 1 px na borda (a meta é até 5%).`)
      + (s.liberado ? " Você está liberado para os quadros reais." : ` ${s.motivo.charAt(0).toUpperCase()}${s.motivo.slice(1)}.`);
    const fora = d.placas.filter((p) => p.dif > LIMITE_OCLUSAO);
    const ul = $("resultado-placas");
    ul.replaceChildren();
    const daVerdade = new Map(verdade.placas.map((p) => [p.id, p]));
    const minhas = new Map(rotulo.placas.map((p) => [p.id, p]));
    for (const p of fora) {
      const li = document.createElement("li");
      const nome = document.createElement("span");
      nome.textContent = p.id;
      const valor = document.createElement("span");
      valor.className = "res ruim";
      valor.textContent = `livre: você ${porcento(minhas.get(p.id).livre_frac)}, verdade ${porcento(daVerdade.get(p.id).livre_frac)}`;
      li.append(nome, valor);
      ul.append(li);
    }
    resultado = { minha: Uint8Array.from(pintor.pintura), verdade: pinturaDe(verdade.mascara.dados), vendo: "minha" };
    $("ver-resposta").textContent = "Ver a resposta";
    modoResultado(true);
    $("proximo").focus();
  }

  async function salvar() {
    if (!pintor || !item || salvando || resultado) return;
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
    if (sit === "ok") {
      if (!pintaveis(pintor.geo.info).length) {
        $("erro").textContent = "Nenhuma placa para pintar neste quadro: escolha “Nenhuma placa para pintar”.";
        return;
      }
      if (!$("ck-conferi").checked) {
        $("erro").textContent = "Confira cada placa (o contorno e o que a cobre) e marque a caixa.";
        return;
      }
    }
    let faixas = null;
    if (item.placas_de === "faixas") {
      const lidas = lerFaixas($);
      if (lidas.erro) {
        $("erro").textContent = `${lidas.erro.charAt(0).toUpperCase()}${lidas.erro.slice(1)}.`;
        return;
      }
      faixas = lidas.faixas;
    }
    salvando = true;
    const feito = item;
    try {
      const { rotulo } = await salvarRotuloOclusao(indice, feito.pessoa, {
        partida: feito.partida,
        quadro: feito.quadro,
        pacote: feito.pacote,
        largura: feito.largura,
        altura: feito.altura,
        camera: feito.camera,
        camera_de: feito.camera_de,
        campo: feito.campo,
        placas_de: feito.placas_de,
        faixas,
        placas3d: pintor.placas,
        partiu_de: feito.partiu_de,
        pintura: sit === "ok" || sit === "duvida" ? pintor.pintura : null,
        situacao: sit,
        comentario,
        segundos_ativos: tempo.segundos(),
      });
      item = null; // gravado: daqui não se salva de novo este quadro
      ctx.registrarCodigo(feito.pessoa);
      if (feito.treino) await mostrarResultado(feito, rotulo);
      else await abrirProximo();
    } catch (e) {
      if (item) $("erro").textContent = mensagemDeErro(e); // não gravou: dá para tentar de novo
      else mostrarVazio(`A pintura foi gravada, mas: ${mensagemDeErro(e)}`);
    } finally {
      salvando = false;
    }
  }

  function alternarResposta() {
    if (!resultado || !pintor) return;
    resultado.vendo = resultado.vendo === "minha" ? "verdade" : "minha";
    pintor.definir(resultado.vendo === "minha" ? resultado.minha : resultado.verdade);
    $("ver-resposta").textContent = resultado.vendo === "minha" ? "Ver a resposta" : "Ver a minha pintura";
  }

  ligarFaixas(
    $,
    (faixas) => {
      $("erro").textContent = "";
      if (pintor && item?.placas_de === "faixas") pintor.trocarPlacas(placasDasFaixas(item.campo, faixas));
    },
    (erro) => { $("erro").textContent = erro; },
  );

  // a pessoa escolhida mudou em outra aba: o quadro aberto não é mais de quem está aqui
  const aoTrocarPessoa = (e) => {
    if ((e.key === null || e.key === "anotacao.pessoa") && item && ctx.pessoa() !== item.pessoa) abrirProximo();
  };
  window.addEventListener("storage", aoTrocarPessoa);

  $("salvar").onclick = salvar;
  $("ver-resposta").onclick = alternarResposta;
  $("proximo").onclick = () => abrirProximo();
  $("enquadrar").onclick = () => {
    const caixa = pintor && caixaDasPlacas(pintor);
    if (caixa) pintor.enquadrar(...caixa);
  };

  const teclas = (e) => {
    if (!pintor || e.target.matches("textarea, input[type=text], input[type=number], select")) return;
    if (teclaDoPintor(e, pintor, ferramentas.mostrar)) return;
    if (e.type !== "keydown" || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (resultado) {
      if (k === "n") abrirProximo();
      else if (k === "r") alternarResposta();
      return;
    }
    if (k === "s") {
      e.preventDefault();
      salvar();
    } else if (k === "z") {
      $("enquadrar").click();
    }
  };
  window.addEventListener("keydown", teclas);
  window.addEventListener("keyup", teclas);

  await abrirProximo();
  // sem nada na fila, a página confere sozinha se chegou algo (uma câmera aprovada, um devolvido)
  const vigia = vigiar(ctx, () => !item && !salvando && !$("vazio").hidden, abrirProximo);

  return {
    desmontar() {
      vivo = false;
      vigia.parar();
      window.removeEventListener("keydown", teclas);
      window.removeEventListener("keyup", teclas);
      window.removeEventListener("storage", aoTrocarPessoa);
      tempo.destruir();
      largarPintor();
      soltarImagem();
    },
  };
}
