"""Formatos dos arquivos (versionados). Cada arquivo diz o próprio formato no campo `formato`.

As páginas validam pelos JSON Schemas gerados daqui (`web/esquemas/`, via
`scripts/gerar_arquivos_web.py`) antes de gravar, e o Python valida de novo ao unificar. Os
formatos estão documentados em `docs/formatos.md`.

Duas tarefas:

* pontos (`rotulo.pontos/1`): os pontos do campo que aparecem no quadro, clicados um a um;
* placas (`rotulo.placas/1`): o que está na frente da placa, pintado no recorte dela — a placa já
  endireitada, com um pouco em volta, que vem pronta de fora das páginas (`recortes.lote/1`). A
  máscara (PNG ao lado) só vale dentro da placa.

Em qualquer das duas, uma imagem que não dá para anotar é descartada com um motivo (nas placas,
também o recorte que não está na placa: ele não se ajusta, se descarta) — o descarte também passa
pela revisão cruzada.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .campo import pontos_marcaveis
from .convencoes import (
    RE_DISPOSITIVO,
    RE_ESTADIO,
    RE_GABARITO,
    RE_LOTE,
    RE_MASCARA,
    RE_PACOTE_REF,
    RE_PARTIDA,
    RE_PESSOA,
    RE_QUADRO,
    RE_RECORTE,
    RE_VERSAO_PACOTE,
)

NOMES_PONTOS = frozenset(pontos_marcaveis())

Partida = Annotated[str, Field(pattern=RE_PARTIDA.pattern)]
Quadro = Annotated[str, Field(pattern=RE_QUADRO.pattern)]
Recorte = Annotated[str, Field(pattern=RE_RECORTE.pattern, max_length=48)]
Pessoa = Annotated[str, Field(pattern=RE_PESSOA.pattern)]
IdGabarito = Annotated[str, Field(pattern=RE_GABARITO.pattern)]
#: Um número finito (o JSON não tem NaN nem infinito; o pydantic recusa os dois).
Numero = Annotated[float, Field(allow_inf_nan=False)]
#: Um ponto (x, y) em px.
Px = tuple[Numero, Numero]


class Modelo(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _partida_e_item(partida: str, item: str, regex: re.Pattern, oque: str) -> None:
    if not (RE_PARTIDA.match(partida) or partida == "gabarito"):
        raise ValueError("partida inválida")
    if not (regex.match(item) or RE_GABARITO.match(item)):
        raise ValueError(f"{oque} inválido")


def area_poligono(pol) -> float:
    """A área de um polígono (fórmula do laço), em px²."""
    a = 0.0
    for i in range(len(pol)):
        x0, y0 = pol[i - 1]
        x1, y1 = pol[i]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2


def _regiao_coerente(regiao, largura: int, altura: int) -> None:
    for x, y in regiao:
        if not (0 <= x <= largura and 0 <= y <= altura):
            raise ValueError("a região da placa sai do recorte")
    if area_poligono(regiao) < 1:
        raise ValueError("a região da placa não tem área")


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
    estadio: Annotated[str, Field(pattern=RE_ESTADIO.pattern)] = Field(
        description="nome do estádio, em slug (entra no ID da partida)"
    )
    pacote_versao: Annotated[str, Field(pattern=RE_VERSAO_PACOTE.pattern)] | None = Field(
        None, description="ignorado (das versões até a 0.7, que usavam o levantamento do estádio)"
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
    pacote: Annotated[str, Field(pattern=RE_PACOTE_REF.pattern)] | None = Field(
        None, description="ignorado (das versões até a 0.7, que usavam o levantamento do estádio)"
    )
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
    dupla: bool = Field(False, description="às cegas: duas pessoas anotam do zero, sem ver o rótulo da outra")
    sem_previsao: bool = Field(False, description="começa sem previsão, para medir o viés de ancoragem")


class Fila(Modelo):
    formato: Literal["fila.partida/1"] = "fila.partida/1"
    partida: Partida
    criado_em: datetime
    equipe: list[Pessoa]
    itens: list[ItemFila]


# ----------------------------------------------------------------------------- o que vale nas duas tarefas
class PartiuDe(Modelo):
    fonte: Literal["nenhuma", "modelo", "rotulo_anterior", "rotulo_revisado"]
    versao: str | None = None
    referencia: str | None = None


Situacao = Literal["ok", "descartada"]
MotivoDescarte = Literal["transicao", "borrao", "grafismo", "outro"]
MotivoDescartePlacas = Literal["placa_fora_do_lugar", "transicao", "borrao", "outro"]

#: Motivos para descartar uma imagem, por tarefa, com o texto das páginas. Nas placas, o grafismo da
#: emissora por cima da placa se pinta (ele esconde a placa de quem assiste); o que se descarta é o
#: recorte que não está na placa.
MOTIVOS_DESCARTE = {
    "pontos": {
        "transicao": "transição entre tomadas (fusão, corte no meio)",
        "borrao": "borrada ou fora de foco demais",
        "grafismo": "grafismo da emissora cobre a imagem",
        "outro": "outro motivo (com comentário)",
    },
    "placas": {
        "placa_fora_do_lugar": "o recorte não está na placa (fora do lugar, outra coisa)",
        "transicao": "transição entre tomadas (fusão, corte no meio)",
        "borrao": "borrado ou fora de foco demais",
        "outro": "outro motivo (com comentário)",
    },
}


def _situacao(situacao: str, motivo: str | None, comentario: str) -> None:
    if (situacao == "descartada") != (motivo is not None):
        raise ValueError("o motivo do descarte vem sempre, e só, com a imagem descartada")
    if motivo == "outro" and not comentario.strip():
        raise ValueError("descarte por 'outro' motivo exige comentário")


class _Rotulo(Modelo):
    """O que vale nas duas tarefas. O item (`quadro` nos pontos, `recorte` nas placas) vem em cada uma."""

    formato: str
    partida: str = Field(description="ID da partida, ou 'gabarito'")
    anotador: Pessoa
    versao: int = Field(ge=1)
    ferramenta: str
    manual: str
    criado_em: datetime
    segundos_ativos: float = Field(ge=0)
    largura: int = Field(gt=0, description="largura da imagem (px)")
    altura: int = Field(gt=0, description="altura da imagem (px)")
    partiu_de: PartiuDe
    situacao: Situacao
    motivo_descarte: MotivoDescarte | None = None
    comentario: str = ""
    corrige: str | None = Field(None, description="arquivo do rótulo que esta versão corrige (revisão cruzada)")


def _revisao_coerente(r) -> None:
    if (r.decisao == "devolver") != (r.motivo is not None):
        raise ValueError("motivo é obrigatório ao devolver, e só ao devolver")
    if (r.decisao == "corrigir") != (r.nova_versao is not None):
        raise ValueError("nova_versao é obrigatória ao corrigir, e só ao corrigir")
    if r.motivo == "outro" and not r.comentario.strip():
        raise ValueError("motivo 'outro' exige comentário")


class _Revisao(Modelo):
    """O que vale nas duas tarefas. O item (`quadro` nos pontos, `recorte` nas placas) vem em cada uma."""

    formato: str
    partida: Partida
    rotulo: str = Field(description="arquivo do rótulo revisado")
    revisor: Pessoa
    versao: int = Field(ge=1)
    decisao: Literal["aprovar", "corrigir", "devolver"]
    comentario: str = ""
    nova_versao: str | None = Field(None, description="arquivo da correção, quando a decisão é corrigir")
    ferramenta: str
    manual: str
    criado_em: datetime
    segundos_ativos: float = Field(ge=0)


# ----------------------------------------------------------------------------- pontos do campo
class Ponto(Modelo):
    ponto: str = Field(description="nome do ponto do campo (os 39 que se marcam)")
    x: float = Field(description="px da imagem, a partir do canto de cima à esquerda")
    y: float

    @model_validator(mode="after")
    def _nome(self):
        if self.ponto not in NOMES_PONTOS:
            raise ValueError(f"ponto desconhecido: {self.ponto}")
        return self


def _pontos_coerentes(pontos, largura: int, altura: int) -> None:
    nomes = [p.ponto for p in pontos]
    if len(nomes) != len(set(nomes)):
        raise ValueError("ponto marcado duas vezes")
    for p in pontos:
        if not (0 <= p.x <= largura and 0 <= p.y <= altura):
            raise ValueError(f"o ponto {p.ponto} está fora da imagem")


class RotuloPontos(_Rotulo):
    """Os pontos do campo que aparecem no quadro. Nenhum ponto é uma resposta válida (um close, a
    torcida): a imagem entra no treino sem pontos. Imagem descartada não leva pontos."""

    formato: Literal["rotulo.pontos/1"] = "rotulo.pontos/1"
    quadro: str = Field(description="ID do quadro (t + PTS em ms) ou do item do gabarito (g1001)")
    pontos: list[Ponto] = []

    @model_validator(mode="after")
    def _coerencia(self):
        _partida_e_item(self.partida, self.quadro, RE_QUADRO, "quadro")
        _situacao(self.situacao, self.motivo_descarte, self.comentario)
        if self.situacao == "descartada" and self.pontos:
            raise ValueError("imagem descartada não leva pontos")
        _pontos_coerentes(self.pontos, self.largura, self.altura)
        return self


MotivoPontos = Literal[
    "ponto_fora_do_lugar",
    "nome_trocado",
    "faltou_ponto",
    "ponto_que_nao_se_ve",
    "descarte_errado",
    "outro",
]


class RevisaoPontos(_Revisao):
    formato: Literal["revisao.pontos/1"] = "revisao.pontos/1"
    quadro: Quadro
    motivo: MotivoPontos | None = None

    @model_validator(mode="after")
    def _coerencia(self):
        _revisao_coerente(self)
        return self


class PontoVerdadeiro(Ponto):
    visivel: bool = Field(
        description="false: dentro da imagem, mas coberto (por pessoa, trave ou grafismo); marcar é opcional"
    )


class GabaritoPontos(Modelo):
    """Item do gabarito dos pontos: a imagem e onde está, de verdade, cada ponto que cai nela."""

    formato: Literal["gabarito.pontos/1"] = "gabarito.pontos/1"
    id: IdGabarito
    lote: str = Field("", description="o lote de ouro de onde o item veio")
    imagem: str
    largura: int = Field(gt=0)
    altura: int = Field(gt=0)
    pontos: list[PontoVerdadeiro]
    origem: Literal["simulador", "arbitrado"]
    observacao: str = ""
    fora_de: list[Pessoa] = Field(
        default_factory=list, description="quem não recebe o item: quem anotou ou revisou a imagem de onde ele veio"
    )

    @model_validator(mode="after")
    def _coerencia(self):
        _pontos_coerentes(self.pontos, self.largura, self.altura)
        return self


class PrevisaoPontos(Modelo):
    """Os pontos de um modelo para um quadro: a página começa com eles (quem anota corrige)."""

    formato: Literal["previsao.pontos/1"] = "previsao.pontos/1"
    partida: Partida
    quadro: Quadro
    fonte: str
    versao: str
    pontos: list[Ponto] = []

    @model_validator(mode="after")
    def _unicos(self):
        nomes = [p.ponto for p in self.pontos]
        if len(nomes) != len(set(nomes)):
            raise ValueError("ponto previsto duas vezes")
        return self


# ----------------------------------------------------------------------------- recortes das placas
class ItemRecorte(Modelo):
    """Uma placa num quadro: o recorte dela, endireitado (`<recorte>.jpg`, ao lado do lote).

    O recorte mostra a placa como um retângulo, com um pouco em volta para dar o contexto; `regiao` é a
    parte que se pinta — a placa, só o que cai dentro do quadro. `placa` e `no_quadro` dizem onde os
    quatro cantos da placa estão no recorte e no quadro, para levar a máscara de volta ao quadro."""

    recorte: Recorte
    largura: int = Field(gt=0, le=8192, description="largura do recorte (px)")
    altura: int = Field(gt=0, le=8192, description="altura do recorte (px)")
    regiao: list[Px] = Field(
        min_length=3, max_length=64, description="o que se pinta: a placa, dentro do quadro (polígono, px do recorte)"
    )
    placa: list[Px] = Field(
        min_length=4,
        max_length=4,
        description="os cantos da placa no recorte (px): em cima à esquerda, em cima à direita, embaixo à direita, "
        "embaixo à esquerda",
    )
    no_quadro: list[Px] = Field(min_length=4, max_length=4, description="os mesmos cantos, no quadro (px)")
    dupla: bool = Field(False, description="às cegas: duas pessoas pintam do zero, sem ver a pintura da outra")
    sem_previsao: bool = Field(False, description="começa sem a pré-pintura, para medir o viés de ancoragem")

    @model_validator(mode="after")
    def _coerencia(self):
        _regiao_coerente(self.regiao, self.largura, self.altura)
        return self

    @property
    def quadro(self) -> str:
        return self.recorte.split("_", 1)[0]

    @property
    def id_placa(self) -> str:
        return self.recorte.split("_", 1)[1]


class LoteRecortes(Modelo):
    """Os recortes de uma partida que chegaram juntos: `partidas/<partida>/recortes/<lote>.json`, com as
    imagens ao lado. Feito fora das páginas (pelo simulador, por enquanto; depois, pela projeção das
    placas) e trazido por `anotacao recortes` ou por um .zip. Um recorte que já está em outro lote da
    partida fica de fora."""

    formato: Literal["recortes.lote/1"] = "recortes.lote/1"
    partida: Partida
    lote: Annotated[str, Field(pattern=RE_LOTE.pattern, max_length=40)]
    criado_em: datetime
    origem: Literal["simulador", "modelo"] = Field(description="de onde vêm as placas: o simulador ou um modelo")
    gerador: Annotated[str, Field(min_length=1)] = Field(description="o que gerou os recortes, com a versão")
    itens: list[ItemRecorte] = Field(min_length=1)

    @model_validator(mode="after")
    def _unicos(self):
        ids = [it.recorte for it in self.itens]
        if len(ids) != len(set(ids)):
            raise ValueError("recorte repetido no lote")
        return self


# ----------------------------------------------------------------------------- placas
class RotuloPlacas(_Rotulo):
    """O que está na frente da placa, pintado no recorte dela (PNG ao lado, com o mesmo nome do rótulo:
    1 onde algo cobre a placa, 0 no resto e fora da região da placa). Pinta-se tudo o que esconde a
    placa de quem assiste — gente, bola, trave, outra placa, câmera, bandeira, grafismo da emissora —,
    e não o próprio anúncio, sombra, reflexo nem o que deixa ver a placa através (a rede). Sem nada na
    frente, a máscara é toda 0. Recorte descartado não leva máscara."""

    formato: Literal["rotulo.placas/1"] = "rotulo.placas/1"
    recorte: str = Field(max_length=48, description="ID do recorte (<quadro>_<placa>) ou do item do gabarito (g4001)")
    motivo_descarte: MotivoDescartePlacas | None = None
    mascara: str | None = Field(None, description="o PNG da máscara, ao lado (o mesmo nome, com .png)")
    pixels: int = Field(0, ge=0, description="pixels pintados (algo na frente da placa) na máscara")

    @model_validator(mode="after")
    def _coerencia(self):
        _partida_e_item(self.partida, self.recorte, RE_RECORTE, "recorte")
        _situacao(self.situacao, self.motivo_descarte, self.comentario)
        if self.mascara is not None and not RE_MASCARA.match(self.mascara):
            raise ValueError("nome da máscara inválido")
        if (self.situacao == "ok") != (self.mascara is not None):
            raise ValueError("a máscara vem sempre, e só, com o recorte pintado (não descartado)")
        if self.mascara is None and self.pixels:
            raise ValueError("pixels pintados só com a máscara")
        if self.pixels > self.largura * self.altura:
            raise ValueError("mais pixels pintados que o recorte tem")
        return self


MotivoPlacas = Literal[
    "faltou_pintar",
    "contorno_impreciso",
    "pintou_o_que_nao_cobre",
    "descarte_errado",
    "outro",
]


class RevisaoPlacas(_Revisao):
    formato: Literal["revisao.placas/1"] = "revisao.placas/1"
    recorte: Recorte
    motivo: MotivoPlacas | None = None

    @model_validator(mode="after")
    def _coerencia(self):
        _revisao_coerente(self)
        return self


class GabaritoPlacas(Modelo):
    """Item do gabarito das placas: o recorte e a resposta — a máscara verdadeira (PNG ao lado), com um
    número por coisa na frente da placa (de 1 a N) e 0 no resto, ou "descartar" (o recorte não está
    na placa, e não leva máscara)."""

    formato: Literal["gabarito.placas/1"] = "gabarito.placas/1"
    id: IdGabarito
    lote: str = Field("", description="o lote de ouro de onde o item veio")
    imagem: str
    mascara: str | None = Field(description="a máscara verdadeira, ao lado (null quando a resposta é descartar)")
    largura: int = Field(gt=0, le=8192)
    altura: int = Field(gt=0, le=8192)
    regiao: list[Px] = Field(min_length=3, max_length=64, description="o que se pinta (polígono, px do recorte)")
    oclusores: int = Field(ge=0, le=255, description="quantas coisas na frente da placa: os números 1 a N da máscara")
    resposta: Literal["pintar", "descartar"] = "pintar"
    origem: Literal["simulador", "arbitrado"]
    observacao: str = ""
    fora_de: list[Pessoa] = Field(
        default_factory=list, description="quem não recebe o item: quem anotou ou revisou o recorte de onde ele veio"
    )

    @model_validator(mode="after")
    def _coerencia(self):
        _regiao_coerente(self.regiao, self.largura, self.altura)
        if (self.resposta == "descartar") != (self.mascara is None):
            raise ValueError("a máscara vem sempre, e só, quando a resposta é pintar")
        if self.resposta == "descartar" and self.oclusores:
            raise ValueError("um item para descartar não tem o que pintar")
        return self


# ----------------------------------------------------------------------------- esquemas
ESQUEMAS: dict[str, type[Modelo]] = {
    "projeto.json": Projeto,
    "equipe.json": Equipe,
    "divisao.json": Divisao,
    "manifesto.partida.json": Manifesto,
    "tomadas.partida.json": Tomadas,
    "fila.partida.json": Fila,
    "pessoa.dispositivo.json": DispositivoPessoa,
    "rotulo.pontos.json": RotuloPontos,
    "revisao.pontos.json": RevisaoPontos,
    "gabarito.pontos.json": GabaritoPontos,
    "previsao.pontos.json": PrevisaoPontos,
    "recortes.lote.json": LoteRecortes,
    "rotulo.placas.json": RotuloPlacas,
    "revisao.placas.json": RevisaoPlacas,
    "gabarito.placas.json": GabaritoPlacas,
}

#: Modelos de cada tarefa: o rótulo, a revisão e o item do gabarito.
TAREFA = {
    "pontos": (RotuloPontos, RevisaoPontos, GabaritoPontos),
    "placas": (RotuloPlacas, RevisaoPlacas, GabaritoPlacas),
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
