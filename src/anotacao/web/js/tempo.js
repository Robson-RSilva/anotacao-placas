// Tempo ativo: conta só enquanto a página está visível e houve uso nos últimos 20 s.
// É o número que diz quanto custa cada lote, por isso não conta pausa.

export class TempoAtivo {
  constructor({ limite = 20, aoTique = () => {} } = {}) {
    this.limite = limite * 1000;
    this.aoTique = aoTique;
    this.total = 0;
    this.ultimo = performance.now();
    this._marcar = () => {
      this.ultimo = performance.now();
    };
    for (const ev of ["pointermove", "pointerdown", "keydown", "wheel"]) {
      window.addEventListener(ev, this._marcar, { passive: true });
    }
    this._relogio = setInterval(() => {
      if (document.visibilityState === "visible" && performance.now() - this.ultimo < this.limite) {
        this.total += 1;
        this.aoTique(this.total);
      }
    }, 1000);
  }

  zerar() {
    this.total = 0;
    this.ultimo = performance.now();
    this.aoTique(0);
  }

  segundos() {
    return this.total;
  }
}
