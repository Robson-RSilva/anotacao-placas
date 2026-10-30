"""Lotes de ouro do gabarito: quadros sintéticos com a resposta exata, prontos para importar.

Gera com o simulador do laboratório os lotes que treinam e liberam quem começa e que medem quem
anota (os itens escondidos na fila), nas duas tarefas:

* Pontos (`gabarito.pontos/1`): onde cada um dos 39 pontos que se marcam caiu na imagem, do jeito que
  o simulador o desenhou. O renderizador desenha tudo meio pixel da tela (super-amostrada) para a
  direita e para baixo da projeção da câmera, então a resposta leva esse deslocamento: o ponto
  verdadeiro é o centro do cruzamento que aparece na imagem. Um ponto dentro da imagem vai com
  `visivel: false` (marcar é opcional) quando algo está na frente dele (gente, placa, grafismo da
  emissora e, nos pontos do gramado, a trave), quando fica rente à borda ou quando as linhas se
  cruzam quase paralelas na imagem (o cruzamento não tem um lugar preciso).
* Jogadores (`gabarito.jogadores/1` + a máscara verdadeira `gNNNN.png`): os pixels de cada pessoa
  que o simulador desenhou e que ficaram à vista — sem o que placa, trave ou grafismo cobre e sem a
  sombra. Os jogadores e os goleiros vão de 1 a N; as outras pessoas (árbitro, gandulas, fotógrafos:
  pintá-las é erro), de 255 para baixo. O renderizador do laboratório junta todo mundo numa máscara
  só; aqui ele guarda também quem é quem, e a união das pessoas confere, pixel a pixel, com a máscara
  dele.

Cada lote é um .zip com `gabarito/itens/gNNNN.json` + `gNNNN.jpg` (+ `gNNNN.png` nos jogadores), que
entra pela página do gabarito ("Importar lote de ouro (.zip)"). Os lotes com "treino" no nome são os
do teste de quem começa (com o resultado na hora); os outros, os itens escondidos na fila.

    python scripts/lotes_de_ouro.py --laboratorio ../placas-exposicao --saida lotes

As faixas de id dos lotes não se sobrepõem (pontos em g1xxx, jogadores em g2xxx): dá para importar
um, alguns ou todos na mesma pasta. As sementes são fixas, então o mesmo comando gera sempre os
mesmos lotes. Além dos .zip, `indice-pontos.csv` e `indice-jogadores.csv` descrevem cada item para
quem coordena (câmera, campo de visão, pontos à vista, jogadores...), e `mosaico-<lote>.jpg` mostra
uma amostra de cada lote com a resposta por cima. Esses não vão para a pasta de quem anota.
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
PEQUENO_REF = 30.0  # área (px) abaixo da qual a página não exige o jogador (REGRA.jogadores.pequeno_px)
JOGADOR = ("jogador", "goleiro")  # os tipos de pessoa do simulador que se pintam


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
class LoteJogadores:
    nome: str
    descricao: str
    primeiro: int
    n: int
    semente: int
    dominios: dict[str, float]
    cameras: dict[str, float]
    hfov: tuple[float, float]
    jogadores: tuple[int, int]  # jogadores por item (sem contar os pequenos, que a página não exige)
    com_outras: int  # itens com pelo menos uma outra pessoa à vista (árbitro, gandula, fotógrafo)
    sem_jogadores: int = 0  # itens só com outras pessoas: a resposta é salvar sem pintar nada
    max_pessoas: int = 30  # pessoas à vista por item, contando as pequenas
    inteiros: int = 0  # jogadores (não pequenos) que a imagem mostra inteiros, sem tocar a borda
    nitido: bool = False
    k1_max: float | None = None
    tarefa: str = "jogadores"


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
    LoteJogadores(
        "J1-treino",
        "treino e liberação: dia, planos fechados com poucos jogadores grandes, imagem nítida",
        2001,
        12,
        84_000,
        {"A": 1.0},
        {"principal": 0.5, "16m": 0.3, "reversa": 0.2},
        (8.0, 22.0),
        (2, 6),
        4,
        max_pessoas=10,
        inteiros=2,
        nitido=True,
        k1_max=0.02,
    ),
    LoteJogadores(
        "J2-variado",
        "controle: dia e noite, todas as câmeras menos a tática, mais jogadores e outras pessoas, um sem jogador",
        2101,
        16,
        85_000,
        {"A": 0.5, "B": 0.5},
        SEM_A_TATICA,
        (10.0, 34.0),
        (1, 12),
        8,
        sem_jogadores=1,
        max_pessoas=18,
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


# ----------------------------------------------------------------------------- jogadores
def moda_por_bloco(tela: np.ndarray, k: int) -> np.ndarray:
    """Reduz um mapa de pessoas (0 ninguém; j + 1 a pessoa j) de k em k pixels, como o renderizador
    reduz a máscara dele (pessoa onde mais da metade do bloco é gente): em cada bloco, a pessoa que
    mais aparece nele."""
    H, W = tela.shape
    h, w = H // k, W // k
    b = tela[: h * k, : w * k].reshape(h, k, w, k).transpose(0, 2, 1, 3).reshape(h, w, k * k)
    gente = (b > 0).sum(-1) * 2 > k * k
    iguais = (b[..., :, None] == b[..., None, :]).sum(-1)
    iguais[b == 0] = 0
    moda = np.take_along_axis(b, iguais.argmax(-1)[..., None], -1)[..., 0]
    return np.where(gente, moda, 0).astype(tela.dtype)


def numerar_pessoas(instancias: np.ndarray, tipos: list[str], w: int) -> tuple[np.ndarray, list[dict], list[dict]]:
    """A máscara verdadeira a partir do mapa de pessoas à vista (0 ninguém; j + 1 a pessoa j, do tipo
    `tipos[j]`): os jogadores e goleiros de 1 a N, da esquerda para a direita; as outras pessoas de 255
    para baixo. Devolve (máscara uint8, jogadores, outras), com a área de cada um (px) e se é pequeno
    (a página não exige) e se toca a borda da imagem."""
    escala2 = (REF_W / w) ** 2
    h = instancias.shape[0]
    ids, area = np.unique(instancias[instancias > 0], return_counts=True)
    pessoas = []
    for j1, a in zip(ids.tolist(), area.tolist(), strict=True):
        ys, xs = np.nonzero(instancias == j1)
        borda = bool(xs.min() == 0 or ys.min() == 0 or xs.max() == w - 1 or ys.max() == h - 1)
        pessoas.append(
            {
                "j": j1 - 1,
                "tipo": tipos[j1 - 1],
                "area": int(a),
                "x": float(xs.mean()),
                "pequeno": a * escala2 < PEQUENO_REF,
                "borda": borda,
            }
        )
    jogadores = sorted((p for p in pessoas if p["tipo"] in JOGADOR), key=lambda p: p["x"])
    outras = sorted((p for p in pessoas if p["tipo"] not in JOGADOR), key=lambda p: p["x"])
    if len(jogadores) + len(outras) > 255:
        raise ValueError("pessoas demais para os números de 1 a 255")
    m = np.zeros(instancias.shape, np.uint8)
    for k, p in enumerate(jogadores):
        p["numero"] = k + 1
        m[instancias == p["j"] + 1] = k + 1
    for k, p in enumerate(outras):
        p["numero"] = 255 - k
        m[instancias == p["j"] + 1] = 255 - k
    return m, jogadores, outras


def paleta_da_verdade(n: int, m: int) -> list[tuple[int, int, int]]:
    """Cores para quem abre a máscara num visualizador: cada jogador numa cor, as outras pessoas em
    cinza, o resto preto (a página lê os números, não as cores)."""
    cores = [(255, 64, 129), (64, 196, 255), (255, 214, 0), (118, 255, 3), (213, 0, 249), (255, 145, 0)]
    pal = [(0, 0, 0)] * 256
    for k in range(1, n + 1):
        pal[k] = cores[(k - 1) % len(cores)]
    for k in range(256 - m, 256):
        pal[k] = (170, 170, 170)
    return pal


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

        class ComPessoas(Renderer):
            """O renderizador do laboratório guardando, além da máscara de todas as pessoas, quem é quem."""

            def render(self, sc, **kw):
                self._quem = None
                self._gente = None
                img, gt = super().render(sc, **kw)
                gt["instancias"] = self._instancias(sc.cam)
                return img, gt

            def _draw_person(self, img, pmask, bid, cs, p, S, rng, j):
                if self._quem is None:
                    self._quem = np.zeros(pmask.shape, np.uint16)
                    self._gente = pmask  # placas e traves desenhadas depois apagam a gente nela
                so = np.zeros_like(pmask)
                super()._draw_person(img, so, bid, cs, p, S, rng, j)
                pmask |= so
                self._quem[so > 0] = j + 1

            def _instancias(self, cam):
                if self._quem is None:
                    return np.zeros((cam.h, cam.w), np.uint16)
                tela = np.where(self._gente > 0, self._quem, 0).astype(np.uint16)
                m = moda_por_bloco(tela, self.ss)
                _, remap = self._canvas_camera(cam)
                if remap is not None:
                    m = cv2.remap(m, remap[0], remap[1], cv2.INTER_NEAREST)
                return m

        self.renderizador = ComPessoas(SUPER)


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
    """Os itens sem resposta (sem pontos, sem jogador) espalhados pelo lote, não todos no fim."""
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


def _mirar_em_outra_pessoa(lab: Laboratorio, rng, cena):
    """A câmera apontada para um gandula ou fotógrafo (perto das placas, longe dos jogadores), bem fechada."""
    outras = [p for p in cena.people if p.kind == "staff"]
    if not outras:
        return None
    alvo = outras[int(rng.integers(len(outras)))]
    cam = cena.cam
    novo = lab.Camera.look_at(cam.C, [alvo.x, alvo.y, 0.9], float(rng.uniform(4.0, 8.0)), cam.w, cam.h, roll=0.0)
    novo.meta["kind"] = cam.meta.get("kind", "")
    cena.cam = novo
    return cena


def gerar_jogadores(lote: LoteJogadores, lab: Laboratorio, w: int, h: int, n: int | None = None) -> list[dict]:
    from anotacao.formatos import GabaritoJogadores
    from anotacao.mascara import gravar_png

    total = lote.n if n is None else min(n, lote.n)
    n_vazios = min(lote.sem_jogadores, total) if n is None else min(lote.sem_jogadores, total // 10)
    quota_outras = min(lote.com_outras, total) if n is None else min(lote.com_outras, total // 3)
    cheios, vazios = [], []
    tentativa = 0
    while len(cheios) < total - n_vazios or len(vazios) < n_vazios:
        semente = lote.semente + tentativa
        tentativa += 1
        if tentativa > 150 * total:
            raise RuntimeError(f"{lote.nome}: poucos quadros passam no filtro ({len(cheios) + len(vazios)} de {total})")
        rng = np.random.default_rng(semente)
        vazio = len(cheios) >= total - n_vazios or (len(vazios) < n_vazios and rng.random() < n_vazios / total)
        dominio = sortear(rng, lote.dominios)
        tipo = sortear(rng, lote.cameras)
        campo_lab = lab.FieldModel(L=PADRAO[0], W=PADRAO[1])
        cena = _cena(lab, rng, dominio, w, h, campo_lab, tipo, lote.hfov, lote.nitido, lote.k1_max)
        if cena is None:
            continue
        if vazio and _mirar_em_outra_pessoa(lab, rng, cena) is None:
            continue
        # filtro barato: quantos jogadores têm os pés perto da imagem
        pes, _ = cena.cam.project(np.array([[p.x, p.y, 0.0] for p in cena.people]))
        perto = (
            np.isfinite(pes).all(1)
            & (pes[:, 0] > -0.1 * w)
            & (pes[:, 0] < 1.1 * w)
            & (pes[:, 1] > 0)
            & (pes[:, 1] < 1.3 * h)
        )
        n_perto = sum(bool(perto[k]) and p.kind in JOGADOR for k, p in enumerate(cena.people))
        if vazio and n_perto:
            continue
        if not vazio and not (lote.jogadores[0] <= n_perto <= lote.jogadores[1] + 6):
            continue
        img, gt = lab.renderizador.render(cena)
        inst = gt["instancias"].copy()
        if not np.array_equal(inst > 0, gt["person_mask"] > 0):
            raise AssertionError(f"{lote.nome}, semente {semente}: quem é quem não bate com a máscara do renderizador")
        inst[gt["overlay_mask"] > 0] = 0  # o grafismo da emissora fica na frente de todo mundo
        mascara, jogadores, outras = numerar_pessoas(inst, [p.kind for p in cena.people], w)
        grandes = sum(not p["pequeno"] for p in jogadores)
        outras_grandes = sum(not p["pequeno"] for p in outras)
        if len(jogadores) + len(outras) > lote.max_pessoas:
            continue
        if vazio:
            if jogadores or not outras_grandes:
                continue
        else:
            if not (lote.jogadores[0] <= grandes <= lote.jogadores[1]):
                continue
            if sum(not p["pequeno"] and not p["borda"] for p in jogadores) < lote.inteiros:
                continue
            faltam_outras = quota_outras - sum(c["outras_grandes"] > 0 for c in cheios)
            faltam_itens = total - n_vazios - len(cheios)
            if faltam_outras >= faltam_itens and not outras_grandes:
                continue  # as vagas que sobram são das imagens com outras pessoas
        areas = [p["area"] for p in jogadores]
        indice = {
            "jogadores": len(jogadores),
            "jogadores_pequenos": len(jogadores) - grandes,
            "outras_pessoas": len(outras),
            "pixels_de_jogador": int(sum(areas)),
            "menor_jogador_px": min(areas) if areas else 0,
            "maior_jogador_px": max(areas) if areas else 0,
        }
        (vazios if vazio else cheios).append(
            {
                "cena": cena,
                "img": img,
                "mascara": mascara,
                "n": len(jogadores),
                "m": len(outras),
                "semente": semente,
                "dominio": dominio,
                "campo": campo_lab,
                "indice": indice,
                "outras_grandes": outras_grandes,
            }
        )
        print(
            f"{lote.nome}: {tipo}, {cena.cam.hfov:.1f}°, {len(jogadores)} jogadores ({grandes} grandes), "
            f"{len(outras)} outras pessoas (semente {semente})",
            flush=True,
        )
    itens = []
    for k, c in enumerate(intercalar(cheios, vazios)):
        gid = f"g{lote.primeiro + k:04d}"
        item = GabaritoJogadores(
            id=gid,
            lote=lote.nome,
            imagem=f"{gid}.jpg",
            mascara=f"{gid}.png",
            largura=w,
            altura=h,
            jogadores=c["n"],
            outras_pessoas=c["m"],
            origem="simulador",
            observacao=f"simulador do laboratório, domínio {c['dominio']}, semente {c['semente']}",
        )
        itens.append(
            {
                "item": item,
                "jpg": _jpg(c["img"]),
                "png": gravar_png(c["mascara"], paleta_da_verdade(c["n"], c["m"])),
                "imagem": c["img"],
                "mascara": c["mascara"],
                "indice": {**_comum(lote, gid, c["dominio"], c["cena"], c["semente"], c["campo"]), **c["indice"]},
            }
        )
    return itens


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
    """O quadro com a resposta por cima: os pontos (verde à vista, laranja opcionais) ou a máscara
    (os jogadores em rosa, as outras pessoas em amarelo)."""
    out = it["imagem"].copy()
    if "mascara" in it:
        m = it["mascara"]
        n = it["item"].jogadores
        jog = (m >= 1) & (m <= n)
        outras = m > n
        out[jog] = (0.35 * out[jog] + 0.65 * np.array([129, 64, 255])).astype(np.uint8)
        out[outras] = (0.35 * out[outras] + 0.65 * np.array([0, 214, 255])).astype(np.uint8)
        return out
    r = max(round(4 * ref(out.shape[1])), 3)
    for p in it["item"].pontos:
        c = (60, 220, 60) if p.visivel else (0, 150, 255)
        centro = (round(p.x * 16), round(p.y * 16))
        cv2.circle(out, centro, r * 16, c, 2, cv2.LINE_AA, 4)
    return out


def gravar_mosaico(destino: Path, itens: list[dict], colunas: int = 4, linhas: int = 3) -> None:
    """Uma amostra do lote: até 12 quadros com a resposta por cima, o id e o tipo de câmera."""
    escolha = [itens[round(k)] for k in np.linspace(0, len(itens) - 1, min(colunas * linhas, len(itens)))]
    tw, th = 320, 180
    tela = np.full((linhas * (th + 28) + 8, colunas * (tw + 8) + 8, 3), 250, np.uint8)
    for k, it in enumerate(escolha):
        y, x = 8 + (k // colunas) * (th + 28), 8 + (k % colunas) * (tw + 8)
        tela[y : y + th, x : x + tw] = cv2.resize(com_a_resposta(it), (tw, th), interpolation=cv2.INTER_AREA)
        ind = it["indice"]
        texto = f"{ind['id']}  {ind['camera']}  {ind['hfov_graus']:.0f} graus"
        cv2.putText(tela, texto, (x + 2, y + th + 19), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 40, 40), 1, cv2.LINE_AA)
    cv2.imwrite(str(destino), tela, [cv2.IMWRITE_JPEG_QUALITY, 90])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--laboratorio", required=True, help="pasta do repositório do laboratório (placas-exposicao)")
    ap.add_argument("--saida", required=True, help="pasta onde ficam os .zip, os índices e os mosaicos")
    ap.add_argument("--lotes", nargs="*", default=None, help="só estes lotes (ex.: P1-treino J1-treino)")
    ap.add_argument("--n", type=int, default=None, help="no máximo N itens por lote (para experimentar)")
    ap.add_argument("--largura", type=int, default=1280)
    ap.add_argument("--altura", type=int, default=720)
    args = ap.parse_args()

    try:
        import anotacao  # noqa: F401
    except ImportError:
        sys.path.insert(0, str(RAIZ / "src"))  # rodando sem `pip install -e .`
    lab = Laboratorio(Path(args.laboratorio))
    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)
    escolhidos = [lt for lt in LOTES if args.lotes is None or lt.nome in args.lotes]
    if not escolhidos:
        ap.error(f"nenhum lote com esses nomes; os lotes são {', '.join(lt.nome for lt in LOTES)}")
    linhas: dict[str, list[dict]] = {"pontos": [], "jogadores": []}
    contagem = {}
    for lote in escolhidos:
        gerar = gerar_pontos if lote.tarefa == "pontos" else gerar_jogadores
        itens = gerar(lote, lab, args.largura, args.altura, args.n)
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
