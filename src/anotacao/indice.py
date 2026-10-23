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

from .formatos import Fila, Manifesto, RevisaoCamera, RotuloCamera, Tomadas
from .pasta import Pasta, ler_json

M = TypeVar("M", bound=BaseModel)


@dataclass(frozen=True)
class Arquivo:
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
    revisoes_de: dict[str, list[RevisaoCamera]] = field(default_factory=dict)
    invalidos: list[tuple[Path, str]] = field(default_factory=list)

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

    def ultima_revisao(self, nome_rotulo: str) -> RevisaoCamera | None:
        rs = self.revisoes_de.get(nome_rotulo, [])
        return max(rs, key=lambda r: r.criado_em) if rs else None


class Indice:
    def __init__(self, pasta: Pasta, cache: LeitorCache | None = None):
        self.pasta = pasta
        self.cache = cache or LeitorCache()

    def rotulo(self, a: Arquivo | Path) -> RotuloCamera:
        return self.cache.ler(a.caminho if isinstance(a, Arquivo) else a, RotuloCamera)

    def manifesto(self, partida: str) -> Manifesto:
        return self.cache.ler(self.pasta.manifesto(partida), Manifesto)

    def fila(self, partida: str) -> Fila:
        return self.cache.ler(self.pasta.fila(partida), Fila)

    def tomadas(self, partida: str) -> Tomadas:
        return self.cache.ler(self.pasta.tomadas(partida), Tomadas)

    def partida(self, partida: str, tarefa: str = "camera") -> IndicePartida:
        """Rótulos e revisões válidos da partida; os inválidos ficam em `invalidos` e não entram em nada."""
        invalidos: list[tuple[Path, str]] = []
        rot = []
        for p, q, pe, v in self.pasta.listar(self.pasta.rotulos(partida, tarefa)):
            try:
                r = self.cache.ler(p, RotuloCamera)
                if (r.partida, r.quadro, r.anotador, r.versao) != (partida, q, pe, v):
                    raise ValueError("o conteúdo não bate com o nome do arquivo")
            except (ValidationError, ValueError, OSError) as e:
                invalidos.append((p, str(e).splitlines()[0]))
                continue
            rot.append(Arquivo(p, partida, q, pe, v))
        ip = IndicePartida(partida, rot, [], invalidos=invalidos)
        if partida == "gabarito":
            return ip
        for p, q, pe, v in self.pasta.listar(self.pasta.revisoes(partida, tarefa)):
            try:
                r = self.cache.ler(p, RevisaoCamera)
                if (r.partida, r.quadro, r.revisor, r.versao) != (partida, q, pe, v):
                    raise ValueError("o conteúdo não bate com o nome do arquivo")
            except (ValidationError, ValueError, OSError) as e:
                invalidos.append((p, str(e).splitlines()[0]))
                continue
            ip.revisoes.append(Arquivo(p, partida, q, pe, v))
            ip.revisoes_de.setdefault(r.rotulo, []).append(r)
        return ip
