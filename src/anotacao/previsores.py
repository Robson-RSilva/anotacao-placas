"""Previsor: de onde vem a câmera prevista que já aparece desenhada na página de câmera.

A ferramenta não depende de nenhum modelo para funcionar. Sem previsor, o molde abre pela câmera
de um quadro já anotado da mesma tomada ou pela câmera do registro do estádio. Com previsor, cada
quadro sorteado ganha `previsoes/<quadro>.json` no pré-processamento.

Um previsor é qualquer objeto chamável com `nome` e `versao`:

    class MeuPrevisor:
        nome = "detector_A"
        versao = "3f9c"
        def __call__(self, imagem_bgr, pacote) -> tuple[CameraRotulo | None, float | None]: ...

e é carregado por `--previsor pacote.modulo:objeto` (o objeto pode ser a instância, a classe ou uma
função que devolve a instância).
"""

from __future__ import annotations

import importlib
from typing import Protocol

import numpy as np

from .formatos import CameraRotulo, PacoteEstadio


class Previsor(Protocol):
    nome: str
    versao: str

    def __call__(self, imagem: np.ndarray, pacote: PacoteEstadio) -> tuple[CameraRotulo | None, float | None]: ...


def carregar_previsor(especificacao: str | None) -> Previsor | None:
    if not especificacao:
        return None
    modulo, _, attr = especificacao.partition(":")
    if not modulo or not attr:
        raise ValueError("use o formato pacote.modulo:objeto")
    obj = getattr(importlib.import_module(modulo), attr)
    if isinstance(obj, type) or (callable(obj) and not hasattr(obj, "nome")):
        obj = obj()
    for campo in ("nome", "versao"):
        if not isinstance(getattr(obj, campo, None), str):
            raise TypeError(f"o previsor precisa do atributo de texto '{campo}'")
    if not callable(obj):
        raise TypeError("o previsor precisa ser chamável")
    return obj
