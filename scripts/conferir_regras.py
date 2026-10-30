"""Confere as regras do gabarito com anotadores simulados nos lotes de ouro (ADR-0010).

Cada perfil anota todos os itens com erros de tamanho conhecido — nos pontos, o erro do clique, os
pontos esquecidos, os opcionais marcados e o nome trocado; nas pessoas, o laço no contorno com
vértices tremidos, o pincel que vaza ou come a borda, as pessoas pequenas esquecidas e quem pinta só
os jogadores (a regra da 0.8: sem o árbitro, os gandulas e os fotógrafos). A conta de certo ou errado
é a da própria página (`web/js/nucleo/gabarito.js`), rodada no Node por `conferir_regras.mjs`; este
script só monta os rótulos simulados.

    python scripts/conferir_regras.py --lotes lotes --saida /tmp/conferencia

`--lotes` é a pasta com os `ouro-*.zip` e o `indice-pessoas.csv` de `scripts/lotes_de_ouro.py` (o
índice diz quem é quem em cada máscara). Sementes fixas: o mesmo comando dá a mesma tabela.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import cv2
import numpy as np

RAIZ = Path(__file__).resolve().parents[1]
REF_W = 960

# sigma: erro do clique (px na ref. 960, em cada eixo); falta: chance de esquecer um ponto à vista;
# opcional: chance de marcar um ponto opcional (com o dobro do erro); troca: chance de trocar cab e
# opo de um ponto do item
PERFIS_PONTOS = {
    "cuidadoso": {"sigma": 0.5, "falta": 0.0, "opcional": 0.3, "troca": 0.0},
    "normal": {"sigma": 0.9, "falta": 0.04, "opcional": 0.3, "troca": 0.0},
    "pouco_zoom": {"sigma": 1.5, "falta": 0.04, "opcional": 0.3, "troca": 0.0},
    "apressado": {"sigma": 2.2, "falta": 0.12, "opcional": 0.1, "troca": 0.0},
    "troca_lado": {"sigma": 0.9, "falta": 0.04, "opcional": 0.3, "troca": 0.5},
}

# eps e sigma: o laço (vértices a cada eps px do contorno, tremidos de sigma px); cresce: px que o
# pincel vaza para fora (negativo: come da borda); esquece: pessoas com menos que isso de área (px,
# ref. 960) ficam sem pintar; so_jogadores: pinta só quem joga (jogadores e goleiros)
PERFIS_PESSOAS = {
    "laco_fino": {"eps": 0.7, "sigma": 0.4, "cresce": 0, "esquece": 0, "so_jogadores": False},
    "laco_normal": {"eps": 1.2, "sigma": 0.7, "cresce": 0, "esquece": 0, "so_jogadores": False},
    "laco_rapido": {"eps": 2.5, "sigma": 1.0, "cresce": 0, "esquece": 0, "so_jogadores": False},
    "vaza_1px": {"eps": 0.7, "sigma": 0.4, "cresce": 1, "esquece": 0, "so_jogadores": False},
    "vaza_2px": {"eps": 0.7, "sigma": 0.4, "cresce": 2, "esquece": 0, "so_jogadores": False},
    "vaza_3px": {"eps": 0.7, "sigma": 0.4, "cresce": 3, "esquece": 0, "so_jogadores": False},
    "come_1px": {"eps": 0.7, "sigma": 0.4, "cresce": -1, "esquece": 0, "so_jogadores": False},
    "esquece_pequenos": {"eps": 1.2, "sigma": 0.7, "cresce": 0, "esquece": 150, "so_jogadores": False},
    "so_jogadores": {"eps": 1.2, "sigma": 0.7, "cresce": 0, "esquece": 0, "so_jogadores": True},
}
JOGADOR = ("jogador", "goleiro")


def trocar_lado(nome: str) -> str:
    for a, b in (("_cab", "_opo"), ("_opo", "_cab")):
        if nome.endswith(a):
            return nome[: -len(a)] + b
    return nome


def marcar(item: dict, perfil: dict, rng: np.random.Generator) -> list[dict]:
    """Os pontos que um anotador com esse perfil marcaria no item."""
    s = item["largura"] / REF_W
    marcados = []
    for q in item["pontos"]:
        if q["visivel"]:
            if rng.random() < perfil["falta"]:
                continue
            e = rng.normal(0, perfil["sigma"] * s, 2)
        else:
            if rng.random() >= perfil["opcional"]:
                continue
            e = rng.normal(0, 2 * perfil["sigma"] * s, 2)
        x = float(np.clip(q["x"] + e[0], 0, item["largura"]))
        y = float(np.clip(q["y"] + e[1], 0, item["altura"]))
        marcados.append({"ponto": q["ponto"], "x": x, "y": y})
    if marcados and rng.random() < perfil["troca"]:
        k = int(rng.integers(len(marcados)))
        novo = trocar_lado(marcados[k]["ponto"])
        if novo not in {m["ponto"] for m in marcados}:
            marcados[k]["ponto"] = novo
    return marcados


def laco(mascara: np.ndarray, eps: float, sigma: float, rng: np.random.Generator) -> np.ndarray:
    """O contorno de fora de cada pedaço da máscara, simplificado (eps px), tremido (sigma px) e
    preenchido."""
    out = np.zeros_like(mascara)
    contornos, _ = cv2.findContours(mascara, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    for c in contornos:
        if len(c) < 3:
            cv2.drawContours(out, [c], -1, 1, -1)
            continue
        a = cv2.approxPolyDP(c.astype(np.float32), eps, True).reshape(-1, 2)
        a = a + rng.normal(0, sigma, a.shape)
        cv2.fillPoly(out, [np.round(a * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    return out


def pintar(verdade: np.ndarray, tipos: list[str], perfil: dict, rng: np.random.Generator) -> np.ndarray:
    """A pintura (1 onde pintou) de um anotador com esse perfil, a partir da máscara verdadeira (a pessoa
    j é do tipo `tipos[j - 1]`)."""
    escala2 = (REF_W / verdade.shape[1]) ** 2
    pintura = np.zeros(verdade.shape, np.uint8)
    nucleo = np.ones((3, 3), np.uint8)
    for j in np.unique(verdade):
        if j == 0:
            continue
        m = (verdade == j).astype(np.uint8)
        if perfil["so_jogadores"] and tipos[j - 1] not in JOGADOR:
            continue
        if m.sum() * escala2 < perfil["esquece"]:
            continue
        p = laco(m, perfil["eps"], perfil["sigma"], rng)
        if perfil["cresce"] > 0:
            p = cv2.dilate(p, nucleo, iterations=perfil["cresce"])
        elif perfil["cresce"] < 0:
            p = cv2.erode(p, nucleo, iterations=-perfil["cresce"])
        pintura |= p
    return pintura


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--lotes", required=True, help="pasta com os ouro-*.zip")
    ap.add_argument("--saida", required=True, help="pasta para os rótulos simulados (pode apagar depois)")
    ap.add_argument("--repeticoes", type=int, default=4, help="quantas vezes cada perfil marca os pontos de cada item")
    args = ap.parse_args()

    try:
        from anotacao.mascara import ler_png
    except ImportError:
        sys.path.insert(0, str(RAIZ / "src"))  # rodando sem `pip install -e .`
        from anotacao.mascara import ler_png

    rng = np.random.default_rng(7)
    saida = Path(args.saida)
    (saida / "pessoas").mkdir(parents=True, exist_ok=True)
    quem = {}  # o tipo de cada pessoa de cada item, na ordem dos números da máscara
    indice = Path(args.lotes) / "indice-pessoas.csv"
    if indice.exists():
        with indice.open(encoding="utf-8") as f:
            quem = {linha["id"]: linha["quem_e_quem"].split() for linha in csv.DictReader(f)}
    pontos, pessoas = [], []
    for z in sorted(Path(args.lotes).glob("ouro-*.zip")):
        with zipfile.ZipFile(z) as zf:
            for nome in sorted(n for n in zf.namelist() if n.endswith(".json")):
                item = json.loads(zf.read(nome))
                if item["formato"] == "gabarito.pontos/1":
                    for perfil, p in PERFIS_PONTOS.items():
                        for _ in range(args.repeticoes):
                            pontos.append(
                                {"lote": item["lote"], "perfil": perfil, "item": item, "marcados": marcar(item, p, rng)}
                            )
                    continue
                if item["formato"] != "gabarito.pessoas/1":
                    continue  # de uma versão anterior
                verdade = ler_png(zf.read(nome[: -len(".json")] + ".png"))
                tipos = quem.get(item["id"]) or ["?"] * item["pessoas"]  # sem o índice, "só os jogadores" não roda
                arq_verdade = f"{item['id']}.verdade.bin"
                (saida / "pessoas" / arq_verdade).write_bytes(verdade.tobytes())
                for perfil, p in PERFIS_PESSOAS.items():
                    if p["so_jogadores"] and item["id"] not in quem:
                        continue
                    arq = f"{item['id']}.{perfil}.bin"
                    (saida / "pessoas" / arq).write_bytes(pintar(verdade, tipos, p, rng).tobytes())
                    pessoas.append(
                        {
                            "lote": item["lote"],
                            "perfil": perfil,
                            "largura": item["largura"],
                            "altura": item["altura"],
                            "n": item["pessoas"],
                            "pintura": arq,
                            "verdade": arq_verdade,
                        }
                    )
    (saida / "pontos.json").write_text(json.dumps(pontos), encoding="utf-8")
    (saida / "pessoas.json").write_text(json.dumps(pessoas), encoding="utf-8")
    print(f"{len(pontos)} marcações simuladas e {len(pessoas)} pinturas em {saida}", flush=True)
    node = shutil.which("node")
    if node is None:
        print("sem o Node no PATH: rode `node scripts/conferir_regras.mjs <saida>` para a tabela")
        return
    subprocess.run([node, str(RAIZ / "scripts" / "conferir_regras.mjs"), str(saida)], check=True)


if __name__ == "__main__":
    main()
