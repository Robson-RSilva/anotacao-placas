"""Monta o site publicado no GitHub Pages: copia `web/` e grava `arquivos.json`.

    python scripts/montar_site.py _site

`arquivos.json` lista os arquivos do site (o service worker guarda todos para funcionar sem
internet) e diz a versão e o commit publicados. Só usa a biblioteca padrão.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]


def versao() -> str:
    texto = (RAIZ / "web" / "js" / "nucleo" / "convencoes.js").read_text(encoding="utf-8")
    m = re.search(r'export const VERSAO = "([^"]+)"', texto)
    if not m:
        raise SystemExit("não achei VERSAO em convencoes.js")
    return m.group(1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("destino")
    args = ap.parse_args()
    destino = Path(args.destino)
    if destino.exists():
        shutil.rmtree(destino)
    shutil.copytree(RAIZ / "web", destino)
    arquivos = sorted(p.relative_to(destino).as_posix() for p in destino.rglob("*") if p.is_file())
    arquivos = ["./", *(a for a in arquivos if a != "sw.js")]
    info = {"versao": versao(), "commit": os.environ.get("GITHUB_SHA", "")[:12], "arquivos": arquivos}
    (destino / "arquivos.json").write_text(json.dumps(info, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{destino}: {len(arquivos)} arquivos, versão {info['versao']}")


if __name__ == "__main__":
    main()
