"""Lotes de ouro tirados do que a equipe já anotou: o gabarito arbitrado.

Cada item aprovado na revisão (a regra do `unificar`) vira um item do gabarito com `origem:
"arbitrado"`, num .zip que entra pela página do gabarito ("Importar lote de ouro (.zip)") como os do
simulador:

* pontos: os pontos do rótulo aprovado — os que ficam rente à borda (a menos de 3 px, ref. 960)
  são opcionais, como no simulador;
* placas: a máscara aprovada, com cada pedaço pintado como uma coisa na frente da placa (de 1 a N,
  da esquerda para a direita); o recorte descartado (e aprovado) como "o recorte não está na placa"
  vira um item para descartar. Os outros descartes não viram gabarito.

Só entra o item que não vai mais mudar: todo rótulo dele já revisado e, na dupla às cegas, as duas
pessoas já anotaram. O item nunca vai para quem trabalhou nele: quem anotou, revisou ou corrigiu fica
em `fora_de`. Um em cada três vai para o treino (o lote com "treino" no nome) e os outros para os
escondidos, por um sorteio fixo pelo item.

Cada rodada leva só o que ainda não foi para nenhum lote: o registro `conjuntos/ouro-reais.json` guarda
o que já foi, com o id de cada item. Assim cada .zip é um lote novo (PR1, PR2... nos pontos; PLR1,
PLR2... nas placas), os ids nunca se repetem (pontos em g5001 a g5999, placas em g6001 a g6999) e
importar um .zip de novo não muda nada.
"""

from __future__ import annotations

import hashlib
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import cv2
import numpy as np

from .convencoes import REF_W
from .formatos import GabaritoPlacas, GabaritoPontos, PontoVerdadeiro
from .indice import Indice, IndicePartida
from .mascara import gravar_png
from .pasta import Pasta, escrever_bytes, escrever_json, ler_json
from .recortes import tamanho_jpeg
from .unificar import aprovado, mascara_da_placa

#: As faixas de ids dos itens tirados de rótulos reais (as do simulador: g1xxx pontos, g4xxx placas).
FAIXA = {"pontos": (5001, 5999), "placas": (6001, 6999)}
#: O começo do nome dos lotes de cada tarefa: PR1-treino, PR1-controle, PLR1-treino...
PREFIXO = {"pontos": "PR", "placas": "PLR"}
A_CADA_TREINO = 3  # um em cada três itens vai para o treino
BORDA_REF = 3.0  # ponto a menos disto da borda (px, ref. 960): marcar é opcional
REGISTRO = "ouro-reais.json"
DATA_ZIP = (2026, 1, 1, 0, 0, 0)  # data fixa nas entradas: o mesmo conteúdo dá os mesmos bytes
#: As cores da máscara verdadeira (só para ver o PNG; a página lê os números).
PALETA = [(0, 0, 0)] + [((255, 64, 129), (41, 211, 255), (255, 196, 0), (102, 187, 106))[k % 4] for k in range(255)]


@dataclass
class Rodada:
    """O que uma rodada fez: o .zip (None quando não havia nada novo), os itens por lote e o que ficou
    de fora desta vez, por motivo."""

    n: int
    arquivo: Path | None = None
    por_lote: Counter = field(default_factory=Counter)
    fora: Counter = field(default_factory=Counter)


@dataclass
class _Candidato:
    tarefa: str
    chave: str  # <partida>/<item>
    aprovado_em: datetime
    dados: dict  # o que montar o item precisa (`_montar_pontos` e `_montar_placas`)


def _quem_trabalhou(ip: IndicePartida, item: str) -> list[str]:
    """Quem anotou, corrigiu ou revisou o item."""
    pessoas = set()
    for a in ip.por_quadro().get(item, []):
        pessoas.add(a.pessoa)
        pessoas.update(r.revisor for r in ip.revisoes_de.get(a.nome, []))
    return sorted(pessoas)


def _assentado(ip: IndicePartida, item: str, dupla: bool, ler) -> bool:
    """Nada mais vai mudar no item: todo rótulo próprio (fora as correções feitas na revisão) já foi
    revisado e, na dupla às cegas, as duas pessoas já anotaram."""
    proprios = [a for a in ip.por_quadro().get(item, []) if ler(a).corrige is None]
    if any(ip.ultima_revisao(a.nome) is None for a in proprios):
        return False
    return not dupla or len({a.pessoa for a in proprios}) >= 2


def _lote(tarefa: str, n: int, chave: str) -> str:
    treino = int(hashlib.sha256(chave.encode()).hexdigest()[:8], 16) % A_CADA_TREINO == 0
    return f"{PREFIXO[tarefa]}{n}-{'treino' if treino else 'controle'}"


