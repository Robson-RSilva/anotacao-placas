"""Previsores de mentira para os testes de `anotacao prever`: sempre os mesmos pontos, e sempre a mesma
pré-pintura das placas."""

from __future__ import annotations

import numpy as np


class PontosFixos:
    nome = "fixo"
    versao = "1"

    def __init__(self) -> None:
        self.chamadas = 0

    def __call__(self, imagem):
        self.chamadas += 1
        h, w = imagem.shape[:2]
        # um fora da imagem e um que não se marca: os dois ficam de fora
        return {
            "centro": (w / 2, h / 2),
            "meio_cab": (w / 2, h - 10.0),
            "canto_esq_cab": (-5.0, 3.0),
            "circ_esq": (3.0, 3.0),
        }


class MascaraFixa:
    """Pré-pintura de mentira para `anotacao prever --tarefa placas`: uma faixa de cima a baixo do recorte,
    no meio dele (o que sai da placa fica de fora da previsão)."""

    nome = "mascara-fixa"
    versao = "1"

    def __call__(self, imagem):
        h, w = imagem.shape[:2]
        m = np.zeros((h, w), np.uint8)
        m[:, w // 3 : w // 2] = 7  # qualquer valor diferente de zero cobre a placa
        return m
