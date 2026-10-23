"""Gera `tests/fixtures/camera_laboratorio.json` a partir do código do laboratório.

A ferramenta de anotação tem a sua própria cópia do modelo de câmera e do campo (em Python e em
JavaScript). Este arquivo congela o que o laboratório calcula — projeções, ângulos, câmera
espelhada, lado canônico e a geometria do campo — para que os testes das duas cópias falhem se
qualquer uma divergir do laboratório.

Uso (só quando o modelo de câmera ou do campo mudar no laboratório):

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
    ap.add_argument("--saida", default="tests/fixtures/camera_laboratorio.json")
    args = ap.parse_args()

    sys.path.insert(0, str(Path(args.laboratorio) / "src"))
    from exposure.core.camera import Camera, mirror_camera
    from exposure.field.model import FieldModel, canonical_side

    rng = np.random.default_rng(20261023)
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

    F = FieldModel()
    X = np.vstack([F.KP] + [e.sample(2.0) for e in F.elements])
    registro = {
        "principal": (0.0, -58.0, 14.0),
        "16m_esq": (-36.0, -57.0, 13.0),
        "16m_dir": (36.0, -57.0, 13.0),
        "fundo_dir": (66.5, 0.0, 16.0),
        "reversa": (0.0, 54.0, 9.0),
    }
    casos = []
    for k in range(24):
        nome = list(registro)[k % len(registro)]
        C = np.array(registro[nome]) + rng.normal(0, 1.5, 3)
        alvo = np.array([rng.uniform(-45, 45), rng.uniform(-25, 25), 0.0])
        w, h = ((1920, 1080), (960, 540), (1280, 720))[k % 3]
        cam = Camera.look_at(
            C,
            alvo,
            rng.uniform(6, 60),
            w,
            h,
            roll=rng.uniform(-2, 2),
            k1=float(rng.choice([0.0, rng.uniform(-0.2, 0.08)])),
        )
        px, z = cam.project(X)
        pan, tilt, roll = cam.ptr
        esp = mirror_camera(cam)
        epan, etilt, eroll = esp.ptr
        casos.append(
            dict(
                camera=dict(
                    f=cam.f,
                    w=w,
                    h=h,
                    pan=pan,
                    tilt=tilt,
                    roll=roll,
                    C=[float(v) for v in cam.C],
                    k1=cam.k1,
                    hfov_graus=cam.hfov,
                ),
                R=[[float(v) for v in linha] for linha in cam.R],
                pixels=_lista(px),
                profundidade=[float(v) for v in z],
                espelhada=dict(pan=epan, tilt=etilt, roll=eroll, C=[float(v) for v in esp.C]),
                lado_canonico=bool(canonical_side(cam.C)),
            )
        )
    saida = dict(
        descricao="Gerado por scripts/fixture_do_laboratorio.py com o código do laboratório; não editar à mão.",
        pontos_3d=_lista(X),
        casos=casos,
        campos=campos,
    )
    Path(args.saida).parent.mkdir(parents=True, exist_ok=True)
    Path(args.saida).write_text(json.dumps(saida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{args.saida}: {len(casos)} câmeras x {len(X)} pontos, {len(campos)} campos")


if __name__ == "__main__":
    main()
