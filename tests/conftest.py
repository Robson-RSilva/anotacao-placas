from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from anotacao.formatos import Cadastro, Divisao, Equipe, Membro
from anotacao.pacote import pacote_sintetico
from anotacao.pasta import Pasta, escrever_json
from sintetico import gerar_video

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def laboratorio() -> dict:
    return json.loads((FIXTURES / "camera_laboratorio.json").read_text(encoding="utf-8"))


@pytest.fixture
def pacote():
    return pacote_sintetico()


@pytest.fixture
def pasta(tmp_path, pacote) -> Pasta:
    p = Pasta(tmp_path / "trabalho")
    p.criar()
    escrever_json(p.pacote_path(pacote.estadio, pacote.versao), pacote)
    escrever_json(
        p.equipe_path,
        Equipe(
            membros=[
                Membro(codigo="A01", nome="Ana", papeis=["anotador", "revisor"]),
                Membro(codigo="A02", nome="Bruno", papeis=["anotador", "revisor"]),
            ]
        ),
        sobrescrever=True,
    )
    escrever_json(p.divisao_path, Divisao(), sobrescrever=True)
    return p


@pytest.fixture(scope="session")
def video(tmp_path_factory) -> tuple[Path, list]:
    caminho = tmp_path_factory.mktemp("videos") / "jogo.mp4"
    verdade = gerar_video(caminho, pacote_sintetico())
    return caminho, verdade


@pytest.fixture
def cadastro() -> Cadastro:
    return Cadastro(
        estadio="estadio-sintetico",
        pacote_versao="1.0",
        emissora="Emissora X",
        competicao="Estadual",
        data_hora=datetime.fromisoformat("2026-11-02T16:00:00-03:00"),
        mandante="Time A",
        visitante="Time B",
        iluminacao="dia",
        chuva=False,
    )
