"""Filas: gabarito escondido a cada 15 rótulos, concordância dos rótulos cegos e unificar com a divisão."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import cv2
import numpy as np
import pandas as pd

from anotacao.camera import Camera
from anotacao.campo import Campo
from anotacao.filas import INTERVALO_GABARITO, proximo_camera
from anotacao.formatos import CameraRotulo, Divisao, Fila, GabaritoCamera, ItemFila, RevisaoCamera, RotuloCamera
from anotacao.gabarito import importar
from anotacao.indice import Indice
from anotacao.pasta import escrever_json, nome_arquivo
from anotacao.placar import calcular
from anotacao.preprocessamento import preprocessar
from anotacao.sorteio import ParametrosSorteio
from anotacao.unificar import unificar
from sintetico import renderizar

CAMPO = Campo()
AGORA = datetime(2026, 11, 3, 15, 0, tzinfo=UTC)


def _rotulo(partida, quadro, pessoa, cam: Camera | None, versao=1, minutos=0, **kw) -> RotuloCamera:
    return RotuloCamera(
        partida=partida,
        pacote="estadio-sintetico/pacote-1.0",
        quadro=quadro,
        anotador=pessoa,
        versao=versao,
        ferramenta="0.1.0",
        manual="camera-0.1",
        criado_em=AGORA + timedelta(minutes=minutos),
        segundos_ativos=20,
        partiu_de={"fonte": "registro"},
        camera=None if cam is None else CameraRotulo(**cam.para_rotulo()),
        lado=None if cam is None else ("canonico" if cam.C[1] < 0 else "espelhado"),
        situacao="ok" if cam is not None else "sem_marcacoes",
        **kw,
    )


def _gravar(pasta, r: RotuloCamera):
    escrever_json(pasta.rotulos(r.partida, "camera") / nome_arquivo(r.quadro, r.anotador, r.versao), r)


def _gabarito(pasta, pacote, origem, n=14):
    origem.mkdir(parents=True, exist_ok=True)
    cams = {}
    for k in range(n):
        cam = Camera.look_at(np.asarray(pacote.cameras[0].T, float), [-25 + 4 * k, 3.0, 0], 30, 640, 360)
        gid = f"g{k + 1:04d}"
        cv2.imwrite(str(origem / f"{gid}.jpg"), renderizar(cam, CAMPO, pacote, k))
        g = GabaritoCamera(
            id=gid,
            pacote=pacote.ref,
            imagem=f"{gid}.jpg",
            largura=640,
            altura=360,
            camera=CameraRotulo(**cam.para_rotulo()),
            origem="simulador",
        )
        (origem / f"{gid}.json").write_text(g.model_dump_json(), encoding="utf-8")
        cams[gid] = cam
    importar(pasta, origem)
    return cams


def test_gabarito_escondido_a_cada_15(pasta, pacote, video, cadastro, tmp_path):
    caminho, _ = video
    pid = preprocessar(pasta, caminho, cadastro, params=ParametrosSorteio(alvo=3)).partida
    itens = [
        ItemFila(quadro=f"t{1000 * k:010d}", tomada=0, i=k, pts_ms=1000 * k, atribuido_a=["A01"]) for k in range(40)
    ]
    escrever_json(pasta.fila(pid), Fila(partida=pid, criado_em=AGORA, equipe=["A01"], itens=itens), sobrescrever=True)
    cams = _gabarito(pasta, pacote, tmp_path / "gab")
    for k, (gid, cam) in enumerate(list(cams.items())[:10]):  # treino: 10 acertos libera
        _gravar(pasta, _rotulo("gabarito", gid, "A01", cam, minutos=k))
    indice = Indice(pasta)
    for k in range(INTERVALO_GABARITO - 1):
        _gravar(pasta, _rotulo(pid, itens[k].quadro, "A01", None, minutos=20 + k))
    item = proximo_camera(pasta, indice, "A01")
    assert item.partida == pid and not item.treino  # 14 reais: ainda não é a vez do gabarito
    _gravar(pasta, _rotulo(pid, itens[14].quadro, "A01", None, minutos=40))
    item = proximo_camera(pasta, indice, "A01")
    assert item.partida == "gabarito" and not item.treino  # o 16º item é um gabarito escondido


def test_concordancia_e_divisao(pasta, video, cadastro):
    caminho, verdade = video
    pid = preprocessar(pasta, caminho, cadastro, params=ParametrosSorteio(alvo=3)).partida
    fila = pasta.ler_fila(pid)
    alvo = fila.itens[0]
    fila.itens[0] = alvo.model_copy(update={"dupla": True, "atribuido_a": ["A01", "A02"]})
    escrever_json(pasta.fila(pid), fila, sobrescrever=True)
    cam = verdade[alvo.i]
    quase = Camera.from_hfov(cam.hfov, cam.ptr[0] + 0.05, cam.ptr[1], cam.ptr[2], cam.C, cam.w, cam.h)
    _gravar(pasta, _rotulo(pid, alvo.quadro, "A01", cam))
    _gravar(pasta, _rotulo(pid, alvo.quadro, "A02", quase, minutos=5))
    for pessoa, revisor in (("A01", "A02"), ("A02", "A01")):
        escrever_json(
            pasta.revisoes(pid, "camera") / nome_arquivo(alvo.quadro, revisor, 1),
            RevisaoCamera(
                partida=pid,
                quadro=alvo.quadro,
                rotulo=nome_arquivo(alvo.quadro, pessoa, 1),
                revisor=revisor,
                versao=1,
                decisao="aprovar",
                ferramenta="0.1.0",
                manual="revisao-0.1",
                criado_em=AGORA + timedelta(minutes=10 if pessoa == "A01" else 30),
                segundos_ativos=4,
            ),
        )
    pl = calcular(pasta, agora=AGORA + timedelta(hours=1))
    a01 = next(p for p in pl["pessoas"] if p["pessoa"] == "A01")
    assert 0.05 < a01["concordancia_px"] < 3.0  # 0,05° de pan num plano de 38° ≈ 1,3 px na ref. 960
    assert pl["total"]["aprovados"] == 1

    escrever_json(pasta.divisao_path, Divisao(teste_congelado=[pid]), sobrescrever=True)
    destino = unificar(pasta, agora=AGORA)
    df = pd.read_parquet(destino / "camera.parquet")
    assert len(df) == 1 and df.loc[0, "conjunto"] == "teste_congelado"
    assert df.loc[0, "anotador"] == "A01"  # dois aprovados: vale o aprovado primeiro
