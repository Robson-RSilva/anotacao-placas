"""Atualiza os arquivos que saem das definições em Python (ver `anotacao.geracao`).

    python scripts/gerar_arquivos_web.py

Rode depois de mudar um formato (`formatos.py`), as convenções ou o pacote do estádio sintético.
"""

from __future__ import annotations

from pathlib import Path

from anotacao.geracao import gravar


def main() -> None:
    raiz = Path(__file__).resolve().parents[1]
    mudados = gravar(raiz)
    for p in mudados:
        print(p.relative_to(raiz))
    print(f"{len(mudados)} arquivo(s) atualizado(s)")


if __name__ == "__main__":
    main()
