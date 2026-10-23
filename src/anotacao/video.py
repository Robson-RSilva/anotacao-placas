"""Leitura do vídeo: hash, relógio de cada quadro (PTS) e extração dos quadros sorteados.

O ID do quadro é o PTS em milissegundos, então extrair de novo o mesmo vídeo dá os mesmos IDs.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

Progresso = Callable[[float], None]


def sha256_arquivo(caminho: Path, bloco: int = 8 << 20, progresso: Progresso | None = None) -> str:
    h = hashlib.sha256()
    total = max(Path(caminho).stat().st_size, 1)
    lido = 0
    with open(caminho, "rb") as f:
        while chunk := f.read(bloco):
            h.update(chunk)
            lido += len(chunk)
            if progresso:
                progresso(lido / total)
    return h.hexdigest()


@dataclass
class InfoVideo:
    fps: float
    largura: int
    altura: int
    n_quadros: int
    duracao_s: float


def info_video(caminho: Path) -> InfoVideo:
    cap = cv2.VideoCapture(str(caminho))
    if not cap.isOpened():
        raise ValueError(f"não consegui abrir o vídeo: {caminho}")
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 25.0
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    finally:
        cap.release()
    return InfoVideo(fps, w, h, n, n / fps if fps > 0 else 0.0)


def percorrer(caminho: Path, tamanho: tuple[int, int] = (160, 90)) -> Iterator[tuple[int, float, np.ndarray]]:
    """Todos os quadros, em ordem: (índice, PTS em ms, quadro reduzido BGR).

    O PTS vem do decodificador (CAP_PROP_POS_MSEC). Se ele não andar (contêineres sem relógio), cai
    para índice / fps — e o manifesto registra qual dos dois foi usado.
    """
    cap = cv2.VideoCapture(str(caminho))
    if not cap.isOpened():
        raise ValueError(f"não consegui abrir o vídeo: {caminho}")
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 25.0
    i = 0
    try:
        while True:
            ok, quadro = cap.read()
            if not ok:
                break
            pts = float(cap.get(cv2.CAP_PROP_POS_MSEC))
            if not np.isfinite(pts) or pts < 0:
                pts = i * 1000.0 / fps
            yield i, pts, cv2.resize(quadro, tamanho, interpolation=cv2.INTER_AREA)
            i += 1
    finally:
        cap.release()


def corrigir_pts(pts: np.ndarray, fps: float) -> tuple[np.ndarray, str]:
    """PTS crescente garantido. Retorna (pts, fonte): 'decodificador' ou 'indice' quando não dá para confiar."""
    pts = np.asarray(pts, float)
    if len(pts) < 2:
        return np.arange(len(pts)) * 1000.0 / fps, "indice"
    ids = np.round(pts).astype(np.int64)
    if np.all(np.diff(ids) > 0):
        return pts, "decodificador"
    return np.arange(len(pts)) * 1000.0 / fps, "indice"


def extrair(
    caminho: Path, destinos: dict[int, Path], qualidade: int = 95, progresso: Progresso | None = None
) -> dict[int, tuple[int, int]]:
    """Grava em JPEG, na resolução original, os quadros cujos índices estão em `destinos`.

    Percorre o vídeo em ordem (grab sem decodificar a cor nos quadros que não interessam): é mais
    lento que pular direto, mas não depende de o contêiner saber buscar quadro exato.
    """
    if not destinos:
        return {}
    alvo = max(destinos)
    cap = cv2.VideoCapture(str(caminho))
    if not cap.isOpened():
        raise ValueError(f"não consegui abrir o vídeo: {caminho}")
    tamanhos: dict[int, tuple[int, int]] = {}
    i = 0
    try:
        while i <= alvo:
            if not cap.grab():
                break
            if i in destinos:
                ok, quadro = cap.retrieve()
                if ok:
                    destino = destinos[i]
                    destino.parent.mkdir(parents=True, exist_ok=True)
                    tmp = destino.with_name(f".{destino.name}.tmp.jpg")
                    if not cv2.imwrite(str(tmp), quadro, [cv2.IMWRITE_JPEG_QUALITY, qualidade]):
                        raise OSError(f"falha ao gravar {destino}")
                    tmp.replace(destino)
                    tamanhos[i] = (quadro.shape[1], quadro.shape[0])
                if progresso:
                    progresso(len(tamanhos) / len(destinos))
            i += 1
    finally:
        cap.release()
    faltando = set(destinos) - set(tamanhos)
    if faltando:
        raise ValueError(f"{len(faltando)} quadros sorteados não puderam ser extraídos (ex.: {min(faltando)})")
    return tamanhos
