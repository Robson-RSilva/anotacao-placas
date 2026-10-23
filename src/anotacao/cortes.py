"""Cortes, transições, replays e agrupamento das tomadas — só para organizar o sorteio.

Nada aqui é rótulo: é a mesma detecção por regras do laboratório (sem rede), usada para escolher
1 ou 2 quadros por tomada e equilibrar o sorteio por aparência e zoom.

* Cortes: duas pistas com limiar adaptativo (quanto o quadro foge da vizinhança): qui-quadrado
  entre histogramas HSV de quadros vizinhos (cor) e 1 - NCC de quadros reduzidos (estrutura).
* Transições graduais: comparação dupla (diferenças moderadas que se acumulam).
* Replays: correlação com a vinheta da emissora, quando ela está cadastrada.
* Grupo e zoom: k-médias sobre um descritor simples por tomada (histograma, fração de gramado e
  densidade de bordas). É aproximado; depois da anotação, o tipo de câmera sai da própria câmera.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

import cv2
import numpy as np


# ----------------------------------------------------------------------------- descritores por quadro
def hist_hsv(img: np.ndarray, bins: tuple[int, int, int] = (16, 8, 8)) -> np.ndarray:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1, 2], None, list(bins), [0, 180, 0, 256, 0, 256]).ravel()
    return h / max(h.sum(), 1)


def qui2(a: np.ndarray, b: np.ndarray) -> float:
    return float(0.5 * np.sum((a - b) ** 2 / (a + b + 1e-12)))


def estrutura(img: np.ndarray, tamanho: tuple[int, int] = (64, 36), blur: float = 1.0) -> np.ndarray:
    g = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), tamanho, interpolation=cv2.INTER_AREA).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), blur)
    g -= g.mean()
    return g / (np.linalg.norm(g) + 1e-6)


def fracao_gramado(img: np.ndarray) -> float:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    m = (hsv[..., 0] > 30) & (hsv[..., 0] < 90) & (hsv[..., 1] > 50) & (hsv[..., 2] > 35)
    return float(m.mean())


def densidade_bordas(img: np.ndarray) -> float:
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return float((cv2.Canny(g, 80, 160) > 0).mean())


@dataclass
class Descritor:
    hist: np.ndarray  # HSV 16x8x8, para os cortes
    hist_curto: np.ndarray  # HSV 8x4x4, para o agrupamento
    estrutura: np.ndarray
    gramado: float
    bordas: float


def descrever(img: np.ndarray) -> Descritor:
    """Tudo o que o sorteio precisa de um quadro reduzido, com uma conversão de cor só."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h16 = cv2.calcHist([hsv], [0, 1, 2], None, [16, 8, 8], [0, 180, 0, 256, 0, 256]).ravel()
    h8 = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256]).ravel()
    cinza = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.resize(cinza, (64, 36), interpolation=cv2.INTER_AREA).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), 1.0)
    g -= g.mean()
    m = (hsv[..., 0] > 30) & (hsv[..., 0] < 90) & (hsv[..., 1] > 50) & (hsv[..., 2] > 35)
    return Descritor(
        h16 / max(h16.sum(), 1),
        (h8 / max(h8.sum(), 1)).astype(np.float32),
        g / (np.linalg.norm(g) + 1e-6),
        float(m.mean()),
        float((cv2.Canny(cinza, 80, 160) > 0).mean()),
    )


def pontuar_vinheta(img: np.ndarray, gabaritos: list[np.ndarray], roi: float = 0.8) -> float:
    h, w = img.shape[:2]
    y0, y1 = int(h * (0.5 - roi / 2)), int(h * (0.5 + roi / 2))
    x0, x1 = int(w * (0.5 - roi / 2)), int(w * (0.5 + roi / 2))
    r = img[y0:y1, x0:x1]
    melhor = 0.0
    for t in gabaritos:
        if r.shape[0] > t.shape[0] and r.shape[1] > t.shape[1]:
            melhor = max(melhor, float(cv2.matchTemplate(r, t, cv2.TM_CCOEFF_NORMED).max()))
    return melhor


