// Uma página parada, sem nada a fazer, confere de tempos em tempos se chegou algo novo — o rótulo ou a
// revisão de outra pessoa, que o Drive trouxe do computador dela — e confere na hora em que a pessoa
// volta para a aba. Nada é recarregado no meio do trabalho: só enquanto `ativa()` diz que dá.

/**
 * Chama `conferir()` a cada `ctx.intervaloAtualizar` ms, enquanto a aba está à vista e `ativa()` é
 * verdadeiro, e logo que a pessoa volta para a aba. Devolve {parar}.
 */
export function vigiar(ctx, ativa, conferir) {
  let relogio = null;
  let ocupado = false;
  let parado = false;
  const rodar = async () => {
    if (parado || ocupado || document.visibilityState !== "visible" || !ativa()) return;
    ocupado = true;
    try {
      await conferir();
    } catch {
      // a pasta pode estar no meio de uma sincronização: a próxima conferida vê de novo
    } finally {
      ocupado = false;
    }
  };
  const agendar = () => {
    clearTimeout(relogio);
    if (!parado) relogio = setTimeout(() => rodar().finally(agendar), ctx.intervaloAtualizar);
  };
  const aoVoltar = () => {
    if (document.visibilityState === "visible") rodar();
  };
  window.addEventListener("focus", aoVoltar);
  document.addEventListener("visibilitychange", aoVoltar);
  agendar();
  return {
    parar() {
      parado = true;
      clearTimeout(relogio);
      window.removeEventListener("focus", aoVoltar);
      document.removeEventListener("visibilitychange", aoVoltar);
    },
  };
}
