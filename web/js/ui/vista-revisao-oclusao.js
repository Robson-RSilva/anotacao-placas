// Vista "Revisão da oclusão": mostra a pintura de outra pessoa, sem o nome, e grava a decisão. Ao
// corrigir, a pintura (e as faixas) ficam editáveis, como na página da oclusão.

import { Camera } from "../nucleo/camera.js";
import { Molde } from "../nucleo/campo.js";
import { pendentesRevisaoOclusao } from "../nucleo/filas-oclusao.js";
import { placasDasFaixas, placasDoRotulo, pinturaDe } from "../nucleo/oclusao.js";
import { ForaDaFila } from "../nucleo/rotulos.js";
import { salvarRevisaoOclusao } from "../nucleo/rotulos-oclusao.js";
import { ligarFaixas, ligarFerramentas, lerFaixas, listarPlacas, mostrarFaixas, permitirNaoPlaca, teclaDoPintor } from "./painel-oclusao.js";
import { Pintor } from "./pintor.js";
import { caixaDasPlacas } from "./vista-oclusao.js";
import { TempoAtivo } from "./tempo.js";
import { vigiar } from "./vigia.js";
import { el, formatarTempo, imagemDoArquivo, mensagemDeErro, numero } from "./util.js";

export const CLASSE = "pagina-editor";

const SITUACOES = {
  ok: "Pintado",
  sem_placas: "Nenhuma placa para pintar",
  camera_errada: "Câmera errada",
  duvida: "Dúvida",
};
const FONTES = { nenhuma: "nada (tudo livre)", modelo: "pintura de um modelo", rotulo_anterior: "versão anterior", rotulo_revisado: "revisão" };

const descreverFaixas = (f) => [["laterais", f.laterais], ["fundos", f.fundos]]
  .map(([nome, x]) => (x.ligada
    ? `${nome} a ${numero(x.distancia, 2)} m da linha, ${numero(x.altura, 2)} m de altura`
      + (x.comprimento ? `, ${numero(x.comprimento, 1)} m de comprimento` : "")
      + (x.vao ? `, vão de ${numero(x.vao, 1)} m` : "")
    : `${nome}: sem placas`))
  .join("; ");

