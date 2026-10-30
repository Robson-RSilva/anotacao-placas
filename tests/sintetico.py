"""Quadros e vídeos sintéticos para os testes: o campo e algumas "pessoas" desenhadas por câmeras
conhecidas — com a verdade de cada quadro (onde cai cada ponto do campo, e a máscara das pessoas)."""

from __future__ import annotations

import shutil
import struct
import subprocess
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from anotacao.campo import Campo, pontos_marcaveis


@dataclass
class Camera:
    """Pinhole simples (sem distorção): x ~ K R (X - C), com o ponto principal no centro."""

    f: float
    R: np.ndarray
    C: np.ndarray
    w: int
    h: int

    @classmethod
    def look_at(cls, C, alvo, hfov, w=640, h=360) -> Camera:
        C = np.asarray(C, float)
        frente = np.asarray(alvo, float) - C
        frente /= np.linalg.norm(frente)
        direita = np.cross(frente, [0.0, 0.0, 1.0])
        direita /= np.linalg.norm(direita)
        baixo = np.cross(frente, direita)
        f = (w / 2) / np.tan(np.radians(hfov) / 2)
        return cls(f, np.stack([direita, baixo, frente]), C, w, h)

    def project(self, X) -> tuple[np.ndarray, np.ndarray]:
        Xc = (np.atleast_2d(np.asarray(X, float)) - self.C) @ self.R.T
        z = Xc[:, 2]
        px = np.full((len(Xc), 2), np.nan)
        ok = z > 1e-3
        px[ok] = self.f * Xc[ok, :2] / z[ok, None] + [self.w / 2, self.h / 2]
        return px, z


#: As câmeras das tomadas do vídeo sintético: principal, atrás do gol e do outro lado.
PLANOS = [
    ((0.0, -58.0, 16.0), (-8.0, 0.0, 0.0), 40.0),
    ((-64.0, 4.0, 10.0), (-30.0, 0.0, 0.0), 46.0),
    ((6.0, 60.0, 14.0), (10.0, 0.0, 0.0), 42.0),
]

#: Onde ficam as "pessoas" (x, y no campo, em metros) e a cor da roupa (BGR).
PESSOAS = [
    (-14.0, 6.0, (40, 40, 220)),
    (-30.0, -8.0, (220, 220, 220)),
    (-40.0, 2.0, (40, 40, 220)),
    (4.0, -4.0, (220, 220, 220)),
]


def renderizar(cam: Camera, semente: int = 0, campo: Campo | None = None) -> tuple[np.ndarray, dict]:
    """O quadro e a verdade dele: {"pontos": {nome: (x, y)} dos que caem na imagem, "pessoas": a
    máscara (h, w) com 1 onde há pessoa}."""
    campo = campo or Campo()
    rng = np.random.default_rng(semente)
    img = np.empty((cam.h, cam.w, 3), np.uint8)
    img[:] = (45, 125, 50)
    img = np.clip(img.astype(np.int16) + rng.normal(0, 6, img.shape).astype(np.int16), 0, 255).astype(np.uint8)
    for el in campo.elementos:
        px, _ = cam.project(el.amostrar(0.1))
        pts = px[np.isfinite(px).all(1)]
        if len(pts) >= 2:
            cv2.polylines(img, [np.round(pts * 16).astype(np.int32)], False, (235, 235, 235), 2, cv2.LINE_AA, 4)
    mascara = np.zeros((cam.h, cam.w), np.uint8)
    for x, y, cor in PESSOAS:
        base, z = cam.project([[x, y, 0.0], [x, y, 1.8]])
        if not (np.isfinite(base).all() and (z > 1).all()):
            continue
        (bx, by), (tx, ty) = base
        altura = abs(by - ty)
        centro = (round((bx + tx) / 2), round((by + ty) / 2))
        eixos = (max(2, int(altura * 0.18)), max(3, int(altura / 2)))
        cv2.ellipse(img, centro, eixos, 0, 0, 360, cor, -1)
        cv2.ellipse(mascara, centro, eixos, 0, 0, 360, 1, -1)
    px, z = cam.project(campo.KP)
    pontos = {}
    for nome, (x, y), zz in zip(campo.nomes_pontos, px, z, strict=True):
        if nome in pontos_marcaveis() and np.isfinite(x) and 0 <= x <= cam.w and 0 <= y <= cam.h and zz > 0:
            pontos[nome] = (float(x), float(y))
    return img, {"pontos": pontos, "pessoas": mascara}


def cameras_de_tomadas(w: int, h: int) -> list[list[Camera]]:
    """Três tomadas de 2 s a 25 fps, de câmeras diferentes, com um pan lento."""
    tomadas = []
    for C, alvo, hfov in PLANOS:
        cams = []
        for k in range(50):
            a = np.array(alvo) + np.array([0.08 * k, 0.0, 0.0])
            cams.append(Camera.look_at(C, a, hfov, w, h))
        tomadas.append(cams)
    return tomadas


def gravar_quadros(destino: Path, w: int = 640, h: int = 360) -> list[dict]:
    """Grava os quadros do vídeo sintético em PNG (00000.png, …) e devolve a verdade de cada um."""
    destino.mkdir(parents=True, exist_ok=True)
    verdade = []
    for cams in cameras_de_tomadas(w, h):
        for cam in cams:
            img, v = renderizar(cam, semente=len(verdade))
            cv2.imwrite(str(destino / f"{len(verdade):05d}.png"), img)
            verdade.append(v)
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


def _caixas(dados: bytes | bytearray, ini: int, fim: int) -> Iterator[tuple[str, int, int, int]]:
    """Caixas de um trecho de MP4: (tipo, início, início do conteúdo, fim)."""
    pos = ini
    while pos + 8 <= fim:
        tam, tipo = struct.unpack(">I4s", dados[pos : pos + 8])
        cab = 8
        if tam == 1:
            (tam,) = struct.unpack(">Q", dados[pos + 8 : pos + 16])
            cab = 16
        elif tam == 0:
            tam = fim - pos
        yield tipo.decode("latin-1"), pos, pos + cab, pos + tam
        pos += tam


def marcar_chaves_falsas(origem: Path, destino: Path) -> tuple[list[int], list[int]]:
    """Copia o MP4 marcando como chave (stss) o quadro seguinte a cada quadro-chave, menos no segundo.

    O vídeo passa a começar numa chave falsa e só o segundo quadro-chave marcado é de verdade, como no
    MP4 de H.264 que marca como chave quadros I que não são IDR. Devolve as marcas antes e depois
    (números de amostra, a partir de 1).
    """
    dados = bytearray(origem.read_bytes())
    ini, fim = 0, len(dados)
    for tipo in ("moov", "trak", "mdia", "minf", "stbl", "stss"):
        _, _, ini, fim = next(c for c in _caixas(dados, ini, fim) if c[0] == tipo)
    (n,) = struct.unpack(">I", dados[ini + 4 : ini + 8])
    antes = list(struct.unpack(f">{n}I", dados[ini + 8 : ini + 8 + 4 * n]))
    depois = [e if k == 1 else e + 1 for k, e in enumerate(antes)]
    assert n >= 3 and not set(depois[:1] + depois[2:]) & set(antes), antes
    dados[ini + 8 : ini + 8 + 4 * n] = struct.pack(f">{n}I", *depois)
    destino.write_bytes(bytes(dados))
    return antes, depois
