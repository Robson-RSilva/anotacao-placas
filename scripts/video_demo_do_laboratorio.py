"""Monta um vídeo MP4 de demonstração a partir de uma transmissão sintética do laboratório.

Serve para experimentar o fluxo inteiro (importar, anotar, revisar) antes do primeiro jogo real:

    python scripts/video_demo_do_laboratorio.py --transmissao ../placas-exposicao/data/transmissoes/bc_A_123.pkl \
        --saida demo_A_123.mp4

Depois, na página central, importe o vídeo com o pacote `estadio-sintetico/pacote-1.0`.
"""

from __future__ import annotations

import argparse
import pickle

import cv2
import numpy as np


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--transmissao", required=True, help="arquivo bc_*.pkl do laboratório")
    ap.add_argument("--saida", required=True)
    args = ap.parse_args()

    with open(args.transmissao, "rb") as f:  # arquivo gerado pelo próprio laboratório
        dados = pickle.load(f)
    quadros = dados["rendered"]["frames_jpg"]
    fps = float(dados["meta"]["fps"])
    primeiro = cv2.imdecode(np.frombuffer(quadros[0], np.uint8), cv2.IMREAD_COLOR)
    h, w = primeiro.shape[:2]
    vw = cv2.VideoWriter(args.saida, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    for jpg in quadros:
        vw.write(cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR))
    vw.release()
    print(f"{args.saida}: {len(quadros)} quadros, {w}x{h}, {fps:g} fps")


if __name__ == "__main__":
    main()
