"""Previsor: de onde vem a câmera prevista que já aparece desenhada na página de câmera.

As páginas não dependem de nenhum modelo. Sem previsão, o molde abre pela câmera de um quadro já
anotado da mesma tomada ou pela câmera do registro do estádio. Com um previsor, `anotacao prever`
grava `previsoes/<quadro>.json` para os quadros sorteados, e a página usa essa câmera para começar.

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
from collections.abc import Callable
from typing import Protocol

import cv2
import numpy as np

from .formatos import CameraRotulo, PacoteEstadio, Previsao
from .pasta import Pasta, escrever_json


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


def prever(
    pasta: Pasta,
    previsor: Previsor,
    partidas: list[str] | None = None,
    *,
    refazer: bool = False,
    progresso: Callable[[str, int, int], None] | None = None,
) -> int:
    """Grava a previsão de cada quadro da fila (menos os "sem previsão"). Devolve quantas gravou.

    Rodar de novo só faz as que faltam (quadros que ainda não chegaram pela sincronização ficam para
    a próxima vez), a não ser com `refazer`.
    """
    n = 0
    for pid in partidas or pasta.listar_partidas():
        man = pasta.ler_manifesto(pid)
        pacote = pasta.ler_pacote_ref(man.pacote)
        itens = [it for it in pasta.ler_fila(pid).itens if not it.sem_previsao]
        for k, item in enumerate(itens):
            destino = pasta.previsao(pid, item.quadro)
            if destino.exists() and not refazer:
                continue
            img = cv2.imread(str(pasta.quadro(pid, item.quadro)))
            if img is None:
                continue
            cam, confianca = previsor(img, pacote)
            escrever_json(
                destino,
                Previsao(
                    partida=pid,
                    quadro=item.quadro,
                    fonte=previsor.nome,
                    versao=previsor.versao,
                    camera=cam,
                    confianca=confianca,
                ),
                sobrescrever=True,
            )
            n += 1
            if progresso:
                progresso(pid, k + 1, len(itens))
    return n
