"""Sorteio dos quadros para anotar e distribuição na equipe.

Variedade vem da amostragem, não do volume: no máximo 1 ou 2 quadros por tomada (quadros vizinhos
são quase iguais), longe dos cortes e fora das transições, com a cota dividida entre os grupos de
aparência para que tomadas raras (câmera atrás do gol, close) não sumam no meio das da principal.

Cerca de 10% dos quadros vão em dupla às cegas (duas pessoas anotam do zero, para medir a
concordância) e outros ~10% começam sem previsão (para medir o viés de ancoragem). Tudo é
determinístico pela semente da partida: sortear de novo dá o mesmo resultado.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

from .convencoes import id_quadro
from .cortes import TomadaBruta


@dataclass
class ParametrosSorteio:
    alvo: int = 100
    margem_s: float = 0.4
    max_por_tomada: int = 2
    tomada_longa_s: float = 6.0
    frac_dupla: float = 0.10
    frac_sem_previsao: float = 0.10

    def como_dict(self) -> dict:
        return {f"sorteio_{k}": v for k, v in self.__dict__.items()}


@dataclass
class Sorteado:
    quadro: str
    tomada: int
    i: int
    pts_ms: int
    dupla: bool = False
    sem_previsao: bool = False


def semente_de(texto: str) -> int:
    return int.from_bytes(hashlib.sha256(texto.encode("utf-8")).digest()[:8], "little")


def _elegiveis(t: TomadaBruta, pts: np.ndarray, transicao: np.ndarray, margem_ms: float) -> np.ndarray:
    idx = np.arange(t.i0, t.i1)
    ok = ~transicao[t.i0 : t.i1]
    ok &= (pts[t.i0 : t.i1] >= pts[t.i0] + margem_ms) & (pts[t.i0 : t.i1] <= pts[t.i1 - 1] - margem_ms)
    e = idx[ok]
    if len(e) == 0 and t.i1 - t.i0 >= 3:
        meio = (t.i0 + t.i1) // 2
        if not transicao[meio]:
            e = np.array([meio])
    return e


def _repartir(alvo: int, pesos: dict[int, float], capacidade: dict[int, int]) -> dict[int, int]:
    """Divide `alvo` entre grupos na proporção dos pesos, sem passar da capacidade de cada um."""
    cota = {g: 0 for g in pesos}
    restante = min(alvo, sum(capacidade.values()))
    abertos = {g for g in pesos if capacidade[g] > 0}
    while restante > 0 and abertos:
        soma = sum(pesos[g] for g in abertos)
        ideal = {g: restante * pesos[g] / soma for g in abertos}
        dado = 0
        for g in sorted(abertos, key=lambda g: -ideal[g]):
            q = min(capacidade[g] - cota[g], max(1, round(ideal[g])), restante - dado)
            if q <= 0:
                continue
            cota[g] += q
            dado += q
        restante -= dado
        abertos = {g for g in abertos if cota[g] < capacidade[g]}
        if dado == 0:
            break
    return cota


def sortear(
    tomadas: list[TomadaBruta], pts: np.ndarray, transicao: np.ndarray, params: ParametrosSorteio, semente: int
) -> list[Sorteado]:
    rng = np.random.default_rng(semente)
    pts = np.asarray(pts, float)
    eleg = {k: _elegiveis(t, pts, transicao, params.margem_s * 1000) for k, t in enumerate(tomadas)}
    eleg = {k: e for k, e in eleg.items() if len(e)}
    if not eleg:
        return []

    def capacidade_tomada(k: int) -> int:
        t = tomadas[k]
        longa = (pts[t.i1 - 1] - pts[t.i0]) >= params.tomada_longa_s * 1000
        return min(len(eleg[k]), params.max_por_tomada if longa else 1)

    por_grupo: dict[int, list[int]] = {}
    for k in eleg:
        por_grupo.setdefault(tomadas[k].grupo, []).append(k)
    pesos = {g: float(np.sqrt(len(ks))) for g, ks in por_grupo.items()}
    cap = {g: sum(capacidade_tomada(k) for k in ks) for g, ks in por_grupo.items()}
    cota = _repartir(params.alvo, pesos, cap)

    escolhidos: list[tuple[int, int]] = []
    for g, ks in sorted(por_grupo.items()):
        q = cota[g]
        if q <= 0:
            continue
        ordem = [ks[j] for j in rng.permutation(len(ks))]
        primeira = ordem[: min(q, len(ordem))]
        for k in primeira:
            e = eleg[k]
            escolhidos.append((k, int(e[rng.integers(len(e))])))
        faltam = q - len(primeira)
        for k in ordem:
            if faltam <= 0:
                break
            if capacidade_tomada(k) < 2:
                continue
            e = eleg[k]
            ja = next(i for kk, i in escolhidos if kk == k)
            longe = e[np.abs(e - ja) >= max(1, (e[-1] - e[0]) // 3)]
            if len(longe):
                escolhidos.append((k, int(longe[rng.integers(len(longe))])))
                faltam -= 1

    vistos: dict[str, Sorteado] = {}
    for k, i in sorted(escolhidos, key=lambda x: x[1]):
        q = id_quadro(pts[i])
        if q not in vistos:
            vistos[q] = Sorteado(q, k, i, round(float(pts[i])))
    out = list(vistos.values())
    n = len(out)
    for frac, campo in ((params.frac_dupla, "dupla"), (params.frac_sem_previsao, "sem_previsao")):
        m = round(frac * n)
        for j in rng.choice(n, size=min(m, n), replace=False) if m else []:
            setattr(out[int(j)], campo, True)
    return out


def atribuir(sorteados: list[Sorteado], anotadores: list[str], semente: int) -> list[list[str]]:
    """Quem anota cada quadro: rodízio embaralhado; quadro em dupla vai para duas pessoas diferentes."""
    if not anotadores:
        return [[] for _ in sorteados]
    rng = np.random.default_rng(semente ^ 0x5EED)
    ordem = [anotadores[j] for j in rng.permutation(len(anotadores))]
    out = []
    for k, s in enumerate(sorteados):
        a = ordem[k % len(ordem)]
        if s.dupla and len(ordem) > 1:
            b = ordem[(k + 1) % len(ordem)]
            out.append([a, b])
        else:
            out.append([a])
    return out
