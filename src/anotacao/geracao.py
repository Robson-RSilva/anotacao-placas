"""Arquivos que saem das definições em Python e que as páginas (ou os testes delas) leem.

* `web/esquemas/*.json` — JSON Schemas dos formatos (as páginas validam por eles antes de gravar);
* `web/exemplo/*.json` — o pacote do estádio sintético e a equipe da pasta de exemplo;
* `tests/fixtures/convencoes.json` e `tests/fixtures/pacote_generico.json` — as convenções e o campo
  genérico, para os testes dos espelhos em JavaScript.

`python scripts/gerar_arquivos_web.py` grava todos; `tests/test_arquivos_gerados.py` falha quando
algum fica desatualizado.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import __version__
from .convencoes import (
    MANUAL,
    PARTIDA_GABARITO,
    RE_DISPOSITIVO,
    RE_ESTADIO,
    RE_GABARITO,
    RE_PACOTE_REF,
    RE_PARTIDA,
    RE_PESSOA,
    RE_QUADRO,
    RE_VERSAO_PACOTE,
    REF_H,
    REF_PACOTE_GENERICO,
    REF_W,
    id_partida,
    id_quadro,
    slug,
)
from .formatos import ESQUEMAS, Divisao, Equipe, Membro, esquema_json
from .pacote import pacote_generico, pacote_sintetico

RAIZ = Path(__file__).resolve().parents[2]


def equipe_exemplo() -> Equipe:
    return Equipe(
        membros=[
            Membro(codigo="A01", nome="Anotador 1", papeis=["anotador", "revisor"]),
            Membro(codigo="A02", nome="Anotador 2", papeis=["anotador", "revisor"]),
        ]
    )


def _json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def convencoes_para_teste() -> dict:
    textos = ["São Paulo", "  Grêmio x Inter  ", "Atlético-MG", "Água_Santa!!", "", "Ñandú — Club"]
    pts = [0, 0.4, 0.5, 1.5, 2.5, 33.3667, 1234567.5, 9_999_999_999]
    partidas = [
        ("2026-11-02T16:00:00-03:00", "Arena X", "Time A", "Time B"),
        ("2026-11-02", "estadio-sintetico", "São Paulo", "Grêmio"),
    ]
    return {
        "descricao": "Gerado por scripts/gerar_arquivos_web.py a partir de src/anotacao; não editar à mão.",
        "versao": __version__,
        "ref": [REF_W, REF_H],
        "manual": MANUAL,
        "partida_gabarito": PARTIDA_GABARITO,
        "ref_pacote_generico": REF_PACOTE_GENERICO,
        "regex": {
            "RE_ESTADIO": RE_ESTADIO.pattern,
            "RE_VERSAO_PACOTE": RE_VERSAO_PACOTE.pattern,
            "RE_PARTIDA": RE_PARTIDA.pattern,
            "RE_QUADRO": RE_QUADRO.pattern,
            "RE_GABARITO": RE_GABARITO.pattern,
            "RE_PESSOA": RE_PESSOA.pattern,
            "RE_PACOTE_REF": RE_PACOTE_REF.pattern,
            "RE_DISPOSITIVO": RE_DISPOSITIVO.pattern,
        },
        "slug": [[t, slug(t)] for t in textos],
        "id_quadro": [[p, id_quadro(p)] for p in pts],
        "id_partida": [[*a, id_partida(*a)] for a in partidas],
    }


def arquivos_gerados() -> dict[str, str]:
    """Caminho (relativo à raiz do repositório) -> conteúdo esperado."""
    out = {f"web/esquemas/{nome}": esquema_json(modelo) for nome, modelo in ESQUEMAS.items()}
    out["web/exemplo/pacote.json"] = pacote_sintetico().model_dump_json(indent=2) + "\n"
    out["web/exemplo/equipe.json"] = equipe_exemplo().model_dump_json(indent=2) + "\n"
    out["web/exemplo/divisao.json"] = Divisao().model_dump_json(indent=2) + "\n"
    out["tests/fixtures/convencoes.json"] = _json(convencoes_para_teste())
    out["tests/fixtures/pacote_generico.json"] = pacote_generico().model_dump_json(indent=2) + "\n"
    return out


def gravar(raiz: Path = RAIZ) -> list[Path]:
    saidas = []
    for rel, texto in arquivos_gerados().items():
        p = raiz / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if not p.exists() or p.read_text(encoding="utf-8") != texto:
            p.write_text(texto, encoding="utf-8")
            saidas.append(p)
    return saidas
