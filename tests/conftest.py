from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent))

from anotacao.camera import Camera
from anotacao.campo import Campo
from anotacao.formatos import (
    Cadastro,
    CameraRotulo,
    Divisao,
    Equipe,
    Fila,
    ItemFila,
    Manifesto,
    Membro,
    PreProcessamento,
    RevisaoCamera,
    RotuloCamera,
    Tomada,
    Tomadas,
    VideoInfo,
)
from anotacao.pacote import pacote_sintetico
from anotacao.pasta import Pasta, escrever_json, nome_arquivo

from sintetico import renderizar

FIXTURES = Path(__file__).parent / "fixtures"
AGORA = datetime(2026, 11, 3, 15, 0, tzinfo=UTC)
PARTIDA = "2026-11-02_estadio-sintetico_time-a-time-b"


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


def camera_exemplo(alvo=(-8.0, 0.0, 0.0), hfov=38.0, w=640, h=360) -> Camera:
    return Camera.look_at(np.asarray(pacote_sintetico().cameras[0].T, float), alvo, hfov, w, h)


def criar_partida(pasta: Pasta, itens: list[dict], partida: str = PARTIDA, imagens: bool = True) -> Fila:
    """Uma partida como a página grava ao importar: manifesto, tomadas, fila e os quadros em JPEG."""
    pac = pasta.ler_pacote_ref("estadio-sintetico/pacote-1.0")
    fila = Fila(
        partida=partida,
        criado_em=AGORA,
        equipe=["A01", "A02"],
        itens=[
            ItemFila(
                quadro=it.get("quadro", f"t{1000 * (k + 1):010d}"),
                tomada=it.get("tomada", 0),
                i=it.get("i", k),
                pts_ms=it.get("pts_ms", 1000 * (k + 1)),
                atribuido_a=it.get("atribuido_a", ["A01"]),
                dupla=it.get("dupla", False),
                sem_previsao=it.get("sem_previsao", False),
            )
            for k, it in enumerate(itens)
        ],
    )
    escrever_json(
        pasta.tomadas(partida),
        Tomadas(
            partida=partida,
            cortes=[],
            transicoes=[],
            tomadas=[Tomada(id=0, i0=0, i1=100, inicio_ms=0, fim_ms=4000, replay=None, zoom="aberto", grupo=0)],
        ),
    )
    escrever_json(pasta.fila(partida), fila)
    if imagens:
        campo = Campo()
        pasta.quadros(partida).mkdir(parents=True, exist_ok=True)
        for k, it in enumerate(fila.itens):
            cv2.imwrite(
                str(pasta.quadro(partida, it.quadro)), renderizar(camera_exemplo((-8.0 + k, 0.0, 0.0)), campo, pac, k)
            )
    escrever_json(
        pasta.manifesto(partida),
        Manifesto(
            partida=partida,
            pacote="estadio-sintetico/pacote-1.0",
            cadastro=Cadastro(
                estadio="estadio-sintetico",
                pacote_versao="1.0",
                emissora="Emissora X",
                competicao="Estadual",
                data_hora=datetime.fromisoformat("2026-11-02T16:00:00-03:00"),
                mandante="Time A",
                visitante="Time B",
                iluminacao="dia",
                chuva=False,
            ),
            video=VideoInfo(
                nome_original="jogo.mp4",
                sha256="0" * 64,
                bytes=1000,
                duracao_s=4,
                fps=25,
                largura=640,
                altura=360,
                n_quadros=100,
            ),
            pre_processamento=PreProcessamento(ferramenta="0.2.0", criado_em=AGORA, segundos=1, parametros={}),
        ),
    )
    return fila


def gravar_rotulo(
    pasta: Pasta, quadro: str, pessoa: str, cam: Camera | None, versao=1, minutos=0, partida=PARTIDA, **kw
) -> str:
    kw.setdefault("pacote", "estadio-sintetico/pacote-1.0")
    r = RotuloCamera(
        partida=partida,
        quadro=quadro,
        anotador=pessoa,
        versao=versao,
        ferramenta="0.2.0",
        manual="camera-0.1",
        criado_em=AGORA + timedelta(minutes=minutos),
        segundos_ativos=20,
        partiu_de={"fonte": "registro"},
        camera=None if cam is None else CameraRotulo(**cam.para_rotulo()),
        lado=None if cam is None else ("canonico" if cam.C[1] < 0 else "espelhado"),
        situacao="ok" if cam is not None else "sem_marcacoes",
        **kw,
    )
    nome = nome_arquivo(quadro, pessoa, versao)
    escrever_json(pasta.rotulos(partida, "camera") / nome, r)
    return nome


def gravar_revisao(
    pasta: Pasta, quadro: str, rotulo: str, revisor: str, decisao="aprovar", minutos=0, versao=1, **kw
) -> None:
    escrever_json(
        pasta.revisoes(PARTIDA, "camera") / nome_arquivo(quadro, revisor, versao),
        RevisaoCamera(
            partida=PARTIDA,
            quadro=quadro,
            rotulo=rotulo,
            revisor=revisor,
            versao=versao,
            decisao=decisao,
            motivo="lado_trocado" if decisao == "devolver" else None,
            ferramenta="0.2.0",
            manual="revisao-0.1",
            criado_em=AGORA + timedelta(minutes=minutos),
            segundos_ativos=4,
            **kw,
        ),
    )
