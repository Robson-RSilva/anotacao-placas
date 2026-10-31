"""Índice dos rótulos e revisões da pasta, com cache pela data de modificação dos arquivos.

Não há banco de dados: a verdade são os arquivos na pasta sincronizada. O mesmo índice existe nas
páginas (`web/js/nucleo/indice.js`); aqui ele serve ao `validar` e ao `unificar`.
"""

from __future__ import annotations

import threading
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from .formatos import (
    TAREFA,
    Fila,
    ItemRecorte,
    LoteRecortes,
    Manifesto,
    RevisaoPlacas,
    RevisaoPontos,
    RotuloPlacas,
    RotuloPontos,
    Tomadas,
)
from .pasta import Pasta, ler_json, mascara_de

Rotulo = RotuloPontos | RotuloPlacas
Revisao = RevisaoPontos | RevisaoPlacas

#: O campo do item em cada tarefa: o quadro nos pontos, o recorte nas placas.
CAMPO_DO_ITEM = {"pontos": "quadro", "placas": "recorte"}

M = TypeVar("M", bound=BaseModel)


@dataclass(frozen=True)
class Arquivo:
    """Um rótulo ou uma revisão. `quadro` é o item: o quadro nos pontos, o recorte nas placas."""

    caminho: Path
    partida: str
    quadro: str
    pessoa: str
    versao: int

    @property
    def nome(self) -> str:
        return self.caminho.name


class LeitorCache:
    """Lê e valida JSON uma vez; relê só quando o arquivo muda."""

    def __init__(self) -> None:
        self._dados: dict[str, tuple[tuple[int, int], BaseModel]] = {}
        self._trava = threading.Lock()

    def ler(self, caminho: Path, modelo: type[M]) -> M:
        st = caminho.stat()
        assinatura = (st.st_mtime_ns, st.st_size)
        chave = f"{modelo.__name__}:{caminho}"
        with self._trava:
            hit = self._dados.get(chave)
        if hit is not None and hit[0] == assinatura:
            return hit[1]  # type: ignore[return-value]
        obj = ler_json(caminho, modelo)
        with self._trava:
            self._dados[chave] = (assinatura, obj)
        return obj


@dataclass
class IndicePartida:
    partida: str
    rotulos: list[Arquivo]
    revisoes: list[Arquivo]
    revisoes_de: dict[str, list[Revisao]] = field(default_factory=dict)
    invalidos: list[tuple[Path, str]] = field(default_factory=list)
    esperando: list[Path] = field(default_factory=list)  # placas: o rótulo chegou antes da máscara

    def versoes(self, quadro: str, pessoa: str) -> list[Arquivo]:
        return sorted((a for a in self.rotulos if a.quadro == quadro and a.pessoa == pessoa), key=lambda a: a.versao)

    def ultimos(self) -> dict[tuple[str, str], Arquivo]:
        """Última versão de cada (quadro, pessoa)."""
        out: dict[tuple[str, str], Arquivo] = {}
        for a in self.rotulos:
            k = (a.quadro, a.pessoa)
            if k not in out or a.versao > out[k].versao:
                out[k] = a
        return out

    def por_quadro(self) -> dict[str, list[Arquivo]]:
        out: dict[str, list[Arquivo]] = defaultdict(list)
        for a in self.rotulos:
            out[a.quadro].append(a)
        return out

    def ultima_revisao(self, nome_rotulo: str) -> Revisao | None:
        rs = self.revisoes_de.get(nome_rotulo, [])
        return max(rs, key=lambda r: r.criado_em) if rs else None


@dataclass
class Recortes:
    """Os recortes de uma partida, de todos os lotes: recorte -> (lote, item), na ordem dos lotes e,
    em cada lote, na ordem dele. Um recorte que já veio num lote anterior fica de fora (`repetidos`)."""

    itens: dict[str, tuple[str, ItemRecorte]] = field(default_factory=dict)
    lotes: dict[str, LoteRecortes] = field(default_factory=dict)
    invalidos: list[tuple[Path, str]] = field(default_factory=list)
    repetidos: list[tuple[str, str]] = field(default_factory=list)  # (lote, recorte)


