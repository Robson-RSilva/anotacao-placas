"""Os formatos recusam arquivo incoerente."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from anotacao.camera import Camera
from anotacao.formatos import DispositivoPessoa, Divisao, GabaritoCamera, Projeto, RevisaoCamera, RotuloCamera

CAM = Camera.look_at([0.0, -58.0, 14.0], [5.0, 0.0, 0.0], 35.0, 1280, 720).para_rotulo()


def rotulo(**kw):
    base = dict(
        partida="2026-11-02_estadio-sintetico_time-a-time-b",
        pacote="estadio-sintetico/pacote-1.0",
        quadro="t0000012340",
        anotador="A01",
        versao=1,
        ferramenta="0.1.0",
        manual="camera-0.1",
        criado_em=datetime.now(UTC),
        segundos_ativos=31.0,
        partiu_de={"fonte": "registro"},
        camera=CAM,
        lado="canonico",
        pontos_travados=[{"ponto": "centro", "x": 640.0, "y": 360.0}],
        situacao="ok",
    )
    base.update(kw)
    return RotuloCamera(**base)


def test_rotulo_valido():
    r = rotulo()
    assert r.formato == "rotulo.camera/1"
    assert RotuloCamera.model_validate_json(r.model_dump_json()) == r


@pytest.mark.parametrize(
    "mudanca, trecho",
    [
        (dict(camera=None, lado=None), "exige a câmera"),
        (dict(situacao="sem_marcacoes"), "não leva câmera"),
        (dict(situacao="duvida", comentario=""), "exige comentário"),
        (dict(lado="espelhado"), "lado deveria ser"),
        (dict(pontos_travados=[{"ponto": "nao_existe", "x": 1, "y": 2}]), "ponto-chave desconhecido"),
        (dict(quadro="t12"), "quadro inválido"),
        (dict(partida="../fora"), "partida inválida"),
        (dict(anotador="ana"), "pattern"),
    ],
)
def test_rotulo_incoerente(mudanca, trecho):
    with pytest.raises(ValidationError, match=trecho):
        rotulo(**mudanca)


def test_medidas_do_campo_no_rotulo():
    assert rotulo().campo is None  # rótulo da 0.2: valem as do pacote
    r = rotulo(campo={"comprimento": 100.5, "largura": 64})
    assert (r.campo.comprimento, r.campo.largura) == (100.5, 64.0)
    with pytest.raises(ValidationError, match="greater than 40"):
        rotulo(campo={"comprimento": 100, "largura": 30})


def test_medidas_verdadeiras_no_item_do_gabarito():
    def item(**kw):
        base = dict(
            id="g0001",
            pacote="generico/pacote-1.0",
            imagem="g0001.jpg",
            largura=1280,
            altura=720,
            camera=CAM,
            origem="simulador",
        )
        base.update(kw)
        return GabaritoCamera(**base)

    assert item().campo is None  # valem as do pacote
    assert item(campo={"comprimento": 100, "largura": 64}).campo.comprimento == 100
    for campo in ({"comprimento": 125, "largura": 70}, {"comprimento": 95, "largura": 95}):
        with pytest.raises(ValidationError, match="fora do que a página aceita"):
            item(campo=campo)


def test_sem_marcacoes_sem_camera():
    r = rotulo(situacao="sem_marcacoes", camera=None, lado=None, pontos_travados=[])
    assert r.camera is None


def test_revisao_regras():
    base = dict(
        partida="2026-11-02_estadio-sintetico_time-a-time-b",
        quadro="t0000012340",
        rotulo="t0000012340__A01__v1.json",
        revisor="A02",
        versao=1,
        ferramenta="0.1.0",
        manual="revisao-0.1",
        criado_em=datetime.now(UTC),
        segundos_ativos=5,
    )
    RevisaoCamera(decisao="aprovar", **base)
    RevisaoCamera(decisao="devolver", motivo="lado_trocado", **base)
    with pytest.raises(ValidationError):
        RevisaoCamera(decisao="devolver", **base)
    with pytest.raises(ValidationError):
        RevisaoCamera(decisao="corrigir", **base)
    with pytest.raises(ValidationError):
        RevisaoCamera(decisao="devolver", motivo="outro", **base)
    RevisaoCamera(decisao="corrigir", nova_versao="t0000012340__A02__v1.json", **base)


def test_registro_do_codigo_num_computador():
    d = DispositivoPessoa(codigo="AB", dispositivo="3f2a6c1e-8b9d-4e2f-a1b3-c4d5e6f70812", criado_em=datetime.now(UTC))
    assert d.formato == "pessoa.dispositivo/1"
    for ruim in ({"codigo": "ab"}, {"dispositivo": "../../x"}, {"dispositivo": "3F2A6C1E-8B9D-4E2F-A1B3-C4D5E6F70812"}):
        with pytest.raises(ValidationError):
            DispositivoPessoa(**{**d.model_dump(), **ruim})


def test_divisao_sem_sobreposicao():
    p = "2026-11-02_estadio-sintetico_time-a-time-b"
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
