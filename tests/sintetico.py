"""Quadros e vídeos sintéticos para os testes: o molde do campo e as placas desenhados por câmeras conhecidas."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

from anotacao.camera import Camera
from anotacao.campo import Campo
from anotacao.formatos import PacoteEstadio

CORES_LADO = {"cab": (200, 120, 30), "opo": (40, 140, 230), "esq": (160, 60, 160), "dir": (120, 160, 40)}

#: Câmera do registro de cada tomada do vídeo sintético (para começar o molde perto da verdade).
REGISTRO_DA_TOMADA = {0: "principal", 1: "16m_dir", 2: "reversa"}


def renderizar(cam: Camera, campo: Campo, pacote: PacoteEstadio, semente: int = 0) -> np.ndarray:
    rng = np.random.default_rng(semente)
    img = np.empty((cam.h, cam.w, 3), np.uint8)
    img[:] = (45, 125, 50)
    img = np.clip(img.astype(np.int16) + rng.normal(0, 6, img.shape).astype(np.int16), 0, 255).astype(np.uint8)
    for placa in pacote.placas:
        V = np.asarray(placa.vertices, float)
        px, z = cam.project(V)
        if np.all(np.isfinite(px)) and np.all(z > 0.5):
            cor = CORES_LADO[placa.lado] if placa.tipo == "estatica" else (180, 40, 180)
            cv2.fillPoly(img, [np.round(px * 16).astype(np.int32)], cor, cv2.LINE_AA, 4)
    for el in campo.elementos:
        px, _ = cam.project(el.amostrar(0.1))
        ok = np.isfinite(px).all(1)
        pts = px[ok]
        if len(pts) < 2:
            continue
        cv2.polylines(img, [np.round(pts * 16).astype(np.int32)], False, (235, 235, 235), 2, cv2.LINE_AA, 4)
    return img


def cameras_de_tomadas(pacote: PacoteEstadio, w: int, h: int) -> list[list[Camera]]:
    """Três tomadas de 2 s a 25 fps, de câmeras diferentes, com um pan lento."""
    reg = {c.nome: np.asarray(c.T, float) for c in pacote.cameras}
    planos = [
        (reg["principal"], (-8.0, 0.0, 0.0), 38.0),
        (reg["16m_dir"], (40.0, 8.0, 0.0), 30.0),
        (reg["reversa"], (5.0, -5.0, 0.0), 42.0),
    ]
    tomadas = []
    for C, alvo, hfov in planos:
        cams = []
        for k in range(50):
            a = np.array(alvo) + np.array([0.08 * k, 0.0, 0.0])
            cams.append(Camera.look_at(C, a, hfov, w, h))
        tomadas.append(cams)
    return tomadas


def gravar_quadros(destino: Path, pacote: PacoteEstadio, w: int = 640, h: int = 360) -> list[Camera]:
    """Grava os quadros do vídeo sintético em PNG (00000.png, …) e devolve a câmera verdadeira de cada um."""
    campo = Campo(L=pacote.campo.comprimento, W=pacote.campo.largura)
    destino.mkdir(parents=True, exist_ok=True)
    verdade = []
    for cams in cameras_de_tomadas(pacote, w, h):
        for cam in cams:
            cv2.imwrite(str(destino / f"{len(verdade):05d}.png"), renderizar(cam, campo, pacote, semente=len(verdade)))
            verdade.append(cam)
    return verdade


def codificadores_ffmpeg() -> set[str]:
    if not shutil.which("ffmpeg"):
        return set()
    r = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, check=False)
    return {linha.split()[1] for linha in r.stdout.splitlines() if len(linha.split()) > 1 and linha.startswith(" V")}


def codificar(quadros: Path, saida: Path, fps: float = 25.0) -> Path:
    """MP4 com AV1 ou VP9 (o Chromium dos testes não decodifica H.264)."""
    disponiveis = codificadores_ffmpeg()
    opcoes = {
        "libsvtav1": ["-c:v", "libsvtav1", "-preset", "10", "-g", "25"],
        "libvpx-vp9": ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-g", "25", "-b:v", "2M"],
        "libaom-av1": ["-c:v", "libaom-av1", "-cpu-used", "8", "-g", "25", "-b:v", "2M"],
    }
    for nome, args in opcoes.items():
        if nome in disponiveis:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-v",
                    "error",
                    "-framerate",
                    str(fps),
                    "-i",
                    str(quadros / "%05d.png"),
                    *args,
                    "-pix_fmt",
                    "yuv420p",
                    str(saida),
                ],
                check=True,
            )
            return saida
    raise RuntimeError("o ffmpeg não tem codificador AV1 nem VP9")
