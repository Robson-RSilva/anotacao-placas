// Aplicativo de uma página só: escolhe a pasta de trabalho e troca de vista pelo endereço
// (#/, #/camera, #/revisao, #/importar, #/coordenacao). Uma página só porque a permissão da pasta
// vale para a aba aberta: trocar de vista não pede de novo.

import { RE_DISPOSITIVO, VERSAO, codigoPessoa } from "../nucleo/convencoes.js";
import { carregarEsquemas } from "../nucleo/formatos.js";
import { Indice } from "../nucleo/indice.js";
import { Pasta } from "../nucleo/pasta.js";
import * as armazenamento from "./armazenamento.js";
import { local, mensagemDeErro } from "./util.js";
import * as camera from "./vista-camera.js";
import * as central from "./vista-central.js";
import * as coordenacao from "./vista-coordenacao.js";
import * as importar from "./vista-importar.js";
import * as inicio from "./vista-inicio.js";
import * as revisao from "./vista-revisao.js";

const ROTAS = { "": ["central", central], camera: ["camera", camera], revisao: ["revisao", revisao], importar: ["importar", importar], coordenacao: ["coordenacao", coordenacao] };

/** O que as vistas compartilham: a pasta, o índice, quem está anotando e a importação em curso. */
const ctx = {
  versao: VERSAO,
  pasta: null,
  indice: null,
  modo: null,
  lembrada: null,
  importacao: null, // {worker, etapa, frac, resultado, erro, ouvintes:Set}
  /** De quanto em quanto tempo (ms) uma página parada, sem nada a fazer, confere se chegou algo (de outro computador). */
  intervaloAtualizar: 15_000,

  usar({ alca, modo }) {
    this.pasta = new Pasta(alca);
    this.indice = new Indice(this.pasta);
    this.modo = modo;
    this.lembrada = { alca, modo };
  },

  async trocarPasta() {
    if (this.importacao?.worker && !confirm("Uma importação está em andamento e será cancelada. Trocar de pasta mesmo assim?")) return;
    this.importacao?.worker?.terminate();
    this.importacao = null;
    await armazenamento.esquecer();
    this.pasta = null;
    this.indice = null;
    this.modo = null;
    this.lembrada = null;
    if (location.hash && location.hash !== "#/") location.hash = "#/";
    else await rotear();
  },

  /** O código de quem está anotando neste navegador (ou null). */
  pessoa() {
    return codigoPessoa(local.ler("pessoa"));
  },

  definirPessoa(codigo) {
    local.gravar("pessoa", codigo || null);
  },

  /** Este navegador: um identificador aleatório, guardado nele (o mesmo em todas as abas). */
  dispositivo() {
    if (!this._dispositivo) {
      let id = local.ler("dispositivo");
      if (!RE_DISPOSITIVO.test(id ?? "")) {
        id = crypto.randomUUID();
        local.gravar("dispositivo", id);
      }
      this._dispositivo = id;
    }
    return this._dispositivo;
  },

  /** Registra, uma vez, que o código é usado neste navegador (sem atrapalhar quem anota se falhar). */
  async registrarCodigo(codigo) {
    if (!this.pasta || !codigo) return;
    try {
      await this.pasta.registrarDispositivo(codigo, this.dispositivo());
    } catch {
      // a pasta ainda sincronizando, por exemplo: tenta de novo na próxima vez
    }
  },

  /** Os outros navegadores em que o código já foi usado: [{dispositivo, criado_em}]. */
  async outrosComputadores(codigo) {
    if (!this.pasta || !codigo) return [];
    const meu = this.dispositivo();
    return (await this.pasta.dispositivosDoCodigo(codigo)).filter((d) => d.dispositivo !== meu);
  },

  /** A pessoa disse que o código usado em outro computador é ela mesma. */
  codigoConfirmado(codigo) {
    return local.ler(`codigo-confirmado.${codigo}`) === "1";
  },

  confirmarCodigo(codigo) {
    local.gravar(`codigo-confirmado.${codigo}`, "1");
  },

  ir(hash) {
    if (location.hash === hash) rotear();
    else location.hash = hash;
  },
};

let atual = null;
let rodando = Promise.resolve();

async function mostrar(nome, modulo) {
  if (atual?.desmontar) {
    try {
      await atual.desmontar();
    } catch (e) {
      console.error(e);
    }
  }
  atual = null;
  const raiz = document.getElementById("app");
  raiz.replaceChildren(document.getElementById(`tpl-${nome}`).content.cloneNode(true));
  for (const v of raiz.querySelectorAll("[data-versao]")) v.textContent = `v${VERSAO}`;
  document.body.className = modulo.CLASSE ?? "pagina-central";
  window.scrollTo(0, 0);
  atual = (await modulo.montar(raiz, ctx)) ?? null;
}

function rotear() {
  rodando = rodando.then(async () => {
    const nome = location.hash.replace(/^#\/?/, "").split(/[?/]/)[0];
    try {
      if (!ctx.pasta) await mostrar("inicio", inicio);
      else {
        const [tpl, modulo] = ROTAS[nome] ?? ROTAS[""];
        await mostrar(tpl, modulo);
      }
    } catch (e) {
      console.error(e);
      mostrarErroGeral(mensagemDeErro(e));
    }
  });
  return rodando;
}

function mostrarErroGeral(texto) {
  let barra = document.getElementById("erro-geral");
  if (!barra) {
    barra = document.createElement("p");
    barra.id = "erro-geral";
    barra.className = "erro-geral";
    barra.setAttribute("role", "alert");
    document.body.prepend(barra);
  }
  barra.textContent = texto;
  barra.hidden = !texto;
}

async function registrarServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext || local.ler("sem-sw")) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (e) {
    console.warn("sem trabalho offline:", e);
  }
}

window.addEventListener("beforeunload", (e) => {
  if (ctx.importacao?.worker) {
    e.preventDefault();
    e.returnValue = "";
  }
});

window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  mostrarErroGeral(mensagemDeErro(e.reason));
});

async function iniciar() {
  registrarServiceWorker();
  try {
    await carregarEsquemas();
  } catch (e) {
    mostrarErroGeral(`não consegui carregar os formatos dos arquivos: ${mensagemDeErro(e)}`);
    return;
  }
  const lemb = await armazenamento.lembrada();
  ctx.lembrada = lemb;
  if (lemb) {
    try {
      if (await armazenamento.temPermissao(lemb.alca)) ctx.usar(lemb);
    } catch {
      // a pasta sumiu ou o navegador esqueceu: a vista inicial pede de novo
    }
  }
  window.addEventListener("hashchange", rotear);
  await rotear();
}

window.anotacao = ctx; // ajuda a depurar e a testar
iniciar();
