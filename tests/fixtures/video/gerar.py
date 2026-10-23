"""Gera os vídeos pequenos dos testes do leitor de MP4 e o que o ffprobe diz de cada um.

    python tests/fixtures/video/gerar.py      (precisa de ffmpeg e ffprobe)

Os .mp4 e o esperado.json ficam no repositório; rode de novo só para mudar os casos.
"""

import json
import subprocess
from pathlib import Path

AQUI = Path(__file__).parent
FONTE = ["-f", "lavfi", "-i", "testsrc2=size=64x48:rate=25:duration=1.04"]
CASOS = {
    # H.264 com quadros B (há lista de edição e pré-rolagem), índice no fim do arquivo
    "h264_b.mp4": ["-c:v", "libx264", "-preset", "veryfast", "-bf", "2", "-g", "8", "-pix_fmt", "yuv420p"],
    # H.264 com o índice no começo
    "h264_inicio.mp4": [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-bf",
        "0",
        "-g",
        "10",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
    ],
    # H.264 fragmentado (gravadores ao vivo)
    "h264_fragmentado.mp4": [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-bf",
        "2",
        "-g",
        "8",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
    ],
    # AV1 (o Chromium dos testes de ponta a ponta decodifica AV1, não H.264)
    "av1.mp4": ["-vf", "scale=96:64", "-c:v", "libaom-av1", "-cpu-used", "8", "-g", "10", "-pix_fmt", "yuv420p"],
}


def sondar(caminho: Path) -> dict:
    r = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_packets",
            "-show_streams",
            "-show_entries",
            "packet=pts,dts,duration,size,pos,flags:stream=codec_name,profile,level,width,height,time_base",
            "-of",
            "json",
            str(caminho),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    d = json.loads(r.stdout)
    s = d["streams"][0]
    num, den = (int(x) for x in s["time_base"].split("/"))
    pacotes = [
        {
            "pos": int(p["pos"]),
            "tamanho": int(p["size"]),
            "chave": p["flags"].startswith("K"),
            "pts_ms": None if p.get("pts") in (None, "N/A") else int(p["pts"]) * 1000 * num / den,
            "descartado": "D" in p["flags"],
        }
        for p in d["packets"]
    ]
    return {"codec": s["codec_name"], "largura": s["width"], "altura": s["height"], "pacotes": pacotes}


def main() -> None:
    esperado = {}
    for nome, args in CASOS.items():
        saida = AQUI / nome
        subprocess.run(["ffmpeg", "-y", "-v", "error", *FONTE, *args, "-an", str(saida)], check=True)
        esperado[nome] = sondar(saida)
        print(nome, saida.stat().st_size, "bytes", len(esperado[nome]["pacotes"]), "pacotes")
    (AQUI / "esperado.json").write_text(json.dumps(esperado, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
