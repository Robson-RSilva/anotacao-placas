"""Arquivos que saem das definições em Python e que as páginas (ou os testes delas) leem.

* `web/esquemas/*.json` — JSON Schemas dos formatos (as páginas validam por eles antes de gravar);
* `tests/fixtures/convencoes.json` — as convenções, os pontos que se marcam e os nomes sob a rotação
  de 180 graus, para os testes dos espelhos em JavaScript;
* `tests/fixtures/png.json` — dois PNGs (do Python e do OpenCV, com os bytes fixos), para o leitor de
  PNG das páginas;
* `tests/fixtures/regioes.json` — polígonos e os pixels dentro de cada um, para a região da placa dar os
  mesmos pixels nas páginas e no Python.

`python scripts/gerar_arquivos_web.py` grava todos; `tests/test_arquivos_gerados.py` falha quando
algum fica desatualizado.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import __version__
from .campo import PONTOS_SEM_MARCA, perm180_dos_nomes, pontos_marcaveis
from .convencoes import (
    MANUAL,
    PARTIDA_GABARITO,
    RE_ARQUIVO,
    RE_DISPOSITIVO,
    RE_ESTADIO,
    RE_GABARITO,
    RE_LOTE,
    RE_MASCARA,
    RE_PACOTE_REF,
    RE_PARTIDA,
    RE_PESSOA,
    RE_QUADRO,
    RE_RECORTE,
    RE_VERSAO_PACOTE,
    REF_H,
    REF_W,
    TAREFAS,
    id_partida,
    id_quadro,
    slug,
)
from .formatos import ESQUEMAS, MOTIVOS_DESCARTE, esquema_json
from .mascara import rasterizar

RAIZ = Path(__file__).resolve().parents[2]


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
        "tarefas": list(TAREFAS),
        "manual": MANUAL,
        "partida_gabarito": PARTIDA_GABARITO,
        "motivos_descarte": {t: list(m) for t, m in MOTIVOS_DESCARTE.items()},
        "pontos_marcaveis": pontos_marcaveis(),
        "pontos_sem_marca": list(PONTOS_SEM_MARCA),
        "perm180": perm180_dos_nomes(),
        "regex": {
            "RE_ESTADIO": RE_ESTADIO.pattern,
            "RE_VERSAO_PACOTE": RE_VERSAO_PACOTE.pattern,
            "RE_PARTIDA": RE_PARTIDA.pattern,
            "RE_QUADRO": RE_QUADRO.pattern,
            "RE_RECORTE": RE_RECORTE.pattern,
            "RE_LOTE": RE_LOTE.pattern,
            "RE_GABARITO": RE_GABARITO.pattern,
            "RE_PESSOA": RE_PESSOA.pattern,
            "RE_PACOTE_REF": RE_PACOTE_REF.pattern,
            "RE_DISPOSITIVO": RE_DISPOSITIVO.pattern,
            "RE_MASCARA": RE_MASCARA.pattern,
            "RE_ARQUIVO": RE_ARQUIVO.pattern,
        },
        "slug": [[t, slug(t)] for t in textos],
        "id_quadro": [[p, id_quadro(p)] for p in pts],
        "id_partida": [[*a, id_partida(*a)] for a in partidas],
    }


# Os dois PNGs do fixture ficam fixos aqui, e não são gerados a cada vez: o zlib de cada Python (e de
# cada sistema) comprime do seu jeito, e o que o teste do espelho confere é a leitura, não os bytes.
# Gerados uma vez com `gravar_png(PNG_PALETA_INDICES, <uma paleta de 8 cores>)` e com o OpenCV
# (`cv2.imencode(".png", PNG_CINZA_INDICES)`); `tests/test_mascara.py` confere que dizem esses pixels.
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


def png_para_teste() -> dict:
    """Dois PNGs com os bytes fixos e os pixels deles, para o leitor de PNG das páginas
    (`tests/js/png.test.js`) ler o mesmo que o Python."""
    return {
        "descricao": "Gerado por scripts/gerar_arquivos_web.py a partir de src/anotacao/geracao.py; não editar à mão.",
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


#: Polígonos de teste num recorte de 37 x 23 px: o retângulo de um recorte (cantos inteiros e
#: quebrados), a placa cortada pela borda do quadro, um triângulo, um polígono que sai do recorte e
#: um côncavo.
REGIOES_DE_TESTE = [
    [[4, 3], [33, 3], [33, 20], [4, 20]],
    [[4.5, 2.5], [32.5, 2.49], [32.51, 19.5], [4.49, 19.51]],
    [[0, 3], [20.3, 3], [26.7, 20], [0, 20]],
    [[1.2, 22.4], [18.5, 0.6], [35.9, 22.4]],
    [[-3, -2], [40, 5.5], [30, 30], [2, 25]],
    [[3, 3], [34, 3], [34, 20], [18.5, 9.5], [3, 20]],
]


def regioes_para_teste() -> dict:
    """Polígonos e os pixels dentro de cada um (uma linha de "0" e "1" por linha de pixels), para o
    `rasterizar` das páginas (`tests/js/regiao.test.js`) dar o mesmo que o do Python."""
    w, h = 37, 23
    casos = []
    for pol in REGIOES_DE_TESTE:
        m = rasterizar(pol, w, h)
        casos.append({"poligono": pol, "linhas": ["".join("1" if v else "0" for v in linha) for linha in m]})
    return {
        "descricao": "Gerado por scripts/gerar_arquivos_web.py a partir de src/anotacao/geracao.py; não editar à mão.",
        "largura": w,
        "altura": h,
        "casos": casos,
    }


def arquivos_gerados() -> dict[str, str]:
    """Caminho (relativo à raiz do repositório) -> conteúdo esperado."""
    out = {f"web/esquemas/{nome}": esquema_json(modelo) for nome, modelo in ESQUEMAS.items()}
    out["tests/fixtures/convencoes.json"] = _json(convencoes_para_teste())
    out["tests/fixtures/png.json"] = _json(png_para_teste())
    out["tests/fixtures/regioes.json"] = _json(regioes_para_teste())
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
