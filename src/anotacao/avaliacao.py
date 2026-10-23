"""Medidas de qualidade dos rótulos, sempre em pixels na referência 960 (ADR-0001)."""

from __future__ import annotations

import numpy as np

from .camera import Camera
from .campo import Campo
from .convencoes import REF_W
from .formatos import CameraRotulo, PacoteEstadio, RotuloCamera
from .pacote import amostras_placas


def distancia_polilinha(p: np.ndarray, pts: np.ndarray) -> float:
    """Menor distância de um ponto a uma polilinha (trechos com NaN quebram a linha)."""
    p = np.asarray(p, float)
    a, b = pts[:-1], pts[1:]
    ok = np.isfinite(a).all(1) & np.isfinite(b).all(1)
    if not ok.any():
        fin = pts[np.isfinite(pts).all(1)]
        return float(np.min(np.linalg.norm(fin - p, axis=1))) if len(fin) else float("inf")
    a, b = a[ok], b[ok]
    ab = b - a
    t = np.clip(((p - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-12), 0.0, 1.0)
    return float(np.min(np.linalg.norm(a + t[:, None] * ab - p, axis=1)))


def residuos(rotulo: RotuloCamera, campo: Campo, w: int, h: int) -> list[float]:
    """Distância (ref. 960) de cada ponto e linha travados até o molde desenhado pela câmera do rótulo."""
    if rotulo.camera is None:
        return []
    cam = Camera.de_rotulo(rotulo.camera.model_dump(), w, h)
    escala = REF_W / w
    out = []
    for pino in rotulo.pontos_travados:
        px, _ = cam.project(campo.ponto(pino.ponto))
        d = float(np.linalg.norm(px[0] - (pino.x, pino.y))) if np.isfinite(px).all() else float("inf")
        out.append(d * escala)
    for pino in rotulo.linhas_travadas:
        px, _ = cam.project(campo.elemento(pino.elemento).amostrar(0.25))
        out.append(distancia_polilinha(np.array([pino.x, pino.y]), px) * escala)
    return out


def residuo_mediano(rotulo: RotuloCamera, campo: Campo, w: int, h: int) -> float | None:
    r = [v for v in residuos(rotulo, campo, w, h) if np.isfinite(v)]
    return float(np.median(r)) if r else None


def distancia_cameras(
    a: CameraRotulo, b: CameraRotulo, pacote: PacoteEstadio, campo: Campo, w: int, h: int
) -> tuple[float, float] | None:
    """Mediana e p90 da distância (ref. 960) entre as placas desenhadas pelas duas câmeras.

    Usa os pontos das placas que a câmera `a` põe dentro da imagem; sem placas no quadro, usa as
    marcações do campo. Devolve None quando nem isso aparece.
    """
    ca = Camera.de_rotulo(a.model_dump(), w, h)
    cb = Camera.de_rotulo(b.model_dump(), w, h)
    for P in (amostras_placas(pacote), np.vstack([e.amostrar(1.0) for e in campo.elementos])):
        if len(P) == 0:
            continue
        pa, _ = ca.project(P)
        pb, _ = cb.project(P)
        vis = ca.in_image(pa) & np.isfinite(pb).all(1)
        if vis.sum() >= 4:
            d = np.linalg.norm(pa[vis] - pb[vis], axis=1) * (REF_W / w)
            return float(np.median(d)), float(np.percentile(d, 90))
    return None
