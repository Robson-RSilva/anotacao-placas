"""Gabarito: quadros com a resposta verdadeira (do simulador ou de rótulos já arbitrados) — a câmera,
na tarefa de câmera; as placas e a máscara, na de oclusão.

Serve para treinar e liberar quem começa (com o resultado na hora), medir cada anotador o tempo
todo (itens escondidos na fila) e testar a ferramenta antes do primeiro vídeo real. A liberação e
os itens escondidos são decididos pelas páginas (`web/js/nucleo/filas.js`, `filas-oclusao.js` e
`gabarito.js`); aqui só se importa os itens para a pasta. Os rótulos do gabarito nunca entram no
treino.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from .formatos import GabaritoCamera, GabaritoOclusao
from .mascara import eh_png
from .pasta import Pasta, escrever_json, ler_json

ItemGabarito = GabaritoCamera | GabaritoOclusao


def ler_item(p: Path) -> ItemGabarito:
    """Um item do gabarito: o formato dentro dele diz se é da câmera ou da oclusão."""
    formato = json.loads(p.read_text(encoding="utf-8")).get("formato")
    return ler_json(p, GabaritoOclusao if formato == "gabarito.oclusao/1" else GabaritoCamera)


def listar_itens(pasta: Pasta, tarefa: str | None = None) -> list[ItemGabarito]:
    """Os itens do gabarito, de uma tarefa ("camera" ou "oclusao") ou de todas."""
    d = pasta.gabarito / "itens"
    if not d.exists():
        return []
    itens = [ler_item(p) for p in sorted(d.glob("g*.json"))]
    if tarefa is None:
        return itens
    tipo = GabaritoOclusao if tarefa == "oclusao" else GabaritoCamera
    return [g for g in itens if isinstance(g, tipo)]


def importar(pasta: Pasta, origem: Path) -> list[str]:
    """Copia itens (`<id>.json` + imagem JPEG; na oclusão, + a máscara PNG) para a pasta. Item que já
    existe não é sobrescrito."""
    destino = pasta.gabarito / "itens"
    destino.mkdir(parents=True, exist_ok=True)
    novos = []
    for p in sorted(Path(origem).glob("g*.json")):
        item = ler_item(p)
        if p.stem != item.id:
            raise ValueError(f"{p.name}: o nome do arquivo precisa ser o id do item ({item.id})")
        img = p.parent / item.imagem
        if not img.exists():
            raise FileNotFoundError(f"{p.name}: imagem {item.imagem} não encontrada")
        if img.read_bytes()[:3] != b"\xff\xd8\xff":
            raise ValueError(f"{p.name}: a imagem {item.imagem} precisa ser JPEG")
        mascara = None
        if isinstance(item, GabaritoOclusao):
            mascara = p.parent / item.mascara
            if not mascara.exists():
                raise FileNotFoundError(f"{p.name}: máscara {item.mascara} não encontrada")
            if not eh_png(mascara.read_bytes()[:8]):
                raise ValueError(f"{p.name}: a máscara {item.mascara} precisa ser PNG")
        pasta.ler_pacote_ref(item.pacote)  # o pacote precisa existir na pasta
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
