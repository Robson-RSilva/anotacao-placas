"""Gabarito: quadros com a câmera verdadeira (do simulador ou de rótulos já arbitrados).

Serve para três coisas: treinar e liberar quem começa (com o resultado mostrado na hora), medir
cada anotador o tempo todo (itens escondidos na fila, sem resultado) e testar a ferramenta antes do
primeiro vídeo real. Os rótulos do gabarito ficam em `gabarito/rotulos/` e nunca entram no treino.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .avaliacao import distancia_cameras
from .formatos import GabaritoCamera
from .indice import Indice
from .pacote import campo_do_pacote
from .pasta import Pasta, escrever_json, ler_json

N_LIBERACAO = 10
LIMITE_LIBERACAO_PX = 2.0


def listar_itens(pasta: Pasta) -> list[GabaritoCamera]:
    d = pasta.gabarito / "itens"
    if not d.exists():
        return []
    return [ler_json(p, GabaritoCamera) for p in sorted(d.glob("g*.json"))]


def importar(pasta: Pasta, origem: Path) -> list[str]:
    """Copia itens (`<id>.json` + imagem) para a pasta. Item que já existe não é sobrescrito."""
    destino = pasta.gabarito / "itens"
    destino.mkdir(parents=True, exist_ok=True)
    novos = []
    for p in sorted(Path(origem).glob("g*.json")):
        item = ler_json(p, GabaritoCamera)
        img = p.parent / item.imagem
        if not img.exists():
            raise FileNotFoundError(f"{p.name}: imagem {item.imagem} não encontrada")
        pasta.ler_pacote_ref(item.pacote)  # o pacote precisa existir na pasta
        if (destino / f"{item.id}.json").exists():
            continue
        shutil.copyfile(img, destino / f"{item.id}.jpg")
        escrever_json(destino / f"{item.id}.json", item.model_copy(update={"imagem": f"{item.id}.jpg"}))
        novos.append(item.id)
    return novos


@dataclass
class ResultadoGabarito:
    item: str
    mediana_px: float | None
    criado_em: str


def resultados(pasta: Pasta, indice: Indice, pessoa: str) -> list[ResultadoGabarito]:
    """Última versão de cada item do gabarito anotado pela pessoa, comparada com a câmera verdadeira."""
    itens = {g.id: g for g in listar_itens(pasta)}
    ip = indice.partida("gabarito")
    out = []
    for (quadro, autor), arq in ip.ultimos().items():
        if autor != pessoa or quadro not in itens:
            continue
        g = itens[quadro]
        r = indice.rotulo(arq)
        mediana = None
        if r.camera is not None:
            pac = pasta.ler_pacote_ref(g.pacote)
            d = distancia_cameras(r.camera, g.camera, pac, campo_do_pacote(pac), g.largura, g.altura)
            mediana = d[0] if d else None
        out.append(ResultadoGabarito(quadro, mediana, r.criado_em.isoformat()))
    return sorted(out, key=lambda x: x.criado_em)


def liberacao(res: list[ResultadoGabarito], tem_gabarito: bool) -> dict:
    """Liberado para dados reais: mediana dos últimos 10 itens <= 2 px. Sem gabarito, não há bloqueio."""
    if not tem_gabarito:
        return {"liberado": True, "n": 0, "mediana_px": None, "motivo": "sem gabarito importado"}
    ultimos = res[-N_LIBERACAO:]
    vals = [r.mediana_px if r.mediana_px is not None else np.inf for r in ultimos]
    mediana = float(np.median(vals)) if vals else None
    ok = len(ultimos) >= N_LIBERACAO and mediana is not None and mediana <= LIMITE_LIBERACAO_PX
    return {
        "liberado": bool(ok),
        "n": len(res),
        "mediana_px": None if mediana in (None, np.inf) else mediana,
        "motivo": "" if ok else f"faltam acertos no gabarito ({len(ultimos)}/{N_LIBERACAO}, meta ≤ 2 px)",
    }
