"""Convenções compartilhadas com o laboratório (ADR-0001). Não divergir.

1. Mundo: origem no centro do gramado; x ao longo do comprimento; y ao longo da largura; z para
   cima; metros. Lado "cab" (cabines, câmera principal) = y < 0; "opo" = y > 0; fundo "esq" = x < 0
   e "dir" = x > 0, vistos da câmera principal.
2. Câmera: x ~ K R (X - C), pixel quadrado, ponto principal no centro, distorção radial k1.
3. Tempo: sempre pelo PTS do vídeo; o ID do quadro é o PTS em milissegundos.
4. Métricas em pixels na referência 960 x 540.
"""

from __future__ import annotations

import re
import unicodedata

REF_W, REF_H = 960, 540

#: Versão do Manual de anotação que esta versão da ferramenta segue, por tarefa.
MANUAL = {"camera": "camera-0.1", "revisao": "revisao-0.1"}

RE_ESTADIO = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
RE_VERSAO_PACOTE = re.compile(r"^\d+\.\d+$")
RE_PARTIDA = re.compile(r"^\d{4}-\d{2}-\d{2}_[a-z0-9]+(?:-[a-z0-9]+)*_[a-z0-9]+(?:-[a-z0-9]+)*$")
RE_QUADRO = re.compile(r"^t\d{10}$")
RE_GABARITO = re.compile(r"^g\d{4}$")
RE_PESSOA = re.compile(r"^[A-Z][A-Z0-9]{1,9}$")
RE_PACOTE_REF = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*/pacote-\d+\.\d+$")

#: Nome da "partida" que guarda os itens do gabarito (nunca entra nos conjuntos de treino).
PARTIDA_GABARITO = "gabarito"

#: Pacote do campo genérico (105 x 68 m, sem placas), para anotar sem o levantamento do estádio.
REF_PACOTE_GENERICO = "generico/pacote-1.0"


def slug(texto: str) -> str:
    """Texto livre -> identificador em minúsculas, sem acentos, com hífens."""
    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii").lower()
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return re.sub(r"-{2,}", "-", t) or "sem-nome"


def id_quadro(pts_ms: float) -> str:
    """ID estável do quadro: o PTS em milissegundos, com 10 dígitos (t0001234567)."""
    v = round(float(pts_ms))
    if v < 0 or v > 9_999_999_999:
        raise ValueError(f"PTS fora do intervalo: {pts_ms}")
    return f"t{v:010d}"


def id_partida(data_iso: str, estadio: str, mandante: str, visitante: str) -> str:
    """ID da partida: data, estádio e jogo (2026-11-02_<estadio>_<mandante>-<visitante>)."""
    data = data_iso[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", data):
        raise ValueError(f"data inválida: {data_iso!r}")
    return f"{data}_{slug(estadio)}_{slug(mandante)}-{slug(visitante)}"


def ref_pacote(estadio: str, versao: str) -> str:
    return f"{estadio}/pacote-{versao}"
