"""Linha de comando: `anotacao <comando>` — para quem coordena e para quem treina.

As páginas de anotação rodam no navegador (GitHub Pages) e gravam na pasta de trabalho; estes
comandos trabalham sobre a mesma pasta:

anotacao exemplo trabalho/                  cria uma pasta de trabalho de exemplo
anotacao gabarito ORIGEM --pasta trabalho/  importa itens do gabarito
anotacao prever --pasta trabalho/ --previsor pacote.modulo:objeto   previsões para o molde
anotacao prever --tarefa oclusao --pasta trabalho/ --previsor ...    pré-pintura da oclusão
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

from . import __version__, oclusao
from .camera import Camera
from .formatos import DispositivoPessoa, Divisao, GabaritoOclusao, exportar_esquemas
from .gabarito import importar as importar_gabarito
from .gabarito import ler_item
from .geracao import equipe_exemplo
from .indice import Indice
from .mascara import ler_png
from .pacote import pacote_sintetico, validar_geometria
from .pasta import Pasta, escrever_json, ler_json
from .previsores import carregar_previsor, prever, prever_oclusao
from .unificar import unificar

#: Diferença aceita entre as contas da página e as do Python (pixels na borda de uma placa).
TOLERANCIA_PX = 3


def _conferir_mascara(caminho, largura: int, altura: int) -> tuple[object, str | None]:
    try:
        m = ler_png(caminho)
    except (ValueError, OSError) as e:
        return None, f"máscara ilegível: {e}"
    if m.shape != (altura, largura):
        return None, "a máscara não tem o tamanho do quadro"
    if m.max(initial=0) > oclusao.NAO_PLACA:
        return None, "a máscara tem valores fora das classes"
    return m, None


def _conferir_oclusao(pasta: Pasta, r, caminho, placas3d) -> list[str]:
    """A máscara de uma pintura existe, tem o tamanho do quadro, só tem classes dentro das placas e diz
    o mesmo que o rótulo (recalculado aqui, da máscara e das placas)."""
    if r.mascara is None:
        return []
    m, erro = _conferir_mascara(caminho.parent / r.mascara, r.largura, r.altura)
    if erro:
        return [erro]
    geo = oclusao.geometria(Camera.de_rotulo(r.camera.model_dump(), r.largura, r.altura), placas3d, r.largura, r.altura)
    fora = int(((m > 0) & ~geo.roi).sum())
    problemas = []
    if fora > TOLERANCIA_PX * max(1, len(geo.info)) * 10:
        problemas.append(f"{fora} pixels pintados fora das placas")
    est = {p["id"]: p for p in oclusao.estatisticas(m, geo)}
    gravadas = {p.id: p for p in r.placas}
    if set(est) != set(gravadas):
        return [*problemas, "as placas do rótulo não são as que a câmera desenha"]
    for pid, p in est.items():
        g = gravadas[pid]
        campos = ["area_px", "livre_px", "pessoa_px", "bola_px", "rede_px", "grafismo_px", "objeto_px", "nao_placa_px"]
        if any(abs(p[c] - getattr(g, c)) > TOLERANCIA_PX for c in campos):
            problemas.append(f"{pid}: as contas do rótulo não batem com a máscara")
    return problemas


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
        escrever_json(pasta.equipe_path, equipe_exemplo(), sobrescrever=True)
    if not pasta.divisao_path.exists():
        escrever_json(pasta.divisao_path, Divisao())
    print(f"Pasta de exemplo pronta em {pasta.raiz}")
    print(f"  pacote do estádio: {pac.ref}")
    print("  equipe: A01 e A02 (edite na página de coordenação)")
    print("Abra as páginas de anotação no Chrome ou no Edge e escolha esta pasta.")
    return 0


def cmd_validar(a: argparse.Namespace) -> int:
    pasta = Pasta(a.pasta)
    problemas = []
    pasta.ler_equipe()
    pasta.ler_divisao()
    pasta.ler_projeto()
    for ref in pasta.listar_pacotes():
        problemas += [f"{ref}: {e}" for e in validar_geometria(pasta.ler_pacote_ref(ref))]
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
        ip = indice.partida(pid)
        problemas += [f"{p.relative_to(pasta.raiz)}: {e}" for p, e in ip.invalidos]
        ipo = indice.partida(pid, "oclusao")
        problemas += [f"{p.relative_to(pasta.raiz)}: {e}" for p, e in ipo.invalidos]
        problemas += [f"{p.relative_to(pasta.raiz)}: a máscara ainda não chegou" for p in ipo.esperando]
        for a in ipo.rotulos:
            r = indice.rotulo_oclusao(a)
            try:
                pac = pasta.ler_pacote_ref(r.pacote)
            except (ValueError, OSError) as e:
                problemas.append(f"{a.caminho.relative_to(pasta.raiz)}: pacote ilegível ({e})")
                continue
            campo = (r.campo.comprimento, r.campo.largura) if r.campo else (pac.campo.comprimento, pac.campo.largura)
            faixas = r.faixas.model_dump() if r.faixas else None
            placas3d = oclusao.placas_do_rotulo(r.placas_de, faixas, campo, pac)
            erros = _conferir_oclusao(pasta, r, a.caminho, placas3d)
            problemas += [f"{a.caminho.relative_to(pasta.raiz)}: {e}" for e in erros]
    itens = {}
    for p in sorted((pasta.gabarito / "itens").glob("g*.json")):
        try:
            itens[p.stem] = ler_item(p)
        except (ValueError, OSError) as e:
            problemas.append(f"{p.relative_to(pasta.raiz)}: {str(e).splitlines()[0]}")
            continue
        if isinstance(itens[p.stem], GabaritoOclusao):
            g = itens[p.stem]
            _, erro = _conferir_mascara(p.parent / g.mascara, g.largura, g.altura)
            if erro:
                problemas.append(f"{p.relative_to(pasta.raiz)}: {erro}")
    gab = indice.partida("gabarito")
    problemas += [f"{p.relative_to(pasta.raiz)}: {e}" for p, e in gab.invalidos]
    gabo = indice.partida("gabarito", "oclusao")
    problemas += [f"{p.relative_to(pasta.raiz)}: {e}" for p, e in gabo.invalidos]
    for a in gabo.rotulos:
        r = indice.rotulo_oclusao(a)
        item = itens.get(a.quadro)
        if not isinstance(item, GabaritoOclusao):
            problemas.append(f"{a.caminho.relative_to(pasta.raiz)}: não há item da oclusão {a.quadro} no gabarito")
            continue
        erros = _conferir_oclusao(pasta, r, a.caminho, [pl.model_dump() for pl in item.placas])
        problemas += [f"{a.caminho.relative_to(pasta.raiz)}: {e}" for e in erros]
    for registro in sorted(pasta.pessoas.glob("*/*.json")):  # em que computadores cada código é usado
        try:
            d = ler_json(registro, DispositivoPessoa)
            if d.codigo != registro.parent.name or d.dispositivo != registro.stem:
                raise ValueError("o conteúdo não bate com o nome do arquivo")
        except (ValueError, OSError) as e:
            problemas.append(f"{registro.relative_to(pasta.raiz)}: {e}")
    for linha in problemas:
        print(linha)
    print(f"{len(problemas)} problema(s) em {len(pasta.listar_partidas())} partida(s)")
    return 1 if problemas else 0


def cmd_unificar(a: argparse.Namespace) -> int:
    destino = unificar(Pasta(a.pasta))
    man = json.loads((destino / "manifesto.json").read_text(encoding="utf-8"))
    print(f"{destino}: {man['quadros']} quadros {man['por_conjunto']}")
    oc = man["oclusao"]
    print(f"oclusão: {oc['quadros']} quadros, {oc['placas_pintadas']} placas pintadas {oc['por_conjunto']}")
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
    fazer = prever_oclusao if a.tarefa == "oclusao" else prever
    n = fazer(Pasta(a.pasta), previsor, a.partida or None, refazer=a.refazer)
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

    p = sub.add_parser("gabarito", help="importa itens do gabarito (<id>.json + JPEG; na oclusão, + a máscara PNG)")
    p.add_argument("origem")
    p.add_argument("--pasta", default=_pasta_padrao())
    p.set_defaults(func=cmd_gabarito)

    p = sub.add_parser("prever", help="grava a câmera prevista (ou a pré-pintura da oclusão) de cada quadro sorteado")
    p.add_argument("--pasta", default=_pasta_padrao())
    p.add_argument("--previsor", required=True, help="pacote.modulo:objeto")
    p.add_argument("--tarefa", choices=["camera", "oclusao"], default="camera")
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
