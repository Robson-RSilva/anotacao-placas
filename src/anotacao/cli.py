"""Linha de comando: `anotacao <comando>` — para quem coordena e para quem treina.

As páginas de anotação rodam no navegador (GitHub Pages) e gravam na pasta de trabalho; estes
comandos trabalham sobre a mesma pasta:

anotacao exemplo trabalho/                  cria uma pasta de trabalho de exemplo
anotacao gabarito ORIGEM --pasta trabalho/  importa itens do gabarito
anotacao prever --tarefa pontos --pasta trabalho/ --previsor pacote.modulo:objeto      pontos de um modelo
anotacao prever --tarefa pessoas --pasta trabalho/ --previsor pacote.modulo:objeto     pré-pintura
anotacao validar --pasta trabalho/          confere todos os arquivos
anotacao unificar --pasta trabalho/         gera os conjuntos de treino
anotacao esquemas DESTINO                   exporta os JSON Schemas dos formatos
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

from . import __version__
from .formatos import DispositivoPessoa, Divisao, Equipe, GabaritoPessoas, Membro, exportar_esquemas
from .gabarito import conferir_mascara, ler_item
from .gabarito import importar as importar_gabarito
from .indice import Indice
from .mascara import ler_png
from .pasta import Pasta, escrever_json, ler_json
from .previsores import carregar_previsor, prever
from .unificar import unificar


def equipe_exemplo() -> Equipe:
    return Equipe(
        membros=[
            Membro(codigo="A01", nome="Anotador 1", papeis=["anotador", "revisor"]),
            Membro(codigo="A02", nome="Anotador 2", papeis=["anotador", "revisor"]),
        ]
    )


def _conferir_mascara(caminho: Path, r) -> str | None:
    """A máscara de um rótulo das pessoas existe, tem o tamanho da imagem, só 0 e 1, e os pixels
    pintados que o rótulo diz."""
    try:
        m = ler_png(caminho)
    except (ValueError, OSError) as e:
        return f"máscara ilegível: {e}"
    if m.shape != (r.altura, r.largura):
        return "a máscara não tem o tamanho da imagem"
    if m.max(initial=0) > 1:
        return "a máscara tem valores além de 0 e 1"
    if int(np.count_nonzero(m)) != r.pixels:
        return f"o rótulo diz {r.pixels} pixels pintados, a máscara tem {int(np.count_nonzero(m))}"
    return None


def _pasta_padrao() -> str:
    return os.environ.get("ANOTACAO_PASTA", "trabalho")


def cmd_exemplo(a: argparse.Namespace) -> int:
    pasta = Pasta(a.destino)
    pasta.criar()
    if not pasta.ler_equipe().membros:
        escrever_json(pasta.equipe_path, equipe_exemplo(), sobrescrever=True)
    if not pasta.divisao_path.exists():
        escrever_json(pasta.divisao_path, Divisao())
    print(f"Pasta de exemplo pronta em {pasta.raiz}")
    print("  equipe: A01 e A02 (edite na página de coordenação)")
    print("Abra as páginas de anotação no Chrome ou no Edge e escolha esta pasta.")
    return 0


def cmd_validar(a: argparse.Namespace) -> int:
    pasta = Pasta(a.pasta)
    problemas = []
    pasta.ler_equipe()
    pasta.ler_divisao()
    pasta.ler_projeto()
    rel = lambda p: p.relative_to(pasta.raiz)  # noqa: E731
    indice = Indice(pasta)
    for pid in pasta.listar_partidas():
        try:
            indice.manifesto(pid)
            indice.tomadas(pid)
            fila = indice.fila(pid)
        except (ValueError, OSError) as e:  # incompleta (ainda sincronizando) ou inválida
            problemas.append(f"{pid}: partida incompleta ou inválida: {e}")
            continue
        faltando = [it.quadro for it in fila.itens if not pasta.quadro(pid, it.quadro).exists()]
        if faltando:
            problemas.append(f"{pid}: {len(faltando)} quadro(s) da fila sem imagem (ex.: {faltando[0]})")
        do_quadro = {it.quadro for it in fila.itens}
        for tarefa in ("pontos", "pessoas"):
            ip = indice.partida(pid, tarefa)
            problemas += [f"{rel(p)}: {e}" for p, e in ip.invalidos]
            problemas += [f"{rel(p)}: a máscara ainda não chegou" for p in ip.esperando]
            for arq in ip.rotulos:
                r = indice.rotulo(arq, tarefa)
                if arq.quadro not in do_quadro:
                    problemas.append(f"{rel(arq.caminho)}: o quadro não está na fila da partida")
                if tarefa == "pessoas" and r.mascara is not None:
                    erro = _conferir_mascara(arq.caminho.parent / r.mascara, r)
                    if erro:
                        problemas.append(f"{rel(arq.caminho)}: {erro}")
    itens = {}
    for p in sorted((pasta.gabarito / "itens").glob("g*.json")):
        try:
            item = ler_item(p)
        except (ValueError, OSError) as e:
            problemas.append(f"{rel(p)}: {str(e).splitlines()[0]}")
            continue
        if item is None:
            continue  # item das versões anteriores (câmera, oclusão ou jogadores): fica fora
        if item.id != p.stem:
            problemas.append(f"{rel(p)}: o nome do arquivo precisa ser o id do item ({item.id})")
            continue
        itens[item.id] = item
        if isinstance(item, GabaritoPessoas):
            try:
                conferir_mascara((p.parent / item.mascara).read_bytes(), item)
            except (ValueError, OSError) as e:
                problemas.append(f"{rel(p)}: {e}")
    for tarefa in ("pontos", "pessoas"):
        gab = indice.partida("gabarito", tarefa)
        problemas += [f"{rel(p)}: {e}" for p, e in gab.invalidos]
        for arq in gab.rotulos:
            item = itens.get(arq.quadro)
            if item is None or (tarefa == "pessoas") != isinstance(item, GabaritoPessoas):
                problemas.append(f"{rel(arq.caminho)}: não há item {arq.quadro} de {tarefa} no gabarito")
                continue
            r = indice.rotulo(arq, tarefa)
            if (r.largura, r.altura) != (item.largura, item.altura):
                problemas.append(f"{rel(arq.caminho)}: o tamanho não é o da imagem do item")
            if tarefa == "pessoas" and r.mascara is not None:
                erro = _conferir_mascara(arq.caminho.parent / r.mascara, r)
                if erro:
                    problemas.append(f"{rel(arq.caminho)}: {erro}")
    for registro in sorted(pasta.pessoas.glob("*/*.json")):  # em que computadores cada código é usado
        try:
            d = ler_json(registro, DispositivoPessoa)
            if d.codigo != registro.parent.name or d.dispositivo != registro.stem:
                raise ValueError("o conteúdo não bate com o nome do arquivo")
        except (ValueError, OSError) as e:
            problemas.append(f"{rel(registro)}: {e}")
    for linha in problemas:
        print(linha)
    print(f"{len(problemas)} problema(s) em {len(pasta.listar_partidas())} partida(s)")
    return 1 if problemas else 0


def cmd_unificar(a: argparse.Namespace) -> int:
    destino = unificar(Pasta(a.pasta))
    man = json.loads((destino / "manifesto.json").read_text(encoding="utf-8"))
    po, pe = man["pontos"], man["pessoas"]
    print(f"{destino}:")
    print(f"  pontos: {po['quadros']} quadros, {po['pontos']} pontos {po['por_conjunto']}")
    print(f"  pessoas: {pe['quadros']} quadros {pe['por_conjunto']}")
    for tarefa, motivos in man["descartados"].items():
        if motivos:
            print(f"  descartados em {tarefa}: {motivos}")
    prob = json.loads((destino / "problemas.json").read_text(encoding="utf-8"))
    for p in prob["invalidos"]:
        if p["erro"].startswith("partida fora dos conjuntos"):
            print(f"atenção: {p['arquivo']}: {p['erro']}")
    return 0


def cmd_gabarito(a: argparse.Namespace) -> int:
    novos = importar_gabarito(Pasta(a.pasta), Path(a.origem))
    print(f"{len(novos)} itens novos no gabarito")
    return 0


def cmd_prever(a: argparse.Namespace) -> int:
    previsor = carregar_previsor(a.previsor)
    n = prever(Pasta(a.pasta), previsor, a.tarefa, a.partida or None, refazer=a.refazer)
    print(f"{n} previsões gravadas ({previsor.nome}@{previsor.versao})")
    return 0


def cmd_esquemas(a: argparse.Namespace) -> int:
    for p in exportar_esquemas(Path(a.destino)):
        print(p)
    return 0


def construir_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="anotacao", description="Ferramentas da pasta de trabalho da anotação de dados de treino."
    )
    ap.add_argument("--versao", action="version", version=f"%(prog)s {__version__}")
    sub = ap.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("exemplo", help="cria uma pasta de trabalho de exemplo")
    p.add_argument("destino")
    p.set_defaults(func=cmd_exemplo)

    p = sub.add_parser("gabarito", help="importa itens do gabarito (<id>.json + JPEG; nas pessoas, + a máscara PNG)")
    p.add_argument("origem")
    p.add_argument("--pasta", default=_pasta_padrao())
    p.set_defaults(func=cmd_gabarito)

    p = sub.add_parser("prever", help="grava os pontos (ou a pré-pintura das pessoas) de um modelo para cada quadro")
    p.add_argument("--pasta", default=_pasta_padrao())
    p.add_argument("--previsor", required=True, help="pacote.modulo:objeto")
    p.add_argument("--tarefa", choices=["pontos", "pessoas"], required=True)
    p.add_argument("--partida", action="append", help="só esta partida (pode repetir)")
    p.add_argument("--refazer", action="store_true", help="refaz as previsões que já existem")
    p.set_defaults(func=cmd_prever)

    p = sub.add_parser("validar", help="confere todos os arquivos da pasta")
    p.add_argument("--pasta", default=_pasta_padrao())
    p.set_defaults(func=cmd_validar)

    p = sub.add_parser("unificar", help="gera os conjuntos de treino")
    p.add_argument("--pasta", default=_pasta_padrao())
    p.set_defaults(func=cmd_unificar)

    p = sub.add_parser("esquemas", help="exporta os JSON Schemas dos formatos")
    p.add_argument("destino")
    p.set_defaults(func=cmd_esquemas)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = construir_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