def _observacao(chave: str, a, revisor: str, decisao: str) -> str:
    como = "corrigido" if decisao == "corrigir" else "aprovado"
    return f"rótulo real: {chave}, {a.nome}, {como} por {revisor}"


def _candidatos_pontos(pasta: Pasta, indice: Indice, pid: str, fora: Counter) -> list[_Candidato]:
    ip = indice.partida(pid, "pontos")
    ler = lambda a: indice.rotulo(a, "pontos")  # noqa: E731
    out = []
    for item in indice.fila(pid).itens:
        q = item.quadro
        escolhido = aprovado(ip, q, ler)
        if escolhido is None:
            continue
        if not _assentado(ip, q, item.dupla, ler):
            fora["esperando revisão (ou a outra pessoa da dupla)"] += 1
            continue
        aprovado_em, a, r, revisor, decisao = escolhido
        if r.situacao == "descartada":
            fora["descartados"] += 1
            continue
        img = pasta.quadro(pid, q)
        jpg = img.read_bytes() if img.is_file() else b""
        if (tamanho_jpeg(jpg) if jpg else None) != (r.largura, r.altura):
            fora["sem a imagem (ou de outro tamanho)"] += 1
            continue
        chave = f"{pid}/{q}"
        dados = {
            "rotulo": r,
            "observacao": _observacao(chave, a, revisor, decisao),
            "fora_de": _quem_trabalhou(ip, q),
            "jpg": jpg,
        }
        out.append(_Candidato("pontos", chave, aprovado_em, dados))
    return out


def _montar_pontos(gid: str, lote: str, d: dict) -> tuple[GabaritoPontos, bytes, None]:
    r = d["rotulo"]
    borda = BORDA_REF * r.largura / REF_W
    pontos = [
        PontoVerdadeiro(ponto=p.ponto, x=p.x, y=p.y, visivel=min(p.x, p.y, r.largura - p.x, r.altura - p.y) >= borda)
        for p in r.pontos
    ]
    g = GabaritoPontos(
        id=gid,
        lote=lote,
        imagem=f"{gid}.jpg",
        largura=r.largura,
        altura=r.altura,
        pontos=pontos,
        origem="arbitrado",
        observacao=d["observacao"],
        fora_de=d["fora_de"],
    )
    return g, d["jpg"], None


def _numerar(m: np.ndarray) -> tuple[np.ndarray, int]:
    """Cada pedaço pintado (vizinhos em 8 direções) com um número, de 1 a N, da esquerda para a direita."""
    n, rot, _, centros = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    ordem = sorted(range(1, n), key=lambda k: (centros[k][0], centros[k][1]))
    verdade = np.zeros(m.shape, np.uint8)
    for novo, k in enumerate(ordem[:255], start=1):
        verdade[rot == k] = novo
    return verdade, n - 1


def _candidatos_placas(pasta: Pasta, indice: Indice, pid: str, fora: Counter) -> list[_Candidato]:
    rec = indice.recortes(pid)
    ip = indice.partida(pid, "placas")
    ler = lambda a: indice.rotulo(a, "placas")  # noqa: E731
    out = []
    for recorte, (_, it) in rec.itens.items():
        escolhido = aprovado(ip, recorte, ler)
        if escolhido is None:
            continue
        if not _assentado(ip, recorte, it.dupla, ler):
            fora["esperando revisão (ou a outra pessoa da dupla)"] += 1
            continue
        aprovado_em, a, r, revisor, decisao = escolhido
        descartar = r.situacao == "descartada"
        if descartar and r.motivo_descarte != "placa_fora_do_lugar":
            fora["descartados (por outro motivo que não o recorte fora do lugar)"] += 1
            continue
        img = pasta.recorte(pid, recorte)
        jpg = img.read_bytes() if img.is_file() else b""
        if (tamanho_jpeg(jpg) if jpg else None) != (it.largura, it.altura):
            fora["sem a imagem (ou de outro tamanho)"] += 1
            continue
        verdade, n = None, 0
        if not descartar:
            if (r.largura, r.altura) != (it.largura, it.altura):
                fora["máscara que não serve"] += 1
                continue
            m, erro = mascara_da_placa(Path(a.caminho).parent / r.mascara, r, it.regiao)
            if erro:
                fora["máscara que não serve"] += 1
                continue
            verdade, n = _numerar(m)
            if n > 255:
                fora["coisas demais na frente da placa"] += 1
                continue
        chave = f"{pid}/{recorte}"
        dados = {
            "item": it,
            "verdade": verdade,
            "n": n,
            "observacao": _observacao(chave, a, revisor, decisao),
            "fora_de": _quem_trabalhou(ip, recorte),
            "jpg": jpg,
        }
        out.append(_Candidato("placas", chave, aprovado_em, dados))
    return out


