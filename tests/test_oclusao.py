"""Oclusão nas placas: a máscara PNG, as faixas de placas, a geometria, as estatísticas por placa e os
formatos (rotulo.oclusao/1, revisao.oclusao/1, gabarito.oclusao/1)."""

from __future__ import annotations

import base64

import cv2
import numpy as np
import pytest
from pydantic import ValidationError

from anotacao import oclusao
from anotacao.camera import Camera
from anotacao.formatos import Faixa, GabaritoOclusao, RevisaoOclusao, RotuloOclusao
from anotacao.mascara import eh_png, gravar_png, ler_png

from conftest import AGORA, PARTIDA, camera_exemplo, placas_do_pacote


def test_png_ida_e_volta_e_o_do_opencv():
    m = (np.arange(37 * 23).reshape(23, 37) % 8).astype(np.uint8)
    png = gravar_png(m, oclusao.PALETA)
    assert eh_png(png)
    assert np.array_equal(ler_png(png), m)
    # o OpenCV lê a paleta como cores: por isso o leitor é próprio
    assert cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_UNCHANGED).ndim == 3
    # o PNG em tons de cinza que o OpenCV grava (a previsão de um modelo) também serve
    ok, cinza = cv2.imencode(".png", m * 30)
    assert ok and np.array_equal(ler_png(cinza.tobytes()), m * 30)
    with pytest.raises(ValueError, match="não é um PNG"):
        ler_png(b"nada")


def test_pngs_fixos_do_fixture_dizem_os_pixels_deles():
    """Os PNGs do fixture do espelho têm os bytes fixos (o zlib de cada sistema comprime diferente): eles
    continuam dizendo os mesmos pixels, e o `gravar_png` e o OpenCV de agora gravam PNGs com esses pixels."""
    from anotacao.geracao import PNG_CINZA_B64, PNG_CINZA_INDICES, PNG_PALETA_B64, PNG_PALETA_INDICES

    assert np.array_equal(ler_png(base64.b64decode(PNG_PALETA_B64)), PNG_PALETA_INDICES)
    assert np.array_equal(ler_png(base64.b64decode(PNG_CINZA_B64)), PNG_CINZA_INDICES)
    assert np.array_equal(ler_png(gravar_png(PNG_PALETA_INDICES, oclusao.PALETA)), PNG_PALETA_INDICES)
    ok, cinza = cv2.imencode(".png", PNG_CINZA_INDICES)
    assert ok and np.array_equal(ler_png(cinza.tobytes()), PNG_CINZA_INDICES)


def test_faixas_reproduzem_o_estadio_do_laboratorio():
    """Laterais de 96 m e fundos de 60 m com um vão de 12 m atrás do gol: as placas do laboratório."""
    faixas = {
        "laterais": {"distancia": 4.0, "altura": 0.98, "comprimento": 96.0, "vao": 0.0, "ligada": True},
        "fundos": {"distancia": 5.0, "altura": 0.98, "comprimento": 60.0, "vao": 12.0, "ligada": True},
    }
    placas = oclusao.placas_das_faixas(105.0, 68.0, faixas)
    esq = [p for p in placas if p["lado"] == "esq"]
    assert len([p for p in placas if p["lado"] == "opo"]) == 12 and len(esq) == 6
    assert [(p["vertices"][0][1] + p["vertices"][1][1]) / 2 for p in esq] == [-26.0, -18.0, -10.0, 10.0, 18.0, 26.0]
    assert all(p["vertices"][0][0] == -57.5 for p in esq)
    padrao = oclusao.placas_das_faixas(105.0, 68.0, oclusao.faixas_padrao())
    assert {p["lado"] for p in padrao} == {"opo", "cab", "esq", "dir"}
    with pytest.raises(ValidationError, match="vão"):
        Faixa(distancia=4, altura=1, comprimento=10, vao=12)


