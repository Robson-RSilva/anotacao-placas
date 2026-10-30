"""Pasta de trabalho (sincronizada com o Drive): layout, nomes de arquivo e escrita segura.

Regras que evitam conflito na sincronização:

* um arquivo por pessoa e por versão: ninguém edita o arquivo de outra pessoa, e versão nova é
  arquivo novo (`<quadro>__<pessoa>__v<n>.json`);
* escrita atômica: o conteúdo vai para um temporário na mesma pasta e só então troca de nome, para o
  Drive nunca sincronizar um arquivo pela metade;
* um arquivo que já existe nunca é sobrescrito, a não ser os da coordenação (equipe, divisão,
  projeto), as tomadas e a fila de uma importação, e as previsões.

O mesmo layout existe nas páginas (`web/js/nucleo/pasta.js`).

    trabalho/
      equipe.json (opcional: nomes), divisao.json, projeto.json (opcional: nome e link do Manual)
      partidas/<partida>/
        manifesto.json, tomadas.json, fila.json
        quadros/<quadro>.jpg
        previsoes/pontos/<quadro>.json              pontos de um modelo (opcional)
        previsoes/pessoas/<quadro>.png              pré-pintura de um modelo (opcional)
        rotulos/<tarefa>/<quadro>__<anotador>__v<n>.json    nas pessoas, com o .png da máscara ao lado
        revisoes/<tarefa>/<quadro>__<revisor>__v<n>.json
      gabarito/itens/<g1001>.json|.jpg (|.png nas pessoas), gabarito/rotulos/<tarefa>/...
      pessoas/<codigo>/<dispositivo>.json           em que computadores cada código é usado
      conjuntos/<data-hora>/                        saída do unificar

As tarefas são `pontos` e `pessoas`. As pastas das versões anteriores (`rotulos/camera`,
`rotulos/oclusao` e `estadios/`, até a 0.7; `rotulos/jogadores`, da 0.8) ficam onde estão e não
entram em nada.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from .convencoes import PARTIDA_GABARITO, RE_GABARITO, RE_MASCARA, RE_PARTIDA, RE_PESSOA, RE_QUADRO, TAREFAS
from .formatos import Divisao, Equipe, Fila, Manifesto, Projeto, Tomadas

RE_ARQUIVO = re.compile(r"^(?P<quadro>t\d{10}|g\d{4})__(?P<pessoa>[A-Z][A-Z0-9]{1,9})__v(?P<versao>\d+)\.json$")

M = TypeVar("M", bound=BaseModel)


class ArquivoExiste(FileExistsError):
    """Tentativa de sobrescrever um arquivo que já existe."""


def escrever_json(caminho: Path, obj: BaseModel | dict | list, *, sobrescrever: bool = False) -> Path:
    """Escreve JSON de forma atômica. Sem `sobrescrever`, recusa um arquivo que já existe."""
    caminho = Path(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(obj, BaseModel):
        texto = obj.model_dump_json(indent=2)
    else:
        texto = json.dumps(obj, ensure_ascii=False, indent=2)
    if not sobrescrever and caminho.exists():
        raise ArquivoExiste(str(caminho))
    fd, tmp = tempfile.mkstemp(prefix=f".{caminho.name}.", suffix=".tmp", dir=caminho.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(texto + "\n")
            f.flush()
            os.fsync(f.fileno())
        if not sobrescrever and caminho.exists():
            raise ArquivoExiste(str(caminho))
        os.replace(tmp, caminho)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return caminho


def escrever_bytes(caminho: Path, dados: bytes, *, sobrescrever: bool = False) -> Path:
    """Como `escrever_json`, para bytes (as máscaras PNG das pessoas)."""
    caminho = Path(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    if not sobrescrever and caminho.exists():
        raise ArquivoExiste(str(caminho))
    fd, tmp = tempfile.mkstemp(prefix=f".{caminho.name}.", suffix=".tmp", dir=caminho.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(dados)
            f.flush()
            os.fsync(f.fileno())
        if not sobrescrever and caminho.exists():
            raise ArquivoExiste(str(caminho))
        os.replace(tmp, caminho)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return caminho


def ler_json(caminho: Path, modelo: type[M] | None = None) -> M | dict:
    texto = Path(caminho).read_text(encoding="utf-8")
    return modelo.model_validate_json(texto) if modelo is not None else json.loads(texto)


def nome_arquivo(quadro: str, pessoa: str, versao: int) -> str:
    if not (RE_QUADRO.match(quadro) or RE_GABARITO.match(quadro)):
        raise ValueError(f"quadro inválido: {quadro!r}")
    if not RE_PESSOA.match(pessoa):
        raise ValueError(f"código de pessoa inválido: {pessoa!r}")
    if versao < 1:
        raise ValueError("versão começa em 1")
    return f"{quadro}__{pessoa}__v{versao}.json"


def ler_nome(nome: str) -> tuple[str, str, int] | None:
    m = RE_ARQUIVO.match(nome)
    if not m:
        return None
    return m["quadro"], m["pessoa"], int(m["versao"])


def ler_nome_mascara(nome: str) -> tuple[str, str, int] | None:
    """A máscara das pessoas (`<quadro>__<anotador>__v<n>.png`), ou None."""
    m = RE_MASCARA.match(nome)
    return (m[1], m[2], int(m[3])) if m else None


def mascara_de(nome_rotulo: str) -> str:
    """O nome da máscara que acompanha um rótulo das pessoas."""
    return nome_rotulo.removesuffix(".json") + ".png"


def _checar(regex: re.Pattern, valor: str, oque: str) -> str:
    if not isinstance(valor, str) or not regex.match(valor):
        raise ValueError(f"{oque} inválido: {valor!r}")
    return valor


class Pasta:
    """Acesso à pasta de trabalho. Todos os caminhos passam pela validação dos IDs."""

    def __init__(self, raiz: str | Path):
        self.raiz = Path(raiz).expanduser().resolve()

    # ------------------------------------------------------------------ layout
    @property
    def equipe_path(self) -> Path:
        return self.raiz / "equipe.json"

    @property
    def divisao_path(self) -> Path:
        return self.raiz / "divisao.json"

    @property
    def projeto_path(self) -> Path:
        return self.raiz / "projeto.json"

    @property
    def pessoas(self) -> Path:
        return self.raiz / "pessoas"

    @property
    def partidas(self) -> Path:
        return self.raiz / "partidas"

    @property
    def gabarito(self) -> Path:
        return self.raiz / "gabarito"

    @property
    def conjuntos(self) -> Path:
        return self.raiz / "conjuntos"

    def partida(self, partida: str) -> Path:
        if partida == PARTIDA_GABARITO:
            return self.gabarito
        return self.partidas / _checar(RE_PARTIDA, partida, "partida")

    def manifesto(self, partida: str) -> Path:
        return self.partida(partida) / "manifesto.json"

    def tomadas(self, partida: str) -> Path:
        return self.partida(partida) / "tomadas.json"

    def fila(self, partida: str) -> Path:
        return self.partida(partida) / "fila.json"

    def quadros(self, partida: str) -> Path:
        if partida == PARTIDA_GABARITO:
            return self.gabarito / "itens"
        return self.partida(partida) / "quadros"

    def quadro(self, partida: str, quadro: str) -> Path:
        regex = RE_GABARITO if partida == PARTIDA_GABARITO else RE_QUADRO
        return self.quadros(partida) / f"{_checar(regex, quadro, 'quadro')}.jpg"

    def previsao_pontos(self, partida: str, quadro: str) -> Path:
        """Os pontos de um modelo para o quadro, quando há."""
        return self.partida(partida) / "previsoes" / "pontos" / f"{_checar(RE_QUADRO, quadro, 'quadro')}.json"

    def previsao_pessoas(self, partida: str, quadro: str) -> Path:
        """A pré-pintura de um modelo (PNG: 1 onde há pessoa), quando há."""
        return self.partida(partida) / "previsoes" / "pessoas" / f"{_checar(RE_QUADRO, quadro, 'quadro')}.png"

    def item_gabarito(self, item: str) -> Path:
        return self.gabarito / "itens" / f"{_checar(RE_GABARITO, item, 'item do gabarito')}.json"

    def mascara_gabarito(self, item: str) -> Path:
        """A máscara verdadeira de um item do gabarito das pessoas."""
        return self.gabarito / "itens" / f"{_checar(RE_GABARITO, item, 'item do gabarito')}.png"

    def rotulos(self, partida: str, tarefa: str) -> Path:
        if tarefa not in TAREFAS:
            raise ValueError(f"tarefa desconhecida: {tarefa!r}")
        return self.partida(partida) / "rotulos" / tarefa

    def revisoes(self, partida: str, tarefa: str) -> Path:
        if tarefa not in TAREFAS:
            raise ValueError(f"tarefa desconhecida: {tarefa!r}")
        return self.partida(partida) / "revisoes" / tarefa

    # ------------------------------------------------------------------ criação
    def criar(self) -> None:
        for p in (self.partidas, self.gabarito / "itens", self.conjuntos):
            p.mkdir(parents=True, exist_ok=True)
        if not self.equipe_path.exists():
            escrever_json(self.equipe_path, Equipe(membros=[]))
        if not self.divisao_path.exists():
            escrever_json(self.divisao_path, Divisao())

    # ------------------------------------------------------------------ leitura
    def ler_equipe(self) -> Equipe:
        return ler_json(self.equipe_path, Equipe) if self.equipe_path.exists() else Equipe(membros=[])

    def ler_projeto(self) -> Projeto:
        return ler_json(self.projeto_path, Projeto) if self.projeto_path.exists() else Projeto()

    def ler_divisao(self) -> Divisao:
        return ler_json(self.divisao_path, Divisao) if self.divisao_path.exists() else Divisao()

    def ler_manifesto(self, partida: str) -> Manifesto:
        return ler_json(self.manifesto(partida), Manifesto)

    def ler_tomadas(self, partida: str) -> Tomadas:
        return ler_json(self.tomadas(partida), Tomadas)

    def ler_fila(self, partida: str) -> Fila:
        return ler_json(self.fila(partida), Fila)

    def listar_partidas(self) -> list[str]:
        """Partidas completas (com manifesto), da mais antiga para a mais nova.

        Um manifesto vazio é uma importação interrompida (ou que o Drive ainda está sincronizando):
        a partida não conta, como nas páginas.
        """
        if not self.partidas.exists():
            return []

        def completa(p: Path) -> bool:
            m = p / "manifesto.json"
            return m.is_file() and m.stat().st_size > 0

        return sorted(p.name for p in self.partidas.iterdir() if RE_PARTIDA.match(p.name) and completa(p))

    def listar(self, diretorio: Path) -> list[tuple[Path, str, str, int]]:
        """Arquivos de rótulo ou revisão de uma pasta: (caminho, quadro, pessoa, versão)."""
        if not diretorio.exists():
            return []
        out = []
        for p in sorted(diretorio.iterdir()):
            r = ler_nome(p.name)
            if r is not None:
                out.append((p, *r))
        return out

    def proxima_versao(self, diretorio: Path, quadro: str, pessoa: str) -> int:
        """A versão seguinte à maior da pessoa no quadro (contando as máscaras sem rótulo, de uma gravação
        interrompida: o nome nunca se repete)."""
        vs = [v for _, q, pe, v in self.listar(diretorio) if q == quadro and pe == pessoa]
        if diretorio.exists():
            vs += [r[2] for p in diretorio.iterdir() if (r := ler_nome_mascara(p.name)) and r[:2] == (quadro, pessoa)]
        return max(vs, default=0) + 1
