"""Formatos dos arquivos (versionados). Cada arquivo diz o próprio formato no campo `formato`.

As páginas validam pelos JSON Schemas gerados daqui (`web/esquemas/`, via
`scripts/gerar_arquivos_web.py`) antes de gravar, e o Python valida de novo ao unificar. Os
formatos estão documentados em `docs/formatos.md`.
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
    RE_DISPOSITIVO,
    RE_ESTADIO,
    RE_GABARITO,
    RE_MASCARA,
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


# ----------------------------------------------------------------------------- projeto, equipe e divisão
class Projeto(Modelo):
    """Dados da pasta de trabalho que as páginas mostram (opcional)."""

    formato: Literal["projeto/1"] = "projeto/1"
    nome: str = ""
    manual_url: Annotated[str, Field(pattern=r"^(https://\S+)?$", description="link do Manual de anotação")] = ""


class DispositivoPessoa(Modelo):
    """Um código usado num navegador: `pessoas/<codigo>/<dispositivo>.json`, um arquivo por computador.

    Serve para avisar quando duas pessoas escolhem o mesmo código em computadores diferentes — elas
    gravariam os mesmos nomes de arquivo e uma não revisaria a outra.
    """

    formato: Literal["pessoa.dispositivo/1"] = "pessoa.dispositivo/1"
    codigo: Pessoa
    dispositivo: Annotated[str, Field(pattern=RE_DISPOSITIVO.pattern)]
    criado_em: datetime


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
    estadio: Estadio = Field(description="nome do estádio, em slug (entra no ID da partida)")
    pacote_versao: Annotated[str, Field(pattern=RE_VERSAO_PACOTE.pattern)] | None = Field(
        None, description="versão do pacote do estádio, quando há o levantamento; sem ele, o campo genérico"
    )
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
    replay: bool | None = Field(None, description="None: replays são conferidos na solução assistida")
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
    campo: CampoPacote | None = Field(
        None, description="medidas do campo no molde deste rótulo (m); sem elas, as do pacote do estádio"
    )
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
    pacote: PacoteRef = Field(description="o molde com que o item abre (o campo genérico, ou o pacote de um estádio)")
    imagem: str
    largura: int = Field(gt=0)
    altura: int = Field(gt=0)
    camera: CameraRotulo
    campo: CampoPacote | None = Field(
        None,
        description=(
            "medidas verdadeiras do campo (m), quando não são as do pacote — por exemplo, um campo de "
            "100 x 64 m que abre no molde genérico de 105 x 68 m; quem anota precisa ajustar as medidas"
        ),
    )
    origem: Literal["simulador", "arbitrado"]
    observacao: str = ""

    @model_validator(mode="after")
    def _medidas(self):
        c = self.campo
        if c is not None and not (90 <= c.comprimento <= 120 and 45 <= c.largura <= 90 and c.comprimento > c.largura):
            raise ValueError(
                "medidas do campo fora do que a página aceita: comprimento de 90 a 120 m, largura de 45 a 90 m "
                "e mais comprido que largo"
            )
        return self


# ----------------------------------------------------------------------------- oclusão nas placas
class Faixa(Modelo):
    distancia: float = Field(ge=0.5, le=30, description="m, da linha (lateral ou de fundo) até a frente das placas")
    altura: float = Field(ge=0.2, le=5, description="m, do gramado ao topo das placas")
    comprimento: float | None = Field(
        None, ge=2, le=200, description="m, a faixa inteira, centrada no meio do lado; sem ele, de canto a canto"
    )
    vao: float = Field(
        0.0, ge=0, le=100, description="m, um vão sem placas no meio da faixa (atrás do gol, por exemplo)"
    )
    ligada: bool = Field(True, description="há placas desses lados")

    @model_validator(mode="after")
    def _vao(self):
        if self.comprimento is not None and self.vao >= self.comprimento:
            raise ValueError("o vão precisa ser menor que o comprimento")
        return self


class Faixas(Modelo):
    """As faixas de placas do campo genérico: as duas laterais com as mesmas medidas, e os dois fundos."""

    laterais: Faixa
    fundos: Faixa


IdPlaca = Annotated[str, Field(pattern=r"^[A-Z0-9]+(?:_[A-Z0-9]+)*$")]


class PlacaOclusao(Modelo):
    """O que a máscara diz de uma placa, em pixels do quadro."""

    id: IdPlaca
    lado: Literal["cab", "opo", "esq", "dir"] | None = None
    area_px: int = Field(ge=0, description="pixels do polígono da placa dentro da imagem")
    outra_placa_px: int = Field(ge=0, description="desses, os cobertos por uma placa mais perto")
    livre_px: int = Field(ge=0)
    pessoa_px: int = Field(ge=0)
    bola_px: int = Field(ge=0)
    rede_px: int = Field(ge=0)
    grafismo_px: int = Field(ge=0)
    objeto_px: int = Field(ge=0)
    nao_placa_px: int = Field(ge=0)
    livre_frac: float | None = Field(
        None, ge=0, le=1, description="(livre + rede) / (área − não é placa); nenhuma nas pequenas demais"
    )
    altura_ref_px: float = Field(ge=0, description="altura da placa na imagem (px, ref. 960)")
    pequena: bool = Field(description="mais baixa que 10 px (ref. 960): não se pinta")


class PartiuDeOclusao(Modelo):
    fonte: Literal["nenhuma", "modelo", "rotulo_anterior", "rotulo_revisado"]
    versao: str | None = None
    referencia: str | None = None


SituacaoOclusao = Literal["ok", "sem_placas", "camera_errada", "duvida"]


class RotuloOclusao(Modelo):
    """A oclusão nas placas de um quadro: a máscara (PNG ao lado, com o mesmo nome) e o que ela diz
    de cada placa. As placas saem da câmera aprovada do quadro e das faixas, do pacote ou do item."""

    formato: Literal["rotulo.oclusao/1"] = "rotulo.oclusao/1"
    partida: str = Field(description="ID da partida, ou 'gabarito'")
    pacote: PacoteRef
    quadro: str = Field(description="ID do quadro (t + PTS em ms) ou do item do gabarito (g0401)")
    anotador: Pessoa
    versao: int = Field(ge=1)
    ferramenta: str
    manual: str
    criado_em: datetime
    segundos_ativos: float = Field(ge=0)
    largura: int = Field(gt=0)
    altura: int = Field(gt=0)
    camera_de: str | None = Field(
        None, description="rótulo de câmera aprovado de onde veio a câmera (no gabarito, nenhum)"
    )
    camera: CameraRotulo = Field(description="a câmera que desenhou as placas")
    campo: CampoPacote | None = Field(
        None, description="medidas do campo da câmera (as faixas ficam a uma distância das linhas)"
    )
    placas_de: Literal["faixas", "pacote", "gabarito"]
    faixas: Faixas | None = None
    partiu_de: PartiuDeOclusao
    mascara: str | None = Field(None, description="o PNG da máscara, ao lado (o mesmo nome, com .png)")
    placas: list[PlacaOclusao] = []
    situacao: SituacaoOclusao
    comentario: str = ""
    corrige: str | None = Field(None, description="arquivo do rótulo que esta versão corrige (revisão cruzada)")

    @model_validator(mode="after")
    def _coerencia(self):
        if not (RE_PARTIDA.match(self.partida) or self.partida == "gabarito"):
            raise ValueError("partida inválida")
        if not (RE_QUADRO.match(self.quadro) or RE_GABARITO.match(self.quadro)):
            raise ValueError("quadro inválido")
        if (self.placas_de == "faixas") != (self.faixas is not None):
            raise ValueError("as faixas vêm sempre, e só, com placas_de 'faixas'")
        if (self.partida == "gabarito") != (self.placas_de == "gabarito"):
            raise ValueError("as placas do gabarito são só as dos itens do gabarito")
        if self.mascara is not None and not RE_MASCARA.match(self.mascara):
            raise ValueError("nome da máscara inválido")
        if self.mascara is None and self.placas:
            raise ValueError("as placas só vêm com a máscara")
        if self.situacao == "ok" and (self.mascara is None or all(p.pequena for p in self.placas)):
            raise ValueError("situação 'ok' exige a máscara e uma placa para pintar")
        if self.situacao in ("sem_placas", "camera_errada") and self.mascara is not None:
            raise ValueError(f"situação '{self.situacao}' não leva máscara")
        if self.situacao == "duvida" and not self.comentario.strip():
            raise ValueError("'dúvida' exige comentário")
        ids = [p.id for p in self.placas]
        if len(ids) != len(set(ids)):
            raise ValueError("placas repetidas")
        return self


MotivoOclusao = Literal[
    "faixa_fora_das_placas",
    "pintura_fora_da_tolerancia",
    "classe_errada",
    "camera_errada",
    "outro",
]


class RevisaoOclusao(Modelo):
    formato: Literal["revisao.oclusao/1"] = "revisao.oclusao/1"
    partida: Partida
    quadro: Quadro
    rotulo: str = Field(description="arquivo do rótulo revisado")
    revisor: Pessoa
    versao: int = Field(ge=1)
    decisao: Literal["aprovar", "corrigir", "devolver"]
    motivo: MotivoOclusao | None = None
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


class GabaritoOclusao(Modelo):
    """Item do gabarito da oclusão: o quadro, a câmera exata, as placas exatas e a máscara verdadeira."""

    formato: Literal["gabarito.oclusao/1"] = "gabarito.oclusao/1"
    id: Annotated[str, Field(pattern=RE_GABARITO.pattern)]
    pacote: PacoteRef
    imagem: str
    mascara: str = Field(description="a máscara verdadeira (PNG de índices), ao lado")
    largura: int = Field(gt=0)
    altura: int = Field(gt=0)
    camera: CameraRotulo
    campo: CampoPacote | None = Field(None, description="medidas do campo, quando não são as do pacote")
    placas: list[PlacaPacote] = Field(min_length=1, description="as placas do quadro, com os polígonos exatos")
    origem: Literal["simulador", "arbitrado"]
    observacao: str = ""

    @model_validator(mode="after")
    def _coerencia(self):
        ids = [p.id for p in self.placas]
        if len(ids) != len(set(ids)):
            raise ValueError("IDs de placa repetidos")
        c = self.campo
        if c is not None and not (90 <= c.comprimento <= 120 and 45 <= c.largura <= 90 and c.comprimento > c.largura):
            raise ValueError("medidas do campo fora do que a página aceita")
        return self


# ----------------------------------------------------------------------------- esquemas
ESQUEMAS: dict[str, type[Modelo]] = {
    "projeto.json": Projeto,
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
    "pessoa.dispositivo.json": DispositivoPessoa,
    "rotulo.oclusao.json": RotuloOclusao,
    "revisao.oclusao.json": RevisaoOclusao,
    "gabarito.oclusao.json": GabaritoOclusao,
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
