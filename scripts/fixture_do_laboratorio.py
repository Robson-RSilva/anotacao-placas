"""Gera `tests/fixtures/campo_laboratorio.json` a partir do código do laboratório.

A ferramenta de anotação tem a sua própria cópia do campo (em Python e em JavaScript): os nomes dos
pontos que se marcam, o mapa da página e a simetria de 180 graus saem dela. Este arquivo congela o que
o laboratório calcula — elementos, amostras, pontos-chave e a permutação sob a rotação de 180 graus,
em dois tamanhos de campo — para que os testes das duas cópias falhem se qualquer uma divergir do
laboratório.

Uso (só quando o campo mudar no laboratório):

    python scripts/fixture_do_laboratorio.py --laboratorio ../placas-exposicao
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def _lista(a):
    a = np.asarray(a, float)
    return [None if not np.all(np.isfinite(v)) else [float(x) for x in v] for v in a]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--laboratorio", required=True, help="pasta do repositório do laboratório (placas-exposicao)")
    ap.add_argument("--saida", default="tests/fixtures/campo_laboratorio.json")
    args = ap.parse_args()

    sys.path.insert(0, str(Path(args.laboratorio) / "src"))
    from exposure.field.model import FieldModel

    campos = []
    for L, W in ((105.0, 68.0), (100.0, 64.0)):
        F = FieldModel(L=L, W=W)
        pe, pk = F.perm_rot180()
        elementos = []
        for e in F.elements:
            d = dict(nome=e.name, tipo=e.kind, grupo=e.group)
            if e.kind == "line":
                d.update(A=[float(v) for v in e.A], B=[float(v) for v in e.B])
            else:
                d.update(centro=[float(v) for v in e.center], raio=float(e.radius), a0=float(e.a0), a1=float(e.a1))
            d["amostras_1m"] = _lista(e.sample(1.0))
            elementos.append(d)
        pontos = [dict(nome=n, X=[float(v) for v in X], tipo=t) for n, (X, t) in F.keypoints.items()]
        campos.append(
            dict(
                L=L,
                W=W,
                elementos=elementos,
                pontos=pontos,
                perm180_elementos=[int(v) for v in pe],
                perm180_pontos=[int(v) for v in pk],
            )
        )

    saida = dict(
        descricao="Gerado por scripts/fixture_do_laboratorio.py com o código do laboratório; não editar à mão.",
        campos=campos,
    )
    Path(args.saida).parent.mkdir(parents=True, exist_ok=True)
    Path(args.saida).write_text(json.dumps(saida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{args.saida}: {len(campos)} campos")


if __name__ == "__main__":
    main()
