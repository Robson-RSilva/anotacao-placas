from __future__ import annotations

import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent))

from anotacao.formatos import (
    Cadastro,
    Divisao,
    Equipe,
    Fila,
    ItemFila,
    ItemRecorte,
    LoteRecortes,
    Manifesto,
    Membro,
    PreProcessamento,
    RevisaoPlacas,
    RevisaoPontos,
    RotuloPlacas,
    RotuloPontos,
    Tomada,
    Tomadas,
    VideoInfo,
)
from anotacao.mascara import gravar_png
from anotacao.pasta import Pasta, escrever_bytes, escrever_json, mascara_de, nome_arquivo
from anotacao.previsores import PALETA_PLACAS

from sintetico import PLANOS, Camera, recorte_sintetico, renderizar

FIXTURES = Path(__file__).parent / "fixtures"
W, H = 640, 360


def _escapar(texto: str, propriedade: bool = False) -> str:
    texto = texto.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    return texto.replace(":", "%3A").replace(",", "%2C") if propriedade else texto


def pytest_runtest_logreport(report):
    """No GitHub Actions, cada falha vira uma anotação do trabalho, que dá para ler pela API sem o log."""
    if report.failed and os.environ.get("GITHUB_ACTIONS") == "true":
        arquivo, linha, _ = report.location
        titulo = _escapar(report.nodeid, propriedade=True)
        texto = _escapar(str(report.longrepr)[-4000:])
        sys.__stdout__.write(f"\n::error file={arquivo},line={(linha or 0) + 1},title={titulo}::{texto}\n")
        sys.__stdout__.flush()


AGORA = datetime(2026, 11, 3, 15, 0, tzinfo=UTC)
PARTIDA = "2026-11-02_estadio-sintetico_time-a-time-b"


@pytest.fixture(scope="session")
def laboratorio() -> dict:
    import json

    return json.loads((FIXTURES / "campo_laboratorio.json").read_text(encoding="utf-8"))


@pytest.fixture
def pasta(tmp_path) -> Pasta:
    p = Pasta(tmp_path / "trabalho")
    p.criar()
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


def camera_exemplo(k: int = 0) -> Camera:
    C, alvo, hfov = PLANOS[0]
    return Camera.look_at(C, np.asarray(alvo, float) + np.array([k, 0.0, 0.0]), hfov, W, H)