def _montar_placas(gid: str, lote: str, d: dict) -> tuple[GabaritoPlacas, bytes, bytes | None]:
    it, descartar = d["item"], d["verdade"] is None
    g = GabaritoPlacas(
        id=gid,
        lote=lote,
        imagem=f"{gid}.jpg",
        mascara=None if descartar else f"{gid}.png",
        largura=it.largura,
        altura=it.altura,
        regiao=it.regiao,
        oclusores=d["n"],
        resposta="descartar" if descartar else "pintar",
        origem="arbitrado",
        observacao=d["observacao"],
        fora_de=d["fora_de"],
    )
    return g, d["jpg"], None if descartar else gravar_png(d["verdade"], PALETA)


def ler_registro(pasta: Pasta) -> dict:
    caminho = pasta.conjuntos / REGISTRO
    if not caminho.exists():
        return {"formato": "ouro.reais/1", "rodadas": [], "itens": {"pontos": {}, "placas": {}}}
    return ler_json(caminho)


def _gravar_zip(destino: Path, partes: list[tuple[str, bytes]]) -> None:
    """O .zip na ordem dada, com data fixa nas entradas (JPEG e PNG sem recomprimir)."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(f".{destino.name}.tmp")
    with zipfile.ZipFile(tmp, "w") as z:
        for nome, dados in partes:
            info = zipfile.ZipInfo(nome, date_time=DATA_ZIP)
            info.compress_type = zipfile.ZIP_DEFLATED if nome.endswith(".json") else zipfile.ZIP_STORED
            info.external_attr = 0o644 << 16
            z.writestr(info, dados)
    escrever_bytes(destino, tmp.read_bytes())
    tmp.unlink()


def gerar_lote_real(pasta: Pasta, destino: Path | None = None, agora: datetime | None = None) -> Rodada:
    """Uma rodada: um .zip com os itens aprovados que ainda não foram para nenhum lote (em
    `conjuntos/ouro-reais-<n>.zip`, ou em `destino`), e o registro atualizado. Sem nada novo, não grava
    nada (`arquivo` fica None)."""
    agora = agora or datetime.now(UTC)
    indice = Indice(pasta)
    registro = ler_registro(pasta)
    n = len(registro["rodadas"]) + 1
    rodada = Rodada(n=n)
    candidatos: list[_Candidato] = []
    for pid in pasta.listar_partidas():
        try:
            indice.manifesto(pid)
            indice.fila(pid)
        except (ValueError, OSError):  # incompleta (ainda sincronizando) ou inválida: fica para a próxima
            rodada.fora["partida incompleta ou inválida"] += 1
            continue
        candidatos += _candidatos_pontos(pasta, indice, pid, rodada.fora)
        candidatos += _candidatos_placas(pasta, indice, pid, rodada.fora)
    novos = [c for c in candidatos if c.chave not in registro["itens"][c.tarefa]]
    if not novos:
        return rodada

    partes, itens_novos = [], {"pontos": {}, "placas": {}}
    for tarefa in ("pontos", "placas"):
        usados = [int(g[1:]) for g in registro["itens"][tarefa].values()]
        proximo = max(usados, default=FAIXA[tarefa][0] - 1) + 1
        for c in sorted((c for c in novos if c.tarefa == tarefa), key=lambda c: (c.aprovado_em, c.chave)):
            if proximo > FAIXA[tarefa][1]:
                rodada.fora[f"sem ids livres nos {tarefa}"] += 1
                continue
            gid = f"g{proximo:04d}"
            proximo += 1
            lote = _lote(tarefa, n, c.chave)
            g, jpg, png = (_montar_pontos if tarefa == "pontos" else _montar_placas)(gid, lote, c.dados)
            partes.append((f"gabarito/itens/{gid}.json", g.model_dump_json(indent=2).encode() + b"\n"))
            partes.append((f"gabarito/itens/{gid}.jpg", jpg))
            if png is not None:
                partes.append((f"gabarito/itens/{gid}.png", png))
            itens_novos[tarefa][c.chave] = gid
            rodada.por_lote[lote] += 1
    if not partes:
        return rodada

    destino = Path(destino) if destino else pasta.conjuntos / f"ouro-reais-{n}.zip"
    _gravar_zip(destino, partes)
    for tarefa, itens in itens_novos.items():
        registro["itens"][tarefa].update(itens)
    registro["rodadas"].append(
        {
            "n": n,
            "criado_em": agora.isoformat(),
            "arquivo": destino.name,
            "lotes": dict(sorted(rodada.por_lote.items())),
        }
    )
    escrever_json(pasta.conjuntos / REGISTRO, registro, sobrescrever=True)
    rodada.arquivo = destino
    return rodada
