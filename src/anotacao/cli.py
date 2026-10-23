"""Linha de comando: `anotacao <comando>`.

anotacao exemplo trabalho/                cria uma pasta de trabalho de exemplo
anotacao abrir --pasta trabalho/          abre a página central no navegador
anotacao importar VIDEO --pasta trabalho/ --estadio ... (importa sem passar pelo navegador)
anotacao validar --pasta trabalho/        confere todos os arquivos
anotacao unificar --pasta trabalho/       gera os conjuntos de treino
anotacao gabarito ORIGEM --pasta trabalho/   importa itens do gabarito
anotacao esquemas DESTINO                 exporta os JSON Schemas dos formatos
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import webbrowser
from datetime import datetime
from pathlib import Path

from . import __version__
from .formatos import Cadastro, Divisao, Equipe, Membro, exportar_esquemas
from .gabarito import importar as importar_gabarito
from .indice import Indice
from .pacote import pacote_sintetico, validar_geometria
from .pasta import Pasta, escrever_json
from .preprocessamento import preprocessar
from .previsores import carregar_previsor
from .sorteio import ParametrosSorteio
from .unificar import unificar


def _dir_config() -> Path:
    """Configuração desta máquina (o código de quem anota), fora da pasta sincronizada."""
    base = os.environ.get("XDG_CONFIG_HOME") or (os.environ.get("APPDATA") if os.name == "nt" else None)
    return Path(base) / "anotacao" if base else Path.home() / ".config" / "anotacao"


def _dir_dados() -> Path:
    """Vídeos recebidos pela página central: ficam na máquina, nunca na pasta sincronizada."""
    base = os.environ.get("XDG_DATA_HOME") or (os.environ.get("LOCALAPPDATA") if os.name == "nt" else None)
    return Path(base) / "anotacao" if base else Path.home() / ".local" / "share" / "anotacao"


def _pasta_padrao() -> str:
    return os.environ.get("ANOTACAO_PASTA", "trabalho")


def cmd_exemplo(a: argparse.Namespace) -> int:
    pasta = Pasta(a.destino)
    pasta.criar()
    pac = pacote_sintetico()
    caminho = pasta.pacote_path(pac.estadio, pac.versao)
    if not caminho.exists():
        escrever_json(caminho, pac)
    if not pasta.ler_equipe().membros:
        escrever_json(
            pasta.equipe_path,
            Equipe(
                membros=[
                    Membro(codigo="A01", nome="Anotador 1", papeis=["anotador", "revisor"]),
                    Membro(codigo="A02", nome="Anotador 2", papeis=["anotador", "revisor"]),
                ]
            ),
            sobrescrever=True,
        )
    if not pasta.divisao_path.exists():
        escrever_json(pasta.divisao_path, Divisao())
    print(f"Pasta de exemplo pronta em {pasta.raiz}")
    print(f"  pacote do estádio: {pac.ref}")
    print("  equipe: A01 e A02 (edite equipe.json)")
    print(f"Abra com: anotacao abrir --pasta {a.destino}")
    return 0


def cmd_abrir(a: argparse.Namespace) -> int:
    import uvicorn

    from .servidor import Configuracao, criar_app

    cfg = Configuracao(
        pasta=Path(a.pasta),
        pasta_videos=Path(a.videos or _dir_dados() / "videos"),
        config_local=_dir_config() / "config.json",
        previsor=a.previsor,
        manual_url=a.manual or "",
    )
    app = criar_app(cfg)
    url = f"http://127.0.0.1:{a.porta}/"
    print(f"Anotação {__version__} — pasta {Path(a.pasta).resolve()}")
    print(f"Abrindo {url}  (Ctrl+C para fechar)")
    if not a.sem_navegador:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=a.porta, log_level="warning")
    return 0


def cmd_importar(a: argparse.Namespace) -> int:
    pasta = Pasta(a.pasta)
    cad = Cadastro(
        estadio=a.estadio,
        pacote_versao=a.pacote_versao,
        emissora=a.emissora,
        competicao=a.competicao,
        data_hora=datetime.fromisoformat(a.data_hora),
        mandante=a.mandante,
        visitante=a.visitante,
        iluminacao=a.iluminacao,
        chuva=a.chuva,
        observacoes=a.observacoes or "",
    )
    ultimo = {"etapa": None}

    def progresso(etapa: str, frac: float) -> None:
        if etapa != ultimo["etapa"] or frac >= 1.0:
            print(f"  {etapa}: {frac:.0%}", flush=True)
            ultimo["etapa"] = etapa

    r = preprocessar(
        pasta,
        Path(a.video),
        cad,
        params=ParametrosSorteio(alvo=a.alvo),
        previsor=carregar_previsor(a.previsor),
        progresso=progresso,
    )
    print(
        f"{r.partida}: {r.n_quadros_video} quadros, {r.n_tomadas} tomadas, {r.n_sorteados} sorteados "
        f"em {r.segundos:.0f} s"
    )
    return 0


def cmd_validar(a: argparse.Namespace) -> int:
    pasta = Pasta(a.pasta)
    problemas = []
    pasta.ler_equipe()
    pasta.ler_divisao()
    for ref in pasta.listar_pacotes():
        problemas += [f"{ref}: {e}" for e in validar_geometria(pasta.ler_pacote_ref(ref))]
    indice = Indice(pasta)
    for pid in pasta.listar_partidas():
        indice.manifesto(pid)
        indice.fila(pid)
        indice.tomadas(pid)
        ip = indice.partida(pid)
        problemas += [f"{p.relative_to(pasta.raiz)}: {e}" for p, e in ip.invalidos]
    for linha in problemas:
        print(linha)
    print(f"{len(problemas)} problema(s) em {len(pasta.listar_partidas())} partida(s)")
    return 1 if problemas else 0


def cmd_unificar(a: argparse.Namespace) -> int:
    destino = unificar(Pasta(a.pasta))
    man = json.loads((destino / "manifesto.json").read_text(encoding="utf-8"))
    print(f"{destino}: {man['quadros']} quadros {man['por_conjunto']}")
    return 0


def cmd_gabarito(a: argparse.Namespace) -> int:
    novos = importar_gabarito(Pasta(a.pasta), Path(a.origem))
    print(f"{len(novos)} itens novos no gabarito")
    return 0


def cmd_esquemas(a: argparse.Namespace) -> int:
    for p in exportar_esquemas(Path(a.destino)):
        print(p)
    return 0


def construir_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="anotacao", description="Páginas locais de anotação de dados de treino.")
    ap.add_argument("--versao", action="version", version=f"%(prog)s {__version__}")
    sub = ap.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("exemplo", help="cria uma pasta de trabalho de exemplo")
    p.add_argument("destino")
    p.set_defaults(func=cmd_exemplo)

    p = sub.add_parser("abrir", help="abre a página central no navegador")
    p.add_argument("--pasta", default=_pasta_padrao(), help="pasta de trabalho (sincronizada com o Drive)")
    p.add_argument("--porta", type=int, default=8765)
    p.add_argument("--videos", help="onde guardar os vídeos enviados (fora da pasta de trabalho)")
    p.add_argument("--previsor", help="previsor de câmera, no formato pacote.modulo:objeto")
    p.add_argument("--manual", help="link do Manual de anotação")
    p.add_argument("--sem-navegador", action="store_true")
    p.set_defaults(func=cmd_abrir)

    p = sub.add_parser("importar", help="importa um vídeo pela linha de comando")
    p.add_argument("video")
    p.add_argument("--pasta", default=_pasta_padrao())
    p.add_argument("--estadio", required=True)
    p.add_argument("--pacote-versao", default="1.0")
    p.add_argument("--emissora", required=True)
    p.add_argument("--competicao", required=True)
    p.add_argument("--data-hora", required=True, help="ex.: 2026-11-02T16:00:00-03:00")
    p.add_argument("--mandante", required=True)
    p.add_argument("--visitante", required=True)
    p.add_argument("--iluminacao", choices=["dia", "noite", "transicao"], required=True)
    p.add_argument("--chuva", action=argparse.BooleanOptionalAction, default=False)
    p.add_argument("--observacoes")
    p.add_argument("--alvo", type=int, default=100, help="quadros sorteados nesta partida")
    p.add_argument("--previsor")
    p.set_defaults(func=cmd_importar)

    p = sub.add_parser("validar", help="confere todos os arquivos da pasta")
    p.add_argument("--pasta", default=_pasta_padrao())
    p.set_defaults(func=cmd_validar)

    p = sub.add_parser("unificar", help="gera os conjuntos de treino")
    p.add_argument("--pasta", default=_pasta_padrao())
    p.set_defaults(func=cmd_unificar)

    p = sub.add_parser("gabarito", help="importa itens do gabarito (<id>.json + imagem)")
    p.add_argument("origem")
    p.add_argument("--pasta", default=_pasta_padrao())
    p.set_defaults(func=cmd_gabarito)

    p = sub.add_parser("esquemas", help="exporta os JSON Schemas dos formatos")
    p.add_argument("destino")
    p.set_defaults(func=cmd_esquemas)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = construir_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
