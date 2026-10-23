// Utilidades das páginas: elementos, números, imagens, downloads e mensagens de erro em português.

export function el(id, raiz = document) {
  return raiz.querySelector(`#${id}`);
}

export function formatarTempo(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function numero(v, casas = 1) {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas });
}

export function carregarImagem(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("não consegui abrir a imagem do quadro"));
    img.src = url;
  });
}

/** Imagem de um arquivo da pasta (File/Blob), com a URL para soltar depois. */
export async function imagemDoArquivo(arquivo) {
  const url = URL.createObjectURL(arquivo);
  try {
    return { img: await carregarImagem(url), url };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Oferece um Blob para baixar com o nome dado. */
export function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function celula(texto, classe = "") {
  const td = document.createElement("td");
  td.textContent = texto;
  if (classe) td.className = classe;
  return td;
}

export function linhaVazia(tbody, colunas, texto) {
  const tr = document.createElement("tr");
  const td = celula(texto, "sutil");
  td.colSpan = colunas;
  tr.append(td);
  tbody.append(tr);
}

/** Mensagem de erro para gente: traduz os erros do navegador mais comuns. */
export function mensagemDeErro(e) {
  if (!e) return "erro desconhecido";
  switch (e.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "o navegador não deu permissão para usar a pasta; volte à página central e permita de novo";
    case "QuotaExceededError":
      return "acabou o espaço de armazenamento deste navegador; baixe uma cópia em .zip e libere espaço";
    case "NotReadableError":
      return "não consegui ler o arquivo (ele foi movido, apagado ou ainda está sincronizando?)";
    case "InvalidStateError":
      return "a pasta mudou enquanto a página lia; tente de novo";
    case "AbortError":
      return "cancelado";
    default:
      return e.message || String(e);
  }
}

/** Data e hora para nomes de arquivo: 20261103-1405. */
export function carimbo(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Guarda e lê preferências desta pessoa neste navegador (sem quebrar quando o armazenamento falha). */
export const local = {
  ler(chave, padrao = null) {
    try {
      const v = localStorage.getItem(`anotacao.${chave}`);
      return v === null ? padrao : v;
    } catch {
      return padrao;
    }
  },
  gravar(chave, valor) {
    try {
      if (valor === null || valor === undefined) localStorage.removeItem(`anotacao.${chave}`);
      else localStorage.setItem(`anotacao.${chave}`, String(valor));
    } catch {
      // modo privado ou armazenamento bloqueado: só não lembra
    }
  },
};
