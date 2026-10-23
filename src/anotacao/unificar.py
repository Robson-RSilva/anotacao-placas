"""Unificar: lê tudo, valida de novo e gera os conjuntos de treino (Parquet + manifesto).

Para cada quadro fica um rótulo só: o aprovado na revisão cruzada (ou a correção do revisor). Se
mais de um foi aprovado (quadro em dupla), vale o aprovado primeiro. Quadros sem marcações
suficientes, transições e borrões ficam fora. O conjunto de cada quadro é o da partida em
`divisao.json` — nunca se misturam quadros da mesma partida entre treino e teste.

Saída em `conjuntos/<data-hora>/`:
    camera.parquet     um quadro por linha: imagem, câmera, partida e condições do jogo
    manifesto.json     contagens por conjunto, versões, hash do conteúdo
    problemas.json     arquivos inválidos e quadros pendentes
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from . import __version__
from .indice import Indice
from .pasta import Pasta, escrever_json

COLUNAS = [
    "conjunto",
    "partida",
    "quadro",
    "imagem",
    "largura",
    "altura",
    "pts_ms",
    "tomada",
    "hfov_graus",
    "pan",
    "tilt",
    "roll",
    "Cx",
    "Cy",
    "Cz",
    "k1",
    "lado",
    "residuo_mediano_px",
    "anotador",
    "versao",
    "revisor",
    "decisao",
    "manual",
    "ferramenta",
    "pacote",
    "estadio",
    "emissora",
    "competicao",
    "data_hora",
    "iluminacao",
    "chuva",
]


def unificar(pasta: Pasta, destino: Path | None = None, agora: datetime | None = None) -> Path:
    agora = agora or datetime.now(UTC)
    indice = Indice(pasta)
    divisao = pasta.ler_divisao()
    linhas, pendentes, problemas = [], [], []
    for pid in pasta.listar_partidas():
        man = indice.manifesto(pid)
        fila = indice.fila(pid)
        ip = indice.partida(pid)
        problemas += [{"arquivo": str(p.relative_to(pasta.raiz)), "erro": e} for p, e in ip.invalidos]
        item_de = {it.quadro: it for it in fila.itens}
        por_quadro = ip.por_quadro()
        for quadro in sorted(item_de):
            escolhido = None
            for a in sorted(por_quadro.get(quadro, []), key=lambda a: (a.pessoa, a.versao)):
                r = indice.rotulo(a)
                rev = ip.ultima_revisao(a.nome)
                if r.corrige is not None:
                    aprovado_em, revisor, decisao = r.criado_em, a.pessoa, "corrigir"
                elif rev is not None and rev.decisao == "aprovar":
                    aprovado_em, revisor, decisao = rev.criado_em, rev.revisor, "aprovar"
                else:
                    continue
                if escolhido is None or aprovado_em < escolhido[0]:
                    escolhido = (aprovado_em, a, r, revisor, decisao)
            if escolhido is None:
                pendentes.append({"partida": pid, "quadro": quadro, "motivo": "sem rótulo aprovado"})
                continue
            _, a, r, revisor, decisao = escolhido
            if r.situacao != "ok" or r.camera is None:
                continue
            item, c, cad = item_de[quadro], r.camera, man.cadastro
            linhas.append(
                {
                    "conjunto": divisao.conjunto(pid),
                    "partida": pid,
                    "quadro": quadro,
                    "imagem": str(pasta.quadro(pid, quadro).relative_to(pasta.raiz)).replace("\\", "/"),
                    "largura": man.video.largura,
                    "altura": man.video.altura,
                    "pts_ms": item.pts_ms,
                    "tomada": item.tomada,
                    "hfov_graus": c.hfov_graus,
                    "pan": c.pan,
                    "tilt": c.tilt,
                    "roll": c.roll,
                    "Cx": c.C[0],
                    "Cy": c.C[1],
                    "Cz": c.C[2],
                    "k1": c.k1,
                    "lado": r.lado,
                    "residuo_mediano_px": r.residuo_mediano_px,
                    "anotador": r.anotador,
                    "versao": r.versao,
                    "revisor": revisor,
                    "decisao": decisao,
                    "manual": r.manual,
                    "ferramenta": r.ferramenta,
                    "pacote": r.pacote,
                    "estadio": cad.estadio,
                    "emissora": cad.emissora,
                    "competicao": cad.competicao,
                    "data_hora": cad.data_hora.isoformat(),
                    "iluminacao": cad.iluminacao,
                    "chuva": cad.chuva,
                }
            )
    df = pd.DataFrame(linhas, columns=COLUNAS)
    conteudo = df.sort_values(["partida", "quadro"]).to_json(orient="records", double_precision=10)
    hash_conteudo = hashlib.sha256(conteudo.encode("utf-8")).hexdigest()
    destino = destino or pasta.conjuntos / agora.strftime("%Y%m%d-%H%M%S")
    destino.mkdir(parents=True, exist_ok=False)
    df.to_parquet(destino / "camera.parquet", index=False)
    contagens = {k: int(v) for k, v in df["conjunto"].value_counts().items()} if len(df) else {}
    escrever_json(
        destino / "manifesto.json",
        {
            "formato": "conjuntos.camera/1",
            "criado_em": agora.isoformat(),
            "ferramenta": __version__,
            "quadros": len(df),
            "por_conjunto": contagens,
            "partidas_por_conjunto": {
                k: sorted(df.loc[df["conjunto"] == k, "partida"].unique().tolist()) for k in contagens
            },
            "hash_conteudo": hash_conteudo,
            "divisao": json.loads(divisao.model_dump_json()),
        },
    )
    escrever_json(destino / "problemas.json", {"invalidos": problemas, "pendentes": pendentes})
    return destino
