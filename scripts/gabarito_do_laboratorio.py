"""Gera itens do gabarito com o simulador do laboratório: quadros com a câmera exata.

Cada item vira `g0001.jpg` + `g0001.json` (formato gabarito.camera/1), prontos para
`anotacao gabarito <saida> --pasta <trabalho>`. O estádio é o sintético do laboratório, o mesmo do
pacote `estadio-sintetico/pacote-1.0` criado por `anotacao exemplo`.

    python scripts/gabarito_do_laboratorio.py --laboratorio ../placas-exposicao --saida gabarito-sintetico --n 50
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--laboratorio", required=True, help="pasta do repositório do laboratório (placas-exposicao)")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--semente", type=int, default=50_000)
    ap.add_argument("--largura", type=int, default=1280)
    ap.add_argument("--altura", type=int, default=720)
    ap.add_argument("--dominio", default="A", help="A (dia) ou B (noite, outro gramado)")
    ap.add_argument("--pacote", default="estadio-sintetico/pacote-1.0")
    args = ap.parse_args()

    sys.path.insert(0, str(Path(args.laboratorio) / "src"))
    from exposure.assets.boards import default_stadium
    from exposure.core.camera import hfov_from_f
    from exposure.field.model import FieldModel
    from exposure.sim.render import Renderer
    from exposure.sim.scene import sample_scene

    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)
    F = FieldModel()
    renderizador = Renderer(2)
    for k in range(args.n):
        semente = args.semente + k
        rng = np.random.default_rng(semente)
        cena = sample_scene(
            rng, args.dominio, args.largura, args.altura, F, stadium=default_stadium(F.L, F.W, double_led_opo=False)
        )
        img, gt = renderizador.render(cena)
        c = gt["cam"]
        item = f"g{k + 1:04d}"
        cv2.imwrite(str(saida / f"{item}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        (saida / f"{item}.json").write_text(
            json.dumps(
                {
                    "formato": "gabarito.camera/1",
                    "id": item,
                    "pacote": args.pacote,
                    "imagem": f"{item}.jpg",
                    "largura": args.largura,
                    "altura": args.altura,
                    "camera": {
                        "hfov_graus": hfov_from_f(c["f"], c["w"]),
                        "pan": c["pan"],
                        "tilt": c["tilt"],
                        "roll": c["roll"],
                        "C": [c["Cx"], c["Cy"], c["Cz"]],
                        "k1": c["k1"],
                    },
                    "origem": "simulador",
                    "observacao": (
                        f"laboratório, domínio {args.dominio}, semente {semente}, câmera {cena.cam.meta.get('kind')}"
                    ),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"{item}: {cena.cam.meta.get('kind')}, hfov {hfov_from_f(c['f'], c['w']):.1f}°")


if __name__ == "__main__":
    main()
