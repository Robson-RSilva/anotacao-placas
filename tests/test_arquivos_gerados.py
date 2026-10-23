"""Os arquivos que saem das definições em Python (esquemas, exemplo e convenções) estão em dia."""

from anotacao.geracao import RAIZ, arquivos_gerados


def test_arquivos_gerados_em_dia():
    desatualizados = [
        rel
        for rel, texto in arquivos_gerados().items()
        if not (RAIZ / rel).exists() or (RAIZ / rel).read_text(encoding="utf-8") != texto
    ]
    assert not desatualizados, f"rode `python scripts/gerar_arquivos_web.py`: {desatualizados}"


def test_esquemas_que_as_paginas_leem():
    esquemas = {rel.split("/")[-1] for rel in arquivos_gerados() if rel.startswith("web/esquemas/")}
    texto = (RAIZ / "web" / "js" / "nucleo" / "formatos.js").read_text(encoding="utf-8")
    for nome in esquemas:
        assert f'"{nome}"' in texto, f"{nome} não está em ESQUEMAS de formatos.js"


def test_versao_igual_nos_tres_lugares():
    import tomllib

    from anotacao import __version__

    projeto = tomllib.loads((RAIZ / "pyproject.toml").read_text(encoding="utf-8"))
    assert projeto["project"]["version"] == __version__
    js = (RAIZ / "web" / "js" / "nucleo" / "convencoes.js").read_text(encoding="utf-8")
    assert f'export const VERSAO = "{__version__}";' in js
