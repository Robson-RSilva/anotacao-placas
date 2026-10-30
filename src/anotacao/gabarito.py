"""Gabarito: imagens com a resposta verdadeira (do simulador ou de rótulos já arbitrados) — onde está
cada ponto do campo, na tarefa de pontos; a máscara de cada jogador, na de jogadores.

Serve para treinar e liberar quem começa (com o resultado na hora), medir cada anotador o tempo
todo (itens escondidos na fila) e testar a ferramenta antes do primeiro vídeo real. A liberação, os
itens escondidos e a comparação com a resposta são das páginas (`web/js/nucleo/gabarito.js` e
`filas.js`); aqui só se importa os itens para a pasta. Os rótulos do gabarito nunca entram no treino.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from .formatos import GabaritoJogadores, GabaritoPontos
from .mascara import eh_png, ler_png
from .pasta import Pasta, escrever_json, ler_json

ItemGabarito = GabaritoPontos | GabaritoJogadores

#: O formato de cada tarefa (o formato dentro do item diz a tarefa).
FORMATOS = {"gabarito.pontos/1": ("pontos", GabaritoPontos), "gabarito.jogadores/1": ("jogadores", GabaritoJogadores)}


def ler_item(p: Path) -> ItemGabarito | None:
    """Um item do gabarito, ou None quando é de um formato que esta versão não usa (os da câmera e da
    oclusão, das versões até a 0.7)."""
    formato = json.loads(p.read_text(encoding="utf-8")).get("formato")
    if formato not in FORMATOS:
        return None
    return ler_json(p, FORMATOS[formato][1])


def tarefa_do_item(item: ItemGabarito) -> str:
    return "jogadores" if isinstance(item, GabaritoJogadores) else "pontos"


def listar_itens(pasta: Pasta, tarefa: str | None = None) -> list[ItemGabarito]:
    """Os itens do gabarito, de uma tarefa ("pontos" ou "jogadores") ou das duas."""
    d = pasta.gabarito / "itens"
    if not d.exists():
        return []
    itens = [it for p in sorted(d.glob("g*.json")) if (it := ler_item(p)) is not None]
    return [g for g in itens if tarefa is None or tarefa_do_item(g) == tarefa]


def conferir_mascara(dados: bytes, item: GabaritoJogadores) -> None:
    """A máscara verdadeira tem o tamanho da imagem e só os números do item: 0, os jogadores (1 a N) e
    as outras pessoas (255, 254…)."""
    m = ler_png(dados)
    if m.shape != (item.altura, item.largura):
        raise ValueError(f"{item.id}: a máscara não tem o tamanho da imagem")
    fora = (m > item.jogadores) & (m < 256 - item.outras_pessoas)
    if fora.any():
        nj, no = item.jogadores, item.outras_pessoas
        raise ValueError(f"{item.id}: a máscara tem números além dos {nj} jogadores e das {no} outras pessoas")


def importar(pasta: Pasta, origem: Path) -> list[str]:
    """Copia itens (`<id>.json` + imagem JPEG; nos jogadores, + a máscara PNG) para a pasta. Item que
    já existe não é sobrescrito."""
    destino = pasta.gabarito / "itens"
    destino.mkdir(parents=True, exist_ok=True)
    novos = []
    for p in sorted(Path(origem).glob("g*.json")):
        item = ler_item(p)
        if item is None:
            raise ValueError(f"{p.name}: formato de item que esta versão não usa")
        if p.stem != item.id:
            raise ValueError(f"{p.name}: o nome do arquivo precisa ser o id do item ({item.id})")
        img = p.parent / item.imagem
        if not img.exists():
            raise FileNotFoundError(f"{p.name}: imagem {item.imagem} não encontrada")
        if img.read_bytes()[:3] != b"\xff\xd8\xff":
            raise ValueError(f"{p.name}: a imagem {item.imagem} precisa ser JPEG")
        mascara = None
        if isinstance(item, GabaritoJogadores):
            mascara = p.parent / item.mascara
            if not mascara.exists():
                raise FileNotFoundError(f"{p.name}: máscara {item.mascara} não encontrada")
            if not eh_png(mascara.read_bytes()[:8]):
                raise ValueError(f"{p.name}: a máscara {item.mascara} precisa ser PNG")
            conferir_mascara(mascara.read_bytes(), item)
        if (destino / f"{item.id}.json").exists():
            continue
        shutil.copyfile(img, destino / f"{item.id}.jpg")
        novo = {"imagem": f"{item.id}.jpg"}
        if mascara is not None:
            shutil.copyfile(mascara, destino / f"{item.id}.png")
            novo["mascara"] = f"{item.id}.png"
        escrever_json(destino / f"{item.id}.json", item.model_copy(update=novo))
        novos.append(item.id)
    return novos
