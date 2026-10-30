"""Previsor: um modelo que já deixa a imagem começada, para quem anota só corrigir.

As páginas não dependem de nenhum modelo. Com um previsor, `anotacao prever` grava, para os quadros
sorteados (menos os "sem previsão", que medem o viés de ancoragem):

* pontos (`--tarefa pontos`): `previsoes/pontos/<quadro>.json` (formato previsao.pontos/1). O
  previsor recebe a imagem e devolve os pontos que achou, {nome: (x, y)} em px da imagem;
* pessoas (`--tarefa pessoas`): `previsoes/pessoas/<quadro>.png`. O previsor recebe a imagem e
  devolve a máscara (h, w), diferente de zero onde há pessoa, ou None.

Um previsor é qualquer objeto chamável com `nome` e `versao`:

    class MeusPontos:
        nome = "detector_A"
        versao = "3f9c"
        def __call__(self, imagem_bgr) -> dict[str, tuple[float, float]]: ...

e é carregado por `--previsor pacote.modulo:objeto` (o objeto pode ser a instância, a classe ou uma
função que devolve a instância).
"""

from __future__ import annotations

import importlib
from collections.abc import Callable

import cv2
import numpy as np

from .formatos import NOMES_PONTOS, PrevisaoPontos
from .mascara import gravar_png
from .pasta import Pasta, escrever_bytes, escrever_json

#: As cores da máscara das pessoas: 0 fundo, 1 pessoa (a mesma paleta das páginas).
PALETA_PESSOAS = [(0, 0, 0), (255, 64, 129)]


def carregar_previsor(especificacao: str | None):
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


def _pontos(achados, w: int, h: int) -> list[dict]:
    """Os pontos do previsor que esta versão marca, dentro da imagem."""
    out = []
    for nome, (x, y) in sorted((achados or {}).items()):
        if nome in NOMES_PONTOS and 0 <= x <= w and 0 <= y <= h:
            out.append({"ponto": nome, "x": round(float(x), 2), "y": round(float(y), 2)})
    return out


def prever(
    pasta: Pasta,
    previsor,
    tarefa: str,
    partidas: list[str] | None = None,
    *,
    refazer: bool = False,
    progresso: Callable[[str, int, int], None] | None = None,
) -> int:
    """Grava a previsão de cada quadro da fila na tarefa. Devolve quantas gravou.

    Rodar de novo só faz as que faltam (quadros que ainda não chegaram pela sincronização ficam para
    a próxima vez), a não ser com `refazer`.
    """
    if tarefa not in ("pontos", "pessoas"):
        raise ValueError(f"tarefa desconhecida: {tarefa}")
    n = 0
    for pid in partidas or pasta.listar_partidas():
        man = pasta.ler_manifesto(pid)
        w, h = man.video.largura, man.video.altura
        itens = [it for it in pasta.ler_fila(pid).itens if not it.sem_previsao]
        for k, item in enumerate(itens):
            destino = (pasta.previsao_pontos if tarefa == "pontos" else pasta.previsao_pessoas)(pid, item.quadro)
            if destino.exists() and not refazer:
                continue
            img = cv2.imread(str(pasta.quadro(pid, item.quadro)))
            if img is None:
                continue
            saida = previsor(img)
            if tarefa == "pontos":
                prev = PrevisaoPontos(
                    partida=pid,
                    quadro=item.quadro,
                    fonte=previsor.nome,
                    versao=previsor.versao,
                    pontos=_pontos(saida, w, h),
                )
                escrever_json(destino, prev, sobrescrever=True)
            else:
                if saida is None:
                    continue
                m = np.asarray(saida)
                if m.shape != (h, w):
                    raise ValueError(f"{previsor.nome}: a máscara precisa ter o tamanho do quadro ({m.shape})")
                escrever_bytes(destino, gravar_png((m != 0).astype(np.uint8), PALETA_PESSOAS), sobrescrever=True)
            n += 1
            if progresso:
                progresso(pid, k + 1, len(itens))
    return n
