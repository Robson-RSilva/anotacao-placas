"""A máscara PNG: ida e volta, o PNG em cinza do OpenCV e os PNGs fixos do fixture das páginas."""

from __future__ import annotations

import base64

import cv2
import numpy as np
import pytest

from anotacao.mascara import eh_png, gravar_png, ler_png
from anotacao.previsores import PALETA_JOGADORES

OITO_CORES = [
    (0, 0, 0),
    (52, 152, 219),
    (231, 76, 60),
    (241, 196, 15),
    (155, 89, 182),
    (230, 126, 34),
    (26, 188, 156),
    (127, 140, 141),
]


def test_png_ida_e_volta_e_o_do_opencv():
    m = (np.arange(37 * 23).reshape(23, 37) % 8).astype(np.uint8)
    png = gravar_png(m, OITO_CORES)
    assert eh_png(png)
    assert np.array_equal(ler_png(png), m)
    # o OpenCV lê a paleta como cores: por isso o leitor é próprio
    assert cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_UNCHANGED).ndim == 3
    # o PNG em tons de cinza que o OpenCV grava (a previsão de um modelo) também serve
    ok, cinza = cv2.imencode(".png", m * 30)
    assert ok and np.array_equal(ler_png(cinza.tobytes()), m * 30)
    with pytest.raises(ValueError, match="não é um PNG"):
        ler_png(b"nada")


def test_mascara_dos_jogadores():
    m = np.zeros((9, 16), np.uint8)
    m[2:6, 3:7] = 1
    assert np.array_equal(ler_png(gravar_png(m, PALETA_JOGADORES)), m)


def test_pngs_fixos_do_fixture_dizem_os_pixels_deles():
    """Os PNGs do fixture das páginas têm os bytes fixos (o zlib de cada sistema comprime diferente): eles
    continuam dizendo os mesmos pixels, e o `gravar_png` e o OpenCV de agora gravam PNGs com esses pixels."""
    from anotacao.geracao import PNG_CINZA_B64, PNG_CINZA_INDICES, PNG_PALETA_B64, PNG_PALETA_INDICES

    assert np.array_equal(ler_png(base64.b64decode(PNG_PALETA_B64)), PNG_PALETA_INDICES)
    assert np.array_equal(ler_png(base64.b64decode(PNG_CINZA_B64)), PNG_CINZA_INDICES)
    assert np.array_equal(ler_png(gravar_png(PNG_PALETA_INDICES, OITO_CORES)), PNG_PALETA_INDICES)
    ok, cinza = cv2.imencode(".png", PNG_CINZA_INDICES)
    assert ok and np.array_equal(ler_png(cinza.tobytes()), PNG_CINZA_INDICES)
