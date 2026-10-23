"""Formatos dos arquivos (versionados). Cada arquivo diz o próprio formato no campo `formato`.

Os modelos validam ao salvar (servidor) e de novo ao unificar. Os JSON Schemas em `esquemas/` são
gerados daqui (`anotacao esquemas`) e documentados em `docs/formatos.md`.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .camera import canonical_side
from .campo import Campo
from .convencoes import (
    RE_ESTADIO,
    RE_GABARITO,
    RE_PACOTE_REF,
    RE_PARTIDA,
    RE_PESSOA,
    RE_QUADRO,
    RE_VERSAO_PACOTE,
)

_CAMPO_PADRAO = Campo()
NOMES_PONTOS = frozenset(_CAMPO_PADRAO.nomes_pontos)
NOMES_ELEMENTOS = frozenset(_CAMPO_PADRAO.nomes_elementos)

Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]
Estadio = Annotated[str, Field(pattern=RE_ESTADIO.pattern)]
Partida = Annotated[str, Field(pattern=RE_PARTIDA.pattern)]
Quadro = Annotated[str, Field(pattern=RE_QUADRO.pattern)]
Pessoa = Annotated[str, Field(pattern=RE_PESSOA.pattern)]
PacoteRef = Annotated[str, Field(pattern=RE_PACOTE_REF.pattern)]


class Modelo(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ----------------------------------------------------------------------------- pacote do estádio
class CampoPacote(Modelo):
    comprimento: float = Field(105.0, gt=80, lt=130, description="metros, linha de fundo a linha de fundo")
    largura: float = Field(68.0, gt=40, lt=100, description="metros, lateral a lateral")


class PlacaPacote(Modelo):
    id: Annotated[str, Field(pattern=r"^[A-Z0-9]+(?:_[A-Z0-9]+)*$")]
    tipo: Literal["estatica", "led"]
    lado: Literal["cab", "opo", "esq", "dir"]
    vertices: Annotated[list[Vec3], Field(min_length=4, max_length=4, description="BL, BR, TR, TL, vistos de frente")]
    patrocinador: str | None = None


class CameraRegistro(Modelo):
    nome: Annotated[str, Field(pattern=r"^[a-z0-9_]+$")]
    tipo: Literal["principal", "16m", "fundo", "reversa", "baixa", "tatica", "outra"]
    T: Vec3 = Field(description="posição do tripé (m), no referencial do campo")


class PacoteEstadio(Modelo):
    formato: Literal["pacote.estadio/1"] = "pacote.estadio/1"
    estadio: Estadio
    versao: Annotated[str, Field(pattern=RE_VERSAO_PACOTE.pattern)]
    nome: str
    campo: CampoPacote
    placas: list[PlacaPacote]
    cameras: list[CameraRegistro] = Field(min_length=1)

    @model_validator(mode="after")
    def _unicos(self):
        ids = [p.id for p in self.placas]
        if len(ids) != len(set(ids)):
            raise ValueError("IDs de placa repetidos")
        nomes = [c.nome for c in self.cameras]
        if len(nomes) != len(set(nomes)):
            raise ValueError("nomes de câmera repetidos")
        return self

    @property
    def ref(self) -> str:
        return f"{self.estadio}/pacote-{self.versao}"


# ----------------------------------------------------------------------------- equipe e divisão
class Membro(Modelo):
    codigo: Pessoa
    nome: str
    papeis: list[Literal["anotador", "revisor"]] = Field(min_length=1)


class Equipe(Modelo):
    formato: Literal["equipe/1"] = "equipe/1"
    membros: list[Membro]

    @model_validator(mode="after")
    def _unicos(self):
        cod = [m.codigo for m in self.membros]
        if len(cod) != len(set(cod)):
            raise ValueError("códigos repetidos na equipe")
        return self

    def com_papel(self, papel: str) -> list[str]:
        return sorted(m.codigo for m in self.membros if papel in m.papeis)


class Divisao(Modelo):
    """Partidas fora do treino. Tudo o que não está aqui é treino."""

    formato: Literal["divisao/1"] = "divisao/1"
    validacao: list[Partida] = []
    teste_congelado: list[Partida] = []
    teste_externo: list[Partida] = []

    @model_validator(mode="after")
    def _disjuntos(self):
        vistos: set[str] = set()
        for nome in ("validacao", "teste_congelado", "teste_externo"):
            s = set(getattr(self, nome))
            if vistos & s:
                raise ValueError(f"partida em mais de um conjunto: {sorted(vistos & s)}")
            vistos |= s
        return self

    def conjunto(self, partida: str) -> str:
        for nome in ("validacao", "teste_congelado", "teste_externo"):
            if partida in getattr(self, nome):
                return nome
        return "treino"


# ----------------------------------------------------------------------------- partida
class Cadastro(Modelo):
    estadio: Estadio
    pacote_versao: Annotated[str, Field(pattern=RE_VERSAO_PACOTE.pattern)]
    emissora: Annotated[str, Field(min_length=1)]
    competicao: Annotated[str, Field(min_length=1)]
    data_hora: datetime
    mandante: Annotated[str, Field(min_length=1)]
    visitante: Annotated[str, Field(min_length=1)]
    iluminacao: Literal["dia", "noite", "transicao"]
    chuva: bool
    observacoes: str = ""


class VideoInfo(Modelo):
    nome_original: str
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    bytes: int = Field(ge=0)
    duracao_s: float = Field(ge=0)
    fps: float = Field(gt=0)
    largura: int = Field(gt=0)
    altura: int = Field(gt=0)
    n_quadros: int = Field(ge=0)


class PreProcessamento(Modelo):
    ferramenta: str
    criado_em: datetime
    segundos: float = Field(ge=0)
    parametros: dict[str, float | int | str | bool]
    previsor: str | None = None


class Manifesto(Modelo):
    formato: Literal["manifesto.partida/1"] = "manifesto.partida/1"
    partida: Partida
    pacote: PacoteRef
    cadastro: Cadastro
    video: VideoInfo
    pre_processamento: PreProcessamento


class Tomada(Modelo):
    id: int = Field(ge=0)
    i0: int = Field(ge=0, description="primeiro quadro (índice)")
    i1: int = Field(ge=0, description="um depois do último quadro (índice)")
    inicio_ms: int = Field(ge=0)
    fim_ms: int = Field(ge=0)
    replay: bool | None = Field(None, description="None quando a emissora não tem vinheta cadastrada")
    zoom: Literal["aberto", "medio", "fechado"] = Field(description="aproximado; só para equilibrar o sorteio")
    grupo: int = Field(ge=0, description="agrupamento por aparência; só para equilibrar o sorteio")


class Tomadas(Modelo):
    formato: Literal["tomadas.partida/1"] = "tomadas.partida/1"
    partida: Partida
    cortes: list[int]
    transicoes: list[tuple[int, int]]
    tomadas: list[Tomada]


class ItemFila(Modelo):
    quadro: Quadro
    tomada: int = Field(ge=0)
    i: int = Field(ge=0)
    pts_ms: int = Field(ge=0)
    atribuido_a: list[Pessoa]
    dupla: bool = Field(False, description="rótulo cego: duas pessoas anotam do zero")
    sem_previsao: bool = Field(False, description="começa sem previsão, para medir o viés de ancoragem")


class Fila(Modelo):
    formato: Literal["fila.partida/1"] = "fila.partida/1"
    partida: Partida
    criado_em: datetime
    equipe: list[Pessoa]
    itens: list[ItemFila]


# ----------------------------------------------------------------------------- câmera
class CameraRotulo(Modelo):
    hfov_graus: float = Field(gt=0.5, lt=150, description="campo de visão horizontal")
    pan: float
    tilt: float = Field(ge=-90, le=90)
    roll: float = Field(ge=-45, le=45)
    C: Vec3 = Field(description="centro óptico (m)")
    k1: float = Field(0.0, ge=-1.0, le=1.0)


class Previsao(Modelo):
    formato: Literal["previsao.camera/1"] = "previsao.camera/1"
    partida: Partida
    quadro: Quadro
    fonte: str
    versao: str
    camera: CameraRotulo | None = None
    confianca: float | None = Field(None, ge=0, le=1)


class PartiuDe(Modelo):
    fonte: Literal["modelo", "quadro_anotado", "registro", "rotulo_anterior", "rotulo_revisado", "nenhuma"]
    versao: str | None = None
    referencia: str | None = None


class PontoTravado(Modelo):
    ponto: str
    x: float
    y: float

    @model_validator(mode="after")
    def _nome(self):
        if self.ponto not in NOMES_PONTOS:
            raise ValueError(f"ponto-chave desconhecido: {self.ponto}")
        return self


class LinhaTravada(Modelo):
    elemento: str
    x: float
    y: float

    @model_validator(mode="after")
    def _nome(self):
        if self.elemento not in NOMES_ELEMENTOS:
            raise ValueError(f"elemento desconhecido: {self.elemento}")
        return self


Situacao = Literal["ok", "sem_marcacoes", "impossivel_transicao", "impossivel_borrao", "duvida"]
SEM_CAMERA = ("sem_marcacoes", "impossivel_transicao", "impossivel_borrao")


class RotuloCamera(Modelo):
    formato: Literal["rotulo.camera/1"] = "rotulo.camera/1"
    partida: str = Field(description="ID da partida, ou 'gabarito'")
    pacote: PacoteRef
    quadro: str = Field(description="ID do quadro (t + PTS em ms) ou do item do gabarito (g0001)")
    anotador: Pessoa
    versao: int = Field(ge=1)
    ferramenta: str
    manual: str
    criado_em: datetime
    segundos_ativos: float = Field(ge=0)
    partiu_de: PartiuDe
    camera: CameraRotulo | None = None
    lado: Literal["canonico", "espelhado"] | None = None
    pontos_travados: list[PontoTravado] = []
    linhas_travadas: list[LinhaTravada] = []
    situacao: Situacao
    comentario: str = ""
    residuo_mediano_px: float | None = Field(None, ge=0, description="pontos e linhas travados, ref. 960")
    corrige: str | None = Field(None, description="arquivo do rótulo que esta versão corrige (revisão cruzada)")

    @model_validator(mode="after")
    def _coerencia(self):
        if not (RE_PARTIDA.match(self.partida) or self.partida == "gabarito"):
            raise ValueError("partida inválida")
        if not (RE_QUADRO.match(self.quadro) or RE_GABARITO.match(self.quadro)):
            raise ValueError("quadro inválido")
        if self.situacao == "ok" and self.camera is None:
            raise ValueError("situação 'ok' exige a câmera")
        if self.situacao in SEM_CAMERA and self.camera is not None:
            raise ValueError(f"situação '{self.situacao}' não leva câmera")
        if self.situacao == "duvida" and not self.comentario.strip():
            raise ValueError("'dúvida' exige comentário")
        if self.camera is not None:
            esperado = "canonico" if canonical_side(self.camera.C) else "espelhado"
            if self.lado != esperado:
                raise ValueError(f"lado deveria ser '{esperado}' para esta câmera")
        elif self.lado is not None:
            raise ValueError("lado só existe com câmera")
        return self


Motivo = Literal[
    "lado_trocado",
    "molde_fora_da_tolerancia",
    "ponto_em_marca_coberta",
    "deveria_ser_sem_marcacoes",
    "outro",
]


class RevisaoCamera(Modelo):
    formato: Literal["revisao.camera/1"] = "revisao.camera/1"
    partida: Partida
    quadro: Quadro
    rotulo: str = Field(description="arquivo do rótulo revisado")
    revisor: Pessoa
    versao: int = Field(ge=1)
    decisao: Literal["aprovar", "corrigir", "devolver"]
    motivo: Motivo | None = None
    comentario: str = ""
    nova_versao: str | None = Field(None, description="arquivo da correção, quando a decisão é corrigir")
    ferramenta: str
    manual: str
    criado_em: datetime
    segundos_ativos: float = Field(ge=0)

    @model_validator(mode="after")
    def _coerencia(self):
        if (self.decisao == "devolver") != (self.motivo is not None):
            raise ValueError("motivo é obrigatório ao devolver, e só ao devolver")
        if (self.decisao == "corrigir") != (self.nova_versao is not None):
            raise ValueError("nova_versao é obrigatória ao corrigir, e só ao corrigir")
        if self.motivo == "outro" and not self.comentario.strip():
            raise ValueError("motivo 'outro' exige comentário")
        return self


class GabaritoCamera(Modelo):
    formato: Literal["gabarito.camera/1"] = "gabarito.camera/1"
    id: Annotated[str, Field(pattern=RE_GABARITO.pattern)]
    pacote: PacoteRef
    imagem: str
    largura: int = Field(gt=0)
    altura: int = Field(gt=0)
    camera: CameraRotulo
    origem: Literal["simulador", "arbitrado"]
    observacao: str = ""


# ----------------------------------------------------------------------------- esquemas
ESQUEMAS: dict[str, type[Modelo]] = {
    "pacote.estadio.json": PacoteEstadio,
    "equipe.json": Equipe,
    "divisao.json": Divisao,
    "manifesto.partida.json": Manifesto,
    "tomadas.partida.json": Tomadas,
    "fila.partida.json": Fila,
    "previsao.camera.json": Previsao,
    "rotulo.camera.json": RotuloCamera,
    "revisao.camera.json": RevisaoCamera,
    "gabarito.camera.json": GabaritoCamera,
}


def esquema_json(modelo: type[Modelo]) -> str:
    return json.dumps(modelo.model_json_schema(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def exportar_esquemas(destino: Path) -> list[Path]:
    destino.mkdir(parents=True, exist_ok=True)
    saidas = []
    for nome, modelo in ESQUEMAS.items():
        p = destino / nome
        p.write_text(esquema_json(modelo), encoding="utf-8")
        saidas.append(p)
    return saidas