def test_geometria_e_estatisticas():
    cam = camera_exemplo()
    placas = placas_do_pacote()
    geo = oclusao.geometria(cam, placas, cam.w, cam.h)
    pintaveis = [p for p in geo.info if not p["pequena"]]
    assert pintaveis and all(p["lado"] == "opo" for p in geo.info)  # as das cabines estão de costas
    assert geo.roi.sum() > 0 and not (geo.roi & (geo.regiao == 0)).any()
    # nada pintado: tudo livre; uma pessoa pintada numa placa baixa a fração dela
    vazia = oclusao.mascara_efetiva(np.zeros((cam.h, cam.w), np.uint8), geo.roi)
    est = oclusao.estatisticas(vazia, geo)
    assert all(p["livre_frac"] == 1.0 for p in est if not p["pequena"] and p["outra_placa_px"] == 0)
    alvo = pintaveis[0]
    ys, xs = np.nonzero(geo.regiao == alvo["k"] + 1)
    pintura = np.zeros((cam.h, cam.w), np.uint8)
    pintura[ys.min() : ys.max() + 1, xs.min() : (xs.min() + xs.max()) // 2] = oclusao.PESSOA
    pintura[0:5, 0:5] = oclusao.PESSOA  # fora das placas: não conta
    m = oclusao.mascara_efetiva(pintura, geo.roi)
    assert not m[0:5, 0:5].any()
    p = next(x for x in oclusao.estatisticas(m, geo) if x["id"] == alvo["id"])
    assert 0.2 < p["livre_frac"] < 0.8
    assert p["livre_px"] + p["pessoa_px"] + p["outra_placa_px"] == p["area_px"]
    cmp = oclusao.comparar([p], [next(x for x in est if x["id"] == alvo["id"])], cam.w)
    assert cmp["n"] == 1 and abs(cmp["maxima"] - (1 - p["livre_frac"])) < 1e-3


def _rotulo(**kw) -> dict:
    cam = camera_exemplo()
    base = {
        "partida": PARTIDA,
        "pacote": "estadio-sintetico/pacote-1.0",
        "quadro": "t0000001000",
        "anotador": "A01",
        "versao": 1,
        "ferramenta": "0.7.0",
        "manual": "oclusao-0.1",
        "criado_em": AGORA,
        "segundos_ativos": 10,
        "largura": cam.w,
        "altura": cam.h,
        "camera": cam.para_rotulo(),
        "placas_de": "pacote",
        "partiu_de": {"fonte": "nenhuma"},
        "situacao": "camera_errada",
    }
    return {**base, **kw}


def test_regras_do_rotulo_da_oclusao():
    assert RotuloOclusao(**_rotulo()).mascara is None
    placa = {"id": "OPO_01", "area_px": 10, "outra_placa_px": 0, "livre_px": 10, "pessoa_px": 0, "bola_px": 0,
             "rede_px": 0, "grafismo_px": 0, "objeto_px": 0, "nao_placa_px": 0, "livre_frac": 1.0,
             "altura_ref_px": 12.0, "pequena": False}  # fmt: skip
    ok = RotuloOclusao(**_rotulo(situacao="ok", mascara="t0000001000__A01__v1.png", placas=[placa]))
    assert ok.placas[0].livre_frac == 1.0
    casos = [
        (_rotulo(situacao="ok"), "exige a máscara"),
        (_rotulo(situacao="ok", mascara="t0000001000__A01__v1.png", placas=[{**placa, "pequena": True}]), "placa"),
        (_rotulo(mascara="t0000001000__A01__v1.png", placas=[placa]), "não leva máscara"),
        (_rotulo(situacao="duvida"), "comentário"),
        (_rotulo(placas_de="faixas"), "faixas"),
        (_rotulo(placas_de="gabarito"), "gabarito"),
        (_rotulo(situacao="ok", mascara="outra.png", placas=[placa]), "nome da máscara"),
        (_rotulo(placas=[placa]), "só vêm com a máscara"),
    ]
    for dados, erro in casos:
        with pytest.raises(ValidationError, match=erro):
            RotuloOclusao(**dados)


def test_regras_da_revisao_e_do_gabarito_da_oclusao():
    rev = {"partida": PARTIDA, "quadro": "t0000001000", "rotulo": "t0000001000__A01__v1.json", "revisor": "A02",
           "versao": 1, "decisao": "devolver", "motivo": "classe_errada", "ferramenta": "0.7.0",
           "manual": "revisao-0.1", "criado_em": AGORA, "segundos_ativos": 3}  # fmt: skip
    assert RevisaoOclusao(**rev).motivo == "classe_errada"
    with pytest.raises(ValidationError):
        RevisaoOclusao(**{**rev, "motivo": "lado_trocado"})  # motivo da câmera
    cam = Camera.look_at([0.0, -58.0, 14.0], [-8.0, 0.0, 0.0], 38.0, 640, 360)
    g = {"id": "g0401", "pacote": "generico/pacote-1.0", "imagem": "g0401.jpg", "mascara": "g0401.png",
         "largura": 640, "altura": 360, "camera": cam.para_rotulo(), "placas": placas_do_pacote()[:2],
         "origem": "simulador"}  # fmt: skip
    assert GabaritoOclusao(**g).placas[0].id == "OPO_01"
    with pytest.raises(ValidationError, match="repetidos"):
        GabaritoOclusao(**{**g, "placas": placas_do_pacote()[:1] * 2})
    with pytest.raises(ValidationError):
        GabaritoOclusao(**{**g, "placas": []})
