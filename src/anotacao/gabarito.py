"""Gabarito: quadros com a câmera verdadeira (do simulador ou de rótulos já arbitrados).

Serve para treinar e liberar quem começa (com o resultado na hora), medir cada anotador o tempo
todo (itens escondidos na fila) e testar a ferramenta antes do primeiro vídeo real. A liberação e
os itens escondidos são decididos pelas páginas (`web/js/nucleo/filas.js` e `gabarito.js`); aqui
só se importa os itens para a pasta. Os rótulos do gabarito nunca entram no treino.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from .formatos import GabaritoCamera
from .pasta import Pasta, escrever_json, ler_json


def listar_itens(pasta: Pasta) -> list[GabaritoCamera]:
    d = pasta.gabarito / "itens"
    if not d.exists():
        return []
    return [ler_json(p, GabaritoCamera) for p in sorted(d.glob("g*.json"))]


def importar(pasta: Pasta, origem: Path) -> list[str]:
    """Copia itens (`<id>.json` + imagem JPEG) para a pasta. Item que já existe não é sobrescrito."""
    destino = pasta.gabarito / "itens"
    destino.mkdir(parents=True, exist_ok=True)
    novos = []
    for p in sorted(Path(origem).glob("g*.json")):
        item = ler_json(p, GabaritoCamera)
        if p.stem != item.id:
            raise ValueError(f"{p.name}: o nome do arquivo precisa ser o id do item ({item.id})")
        img = p.parent / item.imagem
        if not img.exists():
            raise FileNotFoundError(f"{p.name}: imagem {item.imagem} não encontrada")
        if img.read_bytes()[:3] != b"\xff\xd8\xff":
            raise ValueError(f"{p.name}: a imagem {item.imagem} precisa ser JPEG")
        pasta.ler_pacote_ref(item.pacote)  # o pacote precisa existir na pasta
        if (destino / f"{item.id}.json").exists():
            continue
        shutil.copyfile(img, destino / f"{item.id}.jpg")
        escrever_json(destino / f"{item.id}.json", item.model_copy(update={"imagem": f"{item.id}.jpg"}))
        novos.append(item.id)
    return novos
