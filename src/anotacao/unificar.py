"""Unificar: lê tudo, valida de novo e gera os conjuntos de treino (Parquet + manifesto).

Para cada quadro e cada tarefa fica um rótulo só: o aprovado na revisão cruzada (ou a correção do
revisor). Se mais de um foi aprovado (quadro em dupla), vale o aprovado primeiro. Imagens
descartadas ficam fora (o manifesto conta por motivo). O conjunto de cada quadro é o da partida em
`divisao.json` — nunca se misturam quadros da mesma partida entre treino e teste.

Uma imagem sem nenhum ponto, ou sem pessoa, entra: é o exemplo de que ali não há o que achar.

Saída em `conjuntos/<data-hora>/`:
    pontos.parquet          um quadro por linha: imagem, tamanho, quantos pontos, quem anotou e
                            revisou, partida e condições do jogo
    pontos_lista.parquet    um ponto por linha: o quadro, o nome do ponto e x, y (px da imagem)
    pessoas.parquet         um quadro por linha: imagem, máscara (o PNG do rótulo aprovado: 1 onde há
                            pessoa), pixels pintados, quem anotou e revisou, condições do jogo
    manifesto.json          contagens por conjunto, descartes por motivo, versões, hash do conteúdo
    problemas.json          arquivos inválidos e quadros pendentes
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from . import __version__
from .indice import Arquivo, Indice, IndicePartida
from .mascara import ler_png
from .pasta import Pasta, escrever_json

COMUNS = ["estadio", "emissora", "competicao", "data_hora", "iluminacao", "chuva"]
AUTORIA = ["anotador", "versao", "revisor", "decisao", "manual", "ferramenta"]
QUADRO = ["conjunto", "partida", "quadro", "imagem", "largura", "altura", "pts_ms", "tomada"]

COLUNAS_PONTOS = [*QUADRO, "n_pontos", *AUTORIA, *COMUNS]
COLUNAS_LISTA = ["conjunto", "partida", "quadro", "ponto", "x", "y"]
COLUNAS_PESSOAS = [*QUADRO, "mascara", "pixels", *AUTORIA, *COMUNS]


def aprovado(ip: IndicePartida, quadro: str, ler) -> tuple | None:
    """O rótulo aprovado primeiro do quadro: (aprovado_em, arquivo, rótulo, revisor, decisão), ou None.

    Uma correção do revisor conta como aprovada quando foi gravada; um rótulo aprovado, quando a
    revisão foi gravada. Empate: o primeiro por (pessoa, versão). A mesma regra das páginas
    (`rotuloAprovado` em `web/js/nucleo/filas.js`)."""
    escolhido = None
    for a in sorted(ip.por_quadro().get(quadro, []), key=lambda a: (a.pessoa, a.versao)):
        r = ler(a)
        rev = ip.ultima_revisao(a.nome)
        if r.corrige is not None:
            aprovado_em, revisor, decisao = r.criado_em, a.pessoa, "corrigir"
        elif rev is not None and rev.decisao == "aprovar":
            aprovado_em, revisor, decisao = rev.criado_em, rev.revisor, "aprovar"
        else:
            continue
        if escolhido is None or aprovado_em < escolhido[0]:
            escolhido = (aprovado_em, a, r, revisor, decisao)
    return escolhido


def _hash(df: pd.DataFrame, chaves: list[str]) -> str:
    conteudo = df.sort_values(chaves).to_json(orient="records", double_precision=10) if len(df) else "[]"
    return hashlib.sha256(conteudo.encode("utf-8")).hexdigest()


def _contagens(df: pd.DataFrame) -> dict[str, int]:
    return {k: int(v) for k, v in df["conjunto"].value_counts().items()} if len(df) else {}


def _mascara(caminho: Path, r) -> tuple[np.ndarray | None, str | None]:
    """A máscara do rótulo aprovado: (pixels, None), ou (None, o motivo de não entrar)."""
    try:
        m = ler_png(caminho)
    except (ValueError, OSError) as e:
        return None, f"máscara ilegível: {e}"
    if m.shape != (r.altura, r.largura):
        return None, "a máscara não tem o tamanho da imagem"
    if m.max(initial=0) > 1:
        return None, "a máscara tem valores além de 0 e 1"
    return m, None


def unificar(pasta: Pasta, destino: Path | None = None, agora: datetime | None = None) -> Path:
    agora = agora or datetime.now(UTC)
    indice = Indice(pasta)
    divisao = pasta.ler_divisao()
    linhas_pontos, linhas_lista, linhas_pes = [], [], []
    pendentes, problemas = [], []
    descartes = {"pontos": Counter(), "pessoas": Counter()}

    for pid in pasta.listar_partidas():
        try:
            man = indice.manifesto(pid)
            fila = indice.fila(pid)
        except (ValueError, OSError) as e:  # incompleta (ainda sincronizando) ou inválida: fica de fora
            problemas.append({"arquivo": f"partidas/{pid}", "erro": f"partida fora dos conjuntos: {e}"})
            continue
        rel = lambda p: str(p.relative_to(pasta.raiz)).replace("\\", "/")  # noqa: E731
        conjunto = divisao.conjunto(pid)
        cad = man.cadastro
        comum = {
            "estadio": cad.estadio,
            "emissora": cad.emissora,
            "competicao": cad.competicao,
            "data_hora": cad.data_hora.isoformat(),
            "iluminacao": cad.iluminacao,
            "chuva": cad.chuva,
        }
        for tarefa in ("pontos", "pessoas"):
            ip = indice.partida(pid, tarefa)
            problemas += [{"arquivo": rel(p), "erro": e} for p, e in ip.invalidos]
            problemas += [{"arquivo": rel(p), "erro": "a máscara ainda não chegou"} for p in ip.esperando]
            for item in sorted(fila.itens, key=lambda it: it.quadro):
                escolhido = aprovado(ip, item.quadro, lambda a, t=tarefa: indice.rotulo(a, t))
                if escolhido is None:
                    pendentes.append(
                        {"partida": pid, "quadro": item.quadro, "tarefa": tarefa, "motivo": "sem rótulo aprovado"}
                    )
                    continue
                _, a, r, revisor, decisao = escolhido
                if r.situacao == "descartada":
                    descartes[tarefa][r.motivo_descarte] += 1
                    continue
                base = {
                    "conjunto": conjunto,
                    "partida": pid,
                    "quadro": item.quadro,
                    "imagem": rel(pasta.quadro(pid, item.quadro)),
                    "largura": r.largura,
                    "altura": r.altura,
                    "pts_ms": item.pts_ms,
                    "tomada": item.tomada,
                }
                autoria = {
                    "anotador": r.anotador,
                    "versao": r.versao,
                    "revisor": revisor,
                    "decisao": decisao,
                    "manual": r.manual,
                    "ferramenta": r.ferramenta,
                }
                if tarefa == "pontos":
                    linhas_pontos.append({**base, "n_pontos": len(r.pontos), **autoria, **comum})
                    linhas_lista += [
                        {
                            "conjunto": conjunto,
                            "partida": pid,
                            "quadro": item.quadro,
                            "ponto": p.ponto,
                            "x": p.x,
                            "y": p.y,
                        }
                        for p in r.pontos
                    ]
                    continue
                caminho = Path(a.caminho).parent / r.mascara
                m, erro = _mascara(caminho, r)
                if erro:
                    pendentes.append({"partida": pid, "quadro": item.quadro, "tarefa": tarefa, "motivo": erro})
                    continue
                linhas_pes.append({**base, "mascara": rel(caminho), "pixels": int(m.sum()), **autoria, **comum})

    df_pontos = pd.DataFrame(linhas_pontos, columns=COLUNAS_PONTOS)
    df_lista = pd.DataFrame(linhas_lista, columns=COLUNAS_LISTA).astype({"x": "float64", "y": "float64"})
    df_pes = pd.DataFrame(linhas_pes, columns=COLUNAS_PESSOAS)
    destino = destino or pasta.conjuntos / agora.strftime("%Y%m%d-%H%M%S")
    destino.mkdir(parents=True, exist_ok=False)
    df_pontos.to_parquet(destino / "pontos.parquet", index=False)
    df_lista.to_parquet(destino / "pontos_lista.parquet", index=False)
    df_pes.to_parquet(destino / "pessoas.parquet", index=False)
    partidas = sorted(set(df_pontos["partida"]) | set(df_pes["partida"]))
    escrever_json(
        destino / "manifesto.json",
        {
            "formato": "conjuntos/4",
            "criado_em": agora.isoformat(),
            "ferramenta": __version__,
            "pontos": {
                "quadros": len(df_pontos),
                "pontos": len(df_lista),
                "sem_pontos": int((df_pontos["n_pontos"] == 0).sum()) if len(df_pontos) else 0,
                "por_conjunto": _contagens(df_pontos),
                "hash_conteudo": _hash(df_pontos, ["partida", "quadro"]),
                "hash_pontos": _hash(df_lista, ["partida", "quadro", "ponto"]),
            },
            "pessoas": {
                "quadros": len(df_pes),
                "sem_pessoas": int((df_pes["pixels"] == 0).sum()) if len(df_pes) else 0,
                "por_conjunto": _contagens(df_pes),
                "hash_conteudo": _hash(df_pes, ["partida", "quadro"]),
            },
            "descartados": {t: dict(sorted(c.items())) for t, c in descartes.items()},
            "partidas_por_conjunto": {
                k: sorted(p for p in partidas if divisao.conjunto(p) == k)
                for k in sorted({divisao.conjunto(p) for p in partidas})
            },
            "divisao": json.loads(divisao.model_dump_json()),
        },
    )
    escrever_json(destino / "problemas.json", {"invalidos": problemas, "pendentes": pendentes})
    return destino


__all__ = ["Arquivo", "aprovado", "unificar"]
