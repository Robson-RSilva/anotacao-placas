"""Os formatos recusam arquivo incoerente."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from anotacao.formatos import (
    DispositivoPessoa,
    Divisao,
    GabaritoJogadores,
    GabaritoPontos,
    Manifesto,
    PrevisaoPontos,
    Projeto,
    RevisaoJogadores,
    RevisaoPontos,
    RotuloJogadores,
    RotuloPontos,
)

PARTIDA = "2026-11-02_estadio-sintetico_time-a-time-b"


def _base(**kw):
    base = dict(
        partida=PARTIDA,
        quadro="t0000012340",
        anotador="A01",
        versao=1,
        ferramenta="0.8.0",
        criado_em=datetime.now(UTC),
        segundos_ativos=31.0,
        largura=1280,
        altura=720,
        partiu_de={"fonte": "nenhuma"},
        situacao="ok",
    )
    base.update(kw)
    return base


def pontos(**kw):
    kw.setdefault("pontos", [{"ponto": "centro", "x": 640.0, "y": 360.0}, {"ponto": "meio_cab", "x": 600.5, "y": 700}])
    return RotuloPontos(**_base(manual="pontos-0.1", **kw))


def jogadores(**kw):
    kw.setdefault("mascara", "t0000012340__A01__v1.png")
    kw.setdefault("pixels", 1500)
    return RotuloJogadores(**_base(manual="jogadores-0.1", **kw))


def test_rotulos_validos():
    r = pontos()
    assert r.formato == "rotulo.pontos/1"
    assert RotuloPontos.model_validate_json(r.model_dump_json()) == r
    assert next(iter(r.model_dump())) == "formato"  # o formato vem primeiro no arquivo
    assert pontos(pontos=[]).pontos == []  # nenhum ponto à vista: vale (a imagem entra sem pontos)
    d = pontos(pontos=[], situacao="descartada", motivo_descarte="transicao")
    assert d.motivo_descarte == "transicao"
    j = jogadores()
    assert j.formato == "rotulo.jogadores/1" and j.pixels == 1500
    assert jogadores(pixels=0).pixels == 0  # nenhum jogador: a máscara toda 0
    assert jogadores(mascara=None, pixels=0, situacao="descartada", motivo_descarte="borrao").mascara is None


@pytest.mark.parametrize(
    "mudanca, trecho",
    [
        (dict(pontos=[{"ponto": "nao_existe", "x": 1, "y": 2}]), "ponto desconhecido"),
        (dict(pontos=[{"ponto": "circ_esq", "x": 1, "y": 2}]), "ponto desconhecido"),  # não se marca
        (dict(pontos=[{"ponto": "centro", "x": 1, "y": 2}, {"ponto": "centro", "x": 3, "y": 4}]), "duas vezes"),
        (dict(pontos=[{"ponto": "centro", "x": 1290, "y": 2}]), "fora da imagem"),
        (dict(pontos=[{"ponto": "centro", "x": -0.5, "y": 2}]), "fora da imagem"),
        (dict(situacao="descartada"), "motivo do descarte"),
        (dict(motivo_descarte="borrao"), "motivo do descarte"),
        (dict(situacao="descartada", motivo_descarte="borrao"), "não leva pontos"),
        (dict(pontos=[], situacao="descartada", motivo_descarte="outro"), "exige comentário"),
        (dict(quadro="t12"), "quadro inválido"),
        (dict(partida="../fora"), "partida inválida"),
        (dict(anotador="ana"), "pattern"),
    ],
)
def test_rotulo_de_pontos_incoerente(mudanca, trecho):
    with pytest.raises(ValidationError, match=trecho):
        pontos(**mudanca)


@pytest.mark.parametrize(
    "mudanca, trecho",
    [
        (dict(mascara=None, pixels=0), "a máscara vem sempre"),
        (dict(situacao="descartada", motivo_descarte="borrao"), "a máscara vem sempre"),
        (dict(mascara=None, pixels=3, situacao="descartada", motivo_descarte="borrao"), "pixels pintados só"),
        (dict(mascara="outra.png"), "nome da máscara"),
        (dict(pixels=1280 * 720 + 1), "mais pixels"),
    ],
)
def test_rotulo_dos_jogadores_incoerente(mudanca, trecho):
    with pytest.raises(ValidationError, match=trecho):
        jogadores(**mudanca)


def test_revisao_regras():
    base = dict(
        partida=PARTIDA,
        quadro="t0000012340",
        rotulo="t0000012340__A01__v1.json",
        revisor="A02",
        versao=1,
        ferramenta="0.8.0",
        manual="revisao-0.2",
        criado_em=datetime.now(UTC),
        segundos_ativos=5,
    )
    for modelo, motivo, alheio in (
        (RevisaoPontos, "nome_trocado", "faltou_jogador"),
        (RevisaoJogadores, "faltou_jogador", "nome_trocado"),
    ):
        assert modelo(decisao="aprovar", **base).formato.startswith("revisao.")
        modelo(decisao="devolver", motivo=motivo, **base)
        modelo(decisao="devolver", motivo="descarte_errado", **base)
        with pytest.raises(ValidationError):
            modelo(decisao="devolver", motivo=alheio, **base)  # motivo da outra tarefa
        with pytest.raises(ValidationError):
            modelo(decisao="devolver", **base)
        with pytest.raises(ValidationError):
            modelo(decisao="corrigir", **base)
        with pytest.raises(ValidationError):
            modelo(decisao="devolver", motivo="outro", **base)
        modelo(decisao="corrigir", nova_versao="t0000012340__A02__v1.json", **base)


def test_itens_do_gabarito():
    g = GabaritoPontos(
        id="g1001",
        lote="P1-treino",
        imagem="g1001.jpg",
        largura=1280,
        altura=720,
        pontos=[
            {"ponto": "centro", "x": 640, "y": 360, "visivel": True},
            {"ponto": "meio_cab", "x": 3, "y": 4, "visivel": False},
        ],
        origem="simulador",
    )
    assert g.pontos[1].visivel is False
    with pytest.raises(ValidationError, match="duas vezes"):
        GabaritoPontos(**{**g.model_dump(), "pontos": [g.pontos[0].model_dump()] * 2})
    with pytest.raises(ValidationError, match="fora da imagem"):
        GabaritoPontos(**{**g.model_dump(), "pontos": [{"ponto": "centro", "x": 2000, "y": 1, "visivel": True}]})
    j = GabaritoJogadores(
        id="g2001", imagem="g2001.jpg", mascara="g2001.png", largura=1280, altura=720, jogadores=12, origem="simulador"
    )
    assert j.lote == ""
    assert j.outras_pessoas == 0
    with pytest.raises(ValidationError, match="não cabem"):
        GabaritoJogadores(**{**j.model_dump(), "jogadores": 250, "outras_pessoas": 6})
    with pytest.raises(ValidationError):
        GabaritoPontos(**{**g.model_dump(), "id": "g12"})


def test_previsao_de_pontos():
    p = PrevisaoPontos(
        partida=PARTIDA, quadro="t0000000040", fonte="det", versao="1", pontos=[{"ponto": "centro", "x": 1, "y": 2}]
    )
    assert p.formato == "previsao.pontos/1"
    with pytest.raises(ValidationError, match="duas vezes"):
        PrevisaoPontos(**{**p.model_dump(), "pontos": [p.pontos[0].model_dump()] * 2})


def test_manifesto_da_0_7_ainda_vale():
    """As partidas importadas até a 0.7 têm o pacote do estádio no manifesto: continuam valendo."""
    cadastro = {"estadio": "estadio-sintetico", "emissora": "X", "competicao": "Y", "mandante": "A", "visitante": "B"}
    cadastro |= {"data_hora": "2026-11-02T16:00:00-03:00", "iluminacao": "dia", "chuva": False}
    video = {"nome_original": "a.mp4", "sha256": "0" * 64, "bytes": 1, "duracao_s": 1, "fps": 25, "largura": 640}
    video |= {"altura": 360, "n_quadros": 25}
    pre = {"ferramenta": "0.7.0", "criado_em": "2026-11-02T16:00:00Z", "segundos": 1, "parametros": {}}
    base = {"partida": PARTIDA, "cadastro": cadastro, "video": video, "pre_processamento": pre}
    assert Manifesto(**base).pacote is None
    antigo = Manifesto(**base, pacote="generico/pacote-1.0")
    assert antigo.pacote == "generico/pacote-1.0"
    with pytest.raises(ValidationError):
        Manifesto(**base, pacote="../x")


def test_registro_do_codigo_num_computador():
    d = DispositivoPessoa(codigo="AB", dispositivo="3f2a6c1e-8b9d-4e2f-a1b3-c4d5e6f70812", criado_em=datetime.now(UTC))
    assert d.formato == "pessoa.dispositivo/1"
    for ruim in ({"codigo": "ab"}, {"dispositivo": "../../x"}, {"dispositivo": "3F2A6C1E-8B9D-4E2F-A1B3-C4D5E6F70812"}):
        with pytest.raises(ValidationError):
            DispositivoPessoa(**{**d.model_dump(), **ruim})


def test_divisao_sem_sobreposicao():
    p = PARTIDA
    assert Divisao(teste_congelado=[p]).conjunto(p) == "teste_congelado"
    assert Divisao().conjunto(p) == "treino"
    with pytest.raises(ValidationError):
        Divisao(validacao=[p], teste_congelado=[p])


def test_projeto_so_aceita_link_https():
    assert Projeto().manual_url == ""
    assert Projeto(manual_url="https://claude.ai/artifact/abc").manual_url.startswith("https://")
    with pytest.raises(ValidationError):
        Projeto(manual_url="javascript:alert(1)")
    with pytest.raises(ValidationError):
        Projeto(manual_url="http://exemplo.com")
