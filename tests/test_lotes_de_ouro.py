"""Os lotes de ouro (scripts/lotes_de_ouro.py): faixas de id separadas e medidas que a página aceita.

A geração em si precisa do simulador do laboratório e não roda aqui; estes testes guardam a
definição dos lotes.
"""

import importlib.util
import itertools
import sys
from pathlib import Path

import numpy as np
import pytest

from anotacao.formatos import GabaritoCamera


@pytest.fixture(scope="module")
def lotes():
    caminho = Path(__file__).resolve().parents[1] / "scripts" / "lotes_de_ouro.py"
    spec = importlib.util.spec_from_file_location("lotes_de_ouro", caminho)
    modulo = importlib.util.module_from_spec(spec)
    sys.modules["lotes_de_ouro"] = modulo  # o dataclass procura o módulo pelo nome
    spec.loader.exec_module(modulo)
    return modulo


def test_faixas_de_id_separadas(lotes):
    faixas = sorted((lt.primeiro, lt.primeiro + lt.n - 1) for lt in lotes.LOTES)
    assert faixas[0][0] >= 1 and faixas[-1][1] <= 9999
    for (_, fim), (inicio, _) in itertools.pairwise(faixas):
        assert fim < inicio
    assert len({lt.nome for lt in lotes.LOTES}) == len(lotes.LOTES)
    assert len({lt.semente for lt in lotes.LOTES}) == len(lotes.LOTES)


def test_medidas_sorteadas_cabem_na_pagina(lotes):
    rng = np.random.default_rng(0)
    vistos = set()
    for modo in ("padrao", "outras", "mistas"):
        for _ in range(300):
            comprimento, largura = lotes.sortear_medidas(rng, modo)
            assert 90 <= comprimento <= 120 and 45 <= largura <= 90 and comprimento > largura
            assert (2 * comprimento).is_integer() and (2 * largura).is_integer(), "de 0,5 em 0,5, como na página"
            if modo == "padrao":
                assert (comprimento, largura) == lotes.PADRAO
            if modo == "outras":
                assert (comprimento, largura) != lotes.PADRAO
            vistos.add((modo, (comprimento, largura) == lotes.PADRAO))
    assert ("mistas", True) in vistos and ("mistas", False) in vistos


def test_medidas_decidiveis(lotes):
    assert lotes.medidas_decidiveis({"meio": 0.3, "grande_area_esq_frente": 0.2, "lateral_opo": 0.5})
    assert lotes.medidas_decidiveis({"circulo_central": 0.3, "grande_area_dir_frente": 0.2, "lateral_cab": 0.5})
    assert not lotes.medidas_decidiveis({"circulo_central": 0.3, "lateral_opo": 0.5}), "sem a grande área"
    assert not lotes.medidas_decidiveis({"meio": 0.3, "grande_area_esq_frente": 0.2}), "sem a lateral"


def test_item_de_um_campo_de_outro_tamanho(lotes):
    item = GabaritoCamera(
        id="g0101",
        pacote=lotes.REF_GENERICO,
        imagem="g0101.jpg",
        largura=1280,
        altura=720,
        camera={"hfov_graus": 40.0, "pan": 10.0, "tilt": 15.0, "roll": 0.0, "C": [0.0, -55.0, 18.0], "k1": 0.0},
        campo={"comprimento": 102.5, "largura": 66.0},
        origem="simulador",
    )
    assert item.pacote == "generico/pacote-1.0"
    assert (item.campo.comprimento, item.campo.largura) == (102.5, 66.0)