def gabaritos_vinheta(vinheta: np.ndarray, escala_quadro: float, escalas=(0.8, 0.95, 1.1, 1.3)) -> list[np.ndarray]:
    """A vinheta (recortada na resolução original) nas escalas do quadro reduzido."""
    out = []
    for s in escalas:
        t = cv2.resize(vinheta, None, fx=s * escala_quadro, fy=s * escala_quadro, interpolation=cv2.INTER_AREA)
        if t.shape[0] >= 4 and t.shape[1] >= 4:
            out.append(t)
    return out


# ----------------------------------------------------------------------------- séries -> eventos
def razao_adaptativa(d: np.ndarray, janela: int = 15) -> np.ndarray:
    """(d_i - mediana local) / (MAD local + piso): quantos "desvios" o quadro foge da vizinhança.

    A vizinhança de i são os `janela` quadros de cada lado, sem o próprio i e sem o quadro 0 (que não
    tem anterior). Vetorizado: um jogo inteiro tem ~160 mil quadros.
    """
    d = np.asarray(d, float)
    n = len(d)
    r = np.zeros(n)
    if n < 2:
        return r
    dd = d.copy()
    dd[0] = np.nan
    pad = np.r_[np.full(janela, np.nan), dd, np.full(janela, np.nan)]
    jan = np.lib.stride_tricks.sliding_window_view(pad, 2 * janela + 1)
    jan = np.delete(jan, janela, axis=1)
    validos = np.isfinite(jan).any(1)
    med = np.zeros(n)
    mad = np.zeros(n)
    if validos.any():
        med[validos] = np.nanmedian(jan[validos], axis=1)
        mad[validos] = 1.4826 * np.nanmedian(np.abs(jan[validos] - med[validos, None]), axis=1)
    r[validos] = (d[validos] - med[validos]) / (mad[validos] + 1e-3 + 0.1 * med[validos])
    r[0] = 0.0
    return r


def detectar_cortes(
    d_hist: np.ndarray,
    d_estr: np.ndarray,
    janela: int = 15,
    r_hist: float = 12.0,
    r_estr: float = 30.0,
    min_hist: float = 0.03,
    min_estr: float = 0.05,
    intervalo_min: int = 3,
) -> list[int]:
    """Índices i com corte entre i-1 e i (os mesmos limiares do laboratório)."""
    r1, r2 = razao_adaptativa(d_hist, janela), razao_adaptativa(d_estr, janela)
    cortes: list[int] = []
    for i in range(1, len(d_hist)):
        hit = (r1[i] > r_hist and d_hist[i] > min_hist) or (r2[i] > r_estr and d_estr[i] > min_estr)
        if hit and (not cortes or i - cortes[-1] >= intervalo_min):
            cortes.append(i)
    return cortes


def detectar_graduais(
    d_hist: np.ndarray, cortes=(), t_baixo: float = 0.04, t_alto: float = 0.35, max_len: int = 25
) -> list[tuple[int, int]]:
    """Fusões: sequências de diferenças moderadas cuja soma passa `t_alto` -> [i0, i1)."""
    out, i, n = [], 1, len(d_hist)
    cortes = set(cortes)
    while i < n:
        if d_hist[i] > t_baixo and i not in cortes:
            j, acc = i, 0.0
            while j < n and d_hist[j] > t_baixo and j - i < max_len and j not in cortes:
                acc += d_hist[j]
                j += 1
            if acc > t_alto and j - i >= 3:
                out.append((i, j))
            i = j + 1
        else:
            i += 1
    return out


def replays_por_vinheta(scores: np.ndarray, limiar: float = 0.6, max_len: int = 4000):
    """Vinhetas -> (máscara de replay, máscara de transição, grupos de quadros com vinheta).

    Cada grupo com vinheta alterna ao vivo <-> replay; um grupo com o dobro da duração típica é saída e
    entrada coladas. Replay mais longo que `max_len` quadros é implausível e volta a ser ao vivo.
    """
    n = len(scores)
    on = np.where(scores > limiar)[0]
    grupos: list[list[int]] = []
    for i in on:
        if grupos and i - grupos[-1][-1] <= 2:
            grupos[-1].append(int(i))
        else:
            grupos.append([int(i)])
    replay = np.zeros(n, bool)
    trans = np.zeros(n, bool)
    for g in grupos:
        trans[g[0] : g[-1] + 1] = True
    if not grupos:
        return replay, trans, grupos
    simples = int(np.median([g[-1] - g[0] + 1 for g in grupos]))
    estado, inicio = False, 0
    for g in grupos:
        comp = g[-1] - g[0] + 1
        trocas = 2 if comp >= 1.6 * simples and simples >= 2 else 1
        for _ in range(trocas):
            if not estado:
                estado, inicio = True, g[0]
            else:
                if g[-1] - inicio <= max_len:
                    replay[inicio : g[-1] + 1] = True
                estado = False
    return replay, trans, grupos


