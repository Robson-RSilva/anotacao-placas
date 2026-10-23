// Trabalho offline: rede primeiro (com internet, sempre a versão mais nova do site) e a cópia guardada
// quando não há rede. Só os arquivos do próprio site passam por aqui: os dados de anotação ficam na
// pasta de trabalho e nunca vão para a rede.

const CACHE = "anotacao-site";

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const r = await fetch("./arquivos.json", { cache: "no-cache" });
        if (r.ok) await cache.addAll((await r.json()).arquivos);
      } catch {
        // sem a lista (desenvolvimento local): guarda o que for sendo usado
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (evento) => evento.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET" || new URL(pedido.url).origin !== self.location.origin) return;
  evento.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const resposta = await fetch(pedido.mode === "navigate" ? pedido.url : pedido, { cache: "no-cache" });
        if (resposta.ok && resposta.type === "basic") cache.put(pedido, resposta.clone());
        return resposta;
      } catch (erro) {
        const guardada = await cache.match(pedido, { ignoreSearch: true });
        if (guardada) return guardada;
        throw erro;
      }
    })(),
  );
});
