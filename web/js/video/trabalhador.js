// Worker da importação e das previsões: lê, decodifica, sorteia e roda o detector sem travar a página.
// Recebe a pasta (a alça da File System Access API, que pode ser passada para o worker) e o que fazer:
// "importar" (o arquivo de vídeo, o cadastro, os trechos, o conjunto e o modelo da detecção) ou "prever"
// (as previsões de uma partida já importada, pelo botão da página da partida).

import { carregarEsquemas } from "../nucleo/formatos.js";
import { Pasta } from "../nucleo/pasta.js";
import { importarVideo } from "./importar.js";
import { preverPartida } from "./previsao.js";

let controle = null;

self.onmessage = async (evento) => {
  const m = evento.data;
  if (m.tipo === "cancelar") {
    controle?.abort();
    return;
  }
  if (m.tipo !== "importar" && m.tipo !== "prever") return;
  controle = new AbortController();
  let ultimo = 0;
  const aoProgresso = (etapa, frac) => {
    const agora = performance.now();
    if (frac >= 1 || frac === 0 || agora - ultimo > 250) {
      ultimo = agora;
      self.postMessage({ tipo: "progresso", etapa, frac });
    }
  };
  try {
    await carregarEsquemas();
    const pasta = new Pasta(m.raiz);
    const resultado =
      m.tipo === "importar"
        ? await importarVideo({
            pasta,
            arquivo: m.arquivo,
            cadastro: m.cadastro,
            trechos: m.trechos,
            alvo: m.alvo,
            conjunto: m.conjunto ?? "treino",
            modelo: m.modelo ?? null,
            substituir: Boolean(m.substituir),
            sinal: controle.signal,
            aoProgresso,
          })
        : await preverPartida({ pasta, partida: m.partida, modelo: m.modelo, sinal: controle.signal, aoProgresso });
    self.postMessage({ tipo: "fim", resultado });
  } catch (erro) {
    self.postMessage({
      tipo: "erro",
      nome: erro?.name || "Error",
      mensagem: erro?.message || String(erro),
      podeSubstituir: Boolean(erro?.podeSubstituir),
    });
  }
};
