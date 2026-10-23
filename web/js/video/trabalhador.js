// Worker da importação: lê, decodifica e sorteia sem travar a página. Recebe a pasta (a alça da
// File System Access API, que pode ser passada para o worker), o arquivo de vídeo, o cadastro, o
// molde do campo e os trechos escolhidos.

import { carregarEsquemas } from "../nucleo/formatos.js";
import { Pasta } from "../nucleo/pasta.js";
import { importarVideo } from "./importar.js";

let controle = null;

self.onmessage = async (evento) => {
  const m = evento.data;
  if (m.tipo === "cancelar") {
    controle?.abort();
    return;
  }
  if (m.tipo !== "importar") return;
  controle = new AbortController();
  let ultimo = 0;
  try {
    await carregarEsquemas();
    const resultado = await importarVideo({
      pasta: new Pasta(m.raiz),
      arquivo: m.arquivo,
      cadastro: m.cadastro,
      pacote: m.pacote,
      trechos: m.trechos,
      alvo: m.alvo,
      sinal: controle.signal,
      aoProgresso: (etapa, frac) => {
        const agora = performance.now();
        if (frac >= 1 || frac === 0 || agora - ultimo > 250) {
          ultimo = agora;
          self.postMessage({ tipo: "progresso", etapa, frac });
        }
      },
    });
    self.postMessage({ tipo: "fim", resultado });
  } catch (erro) {
    self.postMessage({ tipo: "erro", nome: erro?.name || "Error", mensagem: erro?.message || String(erro) });
  }
};
