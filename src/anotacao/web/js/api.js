// Pedidos ao servidor local. Pedidos que gravam levam o cabeçalho X-Anotacao (ver servidor.py).

function mensagem(dados, resposta) {
  if (dados && dados.detail) {
    if (Array.isArray(dados.detail)) return dados.detail.map((d) => d.msg || String(d)).join("; ");
    return String(dados.detail);
  }
  return `${resposta.status} ${resposta.statusText}`;
}

async function pedir(metodo, url, corpo) {
  const opcoes = { method: metodo, headers: {} };
  if (metodo !== "GET") opcoes.headers["X-Anotacao"] = "1";
  if (corpo !== undefined) {
    opcoes.headers["Content-Type"] = "application/json";
    opcoes.body = JSON.stringify(corpo);
  }
  const r = await fetch(url, opcoes);
  const texto = await r.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }
  if (!r.ok) throw new Error(mensagem(dados, r));
  return dados;
}

export const api = {
  get: (url) => pedir("GET", url),
  post: (url, corpo) => pedir("POST", url, corpo),
};

/** Envia um arquivo grande no corpo do pedido (PUT), com progresso de 0 a 1. */
export function enviarArquivo(url, arquivo, aoProgresso = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("X-Anotacao", "1");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgresso(e.loaded / e.total);
    };
    xhr.onload = () => {
      let dados = null;
      try {
        dados = JSON.parse(xhr.responseText);
      } catch {
        dados = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(dados);
      else reject(new Error(mensagem(dados, { status: xhr.status, statusText: xhr.statusText })));
    };
    xhr.onerror = () => reject(new Error("falha de rede ao enviar o vídeo"));
    xhr.send(arquivo);
  });
}

export function carregarImagem(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`não consegui carregar a imagem ${url}`));
    img.src = url;
  });
}

export function el(id) {
  return document.getElementById(id);
}

export function formatarTempo(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function numero(v, casas = 1) {
  return v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas });
}
