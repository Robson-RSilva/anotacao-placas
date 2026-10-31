"""Lotes de ouro do gabarito: imagens sintéticas com a resposta exata, prontas para importar.

Gera com o simulador do laboratório os lotes que treinam e liberam quem começa e que medem quem
anota (os itens escondidos na fila), nas duas tarefas:

* Pontos (`gabarito.pontos/1`): onde cada um dos 39 pontos que se marcam caiu na imagem, do jeito que
  o simulador o desenhou. O renderizador desenha tudo meio pixel da tela (super-amostrada) para a
  direita e para baixo da projeção da câmera, então a resposta leva esse deslocamento: o ponto
  verdadeiro é o centro do cruzamento que aparece na imagem. Um ponto dentro da imagem vai com
  `visivel: false` (marcar é opcional) quando algo está na frente dele (gente, placa, grafismo da
  emissora e, nos pontos do gramado, a trave), quando fica rente à borda ou quando as linhas se
  cruzam quase paralelas na imagem (o cruzamento não tem um lugar preciso).
* Placas (`gabarito.placas/1` + a máscara verdadeira `gNNNN.png`): o recorte de uma placa do quadro,
  endireitado — o retângulo da placa com um pouco em volta (`MARGEM`), como a projeção das placas vai
  mandar —, e o que está na frente dela, pixel a pixel: gente (jogador, goleiro, árbitro, gandula e
  fotógrafo), trave, bola, outra placa mais perto e o grafismo da emissora. A verdade sai de quem o
  próprio renderizador deixou por cima em cada pixel da tela super-amostrada (`SUB` x `SUB` amostras
  por pixel do recorte, vale a maioria), só dentro da placa; a rede, que deixa ver a placa, não cobre.
  Cada coisa na frente tem um número, de 1 a N, da esquerda para a direita. Uns itens têm a placa
  sem nada na frente (a resposta é salvar sem pintar), e outros o recorte fora do lugar — o retângulo
  deslocado para cima ou para baixo da placa: a resposta é descartar (`resposta: "descartar"`, sem
  máscara).

Cada lote é um .zip com `gabarito/itens/gNNNN.json` + `gNNNN.jpg` (+ `gNNNN.png` nas placas para
pintar), que entra pela página do gabarito ("Importar lote de ouro (.zip)"). Os lotes com "treino" no
nome são os do teste de quem começa (com o resultado na hora); os outros, os itens escondidos na fila.

    python scripts/lotes_de_ouro.py --laboratorio ../placas-exposicao --saida lotes

As faixas de id dos lotes não se sobrepõem (pontos em g1xxx, placas em g4xxx; os g2xxx e g3xxx eram
os jogadores e as pessoas das 0.8 e 0.9): dá para importar um, alguns ou todos na mesma pasta. As
sementes são fixas, então o mesmo comando gera sempre os mesmos lotes. Além dos .zip,
`indice-pontos.csv` e `indice-placas.csv` descrevem cada item para quem coordena (câmera, campo de
visão, pontos à vista; a placa, o que está na frente dela e quanto ela fica coberta...), e
`mosaico-<lote>.jpg` mostra uma amostra de cada lote com a resposta por cima. Esses não vão para a
pasta de quem anota.

Com `--demonstracao`, gera também `demonstracao-recortes.zip`: uma partida sintética (sem quadros
para os pontos) com um lote de recortes das placas, para experimentar a página das placas de ponta a
ponta numa pasta de teste — nunca na pasta da equipe, que esses recortes não são de jogo nenhum. Ele
entra pela página central ("Trazer arquivos de um .zip"); `--lotes` sem nomes gera só a demonstração:

    python scripts/lotes_de_ouro.py --laboratorio ../placas-exposicao --saida lotes --lotes --demonstracao
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

RAIZ = Path(__file__).resolve().parents[1]
PADRAO = (105.0, 68.0)
DATA_ZIP = (2026, 1, 1, 0, 0, 0)  # data fixa nas entradas: o mesmo comando dá os mesmos bytes
PESOS_DO_LABORATORIO = {"principal": 0.42, "16m": 0.16, "fundo": 0.12, "reversa": 0.10, "baixa": 0.08, "tatica": 0.12}
#: O simulador abre a câmera tática pelo menos até 35 graus e a baixa até 18: um lote com essas câmeras
#: precisa deixar o campo de visão chegar lá.
HFOV_MINIMO = {"tatica": 35.0, "baixa": 18.0}
SUPER = 2  # super-amostragem do renderizador

# Medidas em px na referência de 960 de largura, como as regras da página.
REF_W = 960
BORDA_REF = 3.0  # ponto a menos disto da borda, dentro da imagem: marcar é opcional
FORA_REF = 6.0  # ponto fora da imagem, mas a menos disto da borda: o quadro não entra (seria ambíguo)
COBERTO_REF = 2.0  # algo na frente do ponto até esta distância: coberto
ANGULO_MIN = 15.0  # graus entre as linhas do cruzamento, na imagem: abaixo disto, marcar é opcional

# Os recortes das placas.
MARGEM = 0.6  # o que o recorte mostra em volta da placa, em alturas da placa (de cada lado)
MIN_ALTURA = 30  # placa mais baixa que isto (px de um quadro de 1920 de largura) não vira recorte
MIN_COMPRIMENTO = 4  # nem a que mostra menos que isto (em alturas dela) de comprimento
SUB = 3  # amostras por lado em cada pixel do recorte, para a verdade (vale a maioria)
PEQUENO_PX = 30  # área (px do recorte) abaixo da qual a página não exige a coisa (REGRA.placas.pequeno_px)
FUNDO_FORA = (128, 128, 128)  # o que fica fora do quadro, no recorte
#: Os códigos de quem aparece em cada pixel da tela do renderizador.
PLACA, PESSOA, TRAVE, BOLA, GRAFISMO = 1, 1000, 2000, 3000, 4000


@dataclass(frozen=True)
class LotePontos:
    nome: str
    descricao: str
    primeiro: int  # id do primeiro item (1001 -> g1001)
    n: int
    semente: int
    dominios: dict[str, float]  # "A": dia ou nublado; "B": noite, outro gramado e mais ruído -> peso
    cameras: dict[str, float]  # tipo de câmera do simulador -> peso
    hfov: tuple[float, float]  # campo de visão horizontal, em graus
    medidas: str  # "padrao" (105 x 68 m) ou "mistas" (metade de outro tamanho)
    pontos: tuple[int, int]  # pontos à vista (visivel: true) por item
    min_espalhamento: float  # maior distância entre dois pontos à vista, em frações da largura
    sem_pontos: int = 0  # itens sem nenhum ponto na imagem (closes): a resposta é salvar sem pontos
    nitido: bool = False  # sem borrão de movimento, sem desfoque e sem a faixa de replay na imagem
    k1_max: float | None = None  # distorção máxima (None: a do simulador)
    tarefa: str = "pontos"


@dataclass(frozen=True)
class LotePlacas:
    nome: str
    descricao: str
    primeiro: int
    semente: int
    dominios: dict[str, float]
    cameras: dict[str, float]
    hfov: tuple[float, float]
    #: quantos itens de cada tipo: o que está na frente da placa ("pessoas", "trave", "grafismo",
    #: "bola", "placa"), nada na frente ("nada") ou o recorte fora do lugar ("fora", para descartar)
    tipos: dict[str, int]
    nitido: bool = False
    k1_max: float | None = 0.03
    tarefa: str = "placas"

    @property
    def n(self) -> int:
        return sum(self.tipos.values())


CENTRAIS = {"principal": 0.6, "16m": 0.2, "tatica": 0.2}
SEM_A_TATICA = {k: v for k, v in PESOS_DO_LABORATORIO.items() if k != "tatica"}

LOTES = (
    LotePontos(
        "P1-treino",
        "treino e liberação: dia, câmeras centrais da transmissão, campo de 105 x 68 m, imagem nítida",
        1001,
        30,
        81_000,
        {"A": 1.0},
        CENTRAIS,
        (25.0, 55.0),
        "padrao",
        (6, 18),
        0.40,
        nitido=True,
        k1_max=0.02,
    ),
    LotePontos(
        "P2-variado",
        "controle de dia: todas as câmeras, metade dos campos de outro tamanho, alguns closes sem pontos",
        1101,
        40,
        82_000,
        {"A": 1.0},
        PESOS_DO_LABORATORIO,
        (12.0, 62.0),
        "mistas",
        (4, 39),
        0.30,
        sem_pontos=3,
    ),
    LotePontos(
        "P3-noite",
        "controle à noite: outro gramado, ruído mais forte, todas as câmeras, um close sem pontos",
        1201,
        20,
        83_000,
        {"B": 1.0},
        PESOS_DO_LABORATORIO,
        (12.0, 62.0),
        "mistas",
        (4, 39),
        0.30,
        sem_pontos=1,
    ),
    LotePlacas(
        "PL1-treino",
        "treino e liberação: dia, câmeras da transmissão, imagem nítida; gente na frente das placas, uma trave,"
        " um grafismo da emissora, duas placas sem nada na frente e duas com o recorte fora do lugar",
        4001,
        91_000,
        {"A": 1.0},
        {"principal": 0.5, "16m": 0.3, "reversa": 0.2},
        (8.0, 40.0),
        {"pessoas": 6, "trave": 1, "grafismo": 1, "nada": 2, "fora": 2},
        nitido=True,
        k1_max=0.02,
    ),
    LotePlacas(
        "PL2-variado",
        "controle: dia e noite, todas as câmeras menos a tática, com borrão; gente, traves e grafismo na"
        " frente das placas, três placas sem nada na frente e duas com o recorte fora do lugar",
        4101,
        92_000,
        {"A": 0.5, "B": 0.5},
        SEM_A_TATICA,
        (8.0, 50.0),
        {"pessoas": 8, "trave": 2, "grafismo": 1, "nada": 3, "fora": 2},
    ),
)


# ----------------------------------------------------------------------------- pontos
def ref(w: int) -> float:
    """Px da imagem por px da referência de 960."""
    return w / REF_W


def projetar_como_o_desenho(cam, X: np.ndarray, super_amostragem: int = SUPER) -> np.ndarray:
    """Onde os pontos 3D `X` aparecem na imagem do renderizador (N, 2; NaN onde a câmera do laboratório
    não projeta): ele desenha meio pixel da tela super-amostrada para a direita e para baixo da
    projeção (o OpenCV põe o centro do pixel no número inteiro), antes da distorção."""
    X = np.atleast_2d(np.asarray(X, float))
    bruto, _ = cam.project(X)
    ok = np.isfinite(bruto).all(1)
    out = np.full((len(X), 2), np.nan)
    Xc = (X[ok] - cam.C) @ cam.R.T
    n = Xc[:, :2] / Xc[:, 2:3] + (0.5 / super_amostragem) / cam.f
    r2 = (n**2).sum(1, keepdims=True)
    out[ok] = cam.f * n * (1 + cam.k1 * r2 + cam.k2 * r2**2) + np.array([cam.cx, cam.cy])
    return out


_DIRECOES: dict = {}


def direcoes_no_ponto(campo, nome: str) -> list[np.ndarray]:
    """As direções 3D (unitárias) das linhas que passam pelo ponto ou terminam nele."""
    chave = (campo.L, campo.W, nome)
    if chave in _DIRECOES:
        return _DIRECOES[chave]
    P = campo.ponto(nome)
    dirs = []
    for e in campo.elementos:
        if e.distancia(P[None])[0] > 1e-6:
            continue
        if e.tipo == "line":
            d = e.B - e.A
        else:  # a tangente do arco no ponto
            r = P[:2] - e.centro[:2]
            d = np.array([-r[1], r[0], 0.0])
        dirs.append(d / np.linalg.norm(d))
    _DIRECOES[chave] = dirs
    return dirs


def angulo_na_imagem(cam, P: np.ndarray, dirs: list[np.ndarray], passo: float = 0.25) -> float | None:
    """O maior ângulo (graus, de 0 a 90) entre as linhas do cruzamento depois de projetadas pela câmera
    (qualquer objeto com `project(X) -> (px, z)`); None quando não há duas linhas (uma marca, como o
    pênalti)."""
    if len(dirs) < 2:
        return None
    v = []
    for d in dirs:
        a, b = cam.project(np.array([P - passo * d, P + passo * d]))[0]
        if not (np.isfinite(a).all() and np.isfinite(b).all()) or np.linalg.norm(b - a) < 1e-9:
            return None
        v.append((b - a) / np.linalg.norm(b - a))
    melhor = 0.0
    for i in range(len(v)):
        for j in range(i + 1, len(v)):
            c = abs(float(v[i] @ v[j]))
            melhor = max(melhor, float(np.degrees(np.arccos(min(c, 1.0)))))
    return melhor


def pontos_verdadeiros(
    nomes: list[str],
    tipos: list[str],
    px: np.ndarray,
    angulos: list[float | None],
    oclusor: np.ndarray,
    trave: np.ndarray,
    w: int,
    h: int,
) -> tuple[list[dict], int]:
    """Os pontos de um item: [{ponto, x, y, visivel}] dos que caem na imagem, e quantos caem fora dela
    mas rente à borda (o quadro com algum desses não entra).

    `px` (N, 2): onde cada ponto aparece (NaN atrás da câmera); `oclusor`: o que cobre qualquer ponto
    (gente, placa, grafismo); `trave`: o que cobre os pontos do gramado, mas não os do próprio gol."""
    s = ref(w)
    r = max(round(COBERTO_REF * s), 1)
    nucleo = np.ones((2 * r + 1, 2 * r + 1), np.uint8)
    perto = cv2.dilate(oclusor.astype(np.uint8), nucleo) > 0
    perto_trave = cv2.dilate(trave.astype(np.uint8), nucleo) > 0
    borda, fora = BORDA_REF * s, FORA_REF * s
    out, rentes = [], 0
    for nome, tipo, (x, y), ang in zip(nomes, tipos, px, angulos, strict=True):
        if not (np.isfinite(x) and np.isfinite(y)):
            continue
        if not (0 <= x < w and 0 <= y < h):
            if -fora < x < w + fora and -fora < y < h + fora:
                rentes += 1
            continue
        i, j = int(y), int(x)
        coberto = bool(perto[i, j]) or (tipo != "gol" and bool(perto_trave[i, j]))
        na_borda = min(x, y, w - x, h - y) < borda
        rasante = ang is not None and ang < ANGULO_MIN
        out.append(
            {
                "ponto": nome,
                "x": round(float(x), 2),
                "y": round(float(y), 2),
                "visivel": not (coberto or na_borda or rasante),
            }
        )
    return out, rentes


def espalhamento(pontos: list[dict], w: int) -> float:
    """A maior distância entre dois pontos à vista, em frações da largura."""
    p = np.array([[q["x"], q["y"]] for q in pontos if q["visivel"]], float)
    if len(p) < 2:
        return 0.0
    return float(np.linalg.norm(p[:, None] - p[None], axis=2).max()) / w


# ----------------------------------------------------------------------------- placas
def paleta_da_verdade(n: int) -> list[tuple[int, int, int]]:
    """Cores para quem abre a máscara num visualizador: cada coisa na frente da placa numa cor, o resto
    preto (a página lê os números, não as cores)."""
    cores = [(255, 64, 129), (64, 196, 255), (255, 214, 0), (118, 255, 3), (213, 0, 249), (255, 145, 0)]
    pal = [(0, 0, 0)] * 256
    for k in range(1, n + 1):
        pal[k] = cores[(k - 1) % len(cores)]
    return pal


def recortar_poligono(pol: list, xmin: float, ymin: float, xmax: float, ymax: float) -> list:
    """O polígono (convexo) cortado por uma caixa (Sutherland-Hodgman)."""

    def cortar(pts, dentro, cruza):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            if dentro(b):
                if not dentro(a):
                    out.append(cruza(a, b))
                out.append(b)
            elif dentro(a):
                out.append(cruza(a, b))
        return out

    def em_x(x0):
        return lambda a, b: (x0, a[1] + (x0 - a[0]) * (b[1] - a[1]) / (b[0] - a[0]))

    def em_y(y0):
        return lambda a, b: (a[0] + (y0 - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), y0)

    pts = [tuple(map(float, q)) for q in pol]
    for dentro, cruza in (
        (lambda q: q[0] >= xmin, em_x(xmin)),
        (lambda q: q[0] <= xmax, em_x(xmax)),
        (lambda q: q[1] >= ymin, em_y(ymin)),
        (lambda q: q[1] <= ymax, em_y(ymax)),
    ):
        pts = cortar(pts, dentro, cruza) if pts else pts
    return pts


@dataclass
class Recorte:
    """O recorte de uma placa (ou de um retângulo fora do lugar) num quadro renderizado."""

    k: int  # a placa no estádio do simulador
    imagem: np.ndarray  # BGR, o recorte endireitado
    regiao: list  # o que se pinta: a placa, dentro do quadro (px do recorte)
    placa: list  # os cantos da placa no recorte: em cima à esquerda, em cima à direita, embaixo à direita e à esquerda
    no_quadro: list  # os mesmos cantos no quadro (px)
    altura_placa: int  # px
    a_vista: float  # a parte da placa dentro do quadro
    mapa: tuple  # (amostras do recorte -> px do quadro, origem, escala): para a verdade
    verdade: np.ndarray | None = None  # cada coisa na frente da placa com um número (1 a N), só dentro dela
    quem: list | None = None  # o que é cada número: "pessoa:<tipo>", "trave", "bola", "placa", "grafismo"
    deslocado: tuple = (0.0, 0.0)  # o retângulo fora do lugar: quanto (em alturas e comprimentos da placa)


def recortar(cena, img: np.ndarray, k: int, deslocar: tuple = (0.0, 0.0)) -> Recorte | None:
    """O recorte da placa `k` do quadro `img`, endireitado: o retângulo da placa com `MARGEM` alturas em
    volta, cada pixel tirado do quadro onde o plano da placa cai (com a distorção da lente). Só a parte
    da placa dentro do quadro entra; a placa cortada pela borda de cima ou de baixo do quadro, ou baixa
    ou curta demais, não vira recorte (None). `deslocar` (em comprimentos e alturas da placa) move o
    retângulo no plano dela — o recorte fora do lugar."""
    cam = cena.cam
    hq, wq = img.shape[:2]
    b = cena.stadium.boards[k]
    L, A = b.width, b.height
    V0 = b.V[0] + deslocar[0] * L * b.e_u + deslocar[1] * A * b.e_v

    def mundo(u, v):
        return V0 + np.asarray(u, float)[..., None] * b.e_u + np.asarray(v, float)[..., None] * b.e_v

    cantos = projetar_como_o_desenho(cam, mundo([0, L, L, 0], [A, A, 0, 0]))  # TL, TR, BR, BL
    if not np.isfinite(cantos).all():
        return None
    wb = round(max(np.linalg.norm(cantos[1] - cantos[0]), np.linalg.norm(cantos[2] - cantos[3])))
    hb = round(max(np.linalg.norm(cantos[3] - cantos[0]), np.linalg.norm(cantos[2] - cantos[1])))
    if hb < MIN_ALTURA * wq / 1920 or wb < hb or wb > 20_000:
        return None

    def no_quadro(cx, cy):
        """Onde os pontos do recorte (px, com o retângulo da placa de 0 a wb e de 0 a hb) caem no quadro."""
        q = projetar_como_o_desenho(cam, mundo(cx * L / wb, A - cy * A / hb).reshape(-1, 3))
        return q.reshape(*np.shape(cx), 2)

    # o que da placa cai dentro do quadro, pelo centro de cada pixel do retângulo dela
    gx, gy = np.meshgrid(np.arange(wb) + 0.5, np.arange(hb) + 0.5)
    q = no_quadro(gx, gy)
    dentro = np.isfinite(q).all(-1) & (q[..., 0] >= 0) & (q[..., 0] < wq) & (q[..., 1] >= 0) & (q[..., 1] < hq)
    em_cima, embaixo = np.nonzero(dentro[0])[0], np.nonzero(dentro[-1])[0]
    if not len(em_cima) or not len(embaixo):
        return None  # a borda de cima ou a de baixo do quadro corta a placa
    t0, t1, b0, b1 = em_cima[0], em_cima[-1] + 1, embaixo[0], embaixo[-1] + 1
    regiao_cheia = [(t0, 0), (t1, 0), (b1, hb), (b0, hb)]  # cortada só pelas bordas dos lados do quadro
    area = 0.5 * ((t1 - t0) + (b1 - b0)) * hb
    if abs(area - dentro.sum()) > 2 * hb + 0.02 * area:
        return None  # o corte não é uma reta (a borda de cima ou de baixo pega um canto da placa)
    if min(t1 - t0, b1 - b0) < MIN_COMPRIMENTO * hb:
        return None
    m = round(MARGEM * hb)
    ox, oy = min(t0, b0) - m, -m
    w_r, h_r = max(t1, b1) + m - ox, hb + 2 * m
    gx, gy = np.meshgrid(np.arange(w_r) + 0.5 + ox, np.arange(h_r) + 0.5 + oy)
    q = no_quadro(gx, gy)
    q = np.where(np.isfinite(q), q, -1e6)
    imagem = cv2.remap(
        img,
        (q[..., 0] - 0.5).astype(np.float32),
        (q[..., 1] - 0.5).astype(np.float32),
        cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=FUNDO_FORA,
    )
    regiao = recortar_poligono([(x - ox, y - oy) for x, y in regiao_cheia], 0, 0, w_r, h_r)
    placa = [(0 - ox, 0 - oy), (wb - ox, 0 - oy), (wb - ox, hb - oy), (0 - ox, hb - oy)]
    return Recorte(
        k=k,
        imagem=imagem,
        regiao=[[round(x, 3), round(y, 3)] for x, y in regiao],
        placa=[[float(x), float(y)] for x, y in placa],
        no_quadro=[[round(float(x), 2), round(float(y), 2)] for x, y in cantos],
        altura_placa=hb,
        a_vista=float(dentro.mean()),
        mapa=(no_quadro, (ox, oy), mundo, (L, A, wb, hb)),
        deslocado=deslocar,
    )


def verdade_do_recorte(cena, gt: dict, r: Recorte, sub: int = SUB) -> None:
    """O que está na frente da placa em cada pixel do recorte (dentro da região dela): a maioria das
    `sub` x `sub` amostras do pixel, cada uma pelo que o renderizador deixou por cima na tela
    super-amostrada (ou o grafismo da emissora, por cima de tudo). Uma placa vizinha do mesmo lado não
    está na frente; a placa, o fundo e a rede, também não. Preenche `r.verdade` e `r.quem`."""
    from anotacao.mascara import rasterizar

    no_quadro, (ox, oy), mundo, (L, A, wb, hb) = r.mapa
    h_r, w_r = r.imagem.shape[:2]
    ids, tela = gt["quem_aparece"], gt["tela"]
    ov = gt["grafismos"]
    lado = cena.stadium.boards[r.k].side
    dentro = rasterizar(r.regiao, w_r, h_r)
    jj, ii = np.nonzero(dentro)
    d = (np.arange(sub) + 0.5) / sub
    dx, dy = np.meshgrid(d, d)
    cx = (ii[:, None] + ox + dx.ravel()[None]).ravel()
    cy = (jj[:, None] + oy + dy.ravel()[None]).ravel()
    X = mundo(cx * L / wb, A - cy * A / hb)
    pc, _ = tela.project(X)
    ok = np.isfinite(pc).all(1)
    idx = np.full((len(cx), 2), -1, int)
    idx[ok] = np.floor(pc[ok] + 0.5).astype(int)
    hc, wc = ids.shape
    na_tela = ok & (idx[:, 0] >= 0) & (idx[:, 0] < wc) & (idx[:, 1] >= 0) & (idx[:, 1] < hc)
    cod = np.zeros(len(cx), np.int32)
    cod[na_tela] = ids[idx[na_tela, 1], idx[na_tela, 0]]
    # o que não cobre a placa: ela mesma, uma vizinha do mesmo lado, o fundo
    eh_placa = (cod >= PLACA) & (cod < PESSOA)
    outra = np.zeros(len(cx), bool)
    if eh_placa.any():
        lados = np.array([bb.side for bb in cena.stadium.boards])
        outra[eh_placa] = lados[cod[eh_placa] - PLACA] != lado
    cod[eh_placa & ~outra] = 0
    # o grafismo da emissora fica por cima de tudo
    qq = no_quadro(cx, cy).reshape(-1, 2)
    no_q = (
        np.isfinite(qq).all(1) & (qq[:, 0] >= 0) & (qq[:, 0] < ov.shape[1]) & (qq[:, 1] >= 0) & (qq[:, 1] < ov.shape[0])
    )
    g = np.zeros(len(cx), np.int32)
    g[no_q] = ov[qq[no_q, 1].astype(int), qq[no_q, 0].astype(int)]
    cod[g > 0] = GRAFISMO + g[g > 0]
    cod = cod.reshape(-1, sub * sub)
    # a maioria das amostras decide: coberto quando mais da metade está coberta, pelo que mais aparece
    coberto = (cod > 0).sum(1) * 2 > sub * sub
    final = np.zeros(len(cod), np.int32)
    for linha in np.nonzero(coberto)[0]:
        v, c = np.unique(cod[linha][cod[linha] > 0], return_counts=True)
        final[linha] = v[np.argmax(c)]
    mapa = np.zeros((h_r, w_r), np.int32)
    mapa[jj, ii] = final
    codigos = [c for c in np.unique(mapa) if c]
    centro = {c: float(np.nonzero(mapa == c)[1].mean()) for c in codigos}
    codigos.sort(key=lambda c: centro[c])
    if len(codigos) > 255:
        raise ValueError("coisas demais na frente da placa para os números de 1 a 255")
    verdade = np.zeros((h_r, w_r), np.uint8)
    quem = []
    for n, c in enumerate(codigos, start=1):
        verdade[mapa == c] = n
        if c >= GRAFISMO:
            quem.append("grafismo")
        elif c >= BOLA:
            quem.append("bola")
        elif c >= TRAVE:
            quem.append("trave")
        elif c >= PESSOA:
            quem.append(f"pessoa:{cena.people[c - PESSOA].kind}")
        else:
            quem.append("placa")
    r.verdade, r.quem = verdade, quem


def tipo_do_recorte(r: Recorte) -> str | None:
    """O tipo do item que o recorte faz: o que de mais raro está na frente da placa (sem contar as coisas
    pequenas, que a página não exige), "nada" quando não há nada na frente, ou None quando só há coisa
    pequena (não serve: nem vazio nem com o que pintar)."""
    if r.verdade is None:
        return None
    areas = np.bincount(r.verdade.ravel(), minlength=len(r.quem) + 1)[1:]
    grandes = {q.split(":")[0] for q, a in zip(r.quem, areas, strict=True) if a >= PEQUENO_PX}
    if not r.quem:
        return "nada"
    for t in ("grafismo", "bola", "trave", "placa", "pessoa"):
        if t in grandes:
            return "pessoas" if t == "pessoa" else t
    return None


def placas_a_vista(cena) -> list[int]:
    """As placas viradas para a câmera (a frente delas), da mais perto para a mais longe."""
    C = cena.cam.C
    out = [
        (float(np.linalg.norm(C - b.center)), k) for k, b in enumerate(cena.stadium.boards) if b.n @ (C - b.center) > 0
    ]
    return [k for _, k in sorted(out)]


# ----------------------------------------------------------------------------- simulador
class Laboratorio:
    """O que o script usa do laboratório (placas-exposicao/src)."""

    def __init__(self, pasta: Path):
        sys.path.insert(0, str(Path(pasta) / "src"))
        from exposure.assets.boards import default_stadium
        from exposure.core.camera import Camera, hfov_from_f
        from exposure.field.model import FieldModel
        from exposure.sim.render import Renderer
        from exposure.sim.scene import sample_scene

        self.default_stadium = default_stadium
        self.Camera = Camera
        self.hfov_from_f = hfov_from_f
        self.FieldModel = FieldModel
        self.sample_scene = sample_scene

        class ComOclusao(Renderer):
            """O renderizador do laboratório guardando também quem ficou por cima em cada pixel da tela
            (super-amostrada e sem a distorção): a placa, a pessoa, a trave ou a bola."""

            def render(self, sc, **kw):
                self._bid = self._gente = self._quem = self._tela = None
                self._traves = []
                img, gt = super().render(sc, **kw)
                gt["quem_aparece"] = self._quem_aparece(sc)
                gt["tela"] = self._tela
                _, rot = cv2.connectedComponents((gt["overlay_mask"] > 0).astype(np.uint8))
                gt["grafismos"] = rot.astype(np.int32)  # cada grafismo da emissora com um número
                return img, gt

            def _draw_goal(self, img, omask, bid, pmask, cs, F, side, night):
                # as alças da tela: no fim do desenho, elas guardam quem ficou por cima
                self._bid, self._gente, self._tela = bid, pmask, cs
                antes = omask.copy()
                super()._draw_goal(img, omask, bid, pmask, cs, F, side, night)
                self._traves.append((side, (omask > 0) & (antes == 0)))

            def _draw_person(self, img, pmask, bid, cs, p, S, rng, j):
                if self._quem is None:
                    self._quem = np.zeros(pmask.shape, np.uint16)
                so = np.zeros_like(pmask)
                super()._draw_person(img, so, bid, cs, p, S, rng, j)
                pmask |= so
                self._quem[so > 0] = j + 1

            def _quem_aparece(self, sc):
                """Na tela: 0 o fundo, PLACA + k a placa k, PESSOA + j a pessoa j, TRAVE (+ 1 a do lado
                direito) e BOLA. O que foi desenhado depois (mais perto) fica por cima: a pessoa apaga a
                placa (e a placa, a pessoa), a trave apaga as duas; a bola não apaga nada no desenho do
                laboratório, então ela fica por cima de tudo o que está mais longe que ela."""
                cs = self._tela
                ids = np.zeros(self._bid.shape, np.int32)
                for lado, m in self._traves:
                    ids[m] = TRAVE + (1 if lado > 0 else 0)
                bid = self._bid
                ids[bid > 0] = PLACA + bid[bid > 0].astype(np.int32) - 1
                if self._quem is not None:
                    gente = self._gente > 0
                    ids[gente] = PESSOA + self._quem[gente].astype(np.int32) - 1
                if sc.ball is not None:
                    bx, by = sc.ball
                    pc, z = cs.project(np.array([[bx, by, 0.11]]))
                    if np.isfinite(pc).all():
                        disco = np.zeros(ids.shape, np.uint8)
                        r = max(0.11 * cs.f / z[0], 1.0)
                        cv2.circle(disco, tuple(np.round(pc[0] * 16).astype(int)), int(r * 16), 1, -1, cv2.LINE_8, 4)
                        longe = np.full(BOLA + 1, np.inf)  # quanto cada coisa está da câmera
                        F = sc.field
                        for k, b in enumerate(sc.stadium.boards):
                            longe[PLACA + k] = np.linalg.norm(cs.C - b.center)
                        for j, p in enumerate(sc.people):
                            longe[PESSOA + j] = np.linalg.norm(cs.C - np.array([p.x, p.y, 0.9]))
                        for lado in (-1, 1):
                            gc = np.array([lado * (F.L / 2 + 1.0), 0.0, 1.0])
                            longe[TRAVE + (1 if lado > 0 else 0)] = np.linalg.norm(cs.C - gc)
                        d_bola = np.linalg.norm(cs.C - np.array([bx, by, 0.11]))
                        ys, xs = np.nonzero(disco)
                        por_cima = (ids[ys, xs] == 0) | (longe[ids[ys, xs]] >= d_bola)
                        ids[ys[por_cima], xs[por_cima]] = BOLA
                return ids

        self.renderizador = ComOclusao(SUPER)


def sortear(rng: np.random.Generator, pesos: dict[str, float]) -> str:
    chaves = list(pesos)
    p = np.array([pesos[k] for k in chaves], float)
    return str(rng.choice(chaves, p=p / p.sum()))


def sortear_medidas(rng: np.random.Generator, modo: str) -> tuple[float, float]:
    """Comprimento e largura do campo (m), de 0,5 em 0,5."""
    if modo == "padrao" or (modo == "mistas" and rng.random() < 0.5):
        return PADRAO
    while True:
        comprimento = float(rng.choice(np.arange(100.0, 110.5, 0.5)))
        largura = float(rng.choice(np.arange(64.0, 75.5, 0.5)))
        if abs(comprimento - PADRAO[0]) >= 1.5 or abs(largura - PADRAO[1]) >= 1.5:
            return comprimento, largura


def _cena(lab: Laboratorio, rng, dominio, w, h, campo, tipo, hfov, nitido, k1_max):
    estadio = lab.default_stadium(campo.L, campo.W, double_led_opo=bool(rng.random() < 0.3))
    cena = lab.sample_scene(rng, dominio, w, h, campo, stadium=estadio, kind=tipo, hfov_range=hfov)
    if k1_max is not None and abs(cena.cam.k1) > k1_max:
        return None
    if nitido:
        if cena.style.motion_len > 0 or cena.style.defocus > 0.5:
            return None
        cena.overlays["banner"] = False
    return cena


def intercalar(cheios: list, vazios: list) -> list:
    """Os itens especiais (sem pontos; só a torcida; só quem trabalha em volta do campo) espalhados pelo
    lote, não todos no fim."""
    final = len(cheios) + len(vazios)
    lugar = {round((k + 1) * final / (len(vazios) + 1)): v for k, v in enumerate(vazios)}
    resto = iter(cheios)
    return [lugar[i] if i in lugar else next(resto) for i in range(final)]


def _jpg(img: np.ndarray) -> bytes:
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    return jpg.tobytes()


def _comum(lote, gid, dominio, cena, semente, campo) -> dict:
    return {
        "lote": lote.nome,
        "id": gid,
        "dominio": dominio,
        "iluminacao": cena.style.lighting,
        "camera": cena.cam.meta.get("kind", ""),
        "hfov_graus": round(cena.cam.hfov, 2),
        "k1": round(cena.cam.k1, 4),
        "campo": f"{campo.L:g} x {campo.W:g}",
        "borrao": round(float(cena.style.motion_len), 1),
        "desfoque": round(float(cena.style.defocus), 2),
        "semente": semente,
    }


def gerar_pontos(lote: LotePontos, lab: Laboratorio, w: int, h: int, n: int | None = None) -> list[dict]:
    from anotacao.campo import Campo, pontos_marcaveis
    from anotacao.formatos import GabaritoPontos

    marcaveis = set(pontos_marcaveis())
    total = lote.n if n is None else min(n, lote.n)
    n_vazios = min(lote.sem_pontos, total) if n is None else min(lote.sem_pontos, max(total // 10, 0))
    cheios, vazios = [], []
    tentativa = 0
    while len(cheios) < total - n_vazios or len(vazios) < n_vazios:
        semente = lote.semente + tentativa
        tentativa += 1
        if tentativa > 80 * total:
            raise RuntimeError(f"{lote.nome}: poucos quadros passam no filtro ({len(cheios) + len(vazios)} de {total})")
        rng = np.random.default_rng(semente)
        vazio = len(cheios) >= total - n_vazios or (len(vazios) < n_vazios and rng.random() < n_vazios / total)
        dominio = sortear(rng, lote.dominios)
        # um close sem pontos: das câmeras que fecham o plano (a tática e a baixa não fecham tanto)
        tipo = sortear(rng, {k: v for k, v in lote.cameras.items() if not vazio or k not in ("tatica", "baixa")})
        comprimento, largura = sortear_medidas(rng, lote.medidas)
        campo_lab = lab.FieldModel(L=comprimento, W=largura)
        hfov = (3.0, 7.0) if vazio else lote.hfov
        cena = _cena(lab, rng, dominio, w, h, campo_lab, tipo, hfov, lote.nitido, lote.k1_max)
        if cena is None:
            continue
        cam = cena.cam
        nomes = campo_lab.keypoint_names
        idx = [k for k, nome in enumerate(nomes) if nome in marcaveis]
        nomes = [nomes[k] for k in idx]
        tipos = [campo_lab.kp_kinds[k] for k in idx]
        px = projetar_como_o_desenho(cam, campo_lab.KP[idx])
        dentro = np.isfinite(px).all(1) & (px[:, 0] >= 0) & (px[:, 0] < w) & (px[:, 1] >= 0) & (px[:, 1] < h)
        if vazio and dentro.any():  # filtro barato antes de renderizar
            continue
        if not vazio and int(dentro.sum()) < lote.pontos[0]:
            continue
        campo = Campo(L=comprimento, W=largura)
        angulos = [angulo_na_imagem(cam, campo.ponto(nm), direcoes_no_ponto(campo, nm)) for nm in nomes]
        img, gt = lab.renderizador.render(cena)
        oclusor = (gt["person_mask"] > 0) | (gt["overlay_mask"] > 0) | (gt["board_map"] > 0)
        pontos, rentes = pontos_verdadeiros(nomes, tipos, px, angulos, oclusor, gt["goal_mask"] > 0, w, h)
        if rentes:
            continue
        a_vista = sum(p["visivel"] for p in pontos)
        if vazio:
            if pontos:
                continue
        elif not (lote.pontos[0] <= a_vista <= lote.pontos[1]) or espalhamento(pontos, w) < lote.min_espalhamento:
            continue
        indice = {
            "pontos_na_imagem": len(pontos),
            "pontos_a_vista": a_vista,
            "pontos_opcionais": len(pontos) - a_vista,
            "espalhamento": round(espalhamento(pontos, w), 3),
            "lado": "canonico" if gt["canonical"] else "espelhado",
        }
        (vazios if vazio else cheios).append(
            {
                "cena": cena,
                "img": img,
                "pontos": pontos,
                "semente": semente,
                "dominio": dominio,
                "campo": campo_lab,
                "indice": indice,
            }
        )
        print(
            f"{lote.nome}: {tipo}, {cam.hfov:.1f}°, {a_vista} pontos à vista de {len(pontos)} (semente {semente})",
            flush=True,
        )
    itens = []
    for k, c in enumerate(intercalar(cheios, vazios)):
        gid = f"g{lote.primeiro + k:04d}"
        item = GabaritoPontos(
            id=gid,
            lote=lote.nome,
            imagem=f"{gid}.jpg",
            largura=w,
            altura=h,
            pontos=c["pontos"],
            origem="simulador",
            observacao=f"simulador do laboratório, domínio {c['dominio']}, semente {c['semente']}",
        )
        itens.append(
            {
                "item": item,
                "jpg": _jpg(c["img"]),
                "imagem": c["img"],
                "indice": {**_comum(lote, gid, c["dominio"], c["cena"], c["semente"], c["campo"]), **c["indice"]},
            }
        )
    return itens


#: Os tipos de item das placas, do mais raro ao mais comum (a ordem em que o gerador procura).
TIPOS_PLACAS = ("grafismo", "bola", "placa", "trave", "pessoas", "nada", "fora")


def _mirar_no_gol(lab: Laboratorio, rng, cena) -> None:
    """A câmera apontada para um dos gols, fechada: as placas do fundo com a trave na frente."""
    cam, F = cena.cam, cena.field
    lado = float(rng.choice([-1.0, 1.0]))
    alvo = [
        lado * (F.L / 2 + float(rng.uniform(0.5, 4.0))),
        float(rng.uniform(-9.0, 9.0)),
        float(rng.uniform(0.3, 1.5)),
    ]
    novo = lab.Camera.look_at(cam.C, alvo, float(rng.uniform(8.0, 30.0)), cam.w, cam.h, roll=0.0, k1=cam.k1)
    novo.meta["kind"] = cam.meta.get("kind", "")
    cena.cam = novo


def _mirar_nas_placas(lab: Laboratorio, rng, cena) -> None:
    """A câmera apontada para as placas do outro lado, fechada: gente grande na frente delas."""
    cam, F = cena.cam, cena.field
    lado = 1.0 if cam.C[1] < 0 else -1.0
    alvo = [
        float(rng.uniform(-F.L / 2, F.L / 2)),
        lado * (F.W / 2 + float(rng.uniform(0.0, 3.5))),
        float(rng.uniform(0.3, 1.2)),
    ]
    novo = lab.Camera.look_at(cam.C, alvo, float(rng.uniform(6.0, 18.0)), cam.w, cam.h, roll=0.0, k1=cam.k1)
    novo.meta["kind"] = cam.meta.get("kind", "")
    cena.cam = novo
    # gente perto das placas: uns jogadores e quem trabalha ali vão para a frente delas
    for p in cena.people:
        if rng.random() < 0.35:
            p.x = float(np.clip(alvo[0] + rng.normal(0, 6.0), -F.L / 2, F.L / 2))
            p.y = float(lado * (F.W / 2 - rng.uniform(-3.0, 6.0)))


def _mirar_no_grafismo(lab: Laboratorio, rng, cena) -> None:
    """A câmera apontada para as placas do outro lado com elas lá no alto do quadro, à esquerda (onde fica
    o placar da emissora) ou à direita (o logotipo): o grafismo por cima de uma placa."""
    cam, F = cena.cam, cena.field
    lado = 1.0 if cam.C[1] < 0 else -1.0
    alvo = [float(rng.uniform(-F.L / 3, F.L / 3)), lado * (F.W / 2 + 4.0), 0.5]
    hfov = float(rng.uniform(14.0, 34.0))
    base = lab.Camera.look_at(cam.C, alvo, hfov, cam.w, cam.h, roll=0.0, k1=cam.k1)
    pan, tilt, _ = base.ptr
    vfov = hfov * cam.h / cam.w
    pan += (0.32 if rng.random() < 0.6 else -0.36) * hfov
    tilt += float(rng.uniform(0.40, 0.47)) * vfov
    novo = lab.Camera.from_ptr(base.f, pan, tilt, 0.0, cam.C, cam.w, cam.h, k1=cam.k1)
    novo.meta["kind"] = cam.meta.get("kind", "")
    cena.cam = novo


def _item_placas(lote: LotePlacas, gid: str, c: dict) -> dict:
    """O item do gabarito, os arquivos e a linha do índice de um recorte escolhido."""
    from anotacao.formatos import GabaritoPlacas
    from anotacao.mascara import gravar_png, rasterizar

    r: Recorte = c["recorte"]
    h, w = r.imagem.shape[:2]
    fora = c["tipo"] == "fora"
    n = 0 if fora else len(r.quem)
    item = GabaritoPlacas(
        id=gid,
        lote=lote.nome,
        imagem=f"{gid}.jpg",
        mascara=None if fora else f"{gid}.png",
        largura=w,
        altura=h,
        regiao=r.regiao,
        oclusores=n,
        resposta="descartar" if fora else "pintar",
        origem="simulador",
        observacao=f"simulador do laboratório, domínio {c['dominio']}, semente {c['semente']}, placa {c['placa']}",
    )
    regiao = rasterizar(r.regiao, w, h)
    cobertos = 0 if fora else int((r.verdade > 0).sum())
    areas = [] if fora else np.bincount(r.verdade.ravel(), minlength=n + 1)[1:].tolist()
    indice = {
        **_comum(lote, gid, c["dominio"], c["cena"], c["semente"], c["cena"].field),
        "tipo_de_item": c["tipo"],
        "resposta": item.resposta,
        "placa": c["placa"],
        "altura_da_placa_px": r.altura_placa,
        "largura": w,
        "altura": h,
        "placa_a_vista": round(r.a_vista, 3),
        "oclusores": n,
        "pequenos": sum(a < PEQUENO_PX for a in areas),
        "quem_e_quem": " ".join(r.quem or []),  # na ordem dos números da máscara
        "pixels_da_placa": int(regiao.sum()),
        "pixels_cobertos": cobertos,
        "cobertura": round(cobertos / max(int(regiao.sum()), 1), 4),
        "deslocamento": "" if not fora else f"{r.deslocado[0]:+.2f} comprimento, {r.deslocado[1]:+.2f} altura",
    }
    out = {"item": item, "jpg": _jpg(r.imagem), "imagem": r.imagem, "regiao": r.regiao, "indice": indice}
    if not fora:
        out["png"] = gravar_png(r.verdade, paleta_da_verdade(n))
        out["mascara"] = r.verdade
    return out


def candidatos_placas(cena, img: np.ndarray, gt: dict, sub: int = 1) -> list[Recorte]:
    """Os recortes das placas à vista no quadro, com a verdade (com `sub` amostras por lado)."""
    out = []
    for k in placas_a_vista(cena):
        r = recortar(cena, img, k)
        if r is None:
            continue
        verdade_do_recorte(cena, gt, r, sub=sub)
        out.append(r)
    return out


def gerar_placas(lote: LotePlacas, lab: Laboratorio, w: int, h: int, n: int | None = None) -> list[dict]:
    """Os itens do lote: para cada tipo que ainda falta, o recorte de uma placa de um quadro renderizado
    (um recorte por quadro, para variar). O recorte fora do lugar sai de uma placa inteira no quadro,
    com o retângulo deslocado para cima ou para baixo dela (às vezes também para o lado)."""
    quotas = dict(lote.tipos)
    if n is not None:  # experimentando com menos itens: um de cada tipo que couber
        quotas = {t: min(q, 1) for t, q in quotas.items()}
        while sum(quotas.values()) > n:
            quotas[next(t for t in TIPOS_PLACAS if quotas.get(t))] = 0
    feitos: dict[str, list] = {t: [] for t in quotas}
    tentativa = 0
    while any(len(feitos[t]) < q for t, q in quotas.items()):
        semente = lote.semente + tentativa
        tentativa += 1
        if tentativa > 60 * sum(quotas.values()):
            falta = {t: q - len(feitos[t]) for t, q in quotas.items() if len(feitos[t]) < q}
            raise RuntimeError(f"{lote.nome}: não achei recortes para {falta}")
        rng = np.random.default_rng(semente)
        faltam = [t for t in TIPOS_PLACAS if len(feitos.get(t, ())) < quotas.get(t, 0)]
        dominio = sortear(rng, lote.dominios)
        tipo = sortear(rng, lote.cameras)
        campo_lab = lab.FieldModel(L=PADRAO[0], W=PADRAO[1])
        cena = _cena(lab, rng, dominio, w, h, campo_lab, tipo, lote.hfov, lote.nitido, lote.k1_max)
        if cena is None:
            continue
        mira = rng.random()
        if "grafismo" in faltam and mira < 0.5:
            _mirar_no_grafismo(lab, rng, cena)
            cena.overlays["score"] = cena.overlays["logo"] = True
        elif "trave" in faltam and mira < 0.6:
            _mirar_no_gol(lab, rng, cena)
        elif any(t in faltam for t in ("pessoas", "placa")) and mira < 0.85:
            _mirar_nas_placas(lab, rng, cena)
        img, gt = lab.renderizador.render(cena)
        candidatos = candidatos_placas(cena, img, gt)
        escolhido = None
        for t in faltam:
            if t == "fora":
                inteiras = [r for r in candidatos if r.a_vista == 1.0 and r.altura_placa >= 40 * w / 1920]
                for r0 in rng.permutation(len(inteiras)) if inteiras else []:
                    desl = (float(rng.uniform(-0.25, 0.25)), float(rng.choice([-1, 1]) * rng.uniform(0.7, 1.0)))
                    r = recortar(cena, img, inteiras[int(r0)].k, deslocar=desl)
                    if r is not None and r.a_vista == 1.0:
                        escolhido = ("fora", r)
                        break
            else:
                deste = [r for r in candidatos if tipo_do_recorte(r) == t]
                if deste:
                    # mais chance para o que cobre mais da placa: o treino precisa ter o que pintar
                    peso = np.array([0.02 + (r.verdade > 0).mean() for r in deste])
                    r = deste[int(rng.choice(len(deste), p=peso / peso.sum()))]
                    verdade_do_recorte(cena, gt, r)  # agora com todas as amostras
                    if tipo_do_recorte(r) == t:
                        escolhido = (t, r)
            if escolhido:
                break
        if not escolhido:
            continue
        t, r = escolhido
        b = cena.stadium.boards[r.k]
        feitos[t].append(
            {
                "recorte": r,
                "tipo": t,
                "cena": cena,
                "dominio": dominio,
                "semente": semente,
                "placa": b.id.lower().replace("_", "-"),
            }
        )
        tam = f"{r.imagem.shape[1]} x {r.imagem.shape[0]} px"
        print(
            f"{lote.nome}: {t} — {tipo}, {cena.cam.hfov:.1f}°, placa {b.id}, {tam}, {' '.join(r.quem or [])}",
            flush=True,
        )
    # os tipos espalhados pelo lote: um de cada, em rodízio
    ordem, filas = [], {t: list(v) for t, v in feitos.items()}
    while any(filas.values()):
        for t in TIPOS_PLACAS:
            if filas.get(t):
                ordem.append(filas[t].pop(0))
    return [_item_placas(lote, f"g{lote.primeiro + k:04d}", c) for k, c in enumerate(ordem)]


# ----------------------------------------------------------------------------- demonstração
DEMONSTRACAO = {"semente": 93_000, "quadros": 8, "por_quadro": 4, "fora": 3, "lote": "r1"}
CRIADO_EM_DEMONSTRACAO = "2026-01-01T12:00:00+00:00"


def gerar_demonstracao(
    lab: Laboratorio, w: int, h: int, verdades: dict | None = None
) -> tuple[str, list[tuple[str, bytes]]]:
    """A partida sintética para experimentar a página das placas: o manifesto, as tomadas, a fila dos
    pontos (vazia: não há quadros) e um lote de recortes das placas de uns quadros renderizados — as
    placas mais perto da câmera em cada um, e umas poucas com o retângulo fora do lugar (para
    descartar). Devolve o id da partida e os arquivos (caminho no .zip, bytes) na ordem de gravar: as
    imagens antes do lote e o manifesto por último, para a partida só aparecer completa. Com `verdades`
    (um dict), guarda nele o que está na frente de cada placa ({recorte: (máscara de 1 a N, o que é
    cada número)}; None no recorte fora do lugar) — para demonstrar a pintura, não vai no .zip."""
    from datetime import datetime

    from anotacao import __version__
    from anotacao.convencoes import id_partida
    from anotacao.formatos import Cadastro, Fila, ItemRecorte, Manifesto, PreProcessamento, Tomada, Tomadas, VideoInfo
    from anotacao.recortes import montar_lote

    criado = datetime.fromisoformat(CRIADO_EM_DEMONSTRACAO)
    partida = id_partida("2026-01-01", "Estádio do Simulador", "Demonstração", "Placas")
    base = f"partidas/{partida}"
    imagens, itens, tempos = [], [], []
    fora = 0
    tentativa = 0
    while len(tempos) < DEMONSTRACAO["quadros"]:
        semente = DEMONSTRACAO["semente"] + tentativa
        tentativa += 1
        if tentativa > 20 * DEMONSTRACAO["quadros"]:
            raise RuntimeError("demonstração: não achei quadros com placas para recortar")
        rng = np.random.default_rng(semente)
        dominio = "B" if len(tempos) % 4 == 3 else "A"  # um em cada quatro à noite
        tipo = sortear(rng, {"principal": 0.6, "16m": 0.2, "reversa": 0.2})
        cena = _cena(lab, rng, dominio, w, h, lab.FieldModel(L=PADRAO[0], W=PADRAO[1]), tipo, (8.0, 40.0), False, 0.03)
        if cena is None:
            continue
        mira = rng.random()
        if mira < 0.5:
            _mirar_nas_placas(lab, rng, cena)
        elif mira < 0.7:
            _mirar_no_gol(lab, rng, cena)
        img, gt = lab.renderizador.render(cena)
        recortes = [r for r in (recortar(cena, img, k) for k in placas_a_vista(cena)) if r is not None]
        recortes = recortes[: DEMONSTRACAO["por_quadro"]]
        if not recortes:
            continue
        # o tempo do quadro no vídeo (ms): um quadro a cada pouco mais de meio minuto
        ms = 30_000 + 41_000 * len(tempos) + 40 * int(rng.integers(0, 25))
        if fora < DEMONSTRACAO["fora"] and len(tempos) % 2 == 1:
            # a projeção errou uma placa inteira: o retângulo para cima ou para baixo dela
            for j, r in enumerate(recortes):
                if r.a_vista < 1.0:
                    continue
                desl = (float(rng.uniform(-0.2, 0.2)), float(rng.choice([-1, 1]) * rng.uniform(0.7, 1.0)))
                errado = recortar(cena, img, r.k, deslocar=desl)
                if errado is not None and errado.a_vista == 1.0:
                    recortes[j] = errado
                    fora += 1
                    break
        tempos.append(ms)
        for r in recortes:
            rid = f"t{ms:010d}_{cena.stadium.boards[r.k].id.lower().replace('_', '-')}"
            hr, wr = r.imagem.shape[:2]
            itens.append(
                ItemRecorte(recorte=rid, largura=wr, altura=hr, regiao=r.regiao, placa=r.placa, no_quadro=r.no_quadro)
            )
            imagens.append((f"{base}/recortes/{rid}.jpg", _jpg(r.imagem)))
            if verdades is not None:
                if r.deslocado == (0.0, 0.0):
                    verdade_do_recorte(cena, gt, r)
                    verdades[rid] = (r.verdade, r.quem)
                else:
                    verdades[rid] = None
        print(f"demonstração: {tipo}, {cena.cam.hfov:.1f}°, {len(recortes)} recorte(s) do quadro {ms} ms", flush=True)
    lote = montar_lote(
        partida,
        DEMONSTRACAO["lote"],
        itens,
        origem="simulador",
        gerador=f"scripts/lotes_de_ouro.py (anotacao {__version__})",
        semente=DEMONSTRACAO["semente"],
        criado_em=criado,
    )
    fps = 25.0
    n_quadros = round((tempos[-1] / 1000 + 30) * fps)
    tomadas = Tomadas(
        partida=partida,
        cortes=[],
        transicoes=[],
        tomadas=[
            Tomada(id=0, i0=0, i1=n_quadros, inicio_ms=0, fim_ms=round(1000 * n_quadros / fps), zoom="medio", grupo=0)
        ],
    )
    fila = Fila(partida=partida, criado_em=criado, equipe=[], itens=[])
    manifesto = Manifesto(
        partida=partida,
        cadastro=Cadastro(
            estadio="estadio-do-simulador",
            emissora="Simulador do laboratório",
            competicao="Demonstração",
            data_hora=datetime.fromisoformat("2026-01-01T16:00:00-03:00"),
            mandante="Demonstração",
            visitante="Placas",
            iluminacao="dia",
            chuva=False,
            observacoes="Partida sintética para experimentar a pintura das placas numa pasta de teste: os recortes"
            " vêm do simulador do laboratório, não de um jogo. Não traga para a pasta da equipe.",
        ),
        video=VideoInfo(
            nome_original="(simulador: sem vídeo)",
            sha256="0" * 64,
            bytes=0,
            duracao_s=n_quadros / fps,
            fps=fps,
            largura=w,
            altura=h,
            n_quadros=n_quadros,
        ),
        pre_processamento=PreProcessamento(
            ferramenta=__version__, criado_em=criado, segundos=0, parametros={"demonstracao": True}
        ),
    )

    def _json(m) -> bytes:
        return m.model_dump_json(indent=2).encode() + b"\n"

    arquivos = [(f"{base}/tomadas.json", _json(tomadas)), (f"{base}/fila.json", _json(fila))]
    arquivos += imagens
    arquivos += [(f"{base}/recortes/{lote.lote}.json", _json(lote)), (f"{base}/manifesto.json", _json(manifesto))]
    print(f"demonstração: {len(itens)} recortes ({fora} fora do lugar) de {len(tempos)} quadros", flush=True)
    return partida, arquivos


def gravar_zip_de_arquivos(destino: Path, arquivos: list[tuple[str, bytes]]) -> None:
    """Os arquivos num .zip, na ordem dada (a página grava nessa ordem ao trazer o .zip)."""
    with zipfile.ZipFile(destino, "w") as z:
        for nome, dados in arquivos:
            info = zipfile.ZipInfo(nome, date_time=DATA_ZIP)
            info.compress_type = zipfile.ZIP_STORED if nome.endswith(".jpg") else zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, dados)


# ----------------------------------------------------------------------------- saída
def gravar_zip(destino: Path, itens: list[dict]) -> None:
    with zipfile.ZipFile(destino, "w") as z:
        for it in itens:
            gid = it["item"].id
            json_item = it["item"].model_dump_json(indent=2).encode() + b"\n"
            partes = [
                (f"gabarito/itens/{gid}.json", json_item, zipfile.ZIP_DEFLATED),
                (f"gabarito/itens/{gid}.jpg", it["jpg"], zipfile.ZIP_STORED),  # o JPEG já é comprimido
            ]
            if "png" in it:
                partes.append((f"gabarito/itens/{gid}.png", it["png"], zipfile.ZIP_STORED))  # o PNG também
            for nome, dados, modo in partes:
                info = zipfile.ZipInfo(nome, date_time=DATA_ZIP)
                info.compress_type = modo
                info.external_attr = 0o644 << 16
                z.writestr(info, dados)


def com_a_resposta(it: dict) -> np.ndarray:
    """A imagem com a resposta por cima: os pontos (verde à vista, laranja opcionais) ou, no recorte da
    placa, o que está na frente dela (rosa) e o contorno da placa (azul; vermelho no recorte para
    descartar)."""
    out = it["imagem"].copy()
    if "regiao" in it:
        if it.get("mascara") is not None:
            na_frente = it["mascara"] > 0
            out[na_frente] = (0.35 * out[na_frente] + 0.65 * np.array([129, 64, 255])).astype(np.uint8)
        cor = (255, 211, 41) if it["item"].resposta == "pintar" else (40, 40, 230)
        pts = np.round(np.array(it["regiao"]) * 16).astype(np.int32)
        cv2.polylines(out, [pts], True, cor, 2, cv2.LINE_AA, 4)
        return out
    r = max(round(4 * ref(out.shape[1])), 3)
    for p in it["item"].pontos:
        c = (60, 220, 60) if p.visivel else (0, 150, 255)
        centro = (round(p.x * 16), round(p.y * 16))
        cv2.circle(out, centro, r * 16, c, 2, cv2.LINE_AA, 4)
    return out


def gravar_mosaico(destino: Path, itens: list[dict], colunas: int = 4, linhas: int = 3) -> None:
    """Uma amostra do lote, com a resposta por cima: até 12 quadros (pontos), com o id e o tipo de câmera,
    ou até 12 recortes de placa (dois por linha), com o id e o tipo do item."""
    placas = "regiao" in itens[0]
    if placas:
        colunas, linhas = 2, 6
    escolha = [itens[round(k)] for k in np.linspace(0, len(itens) - 1, min(colunas * linhas, len(itens)))]
    tw, th = (560, 140) if placas else (320, 180)
    tela = np.full((linhas * (th + 28) + 8, colunas * (tw + 8) + 8, 3), 250, np.uint8)
    for k, it in enumerate(escolha):
        y, x = 8 + (k // colunas) * (th + 28), 8 + (k % colunas) * (tw + 8)
        img = com_a_resposta(it)
        e = min(tw / img.shape[1], th / img.shape[0])
        pequena = cv2.resize(
            img, (max(1, round(img.shape[1] * e)), max(1, round(img.shape[0] * e))), interpolation=cv2.INTER_AREA
        )
        tela[y : y + pequena.shape[0], x : x + pequena.shape[1]] = pequena
        ind = it["indice"]
        if placas:
            texto = f"{ind['id']}  {ind['tipo_de_item']}  {ind['quem_e_quem'][:40]}"
        else:
            texto = f"{ind['id']}  {ind['camera']}  {ind['hfov_graus']:.0f} graus"
        cv2.putText(tela, texto, (x + 2, y + th + 19), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 40, 40), 1, cv2.LINE_AA)
    cv2.imwrite(str(destino), tela, [cv2.IMWRITE_JPEG_QUALITY, 90])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--laboratorio", required=True, help="pasta do repositório do laboratório (placas-exposicao)")
    ap.add_argument("--saida", required=True, help="pasta onde ficam os .zip, os índices e os mosaicos")
    ap.add_argument(
        "--lotes",
        nargs="*",
        default=None,
        help="só estes lotes (ex.: P1-treino PL1-treino); sem nomes, nenhum (com --demonstracao, só ela)",
    )
    ap.add_argument("--n", type=int, default=None, help="no máximo N itens por lote (para experimentar)")
    ap.add_argument("--largura", type=int, default=None, help="dos quadros (padrão: 1280 nos pontos, 1920 nas placas)")
    ap.add_argument("--altura", type=int, default=None)
    ap.add_argument(
        "--demonstracao",
        action="store_true",
        help="também a partida de demonstração das placas (demonstracao-recortes.zip), para uma pasta de teste",
    )
    args = ap.parse_args()

    try:
        import anotacao  # noqa: F401
    except ImportError:
        sys.path.insert(0, str(RAIZ / "src"))  # rodando sem `pip install -e .`
    lab = Laboratorio(Path(args.laboratorio))
    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)
    escolhidos = [lt for lt in LOTES if args.lotes is None or lt.nome in args.lotes]
    if not escolhidos and not (args.demonstracao and args.lotes == []):
        ap.error(f"nenhum lote com esses nomes; os lotes são {', '.join(lt.nome for lt in LOTES)}")
    if args.demonstracao:
        w = args.largura or 1920
        h = args.altura or round(w * 9 / 16)
        _, arquivos = gerar_demonstracao(lab, w, h)
        gravar_zip_de_arquivos(saida / "demonstracao-recortes.zip", arquivos)
    if not escolhidos:
        return
    linhas: dict[str, list[dict]] = {"pontos": [], "placas": []}
    contagem = {}
    for lote in escolhidos:
        gerar = gerar_pontos if lote.tarefa == "pontos" else gerar_placas
        w = args.largura or (1280 if lote.tarefa == "pontos" else 1920)
        h = args.altura or round(w * 9 / 16)
        itens = gerar(lote, lab, w, h, args.n)
        gravar_zip(saida / f"ouro-{lote.nome}.zip", itens)
        gravar_mosaico(saida / f"mosaico-{lote.nome}.jpg", itens)
        linhas[lote.tarefa] += [it["indice"] for it in itens]
        contagem[lote.nome] = len(itens)
        print(f"{lote.nome}: {len(itens)} itens, g{lote.primeiro:04d} a g{lote.primeiro + len(itens) - 1:04d}")
    for tarefa, lista in linhas.items():
        if not lista:
            continue
        with (saida / f"indice-{tarefa}.csv").open("w", newline="", encoding="utf-8") as f:
            escritor = csv.DictWriter(f, fieldnames=list(lista[0]))
            escritor.writeheader()
            escritor.writerows(lista)
    resumo = {
        lt.nome: {
            "tarefa": lt.tarefa,
            "descricao": lt.descricao,
            "itens": contagem[lt.nome],
            "ids": f"g{lt.primeiro:04d} a g{lt.primeiro + contagem[lt.nome] - 1:04d}",
            "uso": "teste de quem começa (resultado na hora)" if "treino" in lt.nome else "itens escondidos na fila",
        }
        for lt in escolhidos
    }
    (saida / "lotes.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
