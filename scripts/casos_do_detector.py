"""Gera os casos de teste do detector no navegador (`tests/fixtures/detector/`), com o próprio laboratório.

    python scripts/casos_do_detector.py      (no ambiente do exposicao-treino, que tem o PyTorch e o ONNX)

Monta uma rede pequena, com pesos sorteados (nada treinado, nada de dado real) e alguns canais dos pontos
forçados para escore alto, e a exporta pelo `exposicao-treino exportar` — o mesmo caminho do detector de
verdade, com as conferências dele (o `modelo.py` e o `detector.onnx` contra a rede). Grava o que a página
tem de reproduzir:

* `preparacao`: a imagem de entrada da rede (a janela e a redução do `modelo.py`, pelo OpenCV), em bytes
  BGR, para imagens de vários tamanhos — redução de 2,5 e 1,34 vezes, redução inteira (2 e 3 vezes),
  ampliação, 4:3 e quase 16:9. As imagens saem de uma conta simples (`imagem_conta`), que o teste refaz em
  JavaScript: só a resposta fica no arquivo;
* `rede`: os pontos do `modelo.py` em duas dessas imagens (16:9 e 4:3), com o corte de escore da página e
  sem corte nenhum.

Os testes em JavaScript (`tests/js/detector.test.js`) rodam o `detector.onnx` no ONNX Runtime Web e conferem
a preparação e a decodificação da página contra esses casos. Rodar de novo dá os mesmos arquivos (sementes
fixas), menos o `criado_em` do cartão.
"""

from __future__ import annotations

import base64
import gzip
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
import torch

RAIZ = Path(__file__).resolve().parents[1]
DESTINO = RAIZ / "tests" / "fixtures" / "detector"
ENTRADA = (128, 72)  # pequena: os casos ficam leves (múltiplos de 32 e de 8, como a rede pede)
CORTE = 0.5  # o corte de escore da página (web/js/nucleo/detector.js)
# canais com escore alto (o último não é marcável: a decodificação tem de deixá-lo de fora)
CANAIS_FORTES = ("canto_esq_cab", "meio_cab", "pa_dir_frente_opo", "penalti_esq", "circ_meio_cab", "circ_esq")


def imagem_conta(w: int, h: int) -> np.ndarray:
    """Rampas com ruído de um hash dos índices (BGR uint8): o teste em JavaScript refaz a mesma conta."""
    y, x, c = np.meshgrid(np.arange(h), np.arange(w), np.arange(3), indexing="ij")
    y, x, c = (a.astype(np.uint32) for a in (y, x, c))
    v = x * np.uint32(2654435761) + y * np.uint32(2246822519) + c * np.uint32(3266489917)  # mod 2³²
    v ^= v >> np.uint32(15)
    v *= np.uint32(2246822519)
    v ^= v >> np.uint32(13)
    ruido = (v >> np.uint32(24)) % np.uint32(64)
    base = (x * np.uint32(3) + y * np.uint32(5) + c * np.uint32(50)) % np.uint32(192)
    return (base + ruido).astype(np.uint8)


# (nome, largura, altura): o caminho do `preparar` que cada um exercita
TAMANHOS = (
    ("reduz-2,5", 320, 180),  # INTER_AREA com pesos fracionários, sem janela
    ("reduz-1,34", 171, 96),  # quase 16:9 (como 1366 x 768): INTER_AREA e um warpAffine quase identidade
    ("reduz-2", 256, 144),  # redução inteira por 2 (o caminho rápido do OpenCV)
    ("reduz-3", 384, 216),  # redução inteira por 3
    ("amplia", 96, 54),  # imagem menor que a entrada: INTER_LINEAR
    ("4x3", 240, 180),  # INTER_AREA e o warpAffine com faixas pretas
    ("quase", 300, 170),  # um pouco mais estreita que 16:9: faixas finas dos lados
)


def _bytes(a: np.ndarray) -> str:
    return base64.b64encode(gzip.compress(np.ascontiguousarray(a).tobytes(), mtime=0)).decode()


def main() -> None:
    from exposicao_treino.exportar import exportar
    from exposicao_treino.modelos.rede import MarkingNet
    from exposicao_treino.nucleo.campo import NOMES

    torch.manual_seed(0)
    ch = [8, 16, 16, 16, 16]
    net = MarkingNet(ch=tuple(ch), coord=True, context=True).eval()
    with torch.no_grad():
        for nome in CANAIS_FORTES:
            net.kp.net[-1].bias[NOMES.index(nome)] = 6.0
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        execucao = tmp / "execucao"
        execucao.mkdir()
        ck = {
            "model": net.state_dict(),
            "arch": {"ch": ch, "coord": True, "context": True},
            "config": {"alvos": {"entrada": list(ENTRADA)}, "avaliacao": {"limiar": 0.3, "nms_celulas": 2.0}},
            "epoca": 0,
            "it": 0,
        }
        torch.save(ck, execucao / "melhor.pt")
        exp = exportar(execucao / "melhor.pt", nome="detector-teste", saida=tmp / "exportados")
        spec = importlib.util.spec_from_file_location("modelo_teste", exp / "modelo.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = mod
        spec.loader.exec_module(mod)
        det = mod.Detector(str(exp / "detector.pt"))
        preparacao = []
        for nome, w, h in TAMANHOS:
            entrada, janela = mod.preparar(imagem_conta(w, h), ENTRADA)
            preparacao.append(
                {
                    "nome": nome,
                    "largura": w,
                    "altura": h,
                    "entrada_bgr": _bytes(entrada),
                    "janela": [float(v) for v in janela],
                }
            )
        casos = []
        for nome in ("reduz-2,5", "4x3"):
            _, w, h = next(t for t in TAMANHOS if t[0] == nome)
            img = imagem_conta(w, h)
            det.limiar = CORTE
            com_corte = det(img)
            det.limiar = 0.0
            sem_corte = det(img)
            casos.append(
                {"nome": nome, "largura": w, "altura": h, "pontos_com_corte": com_corte, "pontos_sem_corte": sem_corte}
            )
        DESTINO.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(exp / "detector.onnx", DESTINO / "detector.onnx")
        shutil.copyfile(exp / "cartao.json", DESTINO / "cartao.json")
    nota = {
        "o_que": "casos de teste do detector no navegador: rede pequena com pesos sorteados, imagens sintéticas",
        "gerado_por": "scripts/casos_do_detector.py",
        "entrada": list(ENTRADA),
        "corte": CORTE,
        "canais_fortes": list(CANAIS_FORTES),
        "opencv": cv2.__version__,
        "preparacao": preparacao,
        "rede": casos,
    }
    (DESTINO / "casos.json").write_text(json.dumps(nota, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for p in sorted(DESTINO.iterdir()):
        print(f"{p.relative_to(RAIZ)}: {p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
