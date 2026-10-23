"""Monta um vídeo MP4 (H.264) de demonstração a partir de uma transmissão sintética do laboratório.

Serve para experimentar o fluxo inteiro (importar, anotar, revisar) antes do primeiro jogo real:

    python scripts/video_demo_do_laboratorio.py --transmissao ../placas-exposicao/data/transmissoes/bc_A_123.pkl \
        --saida demo_A_123.mp4

Precisa do ffmpeg. Depois, na página de importação, use o pacote `estadio-sintetico/pacote-1.0`.
"""

from __future__ import annotations

import argparse
import pickle
import shutil
import subprocess

import cv2
import numpy as np


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--transmissao", required=True, help="arquivo bc_*.pkl do laboratório")
    ap.add_argument("--saida", required=True)
    args = ap.parse_args()
    if not shutil.which("ffmpeg"):
        raise SystemExit("precisa do ffmpeg no PATH")

    with open(args.transmissao, "rb") as f:  # arquivo gerado pelo próprio laboratório
        dados = pickle.load(f)
    quadros = dados["rendered"]["frames_jpg"]
    fps = float(dados["meta"]["fps"])
    primeiro = cv2.imdecode(np.frombuffer(quadros[0], np.uint8), cv2.IMREAD_COLOR)
    h, w = primeiro.shape[:2]
    cmd = [
        "ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", f"{fps:g}",
        "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", args.saida,
    ]  # fmt: skip
    with subprocess.Popen(cmd, stdin=subprocess.PIPE) as proc:
        for jpg in quadros:
            proc.stdin.write(cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR).tobytes())
        proc.stdin.close()
    if proc.returncode:
        raise SystemExit(f"o ffmpeg falhou ({proc.returncode})")
    print(f"{args.saida}: {len(quadros)} quadros, {w}x{h}, {fps:g} fps")


if __name__ == "__main__":
    main()
