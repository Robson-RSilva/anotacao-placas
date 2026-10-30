"""Pasta de trabalho: nomes estáveis, escrita atômica e nunca sobrescrever o arquivo de outra pessoa."""

import pytest

from anotacao.convencoes import id_partida, id_quadro, slug
from anotacao.pasta import ArquivoExiste, Pasta, escrever_bytes, escrever_json, ler_json, ler_nome, nome_arquivo


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
        pasta.rotulos("2026-11-02_e_a-b", "camera")  # tarefa das versões até a 0.7
    assert pasta.quadro("gabarito", "g0001").name == "g0001.jpg"
    assert pasta.mascara_gabarito("g2001").name == "g2001.png"
    assert pasta.rotulos("gabarito", "jogadores") == tmp_path / "gabarito" / "rotulos" / "jogadores"
    p = "2026-11-02_e_a-b"
    assert pasta.previsao_pontos(p, "t0000000001").parts[-3:] == ("previsoes", "pontos", "t0000000001.json")
    assert pasta.previsao_jogadores(p, "t0000000001").parts[-3:] == ("previsoes", "jogadores", "t0000000001.png")


def test_proxima_versao(tmp_path):
    pasta = Pasta(tmp_path)
    d = tmp_path / "rot"
    assert pasta.proxima_versao(d, "t0000000001", "A01") == 1
    escrever_json(d / nome_arquivo("t0000000001", "A01", 1), {})
    escrever_json(d / nome_arquivo("t0000000001", "A01", 2), {})
    escrever_json(d / nome_arquivo("t0000000001", "A02", 1), {})
    assert pasta.proxima_versao(d, "t0000000001", "A01") == 3
    assert pasta.proxima_versao(d, "t0000000001", "A02") == 2
    # a máscara de uma gravação interrompida (sem o rótulo) também conta: o nome nunca se repete
    escrever_bytes(d / "t0000000001__A02__v4.png", b"\x89PNG")
    assert pasta.proxima_versao(d, "t0000000001", "A02") == 5


def test_pasta_nova(tmp_path):
    pasta = Pasta(tmp_path / "nova")
    pasta.criar()
    assert sorted(p.name for p in pasta.raiz.iterdir()) == [
        "conjuntos",
        "divisao.json",
        "equipe.json",
        "gabarito",
        "partidas",
    ]
    assert pasta.ler_equipe().membros == [] and pasta.listar_partidas() == []
    pasta.criar()  # de novo: não mexe no que existe
