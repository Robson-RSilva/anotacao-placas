"""Os formatos recusam arquivo incoerente, e os JSON Schemas versionados estão em dia."""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from anotacao.camera import Camera
from anotacao.formatos import ESQUEMAS, Divisao, RevisaoCamera, RotuloCamera, esquema_json

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


def test_divisao_sem_sobreposicao():
    p = "2026-11-02_estadio-sintetico_time-a-time-b"
    assert Divisao(teste_congelado=[p]).conjunto(p) == "teste_congelado"
    assert Divisao().conjunto(p) == "treino"
    with pytest.raises(ValidationError):
        Divisao(validacao=[p], teste_congelado=[p])


def test_esquemas_versionados_em_dia():
    pasta = Path(__file__).parents[1] / "src" / "anotacao" / "esquemas"
    for nome, modelo in ESQUEMAS.items():
        assert (pasta / nome).read_text(encoding="utf-8") == esquema_json(modelo), (
            f"{nome} desatualizado: rode `anotacao esquemas src/anotacao/esquemas`"
        )
