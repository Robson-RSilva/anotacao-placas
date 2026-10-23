"""Pasta de trabalho: nomes estáveis, escrita atômica e nunca sobrescrever o arquivo de outra pessoa."""

import pytest

from anotacao.convencoes import REF_PACOTE_GENERICO, id_partida, id_quadro, slug
from anotacao.pacote import pacote_generico
from anotacao.pasta import ArquivoExiste, Pasta, escrever_json, ler_json, ler_nome, nome_arquivo


def test_ids():
    assert id_quadro(1234.4) == "t0000001234"
    assert id_quadro(1234.6) == "t0000001235"
    assert (
        id_partida("2026-11-02T16:00", "Estádio Sintético", "São Paulo", "Grêmio")
        == "2026-11-02_estadio-sintetico_sao-paulo-gremio"
    )
    assert slug("  Ação & Reação!! ") == "acao-reacao"
    with pytest.raises(ValueError):
        id_quadro(-1)


def test_nomes_de_arquivo():
    n = nome_arquivo("t0000001234", "A03", 2)
    assert n == "t0000001234__A03__v2.json"
    assert ler_nome(n) == ("t0000001234", "A03", 2)
    assert ler_nome("t0000001234__A03__v2.json.tmp") is None
    assert ler_nome("g0007__B11__v1.json") == ("g0007", "B11", 1)
    # o código é o que a pessoa digitar: 2 a 10 letras ou números, começando por letra
    assert ler_nome("t0000001234__ANACLARA__v3.json") == ("t0000001234", "ANACLARA", 3)
    assert nome_arquivo("t0000001234", "RS", 1) == "t0000001234__RS__v1.json"
    assert ler_nome("t0000001234__R__v1.json") is None
    ruins = [("t12", "A03", 1), ("t0000001234", "a3", 1), ("t0000001234", "A03", 0)]
    ruins += [("t0000001234", "3A", 1), ("t0000001234", "ABCDEFGHIJK", 1)]
    for args in ruins:
        with pytest.raises(ValueError):
            nome_arquivo(*args)


def test_escrita_atomica_sem_sobrescrever(tmp_path):
    p = tmp_path / "x" / "a.json"
    escrever_json(p, {"v": 1})
    assert ler_json(p) == {"v": 1}
    with pytest.raises(ArquivoExiste):
        escrever_json(p, {"v": 2})
    assert ler_json(p) == {"v": 1}
    escrever_json(p, {"v": 3}, sobrescrever=True)
    assert ler_json(p) == {"v": 3}
    assert [q.name for q in p.parent.iterdir()] == ["a.json"]  # nenhum temporário sobrando


def test_caminhos_validam_ids(tmp_path):
    pasta = Pasta(tmp_path)
    with pytest.raises(ValueError):
        pasta.partida("../../etc")
    with pytest.raises(ValueError):
        pasta.quadro("2026-11-02_e_a-b", "../x")
    with pytest.raises(ValueError):
        pasta.pacote_path("Estadio Com Espaco", "1.0")
    assert pasta.quadro("gabarito", "g0001").name == "g0001.jpg"


def test_proxima_versao(tmp_path):
    pasta = Pasta(tmp_path)
    d = tmp_path / "rot"
    assert pasta.proxima_versao(d, "t0000000001", "A01") == 1
    escrever_json(d / nome_arquivo("t0000000001", "A01", 1), {})
    escrever_json(d / nome_arquivo("t0000000001", "A01", 2), {})
    escrever_json(d / nome_arquivo("t0000000001", "A02", 1), {})
    assert pasta.proxima_versao(d, "t0000000001", "A01") == 3
    assert pasta.proxima_versao(d, "t0000000001", "A02") == 2


def test_campo_generico_sem_levantamento(tmp_path):
    pasta = Pasta(tmp_path / "nova")
    pasta.criar()
    assert pasta.listar_pacotes() == [REF_PACOTE_GENERICO]  # a pasta nova já vem com ele
    assert pasta.ler_pacote_ref(REF_PACOTE_GENERICO) == pacote_generico()
    antiga = Pasta(tmp_path / "antiga")  # criada antes do campo genérico
    antiga.raiz.mkdir()
    assert antiga.listar_pacotes() == []
    assert antiga.ler_pacote_ref(REF_PACOTE_GENERICO) == pacote_generico()
    with pytest.raises(OSError):
        antiga.ler_pacote_ref("arena-x/pacote-1.0")
    gen = pacote_generico()
    assert gen.placas == [] and (gen.campo.comprimento, gen.campo.largura) == (105.0, 68.0)
    assert {c.tipo for c in gen.cameras} >= {"principal", "16m", "fundo", "reversa"}