class Indice:
    def __init__(self, pasta: Pasta, cache: LeitorCache | None = None):
        self.pasta = pasta
        self.cache = cache or LeitorCache()

    def rotulo(self, a: Arquivo | Path, tarefa: str) -> Rotulo:
        return self.cache.ler(a.caminho if isinstance(a, Arquivo) else a, TAREFA[tarefa][0])

    def manifesto(self, partida: str) -> Manifesto:
        return self.cache.ler(self.pasta.manifesto(partida), Manifesto)

    def fila(self, partida: str) -> Fila:
        return self.cache.ler(self.pasta.fila(partida), Fila)

    def tomadas(self, partida: str) -> Tomadas:
        return self.cache.ler(self.pasta.tomadas(partida), Tomadas)

    def recortes(self, partida: str) -> Recortes:
        """Os lotes de recortes válidos da partida (os inválidos vão para `invalidos`)."""
        out = Recortes()
        for lote in self.pasta.listar_lotes(partida):
            caminho = self.pasta.lote_recortes(partida, lote)
            try:
                lr = self.cache.ler(caminho, LoteRecortes)
                if (lr.partida, lr.lote) != (partida, lote):
                    raise ValueError("o conteúdo não bate com o nome do arquivo (partida e lote)")
            except (ValidationError, ValueError, OSError) as e:
                out.invalidos.append((caminho, str(e).splitlines()[0]))
                continue
            out.lotes[lote] = lr
            for it in lr.itens:
                if it.recorte in out.itens:
                    out.repetidos.append((lote, it.recorte))
                else:
                    out.itens[it.recorte] = (lote, it)
        return out

    def partida(self, partida: str, tarefa: str) -> IndicePartida:
        """Rótulos e revisões válidos da partida na tarefa; os inválidos ficam em `invalidos` e não entram
        em nada. Nas placas, um rótulo cuja máscara ainda não chegou fica em `esperando`."""
        modelo_rotulo, modelo_revisao, _ = TAREFA[tarefa]
        campo = CAMPO_DO_ITEM[tarefa]
        invalidos: list[tuple[Path, str]] = []
        esperando: list[Path] = []
        rot = []
        for p, q, pe, v in self.pasta.listar(self.pasta.rotulos(partida, tarefa)):
            try:
                r = self.cache.ler(p, modelo_rotulo)
                if (r.partida, getattr(r, campo), r.anotador, r.versao) != (partida, q, pe, v):
                    raise ValueError("o conteúdo não bate com o nome do arquivo")
                if tarefa == "placas" and r.mascara is not None:
                    if r.mascara != mascara_de(p.name):
                        raise ValueError("a máscara precisa ter o nome do rótulo")
                    if not (p.parent / r.mascara).is_file():
                        esperando.append(p)
                        continue
            except (ValidationError, ValueError, OSError) as e:
                invalidos.append((p, str(e).splitlines()[0]))
                continue
            rot.append(Arquivo(p, partida, q, pe, v))
        ip = IndicePartida(partida, rot, [], invalidos=invalidos, esperando=esperando)
        if partida == "gabarito":
            return ip
        for p, q, pe, v in self.pasta.listar(self.pasta.revisoes(partida, tarefa)):
            try:
                r = self.cache.ler(p, modelo_revisao)
                if (r.partida, getattr(r, campo), r.revisor, r.versao) != (partida, q, pe, v):
                    raise ValueError("o conteúdo não bate com o nome do arquivo")
            except (ValidationError, ValueError, OSError) as e:
                invalidos.append((p, str(e).splitlines()[0]))
                continue
            ip.revisoes.append(Arquivo(p, partida, q, pe, v))
            ip.revisoes_de.setdefault(r.rotulo, []).append(r)
        return ip
