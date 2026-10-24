"""Arquivos que saem das definições em Python e que as páginas (ou os testes delas) leem.

* `web/esquemas/*.json` — JSON Schemas dos formatos (as páginas validam por eles antes de gravar);
* `web/exemplo/*.json` — o pacote do estádio sintético e a equipe da pasta de exemplo;
* `tests/fixtures/convencoes.json` e `tests/fixtures/pacote_generico.json` — as convenções e o campo
  genérico, para os testes dos espelhos em JavaScript;
* `tests/fixtures/oclusao.json` — as faixas de placas, onde as placas caem em três câmeras, as contas
  por placa, uma comparação de máscaras e dois PNGs (do Python e do OpenCV, com os bytes fixos), para o
  espelho da oclusão.

`python scripts/gerar_arquivos_web.py` grava todos; `tests/test_arquivos_gerados.py` falha quando
algum fica desatualizado.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import __version__, oclusao
from .camera import Camera
from .convencoes import (
    MANUAL,
    PARTIDA_GABARITO,
    RE_DISPOSITIVO,
    RE_ESTADIO,
    RE_GABARITO,
    RE_PACOTE_REF,
    RE_PARTIDA,
    RE_PESSOA,
    RE_QUADRO,
    RE_VERSAO_PACOTE,
    REF_H,
    REF_PACOTE_GENERICO,
    REF_W,
    id_partida,
    id_quadro,
    slug,
)
from .formatos import ESQUEMAS, Divisao, Equipe, Membro, esquema_json
from .pacote import pacote_generico, pacote_sintetico

RAIZ = Path(__file__).resolve().parents[2]


def equipe_exemplo() -> Equipe:
    return Equipe(
        membros=[
            Membro(codigo="A01", nome="Anotador 1", papeis=["anotador", "revisor"]),
            Membro(codigo="A02", nome="Anotador 2", papeis=["anotador", "revisor"]),
        ]
    )


def _json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def convencoes_para_teste() -> dict:
    textos = ["São Paulo", "  Grêmio x Inter  ", "Atlético-MG", "Água_Santa!!", "", "Ñandú — Club"]
    pts = [0, 0.4, 0.5, 1.5, 2.5, 33.3667, 1234567.5, 9_999_999_999]
    partidas = [
        ("2026-11-02T16:00:00-03:00", "Arena X", "Time A", "Time B"),
        ("2026-11-02", "estadio-sintetico", "São Paulo", "Grêmio"),
    ]
    return {
        "descricao": "Gerado por scripts/gerar_arquivos_web.py a partir de src/anotacao; não editar à mão.",
        "versao": __version__,
        "ref": [REF_W, REF_H],
        "manual": MANUAL,
        "partida_gabarito": PARTIDA_GABARITO,
        "ref_pacote_generico": REF_PACOTE_GENERICO,
        "regex": {
            "RE_ESTADIO": RE_ESTADIO.pattern,
            "RE_VERSAO_PACOTE": RE_VERSAO_PACOTE.pattern,
            "RE_PARTIDA": RE_PARTIDA.pattern,
            "RE_QUADRO": RE_QUADRO.pattern,
            "RE_GABARITO": RE_GABARITO.pattern,
            "RE_PESSOA": RE_PESSOA.pattern,
            "RE_PACOTE_REF": RE_PACOTE_REF.pattern,
            "RE_DISPOSITIVO": RE_DISPOSITIVO.pattern,
        },
        "slug": [[t, slug(t)] for t in textos],
        "id_quadro": [[p, id_quadro(p)] for p in pts],
        "id_partida": [[*a, id_partida(*a)] for a in partidas],
    }


def _rle(a) -> list[list[int]]:
    """[[valor, quantos], ...] de uma matriz percorrida linha a linha."""
    v = a.ravel()
    corte = np.flatnonzero(np.diff(v)) + 1
    inicios = np.r_[0, corte]
    fins = np.r_[corte, len(v)]
    return [[int(v[i]), int(f - i)] for i, f in zip(inicios, fins, strict=True)]


# Os dois PNGs do fixture ficam fixos aqui, e não são gerados a cada vez: o zlib de cada Python (e de
# cada sistema) comprime do seu jeito, e o que o teste do espelho confere é a leitura, não os bytes.
# Gerados uma vez com `gravar_png(PNG_PALETA_INDICES, oclusao.PALETA)` e com o OpenCV
# (`cv2.imencode(".png", PNG_CINZA_INDICES)`); `tests/test_oclusao.py` confere que dizem esses pixels.
PNG_PALETA_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAMAAAC+RAbqAAAAGFBMVEUAAAA0mNvnTDzxxA+bWbbmfiIavJx/jI01gnpBAAAAH0lEQVR42mNgYGRiZmFl"
    "Y2CHMBjYIAwGVgiDgQXCAAAI6AB0bj4AVwAAAABJRU5ErkJggg=="
)
PNG_CINZA_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAACUAAAAXCAAAAACpR9l5AAAAhUlEQVQoFYXBLRcBUQBFUTcd4QZRFEVRFEVRnCiKoiiKoij6iViYefM+99aENmtK"
    "k9GMFoPmNBjQgjrzpiVV5kMrKsyX1pSZH20oMn/aUmJ62lFgBtqTZwLqyDIhHcgwYzqSMhGdSJiYzsRMQhciJqUrYyZDN0ZMju4ETJ4eDEyBnvRMyQvn"
    "LB8XNC4UJwAAAABJRU5ErkJggg=="
)
PNG_PALETA_INDICES = np.arange(7 * 5, dtype=np.uint8).reshape(5, 7) % 8
PNG_CINZA_INDICES = (np.arange(37 * 23).reshape(23, 37) * 7 % 251).astype(np.uint8)


def oclusao_para_teste() -> dict:
    """Geometria das placas, estatísticas e máscaras PNG calculadas aqui, para os testes do espelho em
    JavaScript acharem os mesmos pixels (`tests/js/oclusao.test.js`)."""
    w, h = 480, 270
    campo = (100.0, 64.0)
    faixas = {
        "laterais": {"distancia": 3.5, "altura": 0.9, "comprimento": None, "vao": 0.0, "ligada": True},
        "fundos": {"distancia": 6.0, "altura": 1.2, "comprimento": 62.0, "vao": 11.0, "ligada": True},
    }
    placas = oclusao.placas_das_faixas(*campo, faixas)
    cameras = {
        "principal": Camera.look_at([2.0, -56.0, 17.0], [-14.0, 10.0, 0.0], 38.0, w, h, k1=-0.04),
        "fundo": Camera.look_at([63.0, 3.0, 11.0], [-20.0, 0.0, 0.0], 52.0, w, h),
        "baixa": Camera.look_at([-10.0, -37.0, 2.4], [8.0, 30.0, 0.8], 30.0, w, h, roll=1.5, k1=-0.02),
    }
    casos = []
    for nome, cam in cameras.items():
        geo = oclusao.geometria(cam, placas, w, h)
        pintura = np.zeros((h, w), np.uint8)
        pintura[90:150, 100:180] = oclusao.PESSOA
        pintura[120:140, 300:330] = oclusao.GRAFISMO
        pintura[60:200, 400:420] = oclusao.NAO_PLACA
        pintura[100:110, 200:204] = oclusao.BOLA
        mascara = oclusao.mascara_efetiva(pintura, geo.roi)
        # outra pintura do mesmo quadro: a pessoa 1 px mais larga (tolerado) e o grafismo 6 px ao lado
        outra = np.zeros_like(pintura)
        outra[89:151, 99:181] = oclusao.PESSOA
        outra[120:140, 306:336] = oclusao.GRAFISMO
        outra[60:200, 400:420] = oclusao.NAO_PLACA
        casos.append(
            {
                "nome": nome,
                "camera": cam.para_rotulo(),
                "info": geo.info,
                "regiao": _rle(geo.regiao),
                "roi": _rle(geo.roi.astype(np.uint8)),
                "estatisticas": oclusao.estatisticas(mascara, geo),
                "comparacao": oclusao.comparar_mascaras(mascara, oclusao.mascara_efetiva(outra, geo.roi), geo),
            }
        )
    return {
        "descricao": "Gerado por scripts/gerar_arquivos_web.py a partir de src/anotacao/oclusao.py; não editar à mão.",
        "largura": w,
        "altura": h,
        "campo": {"comprimento": campo[0], "largura": campo[1]},
        "faixas": faixas,
        "placas": placas,
        "casos": casos,
        "png_paleta": {
            "base64": PNG_PALETA_B64,
            "largura": 7,
            "altura": 5,
            "indices": PNG_PALETA_INDICES.ravel().tolist(),
        },
        "png_cinza": {
            "base64": PNG_CINZA_B64,
            "largura": 37,
            "altura": 23,
            "indices": PNG_CINZA_INDICES.ravel().tolist(),
        },
    }


def arquivos_gerados() -> dict[str, str]:
    """Caminho (relativo à raiz do repositório) -> conteúdo esperado."""
    out = {f"web/esquemas/{nome}": esquema_json(modelo) for nome, modelo in ESQUEMAS.items()}
    out["tests/fixtures/oclusao.json"] = json.dumps(oclusao_para_teste(), ensure_ascii=False) + "\n"
    out["web/exemplo/pacote.json"] = pacote_sintetico().model_dump_json(indent=2) + "\n"
    out["web/exemplo/equipe.json"] = equipe_exemplo().model_dump_json(indent=2) + "\n"
    out["web/exemplo/divisao.json"] = Divisao().model_dump_json(indent=2) + "\n"
    out["tests/fixtures/convencoes.json"] = _json(convencoes_para_teste())
    out["tests/fixtures/pacote_generico.json"] = pacote_generico().model_dump_json(indent=2) + "\n"
    return out


def gravar(raiz: Path = RAIZ) -> list[Path]:
    saidas = []
    for rel, texto in arquivos_gerados().items():
        p = raiz / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if not p.exists() or p.read_text(encoding="utf-8") != texto:
            p.write_text(texto, encoding="utf-8")
            saidas.append(p)
    return saidas
