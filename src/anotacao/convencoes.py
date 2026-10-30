"""Convenções compartilhadas com o laboratório (ADR-0001). Não divergir.

1. Campo: origem no centro do gramado; x ao longo do comprimento; y ao longo da largura; z para
   cima; metros. Lado "cab" (cabines, câmera principal) = y < 0; "opo" = y > 0; fundo "esq" = x < 0
   e "dir" = x > 0, vistos da câmera principal. Os nomes dos pontos do campo seguem esses lados.
2. Imagem: pixels do quadro na resolução do vídeo, origem no canto de cima à esquerda (o primeiro
   pixel vai de 0 a 1; o centro dele é 0,5), x para a direita e y para baixo.
3. Tempo: sempre pelo PTS do vídeo; o ID do quadro é o PTS em milissegundos.
4. Métricas em pixels na referência 960 x 540.
"""

from __future__ import annotations

import re
import unicodedata

REF_W, REF_H = 960, 540

#: As tarefas: marcar os pontos do campo e pintar os jogadores, cada uma direto na imagem.
TAREFAS = ("pontos", "jogadores")

#: Versão do Manual de anotação que esta versão da ferramenta segue, por tarefa.
MANUAL = {"pontos": "pontos-0.1", "jogadores": "jogadores-0.1", "revisao": "revisao-0.2"}

RE_ESTADIO = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
RE_VERSAO_PACOTE = re.compile(r"^\d+\.\d+$")
RE_PARTIDA = re.compile(r"^\d{4}-\d{2}-\d{2}_[a-z0-9]+(?:-[a-z0-9]+)*_[a-z0-9]+(?:-[a-z0-9]+)*$")
RE_QUADRO = re.compile(r"^t\d{10}$")
RE_GABARITO = re.compile(r"^g\d{4}$")
RE_PESSOA = re.compile(r"^[A-Z][A-Z0-9]{1,9}$")
#: Pacote do estádio dos manifestos das versões até a 0.7 (hoje ignorado).
RE_PACOTE_REF = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*/pacote-\d+\.\d+$")
#: A máscara dos jogadores, ao lado do rótulo: o mesmo nome, com .png.
RE_MASCARA = re.compile(r"^(t\d{10}|g\d{4})__([A-Z][A-Z0-9]{1,9})__v(\d+)\.png$")
#: Navegador de um computador (um identificador aleatório, guardado no próprio navegador).
RE_DISPOSITIVO = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

#: Nome da "partida" que guarda os itens do gabarito (nunca entra nos conjuntos de treino).
PARTIDA_GABARITO = "gabarito"


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