def criar_partida(pasta: Pasta, itens: list[dict], partida: str = PARTIDA, imagens: bool = True) -> Fila:
    """Uma partida como a página grava ao importar: manifesto, tomadas, fila e os quadros em JPEG."""
    fila = Fila(
        partida=partida,
        criado_em=AGORA,
        equipe=[],
        itens=[
            ItemFila(
                quadro=it.get("quadro", f"t{1000 * (k + 1):010d}"),
                tomada=it.get("tomada", 0),
                i=it.get("i", k),
                pts_ms=it.get("pts_ms", 1000 * (k + 1)),
                atribuido_a=it.get("atribuido_a", []),
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
        pasta.quadros(partida).mkdir(parents=True, exist_ok=True)
        for k, it in enumerate(fila.itens):
            img, _ = renderizar(camera_exemplo(k), k)
            cv2.imwrite(str(pasta.quadro(partida, it.quadro)), img)
    escrever_json(
        pasta.manifesto(partida),
        Manifesto(
            partida=partida,
            cadastro=Cadastro(
                estadio="estadio-sintetico",
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
                largura=W,
                altura=H,
                n_quadros=100,
            ),
            pre_processamento=PreProcessamento(ferramenta="0.10.0", criado_em=AGORA, segundos=1, parametros={}),
        ),
    )
    return fila


def criar_recortes(
    pasta: Pasta,
    n: int,
    partida: str = PARTIDA,
    lote: str = "r1",
    duplas: tuple[int, ...] = (),
    sem_previsao: tuple[int, ...] = (),
    oclusores: dict[int, int] | None = None,
    imagens: bool = True,
) -> dict[str, dict]:
    """Um lote de recortes das placas na partida (como `anotacao recortes` traz): os recortes k = 0..n-1
    (`t<1000(k+1)>_p<k>`), com as imagens sintéticas. Devolve recorte -> {item, verdade (a máscara
    verdadeira, com cada coisa na frente da placa numerada), imagem}."""
    out = {}
    itens = []
    for k in range(n):
        img, regiao, verdade = recorte_sintetico(100 + k, oclusores=(oclusores or {}).get(k))
        h, w = verdade.shape
        recorte = f"t{1000 * (k + 1):010d}_p{k}"
        it = ItemRecorte(
            recorte=recorte,
            largura=w,
            altura=h,
            regiao=regiao,
            placa=regiao,
            no_quadro=[[100 + 2 * x, 50 + 2 * y] for x, y in regiao],
            dupla=k in duplas,
            sem_previsao=k in sem_previsao,
        )
        itens.append(it)
        out[recorte] = {"item": it, "verdade": verdade, "imagem": img}
        if imagens:
            pasta.recortes(partida).mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(pasta.recorte(partida, recorte)), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    escrever_json(
        pasta.lote_recortes(partida, lote),
        LoteRecortes(partida=partida, lote=lote, criado_em=AGORA, origem="simulador", gerador="testes", itens=itens),
    )
    return out


def _comum(partida, pessoa, versao, minutos, manual, largura=W, altura=H):
    return {
        "partida": partida,
        "anotador": pessoa,
        "versao": versao,
        "ferramenta": "0.10.0",
        "manual": manual,
        "criado_em": AGORA + timedelta(minutes=minutos),
        "segundos_ativos": 20,
        "largura": largura,
        "altura": altura,
        "partiu_de": {"fonte": "nenhuma"},
    }


def gravar_pontos(
    pasta: Pasta, quadro: str, pessoa: str, pontos: dict | None, versao=1, minutos=0, partida=PARTIDA, **kw
) -> str:
    """Um rótulo de pontos ({nome: (x, y)}); None é a imagem descartada (por transição)."""
    r = RotuloPontos(
        **_comum(partida, pessoa, versao, minutos, "pontos-0.1"),
        quadro=quadro,
        pontos=[{"ponto": n, "x": x, "y": y} for n, (x, y) in (pontos or {}).items()],
        situacao="ok" if pontos is not None else "descartada",
        motivo_descarte=None if pontos is not None else "transicao",
        **kw,
    )
    nome = nome_arquivo(quadro, pessoa, versao)
    escrever_json(pasta.rotulos(partida, "pontos") / nome, r)
    return nome


def gravar_placas(
    pasta: Pasta,
    recorte: str,
    pessoa: str,
    mascara: np.ndarray | None,
    versao=1,
    minutos=0,
    partida=PARTIDA,
    motivo="borrao",
    **kw,
) -> str:
    """Um rótulo das placas como a página grava: a máscara (0/1, do tamanho do recorte) e o rótulo; None
    é o recorte descartado (com `motivo`)."""
    nome = nome_arquivo(recorte, pessoa, versao)
    h, w = mascara.shape if mascara is not None else kw.pop("tamanho", (72, 240))
    if mascara is not None:
        escrever_bytes(pasta.rotulos(partida, "placas") / mascara_de(nome), gravar_png(mascara, PALETA_PLACAS))
    r = RotuloPlacas(
        **_comum(partida, pessoa, versao, minutos, "placas-0.1", largura=w, altura=h),
        recorte=recorte,
        mascara=None if mascara is None else mascara_de(nome),
        pixels=0 if mascara is None else int(np.count_nonzero(mascara)),
        situacao="ok" if mascara is not None else "descartada",
        motivo_descarte=None if mascara is not None else motivo,
        **kw,
    )
    escrever_json(pasta.rotulos(partida, "placas") / nome, r)
    return nome


def gravar_revisao(
    pasta: Pasta, tarefa: str, quadro: str, rotulo: str, revisor: str, decisao="aprovar", minutos=0, versao=1, **kw
) -> None:
    """Uma revisão; `quadro` é o item (o quadro nos pontos, o recorte nas placas)."""
    modelo = RevisaoPontos if tarefa == "pontos" else RevisaoPlacas
    motivo = ("ponto_fora_do_lugar" if tarefa == "pontos" else "faltou_pintar") if decisao == "devolver" else None
    escrever_json(
        pasta.revisoes(PARTIDA, tarefa) / nome_arquivo(quadro, revisor, versao),
        modelo(
            partida=PARTIDA,
            **{"quadro" if tarefa == "pontos" else "recorte": quadro},
            rotulo=rotulo,
            revisor=revisor,
            versao=versao,
            decisao=decisao,
            motivo=kw.pop("motivo", motivo),
            ferramenta="0.10.0",
            manual="revisao-0.4",
            criado_em=AGORA + timedelta(minutes=minutos),
            segundos_ativos=4,
            **kw,
        ),
    )
