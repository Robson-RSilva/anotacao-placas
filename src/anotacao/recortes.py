"""Os recortes das placas: o que a pintura das placas recebe pronto, de fora das páginas.

Cada recorte é uma placa num quadro, endireitada — o retângulo da placa com um pouco em volta —, e
vem num lote (`recortes.lote/1`) com a região que se pinta e onde a placa está no quadro. Quem gera
os recortes (o simulador do laboratório, por enquanto; depois, a projeção das placas) monta o lote
com `montar_lote`, que também sorteia a dupla às cegas e o "sem previsão" como a importação de um
vídeo sorteia nos quadros; quem coordena traz o lote para a partida com `anotacao recortes`. O
recorte é considerado certo: quem pinta não ajusta a placa — se ela não está no lugar, descarta.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import cv2
import numpy as np

from .formatos import ItemRecorte, LoteRecortes
from .indice import Indice
from .pasta import ArquivoExiste, Pasta, escrever_bytes, escrever_json, ler_json

#: Como nos quadros sorteados de um vídeo: cerca de 10% em dupla às cegas e 10% sem a pré-pintura.
FRAC_DUPLA = 0.1
FRAC_SEM_PREVISAO = 0.1


def montar_lote(
    partida: str,
    lote: str,
    itens: list[ItemRecorte | dict],
    *,
    origem: str,
    gerador: str,
    semente: int = 0,
    criado_em: datetime | None = None,
) -> LoteRecortes:
    """O lote, com a dupla às cegas e o "sem previsão" sorteados (reprodutível pela semente)."""
    itens = [ItemRecorte.model_validate(it) if isinstance(it, dict) else it.model_copy() for it in itens]
    rng = np.random.default_rng(semente)
    n = len(itens)
    for frac, campo in ((FRAC_DUPLA, "dupla"), (FRAC_SEM_PREVISAO, "sem_previsao")):
        for j in rng.choice(n, size=min(round(frac * n), n), replace=False):
            setattr(itens[int(j)], campo, True)
    return LoteRecortes(
        partida=partida,
        lote=lote,
        criado_em=criado_em or datetime.now(UTC),
        origem=origem,
        gerador=gerador,
        itens=itens,
    )


def tamanho_jpeg(dados: bytes) -> tuple[int, int] | None:
    """(largura, altura) de um JPEG, ou None quando não é um JPEG legível."""
    if dados[:3] != b"\xff\xd8\xff":
        return None
    img = cv2.imdecode(np.frombuffer(dados, np.uint8), cv2.IMREAD_GRAYSCALE)
    return None if img is None else (img.shape[1], img.shape[0])


def importar_lote(pasta: Pasta, origem: Path) -> dict:
    """Traz um lote de recortes (`<lote>.json`, com os `<recorte>.jpg` ao lado) para a partida dele.

    A partida precisa estar na pasta (os recortes são de quadros do vídeo dela). Confere cada imagem
    (JPEG, do tamanho que o lote diz), recusa um recorte que já veio em outro lote da partida e nunca
    sobrescreve: trazer de novo o mesmo lote não muda nada. As imagens vão antes e o lote por último —
    a partida só passa a ter o lote quando as imagens dele já estão lá. Devolve {partida, lote,
    recortes, novos}."""
    origem = Path(origem)
    lr = ler_json(origem, LoteRecortes)
    if origem.stem != lr.lote:
        raise ValueError(f"{origem.name}: o nome do arquivo precisa ser o do lote ({lr.lote}.json)")
    if lr.partida not in pasta.listar_partidas():
        raise ValueError(f"a partida {lr.partida} não está na pasta: importe o vídeo dela antes dos recortes")
    destino = pasta.lote_recortes(lr.partida, lr.lote)
    if destino.exists():
        if ler_json(destino, LoteRecortes) == lr:
            return {"partida": lr.partida, "lote": lr.lote, "recortes": len(lr.itens), "novos": 0}
        raise ArquivoExiste(f"já há um lote {lr.lote} na partida {lr.partida}, com outro conteúdo")
    ja = Indice(pasta).recortes(lr.partida).itens
    repetidos = [it.recorte for it in lr.itens if it.recorte in ja]
    if repetidos:
        raise ValueError(f"{len(repetidos)} recorte(s) já vieram em outro lote da partida (ex.: {repetidos[0]})")
    imagens = []
    for it in lr.itens:
        img = origem.parent / f"{it.recorte}.jpg"
        if not img.is_file():
            raise FileNotFoundError(f"{origem.name}: falta a imagem {img.name}")
        dados = img.read_bytes()
        tam = tamanho_jpeg(dados)
        if tam is None:
            raise ValueError(f"{img.name}: não é um JPEG")
        if tam != (it.largura, it.altura):
            raise ValueError(f"{img.name}: a imagem tem {tam[0]} x {tam[1]} px, o lote diz {it.largura} x {it.altura}")
        imagens.append((pasta.recorte(lr.partida, it.recorte), dados))
    novos = 0
    for caminho, dados in imagens:
        if caminho.exists():
            if caminho.read_bytes() != dados:
                raise ArquivoExiste(f"{caminho.name}: já há outra imagem com este nome na partida")
            continue
        escrever_bytes(caminho, dados)
        novos += 1
    escrever_json(destino, lr)
    return {"partida": lr.partida, "lote": lr.lote, "recortes": len(lr.itens), "novos": novos}
