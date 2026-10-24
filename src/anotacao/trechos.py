"""Trechos do vídeo como a pessoa escreve: "0:05:00-0:50:00, 1:05:00-1:50:00" — o mesmo da página.

O início entra e o fim não: "0:30-1:00" são os 30 segundos a partir de 0:30. Vazio é o vídeo inteiro
(None). Os trechos se separam por vírgula, ponto e vírgula ou linha; o início e o fim, por hífen,
travessão, " a " ou " até ". Trechos que se sobrepõem ou se tocam viram um.

Espelho de `web/js/nucleo/trechos.js`; `tests/fixtures/convencoes.json` leva os mesmos casos para
os testes dos dois lados.
"""

from __future__ import annotations

import math
import re
import unicodedata

RE_TEMPO = re.compile(r"[0-9]+(?::[0-9]{1,2}){0,2}(?:\.[0-9]+)?")
# "\b" não serve para "até" (o "é" não conta como letra para o \b do JavaScript): "a" e "até" vão
# entre espaços
RE_TRECHO = re.compile(r"([0-9:.]+)\s*(?:-|–|—|\s(?:a|até)\s)\s*([0-9:.]+)", re.IGNORECASE)


class ErroTrechos(ValueError):
    pass


def ler_tempo(texto: str) -> float:
    """Tempo -> segundos: "1:05:00", "65:00", "3900" ou "3900.5"; nan quando não dá para ler."""
    t = str(texto).strip()
    if not RE_TEMPO.fullmatch(t):
        return math.nan
    inteiro, _, frac = t.partition(".")
    partes = [int(p) for p in inteiro.split(":")]
    if any(v >= 60 for v in partes[1:]):
        return math.nan
    s = 0
    for v in partes:
        s = s * 60 + v
    return s + float(f"0.{frac}") if frac else float(s)


def ler_trechos(texto: str | None) -> list[tuple[float, float]] | None:
    """Texto -> [(início, fim), ...] em segundos, em ordem e sem sobreposição; vazio -> None."""
    partes = [p.strip() for p in re.split(r"[,;\n]+", unicodedata.normalize("NFC", texto or ""))]
    partes = [p for p in partes if p]
    if not partes:
        return None
    lidos: list[list[float]] = []
    for p in partes:
        m = RE_TRECHO.fullmatch(p)
        ini, fim = (ler_tempo(m.group(1)), ler_tempo(m.group(2))) if m else (math.nan, math.nan)
        if math.isnan(ini) or math.isnan(fim):
            raise ErroTrechos(f"não entendi o trecho “{p}”: escreva como 0:05:00-0:50:00")
        if fim <= ini:
            raise ErroTrechos(f"o trecho “{p}” termina antes de começar")
        lidos.append([ini, fim])
    lidos.sort(key=lambda x: x[0])
    out = [lidos[0]]
    for ini, fim in lidos[1:]:
        if ini <= out[-1][1]:
            out[-1][1] = max(out[-1][1], fim)
        else:
            out.append([ini, fim])
    return [(a, b) for a, b in out]


def tempo_exato(s: float) -> str:
    """Segundos -> "1:05:00" (ou "5:00" abaixo de uma hora), com a fração quando houver: "0:02.2"."""
    ms = math.floor(s * 1000 + 0.5)  # como o Math.round da página (o round do Python arredonda .5 para o par)
    h, resto = divmod(ms, 3_600_000)
    m, resto = divmod(resto, 60_000)
    seg, mil = divmod(resto, 1000)
    texto = f"{seg:02d}" + (f".{mil:03d}".rstrip("0") if mil else "")
    return f"{h}:{m:02d}:{texto}" if h else f"{m}:{texto}"


def formatar_trechos(trechos: list[tuple[float, float]] | None) -> str:
    """[(300, 3000), (3900, 6600)] -> "5:00-50:00, 1:05:00-1:50:00" (que ler_trechos lê de volta)."""
    return ", ".join(f"{tempo_exato(a)}-{tempo_exato(b)}" for a, b in trechos or [])
