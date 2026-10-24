"""Unificar: lê tudo, valida de novo e gera os conjuntos de treino (Parquet + manifesto).

Para cada quadro fica um rótulo só: o aprovado na revisão cruzada (ou a correção do revisor). Se
mais de um foi aprovado (quadro em dupla), vale o aprovado primeiro. Quadros sem marcações
suficientes, transições e borrões ficam fora. O conjunto de cada quadro é o da partida em
`divisao.json` — nunca se misturam quadros da mesma partida entre treino e teste.

A oclusão segue a mesma regra: a pintura aprovada primeiro de cada quadro, com a máscara PNG ao
lado. O que a máscara diz de cada placa é recalculado aqui, da máscara e das placas (a página grava o
mesmo número no rótulo; o `anotacao validar` confere os dois).

Saída em `conjuntos/<data-hora>/`:
    camera.parquet           um quadro por linha: imagem, câmera, medidas do campo no molde, partida e
                             condições do jogo
    oclusao.parquet          um quadro por linha: imagem, máscara, câmera, de onde vêm as placas e os
                             totais por classe
    oclusao_placas.parquet   uma placa por linha: pixels de cada classe, fração livre, altura e o
                             retângulo da placa na imagem (para recortar)
    manifesto.json           contagens por conjunto, versões, hash do conteúdo
    problemas.json           arquivos inválidos e quadros pendentes
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from . import __version__, oclusao
from .camera import Camera
from .indice import Arquivo, Indice, IndicePartida
from .mascara import ler_png
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
    "campo_comprimento",
    "campo_largura",
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

CLASSES_PX = ["livre_px", "pessoa_px", "bola_px", "rede_px", "grafismo_px", "objeto_px", "nao_placa_px"]

COLUNAS_OCLUSAO = [
    "conjunto",
    "partida",
    "quadro",
    "imagem",
    "mascara",
    "largura",
    "altura",
    "pts_ms",
    "tomada",
    "camera_de",
    "hfov_graus",
    "pan",
    "tilt",
    "roll",
    "Cx",
    "Cy",
    "Cz",
    "k1",
    "campo_comprimento",
    "campo_largura",
    "placas_de",
    "faixas",
    "placas",
    "placas_pintadas",
    *CLASSES_PX,
    "livre_frac_minima",
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

COLUNAS_PLACAS = [
    "conjunto",
    "partida",
    "quadro",
    "placa",
    "lado",
    "area_px",
    "outra_placa_px",
    *CLASSES_PX,
    "livre_frac",
    "altura_ref_px",
    "pequena",
    "x0",
    "y0",
    "x1",
    "y1",
]


def aprovado(indice: Indice, ip: IndicePartida, quadro: str, ler) -> tuple | None:
    """O rótulo aprovado primeiro do quadro: (aprovado_em, arquivo, rótulo, revisor, decisão), ou None.

    Uma correção do revisor conta como aprovada quando foi gravada; um rótulo aprovado, quando a
    revisão foi gravada. Empate: o primeiro por (pessoa, versão). A mesma regra das páginas
    (`cameraAprovada` em `web/js/nucleo/filas-oclusao.js`)."""
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


def _caixas(regiao: np.ndarray, n: int) -> dict[int, tuple[int, int, int, int]]:
    """O retângulo [x0, x1) × [y0, y1) dos pixels em que cada placa (índice + 1) está na frente."""
    out = {}
    ys, xs = np.nonzero(regiao)
    if not len(ys):
        return out
    v = regiao[ys, xs].astype(np.int64)
    for k in np.unique(v):
        sel = v == k
        out[int(k) - 1] = (int(xs[sel].min()), int(ys[sel].min()), int(xs[sel].max()) + 1, int(ys[sel].max()) + 1)
    return out


def unificar(pasta: Pasta, destino: Path | None = None, agora: datetime | None = None) -> Path:
    agora = agora or datetime.now(UTC)
    indice = Indice(pasta)
    divisao = pasta.ler_divisao()
    linhas, linhas_oc, linhas_placas = [], [], []
    pendentes, problemas = [], []
    pacotes: dict = {}

    def pacote(ref: str):
        """O pacote (None quando não dá para ler; o problema vai para a lista)."""
        if ref not in pacotes:
            try:
                pacotes[ref] = pasta.ler_pacote_ref(ref)
            except (ValueError, OSError) as e:
                pacotes[ref] = None
                problemas.append({"arquivo": f"estadios/{ref}", "erro": f"pacote ilegível: {e}"})
        return pacotes[ref]

    def campo(r) -> tuple[float, float] | None:
        """Medidas do campo no molde do rótulo: as dele, ou as do pacote (None: pacote que não dá para ler)."""
        if r.campo is not None:
            return r.campo.comprimento, r.campo.largura
        p = pacote(r.pacote)
        return None if p is None else (p.campo.comprimento, p.campo.largura)

    for pid in pasta.listar_partidas():
        try:
            man = indice.manifesto(pid)
            fila = indice.fila(pid)
        except (ValueError, OSError) as e:  # incompleta (ainda sincronizando) ou inválida: fica de fora
            problemas.append({"arquivo": f"partidas/{pid}", "erro": f"partida fora dos conjuntos: {e}"})
            continue
        ip = indice.partida(pid)
        ipo = indice.partida(pid, "oclusao")
        rel = lambda p: str(p.relative_to(pasta.raiz))  # noqa: E731
        problemas += [{"arquivo": rel(p), "erro": e} for p, e in ip.invalidos + ipo.invalidos]
        problemas += [{"arquivo": rel(p), "erro": "a máscara ainda não chegou"} for p in ipo.esperando]
        item_de = {it.quadro: it for it in fila.itens}
        cad = man.cadastro
        comum = {
            "estadio": cad.estadio,
            "emissora": cad.emissora,
            "competicao": cad.competicao,
            "data_hora": cad.data_hora.isoformat(),
            "iluminacao": cad.iluminacao,
            "chuva": cad.chuva,
        }
        for quadro in sorted(item_de):
            escolhido = aprovado(indice, ip, quadro, indice.rotulo)
            if escolhido is None:
                pendentes.append({"partida": pid, "quadro": quadro, "motivo": "sem rótulo aprovado"})
                continue
            _, _a, r, revisor, decisao = escolhido
            if r.situacao != "ok" or r.camera is None:
                continue
            medidas = campo(r)
            if medidas is None:
                pendentes.append({"partida": pid, "quadro": quadro, "motivo": f"sem as medidas do campo ({r.pacote})"})
                continue
            item, c = item_de[quadro], r.camera
            comprimento, largura = medidas
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
                    "campo_comprimento": comprimento,
                    "campo_largura": largura,
                    "lado": r.lado,
                    "residuo_mediano_px": r.residuo_mediano_px,
                    "anotador": r.anotador,
                    "versao": r.versao,
                    "revisor": revisor,
                    "decisao": decisao,
                    "manual": r.manual,
                    "ferramenta": r.ferramenta,
                    "pacote": r.pacote,
                    **comum,
                }
            )
            # oclusão: só os quadros com a câmera aprovada podem ter pintura
            linha_oc = _oclusao(pasta, indice, ipo, pid, quadro, pacote, campo)
            if linha_oc is None:
                continue
            if isinstance(linha_oc, str):
                pendentes.append({"partida": pid, "quadro": quadro, "tarefa": "oclusao", "motivo": linha_oc})
                continue
            linha, placas = linha_oc
            conjunto = divisao.conjunto(pid)
            linhas_oc.append(
                {
                    "conjunto": conjunto,
                    "partida": pid,
                    "quadro": quadro,
                    "imagem": linhas[-1]["imagem"],
                    "pts_ms": item.pts_ms,
                    "tomada": item.tomada,
                    **linha,
                    **comum,
                }
            )
            linhas_placas += [{"conjunto": conjunto, "partida": pid, "quadro": quadro, **p} for p in placas]

    df = pd.DataFrame(linhas, columns=COLUNAS)
    df_oc = pd.DataFrame(linhas_oc, columns=COLUNAS_OCLUSAO)
    df_placas = pd.DataFrame(linhas_placas, columns=COLUNAS_PLACAS)
    destino = destino or pasta.conjuntos / agora.strftime("%Y%m%d-%H%M%S")
    destino.mkdir(parents=True, exist_ok=False)
    df.to_parquet(destino / "camera.parquet", index=False)
    df_oc.to_parquet(destino / "oclusao.parquet", index=False)
    df_placas.to_parquet(destino / "oclusao_placas.parquet", index=False)
    contagens = _contagens(df)
    escrever_json(
        destino / "manifesto.json",
        {
            "formato": "conjuntos/2",
            "criado_em": agora.isoformat(),
            "ferramenta": __version__,
            "quadros": len(df),
            "por_conjunto": contagens,
            "partidas_por_conjunto": {
                k: sorted(df.loc[df["conjunto"] == k, "partida"].unique().tolist()) for k in contagens
            },
            "hash_conteudo": _hash(df, ["partida", "quadro"]),
            "oclusao": {
                "quadros": len(df_oc),
                "placas": len(df_placas),
                "placas_pintadas": int((~df_placas["pequena"]).sum()) if len(df_placas) else 0,
                "por_conjunto": _contagens(df_oc),
                "hash_conteudo": _hash(df_placas, ["partida", "quadro", "placa"]),
            },
            "divisao": json.loads(divisao.model_dump_json()),
        },
    )
    escrever_json(destino / "problemas.json", {"invalidos": problemas, "pendentes": pendentes})
    return destino


def _oclusao(pasta: Pasta, indice: Indice, ipo: IndicePartida, pid: str, quadro: str, pacote, campo):
    """A linha do quadro no conjunto da oclusão e as das placas; None sem pintura aprovada que entre
    no treino, ou o motivo (texto) de uma pintura aprovada que não pôde entrar."""
    escolhido = aprovado(indice, ipo, quadro, indice.rotulo_oclusao)
    if escolhido is None:
        return None
    _, a, r, revisor, decisao = escolhido
    if r.situacao == "camera_errada":
        return "câmera errada na pintura da oclusão: refazer a câmera do quadro"
    if r.situacao != "ok" or r.mascara is None:
        return None
    pac = pacote(r.pacote)
    medidas = campo(r)
    if pac is None or medidas is None:
        return f"sem o pacote das placas ({r.pacote})"
    caminho = Path(a.caminho).parent / r.mascara
    try:
        mascara = ler_png(caminho)
    except (ValueError, OSError) as e:
        return f"máscara ilegível: {e}"
    if mascara.shape != (r.altura, r.largura):
        return "a máscara não tem o tamanho do quadro"
    faixas = r.faixas.model_dump() if r.faixas is not None else None
    placas3d = oclusao.placas_do_rotulo(r.placas_de, faixas, medidas, pac)
    geo = oclusao.geometria(Camera.de_rotulo(r.camera.model_dump(), r.largura, r.altura), placas3d, r.largura, r.altura)
    mascara = np.where(geo.roi, mascara, oclusao.FORA).astype(np.uint8)  # nada fora do que se pinta
    est = oclusao.estatisticas(mascara, geo)
    caixas = _caixas(geo.regiao, len(placas3d))
    info = {p["id"]: p["k"] for p in geo.info}
    placas = []
    for p in est:
        x0, y0, x1, y1 = caixas.get(info[p["id"]], (-1, -1, -1, -1))
        placas.append({
            "placa": p["id"], "lado": p["lado"], "area_px": p["area_px"], "outra_placa_px": p["outra_placa_px"],
            **{k: p[k] for k in CLASSES_PX}, "livre_frac": p["livre_frac"], "altura_ref_px": p["altura_ref_px"],
            "pequena": p["pequena"], "x0": x0, "y0": y0, "x1": x1, "y1": y1,
        })  # fmt: skip
    pintadas = [p for p in est if not p["pequena"]]
    fracs = [p["livre_frac"] for p in pintadas if p["livre_frac"] is not None]
    c = r.camera
    linha = {
        "mascara": str(caminho.relative_to(pasta.raiz)).replace("\\", "/"),
        "largura": r.largura,
        "altura": r.altura,
        "camera_de": r.camera_de,
        "hfov_graus": c.hfov_graus,
        "pan": c.pan,
        "tilt": c.tilt,
        "roll": c.roll,
        "Cx": c.C[0],
        "Cy": c.C[1],
        "Cz": c.C[2],
        "k1": c.k1,
        "campo_comprimento": medidas[0],
        "campo_largura": medidas[1],
        "placas_de": r.placas_de,
        "faixas": json.dumps(faixas, ensure_ascii=False) if faixas is not None else "",
        "placas": len(est),
        "placas_pintadas": len(pintadas),
        **{k: int(sum(p[k] for p in pintadas)) for k in CLASSES_PX},
        "livre_frac_minima": min(fracs) if fracs else None,
        "anotador": r.anotador,
        "versao": r.versao,
        "revisor": revisor,
        "decisao": decisao,
        "manual": r.manual,
        "ferramenta": r.ferramenta,
        "pacote": r.pacote,
    }
    return linha, placas


__all__ = ["Arquivo", "aprovado", "unificar"]
