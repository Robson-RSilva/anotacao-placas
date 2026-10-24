"""Oclusão nas placas: de onde vêm as placas do quadro, onde elas caem na imagem e o que a máscara
pintada diz de cada uma. Espelho de `web/js/nucleo/oclusao.js` — as mesmas contas, na mesma ordem,
para a página e o Python acharem os mesmos pixels (`tests/js/oclusao.test.js` confere com
`tests/fixtures/oclusao.json`, gerado daqui).

As placas vêm do item do gabarito (os polígonos exatos), do pacote do estádio ou, sem
levantamento, das faixas de placas: uma faixa em cada lado do campo, a uma distância da linha, com
uma altura, um comprimento (centrado; sem ele, de canto a canto) e um vão no meio, ajustados uma vez
por partida — as duas laterais com as mesmas medidas, e os dois fundos também (no campo genérico nada
decide qual lado é qual). Cada faixa se divide em trechos de ~8 m, que contam como placas.

A câmera desenha cada placa que está de frente para ela, da mais longe para a mais perto (a mais
perto cobre a outra). A máscara tem uma classe por pixel; fora das placas é 0, e as placas mais
baixas que 10 px (ref. 960) ficam de fora.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .camera import Camera, distortion_valid_radius
from .convencoes import REF_W

FORA, LIVRE, PESSOA, BOLA, REDE, GRAFISMO, OBJETO, NAO_PLACA = range(8)

#: (valor, nome nos arquivos, nome na tela, cor RGB)
CLASSES = (
    (FORA, "fora", "Fora das placas", (0, 0, 0)),
    (LIVRE, "livre", "Placa livre", (52, 152, 219)),
    (PESSOA, "pessoa", "Pessoa", (231, 76, 60)),
    (BOLA, "bola", "Bola", (241, 196, 15)),
    (REDE, "rede", "Rede", (155, 89, 182)),
    (GRAFISMO, "grafismo", "Grafismo", (230, 126, 34)),
    (OBJETO, "objeto", "Objeto", (26, 188, 156)),
    (NAO_PLACA, "nao_placa", "Não é placa", (127, 140, 141)),
)
NOMES_CLASSE = tuple(c[1] for c in CLASSES)
PALETA = tuple(c[3] for c in CLASSES)

ALTURA_MINIMA_REF_PX = 10.0
AREA_MINIMA_REF_PX = 150.0
LIMITE_OCLUSAO = 0.05
MODULO_FAIXA = 8.0
EPS_Z = 0.1
PASSOS_ARESTA = 16
AMOSTRAS_ALTURA = 16


def _meio(x: float) -> int:
    """Arredonda o meio para cima, como `Math.floor(x + 0.5)` nas páginas."""
    return math.floor(x + 0.5)


def _arred(x: float, casas: int) -> float:
    """Como `arredondar` das páginas (`Math.round(x * 10^casas) / 10^casas`)."""
    f = 10.0**casas
    return math.floor(x * f + 0.5) / f


# ----------------------------------------------------------------------------- placas
def faixas_padrao() -> dict:
    return {
        "laterais": {"distancia": 4.0, "altura": 1.0, "comprimento": None, "vao": 0.0, "ligada": True},
        "fundos": {"distancia": 5.0, "altura": 1.0, "comprimento": None, "vao": 0.0, "ligada": True},
    }


def placas_das_faixas(comprimento: float, largura: float, faixas: dict) -> list[dict]:
    """Os trechos das faixas de placas como placas {id, lado, vertices} (BL, BR, TR, TL vistos do campo)."""
    hl, hw = comprimento / 2, largura / 2
    lat, fun = faixas["laterais"], faixas["fundos"]
    xf, yl = hl + fun["distancia"], hw + lat["distancia"]
    out: list[dict] = []

    def trechos(de: float, ate: float) -> list[tuple[float, float]]:
        n = max(1, _meio((ate - de) / MODULO_FAIXA))
        return [(de + (ate - de) * k / n, de + (ate - de) * (k + 1) / n) for k in range(n)]

    def da_faixa(f: dict, cheio: float) -> list[tuple[float, float]]:
        """A faixa centrada no meio do lado, com o vão no meio (sem comprimento: de canto a canto)."""
        C = f.get("comprimento")
        C = cheio if C is None else C
        V = min(f.get("vao") or 0.0, C)
        partes = [(-C / 2, -V / 2), (V / 2, C / 2)] if V > 0 else [(-C / 2, C / 2)]
        return [t for de, ate in partes if ate - de > 1e-9 for t in trechos(de, ate)]

    def placa(lado: str, k: int, BL, BR, altura: float) -> None:
        out.append(
            {
                "id": f"{lado.upper()}_{k + 1:02d}",
                "lado": lado,
                "vertices": [[BL[0], BL[1], 0.0], [BR[0], BR[1], 0.0], [BR[0], BR[1], altura], [BL[0], BL[1], altura]],
            }
        )

    if lat["ligada"]:
        for k, (a, b) in enumerate(da_faixa(lat, 2 * xf)):
            placa("opo", k, (a, yl), (b, yl), lat["altura"])
        for k, (a, b) in enumerate(da_faixa(lat, 2 * xf)):
            placa("cab", k, (b, -yl), (a, -yl), lat["altura"])
    if fun["ligada"]:
        for k, (a, b) in enumerate(da_faixa(fun, 2 * yl)):
            placa("esq", k, (-xf, a), (-xf, b), fun["altura"])
        for k, (a, b) in enumerate(da_faixa(fun, 2 * yl)):
            placa("dir", k, (xf, b), (xf, a), fun["altura"])
    return out


def centro_da_placa(V) -> list[float]:
    return [(V[0][i] + V[1][i] + V[2][i] + V[3][i]) / 4 for i in range(3)]


def de_frente(C, V) -> bool:
    e1 = [V[1][i] - V[0][i] for i in range(3)]
    e2 = [V[3][i] - V[0][i] for i in range(3)]
    n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    c = centro_da_placa(V)
    d = [C[0] - c[0], C[1] - c[1], C[2] - c[2]]
    return n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 0


# ----------------------------------------------------------------------------- projeção
def _na_camera(cam: Camera, X) -> list[float]:
    R = cam.R
    dx, dy, dz = X[0] - cam.C[0], X[1] - cam.C[1], X[2] - cam.C[2]
    return [
        R[0, 0] * dx + R[0, 1] * dy + R[0, 2] * dz,
        R[1, 0] * dx + R[1, 1] * dy + R[1, 2] * dz,
        R[2, 0] * dx + R[2, 1] * dy + R[2, 2] * dz,
    ]


def _da_camera(cam: Camera, P) -> tuple[float, float] | None:
    if not P[2] > 1e-3:
        return None
    nx, ny = P[0] / P[2], P[1] / P[2]
    if cam.k1 != 0.0 or cam.k2 != 0.0:
        r2 = nx * nx + ny * ny
        if not math.sqrt(r2) < distortion_valid_radius(cam.k1, cam.k2):
            return None
        s = 1 + cam.k1 * r2 + cam.k2 * r2 * r2
        nx, ny = nx * s, ny * s
    return cam.f * nx + cam.cx, cam.f * ny + cam.cy


def _projetar(cam: Camera, X) -> tuple[float, float] | None:
    return _da_camera(cam, _na_camera(cam, X))


def _entre(a, b, t: float) -> list[float]:
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]


def _cortar_perto(P: list) -> list:
    out = []
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        da, db = a[2] - EPS_Z, b[2] - EPS_Z
        if da >= 0:
            out.append(a)
        if (da >= 0) != (db >= 0):
            out.append(_entre(a, b, da / (da - db)))
    return out


def contorno_na_imagem(cam: Camera, V) -> list[tuple[float, float]] | None:
    P = _cortar_perto([_na_camera(cam, X) for X in V])
    if len(P) < 3:
        return None
    out = []
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        for k in range(PASSOS_ARESTA):
            q = _da_camera(cam, _entre(a, b, k / PASSOS_ARESTA))
            if q is not None:
                out.append(q)
    return out if len(out) >= 3 else None


def rasterizar(pol, w: int, h: int):
    """Os trechos (y, x0, x1) de pixels cujo centro cai dentro do polígono (regra par-ímpar)."""
    P = np.asarray(pol, float)
    xb, yb = P[:, 0], P[:, 1]
    xa, ya = np.roll(xb, 1), np.roll(yb, 1)  # aresta j -> i, com j o ponto anterior
    y0 = max(0, math.ceil(float(yb.min()) - 0.5))
    y1 = min(h - 1, math.ceil(float(yb.max()) - 0.5) - 1)
    for y in range(y0, y1 + 1):
        Y = y + 0.5
        m = ((ya <= Y) & (yb > Y)) | ((yb <= Y) & (ya > Y))  # aresta que cruza a linha (meio aberto)
        if not m.any():
            continue
        xs = np.sort(xa[m] + ((Y - ya[m]) / (yb[m] - ya[m])) * (xb[m] - xa[m]))
        for k in range(0, len(xs) - 1, 2):
            xi = max(0, math.ceil(xs[k] - 0.5))
            xfim = min(w, math.ceil(xs[k + 1] - 0.5))
            if xfim > xi:
                yield y, xi, xfim


def altura_na_imagem(cam: Camera, V, w: int, h: int) -> float:
    maior = 0.0
    for i in range(AMOSTRAS_ALTURA + 1):
        t = i / AMOSTRAS_ALTURA
        pb, pt = _projetar(cam, _entre(V[0], V[1], t)), _projetar(cam, _entre(V[3], V[2], t))
        if pb is None or pt is None:
            continue
        if max(pb[0], pt[0]) < 0 or min(pb[0], pt[0]) >= w or max(pb[1], pt[1]) < 0 or min(pb[1], pt[1]) >= h:
            continue
        maior = max(maior, math.hypot(pt[0] - pb[0], pt[1] - pb[1]))
    return maior * REF_W / w


@dataclass
class Geometria:
    w: int
    h: int
    placas: list[dict]
    regiao: np.ndarray  # (h, w) uint16: índice + 1 da placa na frente; 0 fora das placas
    roi: np.ndarray  # (h, w) bool: o que se pinta
    info: list[dict]  # as placas que caem na imagem: {k, id, lado, area_px, altura_ref_px, pequena}
    contornos: dict[int, list]


def geometria(cam: Camera, placas: list[dict], w: int, h: int) -> Geometria:
    vistas = []
    for k, placa in enumerate(placas):
        V = placa["vertices"]
        if not de_frente(cam.C, V):
            continue
        pol = contorno_na_imagem(cam, V)
        if pol is None:
            continue
        c = centro_da_placa(V)
        vistas.append((k, pol, math.hypot(cam.C[0] - c[0], cam.C[1] - c[1], cam.C[2] - c[2])))
    vistas.sort(key=lambda v: (-v[2], v[0]))  # a mais longe primeiro: a mais perto cobre
    regiao = np.zeros((h, w), np.uint16)
    area: dict[int, int] = {}
    for k, pol, _ in vistas:
        n = 0
        for y, x0, x1 in rasterizar(pol, w, h):
            regiao[y, x0:x1] = k + 1
            n += x1 - x0
        if n:
            area[k] = n
    info = []
    for k in sorted(area):
        altura = _arred(altura_na_imagem(cam, placas[k]["vertices"], w, h), 1)  # decide com o número que se mostra
        info.append(
            {
                "k": k,
                "id": placas[k]["id"],
                "lado": placas[k].get("lado"),
                "area_px": area[k],
                "altura_ref_px": altura,
                "pequena": altura < ALTURA_MINIMA_REF_PX,
            }
        )
    pequenas = np.zeros(len(placas) + 1, bool)
    for p in info:
        pequenas[p["k"] + 1] = p["pequena"]
    roi = (regiao > 0) & ~pequenas[regiao]
    return Geometria(w, h, placas, regiao, roi, info, {k: pol for k, pol, _ in vistas})


# ----------------------------------------------------------------------------- máscara
def mascara_efetiva(pintura: np.ndarray, roi: np.ndarray) -> np.ndarray:
    """Dentro do que se pinta, a classe pintada (o que não foi pintado é placa livre); fora, 0."""
    valida = (pintura > FORA) & (pintura <= NAO_PLACA)
    return np.where(roi, np.where(valida, pintura, LIVRE), FORA).astype(np.uint8)


def estatisticas(mascara: np.ndarray, geo: Geometria) -> list[dict]:
    """Pixels de cada classe onde a placa está na frente, os cobertos por outra placa e a fração
    livre — (livre + rede) / (área − "não é placa"); placas pequenas demais ficam sem fração."""
    reg = geo.regiao.ravel()
    msk = mascara.ravel().astype(np.int64)
    ok = (reg > 0) & (msk < 8)
    contas = np.zeros((len(geo.placas) + 1, 8), np.int64)
    np.add.at(contas, (reg[ok].astype(np.int64), msk[ok]), 1)
    out = []
    for p in geo.info:
        c = contas[p["k"] + 1]
        util = p["area_px"] - int(c[NAO_PLACA])
        frac = None if p["pequena"] or util <= 0 else _arred((int(c[LIVRE]) + int(c[REDE])) / util, 4)
        out.append(
            {
                "id": p["id"],
                "lado": p["lado"],
                "area_px": p["area_px"],
                "outra_placa_px": p["area_px"] - int(c.sum()),
                "livre_px": int(c[LIVRE]),
                "pessoa_px": int(c[PESSOA]),
                "bola_px": int(c[BOLA]),
                "rede_px": int(c[REDE]),
                "grafismo_px": int(c[GRAFISMO]),
                "objeto_px": int(c[OBJETO]),
                "nao_placa_px": int(c[NAO_PLACA]),
                "livre_frac": frac,
                "altura_ref_px": p["altura_ref_px"],
                "pequena": p["pequena"],
            }
        )
    return out


def comparar(placas_a: list[dict], placas_b: list[dict], w: int) -> dict:
    """Diferença na fração livre, placa a placa (as duas grandes o bastante): {maxima, mediana, n}."""
    por_id = {p["id"]: p for p in placas_b}
    escala = (REF_W / w) ** 2

    def grande(p: dict) -> bool:
        return (
            not p["pequena"]
            and p["livre_frac"] is not None
            and (p["area_px"] - p["nao_placa_px"]) * escala >= AREA_MINIMA_REF_PX
        )

    difs = [
        abs(a["livre_frac"] - por_id[a["id"]]["livre_frac"])
        for a in placas_a
        if a["id"] in por_id and grande(a) and grande(por_id[a["id"]])
    ]
    if not difs:
        return {"maxima": None, "mediana": None, "n": 0}
    return {"maxima": max(difs), "mediana": float(np.median(difs)), "n": len(difs)}


COBREM = (PESSOA, BOLA, GRAFISMO, OBJETO)  # a rede não cobre (por enquanto); "não é placa" não é placa


def _vizinhanca(b: np.ndarray, op, borda: bool) -> np.ndarray:
    """Máximo (dilatar) ou mínimo (erodir) na vizinhança 3 x 3; fora da imagem vale `borda`."""
    h, w = b.shape
    p = np.pad(b, 1, constant_values=borda)
    out = p[1 : h + 1, 1 : w + 1].copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            out = op(out, p[1 + dy : h + 1 + dy, 1 + dx : w + 1 + dx])
    return out


def _alem_da_borda(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Os pixels em que A discorda de B além da borda de 1 px de B: A cobre longe de B, ou A deixa livre
    o miolo de B."""
    return (a & ~_vizinhanca(b, np.maximum, False)) | (_vizinhanca(b, np.minimum, True) & ~a)


