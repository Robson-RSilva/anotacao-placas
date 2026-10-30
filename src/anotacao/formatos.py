"""Formatos dos arquivos (versionados). Cada arquivo diz o próprio formato no campo `formato`.

As páginas validam pelos JSON Schemas gerados daqui (`web/esquemas/`, via
`scripts/gerar_arquivos_web.py`) antes de gravar, e o Python valida de novo ao unificar. Os
formatos estão documentados em `docs/formatos.md`.

Duas tarefas, cada uma direto na imagem:

* pontos (`rotulo.pontos/1`): os pontos do campo que aparecem no quadro, clicados um a um;
* pessoas (`rotulo.pessoas/1`): a máscara de todas as pessoas no gramado e em volta dele (jogadores,
  árbitros, gandulas, fotógrafos, comissão…: quem pode ficar na frente de uma placa), no quadro
  inteiro (PNG ao lado).

Em qualquer das duas, uma imagem que não dá para anotar (transição, borrão, grafismo por cima) é
descartada com um motivo — o descarte também passa pela revisão cruzada.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .campo import pontos_marcaveis
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

NOMES_PONTOS = frozenset(pontos_marcaveis())

Partida = Annotated[str, Field(pattern=RE_PARTIDA.pattern)]
Quadro = Annotated[str, Field(pattern=RE_QUADRO.pattern)]
Pessoa = Annotated[str, Field(pattern=RE_PESSOA.pattern)]
IdGabarito = Annotated[str, Field(pattern=RE_GABARITO.pattern)]


class Modelo(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _partida_e_quadro(partida: str, quadro: str) -> None:
    if not (RE_PARTIDA.match(partida) or partida == "gabarito"):
        raise ValueError("partida inválida")
    if not (RE_QUADRO.match(quadro) or RE_GABARITO.match(quadro)):
        raise ValueError("quadro inválido")


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

#: Motivos para descartar uma imagem, com o texto das páginas.
MOTIVOS_DESCARTE = {
    "transicao": "transição entre tomadas (fusão, corte no meio)",
    "borrao": "borrada ou fora de foco demais",
    "grafismo": "grafismo da emissora cobre a imagem",
    "outro": "outro motivo (com comentário)",
}


def _situacao(situacao: str, motivo: str | None, comentario: str) -> None:
    if (situacao == "descartada") != (motivo is not None):
        raise ValueError("o motivo do descarte vem sempre, e só, com a imagem descartada")
    if motivo == "outro" and not comentario.strip():
        raise ValueError("descarte por 'outro' motivo exige comentário")


class _Rotulo(Modelo):
    formato: str
    partida: str = Field(description="ID da partida, ou 'gabarito'")
    quadro: str = Field(description="ID do quadro (t + PTS em ms) ou do item do gabarito (g1001)")
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
    formato: str
    partida: Partida
    quadro: Quadro
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
    pontos: list[Ponto] = []

    @model_validator(mode="after")
    def _coerencia(self):
        _partida_e_quadro(self.partida, self.quadro)
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


# ----------------------------------------------------------------------------- pessoas
class RotuloPessoas(_Rotulo):
    """A máscara das pessoas do quadro (PNG ao lado, com o mesmo nome do rótulo: 1 onde há pessoa, 0 no
    resto). Pinta-se toda pessoa no gramado e em volta dele, do lado de dentro das placas — jogadores,
    goleiros, árbitros, gandulas, fotógrafos, comissão técnica, seguranças —, e não a torcida nem as
    sombras. Sem nenhuma pessoa, a máscara é toda 0. Imagem descartada não leva máscara."""

    formato: Literal["rotulo.pessoas/1"] = "rotulo.pessoas/1"
    mascara: str | None = Field(None, description="o PNG da máscara, ao lado (o mesmo nome, com .png)")
    pixels: int = Field(0, ge=0, description="pixels pintados (pessoa) na máscara")

    @model_validator(mode="after")
    def _coerencia(self):
        _partida_e_quadro(self.partida, self.quadro)
        _situacao(self.situacao, self.motivo_descarte, self.comentario)
        if self.mascara is not None and not RE_MASCARA.match(self.mascara):
            raise ValueError("nome da máscara inválido")
        if (self.situacao == "ok") != (self.mascara is not None):
            raise ValueError("a máscara vem sempre, e só, com a imagem anotada (não descartada)")
        if self.mascara is None and self.pixels:
            raise ValueError("pixels pintados só com a máscara")
        if self.pixels > self.largura * self.altura:
            raise ValueError("mais pixels pintados que a imagem tem")
        return self


MotivoPessoas = Literal[
    "faltou_pessoa",
    "contorno_impreciso",
    "pintou_o_que_nao_e_pessoa",
    "descarte_errado",
    "outro",
]


class RevisaoPessoas(_Revisao):
    formato: Literal["revisao.pessoas/1"] = "revisao.pessoas/1"
    motivo: MotivoPessoas | None = None

    @model_validator(mode="after")
    def _coerencia(self):
        _revisao_coerente(self)
        return self


class GabaritoPessoas(Modelo):
    """Item do gabarito das pessoas: a imagem e a máscara verdadeira (PNG ao lado), com um número por
    pessoa (de 1 a N) e 0 no resto."""

    formato: Literal["gabarito.pessoas/1"] = "gabarito.pessoas/1"
    id: IdGabarito
    lote: str = Field("", description="o lote de ouro de onde o item veio")
    imagem: str
    mascara: str = Field(description="a máscara verdadeira, ao lado")
    largura: int = Field(gt=0)
    altura: int = Field(gt=0)
    pessoas: int = Field(ge=0, le=255, description="quantas pessoas: os números 1 a N da máscara")
    origem: Literal["simulador", "arbitrado"]
    observacao: str = ""


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
    "rotulo.pessoas.json": RotuloPessoas,
    "revisao.pessoas.json": RevisaoPessoas,
    "gabarito.pessoas.json": GabaritoPessoas,
}

#: Modelos de cada tarefa: o rótulo, a revisão e o item do gabarito.
TAREFA = {
    "pontos": (RotuloPontos, RevisaoPontos, GabaritoPontos),
    "pessoas": (RotuloPessoas, RevisaoPessoas, GabaritoPessoas),
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
