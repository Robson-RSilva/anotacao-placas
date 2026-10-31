"""Gabarito: imagens com a resposta verdadeira (do simulador ou de rótulos já arbitrados) — onde está
cada ponto do campo, na tarefa de pontos; o que está na frente da placa (ou que o recorte se
descarta), na de placas.

Serve para treinar e liberar quem começa (com o resultado na hora), medir cada anotador o tempo
todo (itens escondidos na fila) e testar a ferramenta antes do primeiro vídeo real. A liberação, os
itens escondidos e a comparação com a resposta são das páginas (`web/js/nucleo/gabarito.js` e
`filas.js`); aqui só se importa os itens para a pasta. Os rótulos do gabarito nunca entram no treino.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from .formatos import GabaritoPlacas, GabaritoPontos
from .mascara import eh_png, ler_png, rasterizar
from .pasta import Pasta, escrever_json, ler_json

ItemGabarito = GabaritoPontos | GabaritoPlacas

#: O formato de cada tarefa (o formato dentro do item diz a tarefa).
FORMATOS = {"gabarito.pontos/1": ("pontos", GabaritoPontos), "gabarito.placas/1": ("placas", GabaritoPlacas)}


def ler_item(p: Path) -> ItemGabarito | None:
    """Um item do gabarito, ou None quando é de um formato que esta versão não usa (os da câmera e da
    oclusão, das versões até a 0.7, os dos jogadores, da 0.8, e os das pessoas, da 0.9)."""
    formato = json.loads(p.read_text(encoding="utf-8")).get("formato")
    if formato not in FORMATOS:
        return None
    return ler_json(p, FORMATOS[formato][1])


def tarefa_do_item(item: ItemGabarito) -> str:
    return "placas" if isinstance(item, GabaritoPlacas) else "pontos"


def listar_itens(pasta: Pasta, tarefa: str | None = None) -> list[ItemGabarito]:
    """Os itens do gabarito, de uma tarefa ("pontos" ou "placas") ou das duas."""
    d = pasta.gabarito / "itens"
    if not d.exists():
        return []
    itens = [it for p in sorted(d.glob("g*.json")) if (it := ler_item(p)) is not None]
    return [g for g in itens if tarefa is None or tarefa_do_item(g) == tarefa]


def conferir_mascara(dados: bytes, item: GabaritoPlacas) -> None:
    """A máscara verdadeira tem o tamanho do recorte, só os números do item (0 e o que está na frente da
    placa, de 1 a N) e nada fora da região da placa."""
    m = ler_png(dados)
    if m.shape != (item.altura, item.largura):
        raise ValueError(f"{item.id}: a máscara não tem o tamanho da imagem")
    if (m > item.oclusores).any():
        raise ValueError(f"{item.id}: a máscara tem números além dos {item.oclusores} oclusores")
    if (m[~rasterizar(item.regiao, item.largura, item.altura)] > 0).any():
        raise ValueError(f"{item.id}: a máscara tem pintura fora da região da placa")


def importar(pasta: Pasta, origem: Path) -> list[str]:
    """Copia itens (`<id>.json` + imagem JPEG; nas placas, + a máscara PNG, menos nos itens para
    descartar) para a pasta. Item que já existe não é sobrescrito."""
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
        if isinstance(item, GabaritoPlacas) and item.mascara is not None:
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
