"""Trechos do vídeo escritos como na página (o mesmo leitor do `anotacao baixar`)."""

import math

import pytest

from anotacao.trechos import ErroTrechos, formatar_trechos, ler_tempo, ler_trechos, tempo_exato


def test_tempo():
    assert ler_tempo("1:05:00") == 3900
    assert ler_tempo("65:00") == 3900
    assert ler_tempo("90:00") == 5400
    assert ler_tempo(" 3900 ") == 3900
    assert ler_tempo("0:00:01.5") == 1.5
    for ruim in ["", "1:60", "1:5:70", "1:2:3:4", "-5", "1,5", "abc", "1:", "١٢"]:
        assert math.isnan(ler_tempo(ruim)), ruim


def test_trechos_em_ordem_e_juntos():
    assert ler_trechos("") is None and ler_trechos(None) is None and ler_trechos(" ,;\n") is None
    assert ler_trechos("1:05:00 – 1:50:00; 0:05:00-0:50:00") == [(300, 3000), (3900, 6600)]
    assert ler_trechos("5:00 a 50:00\n65:00 até 110:00") == [(300, 3000), (3900, 6600)]
    assert ler_trechos("5:00 ATÉ 6:00") == [(300, 360)]
    assert ler_trechos("10-20, 15-30, 30-40, 50-60") == [(10, 40), (50, 60)]


@pytest.mark.parametrize(
    "texto, trecho",
    [("0:05:00", "0:05:00"), ("5:00-50:00, primeiro tempo", "primeiro tempo"), ("5:00a50:00", "5:00a50:00")],
)
def test_trecho_ilegivel_diz_qual(texto, trecho):
    with pytest.raises(ErroTrechos, match=f"“{trecho}”"):
        ler_trechos(texto)


def test_trecho_ao_contrario():
    with pytest.raises(ErroTrechos, match="termina antes de começar"):
        ler_trechos("50:00-5:00")


def test_tempo_exato_volta_igual():
    assert [tempo_exato(s) for s in (0, 2.2, 300, 3599.5, 3900, 6600.25)] == [
        "0:00",
        "0:02.2",
        "5:00",
        "59:59.5",
        "1:05:00",
        "1:50:00.25",
    ]
    t = [(2.2, 3.8), (300, 3000), (3900, 6600.25)]
    assert formatar_trechos(t) == "0:02.2-0:03.8, 5:00-50:00, 1:05:00-1:50:00.25"
    assert ler_trechos(formatar_trechos(t)) == t
