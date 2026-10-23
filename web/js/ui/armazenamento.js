// Onde a pasta de trabalho fica: uma pasta escolhida no computador (File System Access API, Chrome
// e Edge) ou o armazenamento do próprio navegador (Origin Private File System). A escolha é
// lembrada no IndexedDB deste navegador; a permissão para a pasta o navegador pede de novo quando
// precisa (um clique).

const BANCO = "anotacao";
const LOJA = "config";
const CHAVE = "pasta";

function abrirBanco() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(LOJA);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function operar(modo, fn) {
  const db = await abrirBanco();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(LOJA, modo);
      const pedido = fn(t.objectStore(LOJA));
      t.oncomplete = () => resolve(pedido?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const suportaPasta = typeof window !== "undefined" && "showDirectoryPicker" in window;
export const suportaNavegador = typeof navigator !== "undefined" && Boolean(navigator.storage?.getDirectory);

/** A pasta lembrada: {alca, modo} ou null. */
export async function lembrada() {
  try {
    return (await operar("readonly", (s) => s.get(CHAVE))) ?? null;
  } catch {
    return null;
  }
}

async function lembrar(alca, modo) {
  try {
    await operar("readwrite", (s) => s.put({ alca, modo }, CHAVE));
  } catch {
    // sem IndexedDB: funciona, só não lembra da próxima vez
  }
}

export async function esquecer() {
  try {
    await operar("readwrite", (s) => s.delete(CHAVE));
  } catch {
    // nada a fazer
  }
}

/** A permissão de leitura e escrita já está dada (sem pedir)? */
export async function temPermissao(alca) {
  if (!alca.queryPermission) return true;
  return (await alca.queryPermission({ mode: "readwrite" })) === "granted";
}

/** Pede a permissão (precisa vir de um clique). */
export async function pedirPermissao(alca) {
  if (!alca.requestPermission) return true;
  return (await alca.requestPermission({ mode: "readwrite" })) === "granted";
}

/** Abre o seletor de pastas do sistema. */
export async function escolherPasta() {
  const alca = await window.showDirectoryPicker({ id: "anotacao-trabalho", mode: "readwrite", startIn: "documents" });
  if (!(await pedirPermissao(alca))) throw Object.assign(new Error("permissão negada"), { name: "NotAllowedError" });
  await lembrar(alca, "pasta");
  return { alca, modo: "pasta" };
}

/** A pasta de trabalho dentro do armazenamento do navegador. */
export async function pastaDoNavegador() {
  const raiz = await navigator.storage.getDirectory();
  const alca = await raiz.getDirectoryHandle("trabalho", { create: true });
  try {
    await navigator.storage.persist?.(); // pede para o navegador não apagar sozinho quando faltar espaço
  } catch {
    // o navegador decide
  }
  await lembrar(alca, "navegador");
  return { alca, modo: "navegador" };
}

/** Espaço usado e disponível neste navegador (só faz sentido no modo "navegador"). */
export async function espaco() {
  try {
    const e = await navigator.storage.estimate();
    const persistente = (await navigator.storage.persisted?.()) ?? false;
    return { usado: e.usage ?? 0, total: e.quota ?? 0, persistente };
  } catch {
    return null;
  }
}