def comparar_mascaras(ma: np.ndarray, mb: np.ndarray, geo: Geometria) -> dict:
    """Diferença entre duas máscaras do mesmo quadro, placa a placa, com a tolerância de 1 px na borda
    do Manual: a fração da placa em que uma cobre e a outra não, fora da faixa de 1 px em volta do que
    a outra pintou (nos dois sentidos, vale a maior). {maxima, mediana, n, placas: [{id, dif}]}.

    Pintar 1 px mais largo ou mais estreito em volta de toda a pessoa não conta; esquecer uma pessoa,
    ou pintar uma que não está lá, conta quase toda a área dela."""
    ca, cb = np.isin(ma, COBREM), np.isin(mb, COBREM)
    fora = _alem_da_borda(ca, cb) | _alem_da_borda(cb, ca)
    util = (ma != NAO_PLACA) & (mb != NAO_PLACA)
    escala = (REF_W / geo.w) ** 2
    reg = geo.regiao.astype(np.int64)
    n_util = np.bincount(reg[util], minlength=len(geo.placas) + 1)
    n_fora = np.bincount(reg[util & fora], minlength=len(geo.placas) + 1)
    placas = []
    for p in geo.info:
        k = p["k"] + 1
        if p["pequena"] or n_util[k] * escala < AREA_MINIMA_REF_PX:
            continue
        placas.append({"id": p["id"], "dif": _arred(n_fora[k] / n_util[k], 4)})
    if not placas:
        return {"maxima": None, "mediana": None, "n": 0, "placas": []}
    difs = [x["dif"] for x in placas]
    return {"maxima": max(difs), "mediana": float(np.median(difs)), "n": len(difs), "placas": placas}


def placas_do_rotulo(placas_de: str, faixas: dict | None, campo: tuple[float, float], pacote, item=None) -> list[dict]:
    """As placas de um rótulo: as do item do gabarito, as do pacote ou as das faixas."""
    if placas_de == "gabarito":
        if item is None:
            raise ValueError("as placas do gabarito precisam do item")
        return [p.model_dump() if hasattr(p, "model_dump") else dict(p) for p in item.placas]
    if placas_de == "pacote":
        return [p.model_dump() for p in pacote.placas]
    if placas_de == "faixas":
        if faixas is None:
            raise ValueError("faltam as faixas")
        return placas_das_faixas(campo[0], campo[1], faixas)
    raise ValueError(f"origem de placas desconhecida: {placas_de}")
