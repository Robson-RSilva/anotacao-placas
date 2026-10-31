"""Os formatos recusam arquivo incoerente."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from anotacao.formatos import (
    DispositivoPessoa,
    Divisao,
    GabaritoPlacas,
    GabaritoPontos,
    ItemRecorte,
    LoteRecortes,
    Manifesto,
    PrevisaoPontos,
    Projeto,
    RevisaoPlacas,
    RevisaoPontos,
    RotuloPlacas,
    RotuloPontos,
)

PARTIDA = "2026-11-02_estadio-sintetico_time-a-time-b"
RECORTE = "t0000012340_opo-03"


def _base(**kw):
    base = dict(
        partida=PARTIDA,
        anotador="A01",
        versao=1,
        ferramenta="0.10.0",
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
    kw.setdefault("quadro", "t0000012340")
    kw.setdefault("pontos", [{"ponto": "centro", "x": 640.0, "y": 360.0}, {"ponto": "meio_cab", "x": 600.5, "y": 700}])
    return RotuloPontos(**_base(manual="pontos-0.1", **kw))


def placas(**kw):
    kw.setdefault("recorte", RECORTE)
    kw.setdefault("mascara", f"{RECORTE}__A01__v1.png")
    kw.setdefault("pixels", 1500)
    return RotuloPlacas(**_base(manual="placas-0.1", **kw))


def test_rotulos_validos():
    r = pontos()
    assert r.formato == "rotulo.pontos/1"
    assert RotuloPontos.model_validate_json(r.model_dump_json()) == r
    assert next(iter(r.model_dump())) == "formato"  # o formato vem primeiro no arquivo
    assert pontos(pontos=[]).pontos == []  # nenhum ponto à vista: vale (a imagem entra sem pontos)
    d = pontos(pontos=[], situacao="descartada", motivo_descarte="transicao")
    assert d.motivo_descarte == "transicao"
    j = placas()
    assert j.formato == "rotulo.placas/1" and j.pixels == 1500
    assert placas(pixels=0).pixels == 0  # nada na frente da placa: a máscara toda 0
    d = placas(mascara=None, pixels=0, situacao="descartada", motivo_descarte="placa_fora_do_lugar")
    assert d.mascara is None
    assert placas(recorte="g4001", partida="gabarito", mascara="g4001__A01__v1.png").recorte == "g4001"


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
        (dict(mascara=None, pixels=0, situacao="descartada", motivo_descarte="outro"), "exige comentário"),
    ],
)
def test_rotulo_das_placas_incoerente(mudanca, trecho):
    with pytest.raises(ValidationError, match=trecho):
        placas(**mudanca)


@pytest.mark.parametrize(
    "mudanca",
    [
        dict(recorte="t0000012340"),  # um quadro, não um recorte
        dict(recorte="t0000012340_OPO"),
        dict(recorte="t0000012340_opo__03"),
        dict(mascara=None, pixels=0, situacao="descartada", motivo_descarte="grafismo"),  # nas placas, se pinta
        dict(quadro="t0000012340"),  # o campo dos pontos
    ],
)
def test_rotulo_das_placas_recusa(mudanca):
    with pytest.raises(ValidationError):
        placas(**mudanca)


def test_revisao_regras():
    comum = dict(
        partida=PARTIDA,
        rotulo="t0000012340__A01__v1.json",
        revisor="A02",
        versao=1,
        ferramenta="0.10.0",
        manual="revisao-0.4",
        criado_em=datetime.now(UTC),
        segundos_ativos=5,
    )
    for modelo, item, motivo, alheio in (
        (RevisaoPontos, {"quadro": "t0000012340"}, "nome_trocado", "faltou_pintar"),
        (RevisaoPlacas, {"recorte": RECORTE}, "faltou_pintar", "nome_trocado"),
    ):
        base = {**comum, **item}
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
    regiao = [[10, 8], [290, 8], [290, 62], [10, 62]]
    j = GabaritoPlacas(
        id="g4001",
        imagem="g4001.jpg",
        mascara="g4001.png",
        largura=300,
        altura=70,
        regiao=regiao,
        oclusores=3,
        origem="simulador",
    )
    assert j.lote == "" and j.formato == "gabarito.placas/1" and j.resposta == "pintar"
    assert GabaritoPlacas(**{**j.model_dump(), "oclusores": 0}).oclusores == 0  # nada na frente: vale
    d = GabaritoPlacas(**{**j.model_dump(), "mascara": None, "oclusores": 0, "resposta": "descartar"})
    assert d.resposta == "descartar"
    for ruim in (
        {"oclusores": 256},  # os números vão até 255
        {"mascara": None},  # pintar precisa da máscara
        {"resposta": "descartar"},  # descartar não leva máscara
        {"mascara": None, "resposta": "descartar"},  # nem o que pintar
        {"regiao": [[10, 8], [301, 8], [290, 62]]},  # a região sai do recorte
        {"regiao": [[10, 8], [20, 8], [30, 8]]},  # sem área
        {"pessoas": 3},  # o campo da 0.9
    ):
        with pytest.raises(ValidationError):
            GabaritoPlacas(**{**j.model_dump(), **ruim})
    with pytest.raises(ValidationError):
        GabaritoPontos(**{**g.model_dump(), "id": "g12"})


def test_lote_de_recortes():
    item = {
        "recorte": RECORTE,
        "largura": 300,
        "altura": 70,
        "regiao": [[10, 8], [290, 8], [290, 62], [10, 62]],
        "placa": [[10, 8], [290, 8], [290, 62], [10, 62]],
        "no_quadro": [[512.2, 100.5], [903.0, 120.25], [902.5, 160.0], [511.0, 141.0]],
    }
    lote = LoteRecortes(
        partida=PARTIDA, lote="r1", criado_em=datetime.now(UTC), origem="simulador", gerador="teste", itens=[item]
    )
    it = lote.itens[0]
    assert (it.quadro, it.id_placa, it.dupla, it.sem_previsao) == ("t0000012340", "opo-03", False, False)
    assert lote.formato == "recortes.lote/1"
    # a placa cortada pela borda do quadro: a região é só a parte de dentro
    ItemRecorte(**{**item, "regiao": [[10, 8], [120.5, 8], [140.2, 62], [10, 62]]})
    for ruim in (
        {"recorte": "t0000012340"},
        {"regiao": [[10, 8], [290, 8]]},  # poucos vértices
        {"regiao": [[10, 8], [290, 8], [310, 62], [10, 62]]},  # sai do recorte
        {"placa": [[10, 8], [290, 8], [290, 62]]},  # quatro cantos
        {"no_quadro": [[1, 2], [3, 4], [5, 6], [7, float("nan")]]},
        {"largura": 0},
    ):
        with pytest.raises(ValidationError):
            ItemRecorte(**{**item, **ruim})
    with pytest.raises(ValidationError, match="repetido"):
        LoteRecortes(**{**lote.model_dump(), "itens": [item, item]})
    with pytest.raises(ValidationError):
        LoteRecortes(**{**lote.model_dump(), "lote": "R_1"})
    with pytest.raises(ValidationError):
        LoteRecortes(**{**lote.model_dump(), "itens": []})


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
