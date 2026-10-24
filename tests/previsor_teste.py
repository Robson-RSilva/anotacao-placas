"""Previsores de mentira para os testes de `anotacao prever`: sempre a mesma câmera, e sempre a mesma
pré-pintura da oclusão."""

from __future__ import annotations

import numpy as np

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


class MascaraFixa:
    """Pré-pintura de mentira para `anotacao prever --tarefa oclusao`: uma "pessoa" no meio do quadro."""

    nome = "mascara-fixa"
    versao = "1"

    def __call__(self, imagem):
        h, w = imagem.shape[:2]
        m = np.zeros((h, w), np.uint8)
        m[h // 4 : h // 2, w // 3 : w // 2] = 2
        m[0, 0] = 1  # "placa livre" não é pré-pintura: some
        return m