export async function montar(raiz, ctx) {
  const $ = (id) => el(id, raiz);
  const { pasta, indice } = ctx;
  let pintor = null;
  let atual = null; // {arquivo, rotulo, pessoa, pintura, pacote}
  let urlImagem = null;
  let enviando = false;
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

  function mostrarVazio(texto) {
    largarPintor();
    soltarImagem();
    $("painel").hidden = true;
    $("vazio").hidden = false;
    $("vazio").textContent = texto;
  }

  const atualizarLista = () => {
    if (pintor) listarPlacas($("lista-placas"), pintor.estatisticas());
    ferramentas.mostrar();
  };

  function modo(nome) {
    $("secao-devolver").hidden = nome !== "devolver";
    $("secao-corrigir").hidden = nome !== "corrigir";
    $("secao-faixas").open = false;
    $("decidir").hidden = nome !== "ver";
    if (pintor) {
      pintor.somenteLeitura = nome !== "corrigir";
      pintor.desenhar();
    }
  }

  async function carregar() {
    $("erro").textContent = "";
    // a decisão não pode ir para outra pintura, nem se a próxima falhar ao abrir
    atual = null;
    const pessoa = ctx.pessoa();
    if (!pessoa) return mostrarVazio("Digite o seu código na página central.");
    const pend = await pendentesRevisaoOclusao(indice, pessoa);
    if (!vivo) return; // a pessoa já saiu da página
    $("pendentes").textContent = pend.length ? `${pend.length} na fila` : "";
    if (!pend.length) return mostrarVazio("Nenhuma pintura de outra pessoa esperando revisão.");
    const proximo = pend[0];
    const rot = proximo.rotulo;
    const pacote = await indice.pacote(rot.pacote);
    const arquivo = await pasta.arquivo(pasta.quadro(rot.partida, rot.quadro));
    if (!arquivo) return mostrarVazio("A imagem deste quadro ainda não chegou na pasta (o Drive terminou de sincronizar?).");
    const { img, url } = await imagemDoArquivo(arquivo);
    soltarImagem();
    urlImagem = url;
    let pintura = null;
    if (rot.mascara) {
      const m = await indice.mascara(`${pasta.rotulos(rot.partida, "oclusao")}/${rot.mascara}`);
      if (m.largura !== img.naturalWidth || m.altura !== img.naturalHeight) throw new Error("a máscara não tem o tamanho do quadro");
      pintura = pinturaDe(m.dados);
    }
    if (!vivo) return;
    largarPintor();
    const campo = rot.campo ?? pacote.campo;
    pintor = new Pintor($("tela"), {
      imagem: img,
      camera: Camera.deRotulo(rot.camera, img.naturalWidth, img.naturalHeight),
      placas: placasDoRotulo(rot, pacote),
      molde: Molde.doCampo(campo.comprimento, campo.largura),
      pintura,
      somenteLeitura: true,
      aoMudar: atualizarLista,
      aoPassar: (t) => { $("dica").textContent = t || ""; },
    });
    window.pintor = pintor;
    permitirNaoPlaca(raiz, pintor, rot.placas_de === "faixas");
    $("r-situacao").textContent = SITUACOES[rot.situacao] || rot.situacao;
    $("r-partiu").textContent = FONTES[rot.partiu_de.fonte] || rot.partiu_de.fonte;
    $("r-placas").textContent = rot.placas_de === "faixas"
      ? `faixas: ${descreverFaixas(rot.faixas)}`
      : rot.placas_de === "pacote" ? `as do levantamento (${rot.pacote})` : "as do gabarito";
    $("r-comentario").textContent = rot.comentario || "—";
    $("secao-faixas").hidden = rot.placas_de !== "faixas";
    if (rot.faixas) mostrarFaixas($, rot.faixas);
    $("comentario-dev").value = "";
    $("comentario-corr").value = "";
    $("situacao-corr").value = rot.situacao === "duvida" ? "ok" : rot.situacao;
    $("painel").hidden = false;
    $("vazio").hidden = true;
    modo("ver");
    tempo.zerar();
    atualizarLista();
    atual = { ...proximo, pessoa, pintura, pacote }; // só agora: a decisão vale para esta pintura, em nome de quem a abriu
  }

  const abrirProximo = () => carregar().catch((e) => mostrarVazio(mensagemDeErro(e)));

  async function enviar(decisao) {
    if (enviando || !atual || !pintor) return;
    if (ctx.pessoa() !== atual.pessoa) {
      await abrirProximo();
      $("erro").textContent = "A pessoa escolhida mudou em outra aba; esta é a fila dela.";
      return;
    }
    enviando = true;
    $("erro").textContent = "";
    const feito = atual;
    try {
      await salvarRevisaoOclusao(indice, feito.pessoa, feito.arquivo, { ...decisao, segundos_ativos: tempo.segundos() });
      atual = null;
      ctx.registrarCodigo(feito.pessoa);
      await abrirProximo();
    } catch (e) {
      if (e instanceof ForaDaFila) {
        await abrirProximo();
        $("erro").textContent = "Aquela pintura saiu da sua fila (outra pessoa revisou antes); esta é a próxima.";
      } else if (atual) {
        $("erro").textContent = mensagemDeErro(e);
      } else {
        mostrarVazio(`A revisão foi gravada, mas: ${mensagemDeErro(e)}`);
      }
    } finally {
      enviando = false;
    }
  }

  function voltar() {
    if (pintor && atual) {
      // volta a pintura e as faixas como estavam
      if (atual.rotulo.faixas) {
        mostrarFaixas($, atual.rotulo.faixas);
        pintor.trocarPlacas(placasDoRotulo(atual.rotulo, atual.pacote), { avisar: false });
      }
      pintor.definir(atual.pintura);
    }
    $("erro").textContent = "";
    modo("ver");
  }

  ligarFaixas(
    $,
    (faixas) => {
      $("erro").textContent = "";
      if (pintor && atual?.rotulo.placas_de === "faixas") pintor.trocarPlacas(placasDasFaixas(atual.rotulo.campo ?? atual.pacote.campo, faixas));
    },
    (erro) => { $("erro").textContent = erro; },
  );

  const aoTrocarPessoa = (e) => {
    if ((e.key === null || e.key === "anotacao.pessoa") && atual && ctx.pessoa() !== atual.pessoa) abrirProximo();
  };
  window.addEventListener("storage", aoTrocarPessoa);

  $("aprovar").onclick = () => enviar({ decisao: "aprovar" });
  $("devolver").onclick = () => modo("devolver");
  $("corrigir").onclick = () => modo("corrigir");
  $("enquadrar").onclick = () => {
    const caixa = pintor && caixaDasPlacas(pintor);
    if (caixa) pintor.enquadrar(...caixa);
  };
  for (const b of raiz.querySelectorAll("[data-voltar]")) b.onclick = voltar;
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
    if (!pintor || !atual) return;
    const sit = $("situacao-corr").value;
    const comentario = $("comentario-corr").value.trim();
    let faixas = null;
    if (atual.rotulo.placas_de === "faixas") {
      const lidas = lerFaixas($);
      if (lidas.erro) {
        $("erro").textContent = `${lidas.erro.charAt(0).toUpperCase()}${lidas.erro.slice(1)}.`;
        return;
      }
      faixas = lidas.faixas;
    }
    enviar({
      decisao: "corrigir",
      comentario,
      correcao: {
        faixas,
        placas3d: pintor.placas,
        pintura: sit === "ok" ? pintor.pintura : null,
        situacao: sit,
        comentario,
        segundos_ativos: tempo.segundos(),
      },
    });
  };

  const teclas = (e) => {
    if (!pintor || e.target.matches("textarea, input, select")) return;
    const corrigindo = !$("secao-corrigir").hidden;
    if (corrigindo && teclaDoPintor(e, pintor, ferramentas.mostrar)) return;
    if (e.type !== "keydown" || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "z") {
      $("enquadrar").click(); // vendo ou corrigindo
      return;
    }
    // vendo: só as camadas, a vista e as decisões
    if (corrigindo || !$("secao-devolver").hidden) return;
    if (k === "a") enviar({ decisao: "aprovar" });
    else if (k === "c") modo("corrigir");
    else if (k === "d") modo("devolver");
    else if (["h", "o", "m", "0", "+", "=", "-"].includes(k)) teclaDoPintor(e, pintor, ferramentas.mostrar);
  };
  window.addEventListener("keydown", teclas);
  window.addEventListener("keyup", teclas);

  await abrirProximo();
  const vigia = vigiar(ctx, () => !atual && !enviando && !$("vazio").hidden, abrirProximo);

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
