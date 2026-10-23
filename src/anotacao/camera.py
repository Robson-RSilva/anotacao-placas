"""Modelo de câmera de transmissão — o mesmo do laboratório (ADR-0001).

Pinhole com distorção radial em coordenadas normalizadas:

    X_c = R (X - C);   n = (X_c, Y_c) / Z_c;   n_d = n (1 + k1 r² + k2 r⁴);   x = f n_d + c

* Mundo: origem no centro do gramado, x ao longo do comprimento, y ao longo da largura, z para
  cima, metros.
* Linhas de R (mundo -> câmera): direita, baixo e eixo óptico (frente).
* Ângulos em graus: pan = azimute do eixo óptico medido de +y para +x; tilt = depressão abaixo do
  horizonte (positivo olha para baixo); roll = rotação em torno do eixo óptico.

Há um espelho em JavaScript (`web/js/camera.js`). Os dois são comparados com o laboratório pelos
testes, com `tests/fixtures/camera_laboratorio.json`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

#: Rotação de 180 graus em torno de z (a simetria do campo), como diagonal.
ESPELHO = np.array([-1.0, -1.0, 1.0])


def rot_from_ptr(pan: float, tilt: float, roll: float = 0.0) -> np.ndarray:
    """(pan, tilt, roll) em graus -> R (mundo -> câmera)."""
    ph, th, ga = np.radians([pan, tilt, roll])
    f = np.array([np.sin(ph) * np.cos(th), np.cos(ph) * np.cos(th), -np.sin(th)])
    r0 = np.array([np.cos(ph), -np.sin(ph), 0.0])
    d0 = np.cross(f, r0)
    r = np.cos(ga) * r0 + np.sin(ga) * d0
    d = -np.sin(ga) * r0 + np.cos(ga) * d0
    return np.stack([r, d, f])


def ptr_from_rot(R: np.ndarray) -> tuple[float, float, float]:
    """R -> (pan, tilt, roll) em graus (inverso de `rot_from_ptr`)."""
    f = R[2]
    th = np.arcsin(np.clip(-f[2], -1.0, 1.0))
    ph = np.arctan2(f[0], f[1])
    r0 = np.array([np.cos(ph), -np.sin(ph), 0.0])
    d0 = np.cross(f, r0)
    ga = np.arctan2(R[0] @ d0, R[0] @ r0)
    pan, tilt, roll = np.degrees([ph, th, ga])
    return float(pan), float(tilt), float(roll)


def f_from_hfov(hfov_deg: float, w: float) -> float:
    return float((w / 2.0) / np.tan(np.radians(hfov_deg) / 2.0))


def hfov_from_f(f: float, w: float) -> float:
    return float(np.degrees(2.0 * np.arctan((w / 2.0) / f)))


def distort_normalized(n: np.ndarray, k1: float, k2: float = 0.0) -> np.ndarray:
    r2 = (n**2).sum(-1, keepdims=True)
    return n * (1.0 + k1 * r2 + k2 * r2**2)


def distortion_valid_radius(k1: float, k2: float = 0.0) -> float:
    """Maior raio normalizado em que r (1 + k1 r² + k2 r⁴) ainda é monotônica (grade de 0,001)."""
    rs = np.linspace(0, 3, 3001)
    ok = 1 + 3 * k1 * rs**2 + 5 * k2 * rs**4 > 0.05
    bad = np.where(~ok)[0]
    return float(rs[bad[0] - 1]) if len(bad) else 3.0


@dataclass
class Camera:
    f: float
    R: np.ndarray
    C: np.ndarray
    w: int = 960
    h: int = 540
    k1: float = 0.0
    k2: float = 0.0
    cx: float | None = None
    cy: float | None = None
    meta: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.R = np.asarray(self.R, float)
        self.C = np.asarray(self.C, float).reshape(3)
        self.f = float(self.f)
        if self.cx is None:
            self.cx = self.w / 2.0
        if self.cy is None:
            self.cy = self.h / 2.0

    # --- construtores
    @classmethod
    def from_ptr(cls, f, pan, tilt, roll, C, w=960, h=540, k1=0.0, k2=0.0) -> Camera:
        return cls(f, rot_from_ptr(pan, tilt, roll), np.asarray(C, float), w, h, k1, k2)

    @classmethod
    def from_hfov(cls, hfov, pan, tilt, roll, C, w=960, h=540, k1=0.0, k2=0.0) -> Camera:
        return cls.from_ptr(f_from_hfov(hfov, w), pan, tilt, roll, C, w, h, k1, k2)

    @classmethod
    def look_at(cls, C, alvo, hfov, w=960, h=540, roll=0.0, k1=0.0) -> Camera:
        d = np.asarray(alvo, float) - np.asarray(C, float)
        d = d / np.linalg.norm(d)
        tilt = np.degrees(np.arcsin(np.clip(-d[2], -1, 1)))
        pan = np.degrees(np.arctan2(d[0], d[1]))
        return cls.from_hfov(hfov, pan, tilt, roll, C, w, h, k1)

    @classmethod
    def de_rotulo(cls, d: dict, w: int, h: int) -> Camera:
        """Câmera de um rótulo (`hfov_graus`, `pan`, `tilt`, `roll`, `C`, `k1`) num quadro w x h."""
        return cls.from_hfov(d["hfov_graus"], d["pan"], d["tilt"], d["roll"], d["C"], w, h, d.get("k1", 0.0))

    # --- propriedades
    @property
    def ptr(self) -> tuple[float, float, float]:
        return ptr_from_rot(self.R)

    @property
    def hfov(self) -> float:
        return hfov_from_f(self.f, self.w)

    def para_rotulo(self) -> dict:
        pan, tilt, roll = self.ptr
        return {
            "hfov_graus": self.hfov,
            "pan": pan,
            "tilt": tilt,
            "roll": roll,
            "C": [float(v) for v in self.C],
            "k1": float(self.k1),
        }

    def scaled(self, w: int, h: int) -> Camera:
        """A mesma câmera em outra resolução (f, cx e cy escalam; a distorção normalizada não muda)."""
        s = w / self.w
        return Camera(
            self.f * s, self.R.copy(), self.C.copy(), w, h, self.k1, self.k2, self.cx * s, self.cy * (h / self.h)
        )

    # --- projeção
    def project(self, X: np.ndarray, eps: float = 1e-3) -> tuple[np.ndarray, np.ndarray]:
        """Projeta pontos 3D. Retorna (pixels (N, 2) com NaN atrás da câmera, profundidade Z_c)."""
        Xc = (np.atleast_2d(np.asarray(X, float)) - self.C) @ self.R.T
        z = Xc[:, 2]
        px = np.full((len(Xc), 2), np.nan)
        ok = z > eps
        n = Xc[ok, :2] / z[ok, None]
        if self.k1 != 0.0 or self.k2 != 0.0:
            rmax = distortion_valid_radius(self.k1, self.k2)
            good = np.linalg.norm(n, axis=1) < rmax
            nd = distort_normalized(n, self.k1, self.k2)
            nd[~good] = np.nan
            n = nd
        px[ok] = self.f * n + np.array([self.cx, self.cy])
        return px, z

    def in_image(self, px: np.ndarray, margem: float = 0.0) -> np.ndarray:
        px = np.atleast_2d(px)
        return (
            np.isfinite(px).all(1)
            & (px[:, 0] >= -margem)
            & (px[:, 0] < self.w + margem)
            & (px[:, 1] >= -margem)
            & (px[:, 1] < self.h + margem)
        )


def mirror_camera(cam: Camera) -> Camera:
    """Câmera equivalente sob a rotação de 180 graus do campo: vê as mesmas marcações, mas põe as
    placas do lado oposto do estádio."""
    return Camera(cam.f, cam.R * ESPELHO[None, :], cam.C * ESPELHO, cam.w, cam.h, cam.k1, cam.k2, cam.cx, cam.cy)


def canonical_side(C: np.ndarray, alpha_deg: float = 45.0) -> bool:
    """True se a câmera está no semiespaço canônico da simetria de 180 graus (o mesmo do laboratório)."""
    a = np.radians(alpha_deg)
    return float(np.sin(a) * C[0] - np.cos(a) * C[1]) >= 0.0