# ----------------------------------------------------------------------------- tomadas
@dataclass
class TomadaBruta:
    i0: int
    i1: int
    replay: bool | None
    zoom: str = "medio"
    grupo: int = 0


def montar_tomadas(
    n: int, cortes: list[int], grupos_vinheta: list[list[int]], replay: np.ndarray | None
) -> list[TomadaBruta]:
    fronteiras = set(cortes)
    for g in grupos_vinheta:
        fronteiras.add(g[0])
        if g[-1] + 1 < n:
            fronteiras.add(g[-1] + 1)
    bordas = [0, *sorted(b for b in fronteiras if 0 < b < n), n]
    out = []
    for a, b in pairwise(bordas):
        if b <= a:
            continue
        rep = None if replay is None else bool(replay[a:b].mean() > 0.5)
        out.append(TomadaBruta(a, b, rep))
    return out


def _kmedias(X: np.ndarray, k: int, semente: int, iters: int = 30) -> np.ndarray:
    """k-médias com inicialização k-means++ (determinística pela semente)."""
    rng = np.random.default_rng(semente)
    n = len(X)
    k = max(1, min(k, n))
    centros = [X[rng.integers(n)]]
    for _ in range(1, k):
        d2 = np.min(((X[:, None] - np.array(centros)[None]) ** 2).sum(-1), axis=1)
        p = d2 / d2.sum() if d2.sum() > 0 else np.full(n, 1 / n)
        centros.append(X[rng.choice(n, p=p)])
    C = np.array(centros)
    rot = np.full(n, -1)
    for _it in range(iters):
        novo = ((X[:, None] - C[None]) ** 2).sum(-1).argmin(1)
        if np.array_equal(novo, rot):
            break
        rot = novo
        for j in range(k):
            if np.any(rot == j):
                C[j] = X[rot == j].mean(0)
    # rótulos em ordem de primeira aparição (estáveis entre execuções)
    ordem = {int(v): i for i, v in enumerate(dict.fromkeys(rot.tolist()))}
    return np.array([ordem[int(v)] for v in rot])


def agrupar(
    tomadas: list[TomadaBruta],
    descritores: dict[int, np.ndarray],
    gramado: np.ndarray,
    bordas: np.ndarray,
    semente: int,
    k: int = 6,
) -> None:
    """Preenche `grupo` e `zoom` de cada tomada (in place)."""
    if not tomadas:
        return
    feats, gr, bd = [], [], []
    for t in tomadas:
        idx = [i for i in descritores if t.i0 <= i < t.i1] or [min(descritores, key=lambda i: abs(i - t.i0))]
        feats.append(np.mean([descritores[i] for i in idx], axis=0))
        gr.append(float(np.mean(gramado[t.i0 : t.i1])))
        bd.append(float(np.mean(bordas[t.i0 : t.i1])))
    H = np.array(feats)
    H = H / (np.linalg.norm(H, axis=1, keepdims=True) + 1e-9)
    G, B = np.array(gr), np.array(bd)
    z = lambda v: (v - v.mean()) / (v.std() + 1e-9)  # noqa: E731
    X = np.c_[H * 2.0, z(G)[:, None], z(B)[:, None]]
    rot = _kmedias(X, k, semente)
    mb = float(np.median(B)) if len(B) else 0.0
    for t, g, gm, b in zip(tomadas, rot, G, B, strict=True):
        t.grupo = int(g)
        if gm < 0.25 or b < 0.5 * mb:
            t.zoom = "fechado"
        elif gm >= 0.5 and b >= mb:
            t.zoom = "aberto"
        else:
            t.zoom = "medio"
