"""Lotes de ouro do gabarito: quadros sintéticos com a câmera exata, prontos para importar.

Gera com o simulador do laboratório os lotes que treinam e liberam quem começa e que medem quem
anota (os itens escondidos na fila). Cada lote é um .zip com `gabarito/itens/gNNNN.json` +
`gNNNN.jpg` (formato gabarito.camera/1), que a página central traz por "Trazer arquivos de um .zip".

Os itens abrem no campo genérico, como os quadros reais sem o levantamento do estádio. Os de um
campo de outro tamanho levam as medidas verdadeiras (`campo`): quem anota só acerta ajustando as
medidas do molde. Todo item passa por um filtro de quadro justo (pontos-chave visíveis e
espalhados, linhas longas e, num campo de outro tamanho, as linhas que decidem as medidas: o meio, a
frente de uma grande área e uma lateral), e a câmera é conferida pelo modelo de câmera e pelo molde
do próprio `anotacao`: os pontos-chave caem onde o simulador os desenhou.

    python scripts/lotes_de_ouro.py --laboratorio ../placas-exposicao --saida lotes

As faixas de id dos lotes não se sobrepõem: dá para importar um, alguns ou todos na mesma pasta. As
sementes são fixas, então o mesmo comando gera sempre os mesmos lotes. Além dos .zip, `indice.csv`
descreve cada item para quem coordena (domínio, câmera, campo de visão, medidas, pontos visíveis), e
`mosaico-<lote>.jpg` mostra uma amostra de cada lote. Esses dois não vão para a pasta de quem anota.
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


def gravar_zip(destino: Path, itens: list[dict]) -> None:
    with zipfile.ZipFile(destino, "w") as z:
        for it in itens:
            gid = it["item"].id
            json_item = it["item"].model_dump_json(indent=2).encode() + b"\n"
            for nome, dados, modo in (
                (f"gabarito/itens/{gid}.json", json_item, zipfile.ZIP_DEFLATED),
                (f"gabarito/itens/{gid}.jpg", it["jpg"], zipfile.ZIP_STORED),  # o JPEG já é comprimido
            ):
                info = zipfile.ZipInfo(nome, date_time=DATA_ZIP)
                info.compress_type = modo
                info.external_attr = 0o644 << 16
                z.writestr(info, dados)


def gravar_mosaico(destino: Path, lote: Lote, itens: list[dict], colunas: int = 4, linhas: int = 3) -> None:
    """Uma amostra do lote: até 12 quadros, com o id e o tipo de câmera."""
    escolha = [itens[round(k)] for k in np.linspace(0, len(itens) - 1, min(colunas * linhas, len(itens)))]
    tw, th = 320, 180
    tela = np.full((linhas * (th + 28) + 8, colunas * (tw + 8) + 8, 3), 250, np.uint8)
    for k, it in enumerate(escolha):
        y, x = 8 + (k // colunas) * (th + 28), 8 + (k % colunas) * (tw + 8)
        tela[y : y + th, x : x + tw] = cv2.resize(it["imagem"], (tw, th), interpolation=cv2.INTER_AREA)
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
    escolhidos = [lt for lt in LOTES if args.lotes is None or lt.nome in args.lotes]
    if not escolhidos:
        ap.error(f"nenhum lote com esses nomes; os lotes são {', '.join(lt.nome for lt in LOTES)}")
    linhas = []
    for lote in escolhidos:
        itens = gerar_lote(lote, args, lab)
        gravar_zip(saida / f"ouro-{lote.nome}.zip", itens)
        gravar_mosaico(saida / f"mosaico-{lote.nome}.jpg", lote, itens)
        linhas += [it["indice"] for it in itens]
        print(f"{lote.nome}: {len(itens)} itens, g{lote.primeiro:04d} a g{lote.primeiro + len(itens) - 1:04d}")
    with (saida / "indice.csv").open("w", newline="", encoding="utf-8") as f:
        escritor = csv.DictWriter(f, fieldnames=list(linhas[0]))
        escritor.writeheader()
        escritor.writerows(linhas)
    contagem = {}
    for linha in linhas:
        contagem[linha["lote"]] = contagem.get(linha["lote"], 0) + 1
    resumo = {
        lt.nome: {
            "descricao": lt.descricao,
            "itens": contagem[lt.nome],
            "ids": f"g{lt.primeiro:04d} a g{lt.primeiro + contagem[lt.nome] - 1:04d}",
        }
        for lt in escolhidos
    }
    (saida / "lotes.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
