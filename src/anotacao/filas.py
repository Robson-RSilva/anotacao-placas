"""Filas: o que cada pessoa faz a seguir. Tudo sai dos arquivos e dá o mesmo em qualquer máquina.

Câmera
    1. quem ainda não foi liberado anota o gabarito, com o resultado na hora (treino);
    2. depois, os quadros atribuídos a ela, na ordem das partidas; um rótulo devolvido volta
       primeiro, como versão nova;
    3. a cada 15 rótulos, um item do gabarito entra escondido na fila.

Revisão cruzada
    Cada rótulo novo tem um revisor sorteado pelo nome do arquivo, entre os revisores que não são o
    autor. O revisor não vê quem anotou. Correções feitas na revisão não voltam para a fila.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

from .camera import Camera
from .formatos import CameraRotulo, GabaritoCamera, ItemFila, PartiuDe, Previsao, RotuloCamera
from .gabarito import liberacao, listar_itens, resultados
from .indice import Arquivo, Indice, IndicePartida
from .pacote import camera_padrao
from .pasta import Pasta, ler_json

INTERVALO_GABARITO = 15


@dataclass
class ItemCamera:
    partida: str
    quadro: str
    versao: int
    largura: int
    altura: int
    pacote: str
    camera_inicial: CameraRotulo
    partiu_de: PartiuDe
    dupla: bool = False
    sem_previsao: bool = False
    devolvido: dict | None = None
    treino: bool = False

    def para_json(self) -> dict:
        d = dict(self.__dict__)
        d["camera_inicial"] = self.camera_inicial.model_dump()
        d["partiu_de"] = self.partiu_de.model_dump()
        return d


def _cam_rotulo(cam: Camera) -> CameraRotulo:
    return CameraRotulo(**cam.para_rotulo())


def _do_registro(pasta: Pasta, pacote_ref: str, w: int, h: int) -> tuple[CameraRotulo, PartiuDe]:
    pac = pasta.ler_pacote_ref(pacote_ref)
    return _cam_rotulo(camera_padrao(pac, w, h)), PartiuDe(fonte="registro", referencia=pac.ref)


def camera_inicial(
    pasta: Pasta,
    indice: Indice,
    ip: IndicePartida,
    item: ItemFila,
    pessoa: str,
    w: int,
    h: int,
    pacote_ref: str,
    anterior: Arquivo | None,
) -> tuple[CameraRotulo, PartiuDe]:
    """De onde o molde abre: a versão devolvida, a previsão, um quadro anotado da mesma tomada ou o registro."""
    if anterior is not None:
        r = indice.rotulo(anterior)
        if r.camera is not None:
            return r.camera, PartiuDe(fonte="rotulo_anterior", referencia=anterior.nome)
    if item.sem_previsao:
        return _do_registro(pasta, pacote_ref, w, h)
    prev_path = pasta.previsao(ip.partida, item.quadro)
    if prev_path.exists():
        prev = ler_json(prev_path, Previsao)
        if prev.camera is not None:
            return prev.camera, PartiuDe(fonte="modelo", versao=f"{prev.fonte}@{prev.versao}")
    # quadro já anotado da mesma tomada (o mais próximo no tempo; nunca o mesmo quadro)
    fila = indice.fila(ip.partida)
    tomada_de = {it.quadro: (it.tomada, it.pts_ms) for it in fila.itens}
    candidatos = []
    for a in ip.ultimos().values():
        if a.quadro == item.quadro or tomada_de.get(a.quadro, (None,))[0] != item.tomada:
            continue
        r = indice.rotulo(a)
        if r.camera is not None:
            candidatos.append((abs(tomada_de[a.quadro][1] - item.pts_ms), a, r))
    if candidatos:
        _, a, r = min(candidatos, key=lambda c: c[0])
        return r.camera, PartiuDe(fonte="quadro_anotado", referencia=a.nome)
    return _do_registro(pasta, pacote_ref, w, h)


def situacao_anotador(pasta: Pasta, indice: Indice, pessoa: str) -> dict:
    itens = listar_itens(pasta)
    res = resultados(pasta, indice, pessoa)
    lib = liberacao(res, bool(itens))
    lib["gabarito_total"] = len(itens)
    return lib


def _item_gabarito(pasta: Pasta, indice: Indice, pessoa: str, g: GabaritoCamera, treino: bool) -> ItemCamera:
    versao = pasta.proxima_versao(pasta.rotulos("gabarito", "camera"), g.id, pessoa)
    cam, de = _do_registro(pasta, g.pacote, g.largura, g.altura)
    return ItemCamera("gabarito", g.id, versao, g.largura, g.altura, g.pacote, cam, de, treino=treino)


def proximo_camera(pasta: Pasta, indice: Indice, pessoa: str) -> ItemCamera | None:
    itens_gab = listar_itens(pasta)
    feitos_gab = {a.quadro for a in indice.partida("gabarito").rotulos if a.pessoa == pessoa}
    pendentes_gab = [g for g in itens_gab if g.id not in feitos_gab]
    rng = np.random.default_rng(int(hashlib.sha256(pessoa.encode()).hexdigest()[:8], 16))
    pendentes_gab = [pendentes_gab[j] for j in rng.permutation(len(pendentes_gab))]

    lib = liberacao(resultados(pasta, indice, pessoa), bool(itens_gab))
    if not lib["liberado"]:
        return _item_gabarito(pasta, indice, pessoa, pendentes_gab[0], treino=True) if pendentes_gab else None

    n_reais = 0
    candidato: ItemCamera | None = None
    for pid in pasta.listar_partidas():
        ip = indice.partida(pid)
        n_reais += sum(1 for a in ip.rotulos if a.pessoa == pessoa and a.versao == 1)
        if candidato is not None:
            continue
        man = indice.manifesto(pid)
        for item in indice.fila(pid).itens:
            if pessoa not in item.atribuido_a:
                continue
            versoes = ip.versoes(item.quadro, pessoa)
            devolvido, anterior = None, None
            if versoes:
                ultima = versoes[-1]
                rev = ip.ultima_revisao(ultima.nome)
                if rev is None or rev.decisao != "devolver":
                    continue
                devolvido = {"motivo": rev.motivo, "comentario": rev.comentario}
                anterior = ultima
            w, h = man.video.largura, man.video.altura
            cam, de = camera_inicial(pasta, indice, ip, item, pessoa, w, h, man.pacote, anterior)
            candidato = ItemCamera(
                pid,
                item.quadro,
                (versoes[-1].versao + 1) if versoes else 1,
                w,
                h,
                man.pacote,
                cam,
                de,
                item.dupla,
                item.sem_previsao,
                devolvido,
            )
            break
    feitos_escondidos = len(feitos_gab) - min(len(feitos_gab), 10)
    if candidato is not None and pendentes_gab and n_reais >= INTERVALO_GABARITO * (feitos_escondidos + 1):
        return _item_gabarito(pasta, indice, pessoa, pendentes_gab[0], treino=False)
    return candidato


def _revisor_designado(nome_rotulo: str, autor: str, revisores: list[str], todos: list[str]) -> str | None:
    candidatos = [r for r in revisores if r != autor] or [r for r in todos if r != autor]
    if not candidatos:
        return None
    k = int(hashlib.sha1(nome_rotulo.encode()).hexdigest(), 16) % len(candidatos)
    return candidatos[k]


def ref_cega(nome_rotulo: str) -> str:
    """Referência do rótulo sem o nome do autor (o nome do arquivo tem o código de quem anotou)."""
    return hashlib.sha256(nome_rotulo.encode()).hexdigest()[:16]


def pendentes_revisao(pasta: Pasta, indice: Indice, pessoa: str) -> list[tuple[Arquivo, RotuloCamera]]:
    equipe = pasta.ler_equipe()
    revisores = equipe.com_papel("revisor")
    todos = sorted(m.codigo for m in equipe.membros)
    out = []
    for pid in pasta.listar_partidas():
        ip = indice.partida(pid)
        for a in ip.ultimos().values():
            if a.pessoa == pessoa or ip.revisoes_de.get(a.nome):
                continue
            r = indice.rotulo(a)
            if r.corrige is not None:
                continue
            if _revisor_designado(a.nome, a.pessoa, revisores, todos) == pessoa:
                out.append((a, r))
    return out


def achar_por_ref(pasta: Pasta, indice: Indice, pessoa: str, ref: str) -> tuple[Arquivo, RotuloCamera] | None:
    for a, r in pendentes_revisao(pasta, indice, pessoa):
        if ref_cega(a.nome) == ref:
            return a, r
    return None
