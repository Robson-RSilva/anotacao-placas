"""Lotes de ouro do gabarito: quadros sintéticos com a resposta exata, prontos para importar.

Gera com o simulador do laboratório os lotes que treinam e liberam quem começa e que medem quem
anota (os itens escondidos na fila). Cada lote é um .zip com `gabarito/itens/gNNNN.json` +
`gNNNN.jpg` (formato gabarito.camera/1; na oclusão, gabarito.oclusao/1 e mais a máscara verdadeira
`gNNNN.png`), que a página central traz por "Trazer arquivos de um .zip".

Oclusão: as placas do item são as do estádio do laboratório (os polígonos exatos), e a máscara
verdadeira sai do renderizador — onde ele desenhou gente (pessoa), grafismo da emissora (grafismo),
trave (objeto) e a bola (bola, desenhada depois da placa) por cima de cada placa, dentro das que se
pintam (as de 10 px ou mais, ref. 960). A rede do gol não entra na máscara do renderizador: na
fração livre ela conta como livre, então pintá-la ou não dá no mesmo.

Os itens abrem no campo genérico, como os quadros reais sem o levantamento do estádio. Os de um
campo de outro tamanho levam as medidas verdadeiras (`campo`): quem anota só acerta ajustando as
medidas do molde. Todo item passa por um filtro de quadro justo (pontos-chave visíveis e
espalhados, linhas longas e, num campo de outro tamanho, as linhas que decidem as medidas: o meio, a
frente de uma grande área e uma lateral), e a câmera é conferida pelo modelo de câmera e pelo molde
do próprio `anotacao`: os pontos-chave caem onde o simulador os desenhou.

    python scripts/lotes_de_ouro.py --laboratorio ../placas-exposicao --saida lotes

As faixas de id dos lotes não se sobrepõem: dá para importar um, alguns ou todos na mesma pasta. As
sementes são fixas, então o mesmo comando gera sempre os mesmos lotes. Além dos .zip, `indice.csv`
(câmera) e `indice-oclusao.csv` descrevem cada item para quem coordena (domínio, câmera, campo de
visão, medidas, pontos visíveis; placas para pintar e cobertas), e `mosaico-<lote>.jpg` mostra uma
amostra de cada lote (na oclusão, com a máscara verdadeira por cima). Esses não vão para a pasta de
quem anota.
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
REF_GENERICO = "generico/pacote-1.0"
PADRAO = (105.0, 68.0)
DATA_ZIP = (2026, 1, 1, 0, 0, 0)  # data fixa nas entradas: o mesmo comando dá os mesmos bytes
PESOS_DO_LABORATORIO = {"principal": 0.42, "16m": 0.16, "fundo": 0.12, "reversa": 0.10, "baixa": 0.08, "tatica": 0.12}


@dataclass(frozen=True)
class Lote:
    nome: str
    descricao: str
    primeiro: int  # id do primeiro item (1 -> g0001)
    n: int
    semente: int
    dominio: str  # "A": dia ou nublado; "B": noite, outro gramado e mais ruído
    cameras: dict[str, float]  # tipo de câmera do simulador -> peso
    hfov: tuple[float, float]  # campo de visão horizontal, em graus
    medidas: str  # "padrao" (105 x 68 m), "outras" ou "mistas" (metade de cada)
    min_pontos: int  # pontos-chave visíveis, sem pessoa nem grafismo por cima
    min_espalhamento: float  # maior distância entre dois pontos visíveis, em frações da largura
    k1_max: float | None = None  # distorção máxima (None: a do simulador)
    medidas_visiveis: bool = False  # exige o meio, a frente de uma grande área e uma lateral em todo item
    # (num campo de outro tamanho, isso é exigido sempre)


@dataclass(frozen=True)
class LoteOclusao:
    nome: str
    descricao: str
    primeiro: int
    n: int
    semente: int
    dominio: str
    cameras: dict[str, float]
    hfov: tuple[float, float]
    min_placas: int  # placas para pintar (com 10 px ou mais, ref. 960)
    min_coberta_px: int  # numa placa, pelo menos isto de gente na frente (px na ref. 960 x 540)
    k1_max: float = 0.04


LOTES = (
    Lote(
        "L1-treino",
        "treino e liberação: dia, câmeras centrais da transmissão, campo de 105 x 68 m",
        1,
        30,
        61_000,
        "A",
        {"principal": 0.6, "16m": 0.2, "tatica": 0.2},
        (25.0, 55.0),
        "padrao",
        6,
        0.40,
        k1_max=0.02,
    ),
    Lote(
        "L2-medidas",
        "medidas do campo: planos abertos de campos de outros tamanhos",
        101,
        20,
        62_000,
        "A",
        {"principal": 0.5, "tatica": 0.3, "16m": 0.2},
        (38.0, 62.0),
        "outras",
        6,
        0.45,
        medidas_visiveis=True,
    ),
    Lote(
        "L3-variado",
        "controle de dia: todas as câmeras, metade dos campos de outro tamanho",
        201,
        60,
        63_000,
        "A",
        PESOS_DO_LABORATORIO,
        (12.0, 62.0),
        "mistas",
        4,
        0.30,
    ),
    Lote(
        "L4-noite",
        "controle à noite: outro gramado, ruído mais forte, metade dos campos de outro tamanho",
        301,
        30,
        64_000,
        "B",
        PESOS_DO_LABORATORIO,
        (12.0, 62.0),
        "mistas",
        4,
        0.30,
    ),
)


LOTES_OCLUSAO = (
    LoteOclusao(
        "L5-oclusao",
        "oclusão de dia: gente, trave e grafismo na frente das placas; câmeras principal, 16 m, baixa e reversa",
        401,
        20,
        65_000,
        "A",
        {"principal": 0.30, "16m": 0.20, "baixa": 0.20, "fundo": 0.15, "reversa": 0.15},
        (14.0, 42.0),
        3,
        120,
    ),
    LoteOclusao(
        "L6-oclusao-noite",
        "oclusão à noite: outro gramado, ruído mais forte e o LED mais claro que o resto; gente, trave e grafismo",
        501,
        10,
        66_000,
        "B",
        {"principal": 0.35, "16m": 0.20, "baixa": 0.25, "fundo": 0.20},
        (14.0, 42.0),
        3,
        120,
    ),
)


def sortear_medidas(rng: np.random.Generator, modo: str) -> tuple[float, float]:
    """Comprimento e largura do campo (m), de 0,5 em 0,5 como na página."""
    if modo == "padrao" or (modo == "mistas" and rng.random() < 0.5):
        return PADRAO
    while True:
        comprimento = float(rng.choice(np.arange(100.0, 110.5, 0.5)))
        largura = float(rng.choice(np.arange(64.0, 75.5, 0.5)))
        if abs(comprimento - PADRAO[0]) >= 1.5 or abs(largura - PADRAO[1]) >= 1.5:
            return comprimento, largura


def visibilidade(gt: dict, campo_lab, w: int, h: int) -> tuple[int, float, dict[str, float]]:
    """Pontos-chave visíveis, o espalhamento deles (fração da largura) e as linhas com pelo menos 10%
    da largura dentro da imagem (nome -> comprimento visível, em frações da largura)."""
    kp = gt["kp"]
    visiveis = kp[:, 2] == 1  # 1: visível; 2: dentro da imagem, mas sob pessoa, grafismo ou trave
    pts = kp[visiveis, :2]
    espalhamento = float(np.linalg.norm(pts[:, None] - pts[None], axis=2).max()) / w if len(pts) >= 2 else 0.0
    linhas = {}
    for e in campo_lab.elements:
        total = 0.0
        for trecho in gt["polylines"].get(e.id, []):
            dentro = (trecho[:, 0] >= 0) & (trecho[:, 0] < w) & (trecho[:, 1] >= 0) & (trecho[:, 1] < h)
            passos = np.linalg.norm(np.diff(trecho, axis=0), axis=1)
            total += float(passos[dentro[1:] & dentro[:-1]].sum())
        if total >= 0.1 * w:
            linhas[e.name] = total / w
    return int(visiveis.sum()), espalhamento, linhas


def medidas_decidiveis(linhas: dict[str, float]) -> bool:
    """O quadro mostra o que decide o tamanho do campo: o meio (comprimento, pela frente da grande
    área) e uma lateral (largura, pelas laterais da grande área)."""
    tem = lambda *nomes: any(n in linhas for n in nomes)  # noqa: E731
    return (
        tem("meio", "circulo_central")
        and tem("grande_area_esq_frente", "grande_area_dir_frente")
        and tem("lateral_cab", "lateral_opo")
    )


def conferir_camera(camera_item: dict, cam_lab, campo_lab, w: int, h: int) -> float:
    """Os pontos-chave pela câmera do item no modelo do `anotacao` caem onde o simulador os pôs."""
    from anotacao.camera import Camera
    from anotacao.campo import Campo

    cam = Camera.de_rotulo(camera_item, w, h)
    campo = Campo(L=campo_lab.L, W=campo_lab.W)
    pior = 0.0
    for nome, (X, _) in campo_lab.keypoints.items():
        p_lab, _ = cam_lab.project(np.asarray([X], float))
        if not cam_lab.in_image(p_lab)[0]:
            continue
        p, _ = cam.project(campo.ponto(nome)[None])
        pior = max(pior, float(np.abs(p[0] - p_lab[0]).max()))
    if not pior < 0.05:
        raise AssertionError(f"a câmera do item não reproduz a do simulador ({pior:.3f} px)")
    return pior


def gerar_lote(lote: Lote, args, lab) -> list[dict]:
    from anotacao.camera import canonical_side
    from anotacao.formatos import GabaritoCamera

    w, h = args.largura, args.altura
    n = lote.n if args.n is None else min(args.n, lote.n)
    renderizador = lab.Renderer(2)
    tipos = list(lote.cameras)
    pesos = np.array([lote.cameras[t] for t in tipos], float)
    pesos /= pesos.sum()
    itens = []
    tentativa = 0
    while len(itens) < n:
        semente = lote.semente + tentativa
        tentativa += 1
        if tentativa > 60 * n:
            raise RuntimeError(f"{lote.nome}: poucos quadros passam no filtro ({len(itens)} de {n})")
        rng = np.random.default_rng(semente)
        tipo = str(rng.choice(tipos, p=pesos))
        comprimento, largura = sortear_medidas(rng, lote.medidas)
        campo_lab = lab.FieldModel(L=comprimento, W=largura)
        estadio = lab.default_stadium(comprimento, largura, double_led_opo=bool(rng.random() < 0.3))
        cena = lab.sample_scene(rng, lote.dominio, w, h, campo_lab, stadium=estadio, kind=tipo, hfov_range=lote.hfov)
        cam = cena.cam
        if lote.k1_max is not None and abs(cam.k1) > lote.k1_max:
            continue
        px, _ = cam.project(campo_lab.KP)  # filtro barato antes de renderizar
        if int(cam.in_image(px).sum()) < lote.min_pontos:
            continue
        img, gt = renderizador.render(cena)
        n_pontos, espalhamento, linhas = visibilidade(gt, campo_lab, w, h)
        if n_pontos < lote.min_pontos or espalhamento < lote.min_espalhamento or len(linhas) < 2:
            continue
        # um campo de outro tamanho só entra quando o quadro mostra o que decide as medidas: o item
        # não tem a partida em volta, e quem anota não teria de onde tirá-las
        if (lote.medidas_visiveis or (comprimento, largura) != PADRAO) and not medidas_decidiveis(linhas):
            continue
        gid = f"g{lote.primeiro + len(itens):04d}"
        c = gt["cam"]
        camera = {
            "hfov_graus": lab.hfov_from_f(c["f"], c["w"]),
            "pan": c["pan"],
            "tilt": c["tilt"],
            "roll": c["roll"],
            "C": [c["Cx"], c["Cy"], c["Cz"]],
            "k1": c["k1"],
        }
        conferir_camera(camera, cam, campo_lab, w, h)
        item = GabaritoCamera(
            id=gid,
            pacote=REF_GENERICO,
            imagem=f"{gid}.jpg",
            largura=w,
            altura=h,
            camera=camera,
            campo=None if (comprimento, largura) == PADRAO else {"comprimento": comprimento, "largura": largura},
            origem="simulador",
            observacao=f"lote {lote.nome}; simulador do laboratório, domínio {lote.dominio}, semente {semente}",
        )
        ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        assert ok
        itens.append(
            {
                "item": item,
                "jpg": jpg.tobytes(),
                "imagem": img,
                "indice": {
                    "lote": lote.nome,
                    "id": gid,
                    "dominio": lote.dominio,
                    "iluminacao": cena.style.lighting,
                    "camera": tipo,
                    "hfov_graus": round(camera["hfov_graus"], 2),
                    "campo_comprimento": comprimento,
                    "campo_largura": largura,
                    "pontos_visiveis": n_pontos,
                    "espalhamento": round(espalhamento, 3),
                    "linhas_visiveis": len(linhas),
                    "k1": round(camera["k1"], 4),
                    "lado": "canonico" if canonical_side(np.asarray(camera["C"])) else "espelhado",
                    "semente": semente,
                },
            }
        )
        print(
            f"{lote.nome} {gid}: {tipo}, {camera['hfov_graus']:.1f}°, campo {comprimento:g} x {largura:g} m, "
            f"{n_pontos} pontos, {len(linhas)} linhas (semente {semente})",
            flush=True,
        )
    return itens


def placas_do_estadio(estadio) -> list[dict]:
    """As placas do estádio do laboratório no formato do pacote (BL, BR, TR, TL vistos do campo)."""
    return [
        {"id": b.id, "tipo": b.kind, "lado": b.side, "vertices": [[float(v) for v in x] for x in b.V]}
        for b in estadio.boards
    ]


def mascara_verdadeira(cena, gt: dict, camera, placas: list[dict]):
    """A máscara verdadeira da oclusão: em cada pixel das placas que se pintam, o que o renderizador
    desenhou por cima (a ordem: bola, trave, gente, grafismo da emissora — o último ganha)."""
    from anotacao import oclusao

    w, h = camera.w, camera.h
    geo = oclusao.geometria(camera, placas, w, h)
    roi = geo.roi
    m = np.where(roi, oclusao.LIVRE, oclusao.FORA).astype(np.uint8)
    if cena.ball is not None:  # a bola não está em nenhuma máscara do renderizador: o disco dela
        P = np.array([[cena.ball[0], cena.ball[1], 0.11]])
        pc, z = camera.project(P)
        if np.isfinite(pc).all() and z[0] > 0.5:
            r = max(0.11 * camera.f / z[0], 0.5)
            yy, xx = np.mgrid[0:h, 0:w]
            disco = (xx + 0.5 - pc[0, 0]) ** 2 + (yy + 0.5 - pc[0, 1]) ** 2 <= r * r
            # o renderizador desenha da mais longe para a mais perto: a bola cobre a placa mais longe que ela
            dist = float(np.linalg.norm(camera.C - P[0]))
            depois = np.zeros(len(placas) + 1, bool)
            for k, p in enumerate(placas):
                depois[k + 1] = dist < float(np.linalg.norm(camera.C - np.mean(np.asarray(p["vertices"]), 0)))
            m[roi & disco & depois[geo.regiao]] = oclusao.BOLA
    m[roi & (gt["goal_mask"] > 0)] = oclusao.OBJETO
    m[roi & (gt["person_mask"] > 0)] = oclusao.PESSOA
    m[roi & (gt["overlay_mask"] > 0)] = oclusao.GRAFISMO
    return geo, m


def concordancia_com_o_renderizador(geo, m, gt: dict) -> float:
    """Dos pixels que se pintam, em quantos "placa livre" bate com "o renderizador desenhou a placa ali"
    (a diferença fica nas bordas: as duas rasterizações não são a mesma)."""
    from anotacao import oclusao

    livre = m == oclusao.LIVRE
    desenhada = gt["board_map"].astype(np.int64) == geo.regiao.astype(np.int64)
    ok = (livre == desenhada) | (m == oclusao.BOLA) | (m == oclusao.GRAFISMO)
    return float(ok[geo.roi].mean()) if geo.roi.any() else 1.0


def gerar_lote_oclusao(lote: LoteOclusao, args, lab) -> list[dict]:
    from anotacao import oclusao
    from anotacao.camera import Camera
    from anotacao.formatos import GabaritoOclusao
    from anotacao.mascara import gravar_png

    w, h = args.largura, args.altura
    n = lote.n if args.n is None else min(args.n, lote.n)
    renderizador = lab.Renderer(2)
    tipos = list(lote.cameras)
    pesos = np.array([lote.cameras[t] for t in tipos], float)
    pesos /= pesos.sum()
    escala = (960 / w) ** 2
    itens = []
    tentativa = 0
    while len(itens) < n:
        semente = lote.semente + tentativa
        tentativa += 1
        if tentativa > 80 * n:
            raise RuntimeError(f"{lote.nome}: poucos quadros passam no filtro ({len(itens)} de {n})")
        rng = np.random.default_rng(semente)
        tipo = str(rng.choice(tipos, p=pesos))
        campo_lab = lab.FieldModel(L=PADRAO[0], W=PADRAO[1])
        estadio = lab.default_stadium(*PADRAO, double_led_opo=bool(rng.random() < 0.3))
        cena = lab.sample_scene(rng, lote.dominio, w, h, campo_lab, stadium=estadio, kind=tipo, hfov_range=lote.hfov)
        if abs(cena.cam.k1) > lote.k1_max:
            continue
        img, gt = renderizador.render(cena)
        c = gt["cam"]
        camera = {
            "hfov_graus": lab.hfov_from_f(c["f"], c["w"]),
            "pan": c["pan"],
            "tilt": c["tilt"],
            "roll": c["roll"],
            "C": [c["Cx"], c["Cy"], c["Cz"]],
            "k1": c["k1"],
        }
        conferir_camera(camera, cena.cam, campo_lab, w, h)
        placas = placas_do_estadio(estadio)
        geo, mascara = mascara_verdadeira(cena, gt, Camera.de_rotulo(camera, w, h), placas)
        est = oclusao.estatisticas(mascara, geo)
        pintaveis = [p for p in est if not p["pequena"]]
        coberto = lambda p: (p["area_px"] - p["livre_px"] - p["outra_placa_px"]) * escala  # noqa: E731
        cobertas = [p for p in pintaveis if coberto(p) >= lote.min_coberta_px]
        if len(pintaveis) < lote.min_placas or not cobertas:
            continue
        acordo = concordancia_com_o_renderizador(geo, mascara, gt)
        if acordo < 0.97:  # uma placa que o renderizador desenhou diferente: o item não seria justo
            continue
        gid = f"g{lote.primeiro + len(itens):04d}"
        item = GabaritoOclusao(
            id=gid,
            pacote=REF_GENERICO,
            imagem=f"{gid}.jpg",
            mascara=f"{gid}.png",
            largura=w,
            altura=h,
            camera=camera,
            placas=placas,
            origem="simulador",
            observacao=f"lote {lote.nome}; simulador do laboratório, domínio {lote.dominio}, semente {semente}",
        )
        ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        assert ok
        soma = {k: int(sum(p[k] for p in pintaveis)) for k in ("pessoa_px", "bola_px", "grafismo_px", "objeto_px")}
        fracs = [p["livre_frac"] for p in pintaveis if p["livre_frac"] is not None]
        itens.append(
            {
                "item": item,
                "jpg": jpg.tobytes(),
                "png": gravar_png(mascara, oclusao.PALETA),
                "imagem": img,
                "mascara": mascara,
                "indice": {
                    "lote": lote.nome,
                    "id": gid,
                    "dominio": lote.dominio,
                    "iluminacao": cena.style.lighting,
                    "camera": tipo,
                    "hfov_graus": round(camera["hfov_graus"], 2),
                    "placas_na_imagem": len(est),
                    "placas_para_pintar": len(pintaveis),
                    "placas_cobertas": len(cobertas),
                    **soma,
                    "livre_frac_minima": round(min(fracs), 3) if fracs else None,
                    "concordancia_com_o_renderizador": round(acordo, 4),
                    "semente": semente,
                },
            }
        )
        print(
            f"{lote.nome} {gid}: {tipo}, {camera['hfov_graus']:.1f}°, {len(pintaveis)} placas para pintar, "
            f"{len(cobertas)} cobertas (semente {semente})",
            flush=True,
        )
    return itens


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


def com_a_mascara(img: np.ndarray, mascara: np.ndarray) -> np.ndarray:
    """O quadro com a máscara verdadeira por cima: as classes que cobrem coloridas, fora das placas mais
    escuro."""
    from anotacao import oclusao

    cores = np.array([c[3][::-1] for c in oclusao.CLASSES], np.uint8)  # BGR
    out = img.copy()
    cobre = mascara >= oclusao.PESSOA
    out[cobre] = (0.4 * out[cobre] + 0.6 * cores[mascara[cobre]]).astype(np.uint8)
    fora = mascara == oclusao.FORA
    out[fora] = (0.6 * out[fora]).astype(np.uint8)
    return out


def gravar_mosaico(destino: Path, lote, itens: list[dict], colunas: int = 4, linhas: int = 3) -> None:
    """Uma amostra do lote: até 12 quadros, com o id e o tipo de câmera (na oclusão, com a máscara)."""
    escolha = [itens[round(k)] for k in np.linspace(0, len(itens) - 1, min(colunas * linhas, len(itens)))]
    tw, th = 320, 180
    tela = np.full((linhas * (th + 28) + 8, colunas * (tw + 8) + 8, 3), 250, np.uint8)
    for k, it in enumerate(escolha):
        y, x = 8 + (k // colunas) * (th + 28), 8 + (k % colunas) * (tw + 8)
        img = com_a_mascara(it["imagem"], it["mascara"]) if "mascara" in it else it["imagem"]
        tela[y : y + th, x : x + tw] = cv2.resize(img, (tw, th), interpolation=cv2.INTER_AREA)
        ind = it["indice"]
        texto = f"{ind['id']}  {ind['camera']}  {ind['hfov_graus']:.0f} graus"
        cv2.putText(tela, texto, (x + 2, y + th + 19), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 40, 40), 1, cv2.LINE_AA)
    cv2.imwrite(str(destino), tela, [cv2.IMWRITE_JPEG_QUALITY, 90])


class _Laboratorio:
    """O que o script usa do laboratório (placas-exposicao/src)."""

    def __init__(self, pasta: Path):
        sys.path.insert(0, str(pasta / "src"))
        from exposure.assets.boards import default_stadium
        from exposure.core.camera import hfov_from_f
        from exposure.field.model import FieldModel
        from exposure.sim.render import Renderer
        from exposure.sim.scene import sample_scene

        self.default_stadium = default_stadium
        self.hfov_from_f = hfov_from_f
        self.FieldModel = FieldModel
        self.Renderer = Renderer
        self.sample_scene = sample_scene


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--laboratorio", required=True, help="pasta do repositório do laboratório (placas-exposicao)")
    ap.add_argument("--saida", required=True, help="pasta onde ficam os .zip, o indice.csv e os mosaicos")
    ap.add_argument("--lotes", nargs="*", default=None, help="só estes lotes (ex.: L1-treino L3-variado)")
    ap.add_argument("--n", type=int, default=None, help="no máximo N itens por lote (para experimentar)")
    ap.add_argument("--largura", type=int, default=1280)
    ap.add_argument("--altura", type=int, default=720)
    args = ap.parse_args()

    try:
        import anotacao  # noqa: F401
    except ImportError:
        sys.path.insert(0, str(RAIZ / "src"))  # rodando sem `pip install -e .`
    lab = _Laboratorio(Path(args.laboratorio))
    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)
    todos = (*LOTES, *LOTES_OCLUSAO)
    escolhidos = [lt for lt in todos if args.lotes is None or lt.nome in args.lotes]
    if not escolhidos:
        ap.error(f"nenhum lote com esses nomes; os lotes são {', '.join(lt.nome for lt in todos)}")
    linhas: dict[str, list[dict]] = {"indice.csv": [], "indice-oclusao.csv": []}
    contagem = {}
    for lote in escolhidos:
        oclusao = isinstance(lote, LoteOclusao)
        itens = gerar_lote_oclusao(lote, args, lab) if oclusao else gerar_lote(lote, args, lab)
        gravar_zip(saida / f"ouro-{lote.nome}.zip", itens)
        gravar_mosaico(saida / f"mosaico-{lote.nome}.jpg", lote, itens)
        linhas["indice-oclusao.csv" if oclusao else "indice.csv"] += [it["indice"] for it in itens]
        contagem[lote.nome] = len(itens)
        print(f"{lote.nome}: {len(itens)} itens, g{lote.primeiro:04d} a g{lote.primeiro + len(itens) - 1:04d}")
    for nome, lista in linhas.items():
        if not lista:
            continue
        with (saida / nome).open("w", newline="", encoding="utf-8") as f:
            escritor = csv.DictWriter(f, fieldnames=list(lista[0]))
            escritor.writeheader()
            escritor.writerows(lista)
    resumo = {
        lt.nome: {
            "tarefa": "oclusao" if isinstance(lt, LoteOclusao) else "camera",
            "descricao": lt.descricao,
            "itens": contagem[lt.nome],
            "ids": f"g{lt.primeiro:04d} a g{lt.primeiro + contagem[lt.nome] - 1:04d}",
        }
        for lt in escolhidos
    }
    (saida / "lotes.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
