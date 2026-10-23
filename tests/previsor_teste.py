"""Previsor de mentira para os testes de `anotacao prever`: sempre a mesma câmera."""

from __future__ import annotations

from anotacao.camera import Camera
from anotacao.formatos import CameraRotulo


class PrevisorFixo:
    nome = "fixo"
    versao = "1"

    def __init__(self) -> None:
        self.chamadas = 0

    def __call__(self, imagem, pacote):
        self.chamadas += 1
        h, w = imagem.shape[:2]
        cam = Camera.look_at(pacote.cameras[0].T, [0.0, 0.0, 0.0], 40.0, w, h)
        return CameraRotulo(**cam.para_rotulo()), 0.5
