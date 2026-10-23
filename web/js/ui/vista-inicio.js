// Vista inicial: escolher onde fica a pasta de trabalho (ou continuar na de antes).

import * as armazenamento from "./armazenamento.js";
import { el, mensagemDeErro } from "./util.js";

export async function montar(raiz, ctx) {
  const erro = (e) => {
    if (e?.name === "AbortError") return; // fechou o seletor sem escolher
    el("erro-inicio", raiz).textContent = mensagemDeErro(e);
  };
  const entrar = (escolha) => {
    ctx.usar(escolha);
    ctx.ir("#/");
  };

  if (ctx.lembrada) {
    el("continuar", raiz).hidden = false;
    el("nome-anterior", raiz).textContent = ctx.lembrada.modo === "navegador" ? "o armazenamento deste navegador" : `a pasta «${ctx.lembrada.alca.name}»`;
    el("btn-continuar", raiz).onclick = async () => {
      try {
        if (await armazenamento.pedirPermissao(ctx.lembrada.alca)) entrar(ctx.lembrada);
        else erro({ name: "NotAllowedError" });
      } catch (e) {
        erro(e);
      }
    };
  }

  const escolher = el("btn-escolher", raiz);
  if (!armazenamento.suportaPasta) {
    escolher.disabled = true;
    el("aviso-pasta", raiz).hidden = false;
  }
  escolher.onclick = async () => {
    try {
      entrar(await armazenamento.escolherPasta());
    } catch (e) {
      erro(e);
    }
  };

  const navegador = el("btn-navegador", raiz);
  navegador.disabled = !armazenamento.suportaNavegador;
  navegador.onclick = async () => {
    try {
      entrar(await armazenamento.pastaDoNavegador());
    } catch (e) {
      erro(e);
    }
  };
}
