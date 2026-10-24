"""`anotacao baixar`: o vídeo inteiro ou só os trechos, juntados sem recodificar, com a origem no MP4.

Roda sem internet: um servidor local com Range faz o papel do CDN do site de vídeo, e o yt-dlp usa o
extrator genérico (link direto para o MP4). O caminho do YouTube em si (extrator e desafios) é do
yt-dlp e não dá para testar aqui.
"""

from __future__ import annotations

import itertools
import subprocess

import cv2
import numpy as np
import pytest

pytest.importorskip("yt_dlp")
pytest.importorskip("imageio_ffmpeg")

from anotacao.baixar import (
    ErroBaixar,
    ajustar_ao_video,
    baixar,
    comentario,
    explicar,
    ffmpeg_exe,
    formato,
    ler_comentario,
    nome_do_arquivo,
    origem,
)
from anotacao.cli import main

from servidor_video import ServidorDeVideo

FPS = 25


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    """12 s a 25 quadros/s, H.264 com quadros B e quadro-chave a cada 2 s (como no YouTube)."""
    pasta = tmp_path_factory.mktemp("site")
    subprocess.run(
        [
            *[ffmpeg_exe(), "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size=320x180:rate={FPS}:duration=12"],
            *["-c:v", "libx264", "-g", "50", "-keyint_min", "50", "-sc_threshold", "0", "-bf", "2"],
            *["-pix_fmt", "yuv420p", "-movflags", "+faststart", str(pasta / "jogo.mp4")],
        ],
        check=True,
    )
    with ServidorDeVideo(pasta) as base:
        yield base, pasta / "jogo.mp4"


def _quadros(caminho):
    """Os quadros (cinza, reduzidos) e os tempos em ms, na ordem em que o vídeo os mostra."""
    cap = cv2.VideoCapture(str(caminho))
    quadros, tempos = [], []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        tempos.append(cap.get(cv2.CAP_PROP_POS_MSEC))
        quadros.append(cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (80, 45)).astype(np.float32))
    cap.release()
    return np.array(quadros), tempos


def _de_onde(saida, fonte):
    """Para cada quadro baixado, o índice do quadro igual no vídeo original (e o pior erro)."""
    idx, pior = [], 0.0
    for q in saida:
        d = ((fonte - q) ** 2).mean(axis=(1, 2))
        idx.append(int(d.argmin()))
        pior = max(pior, float(d.min()))
    return idx, pior


def _comentario(caminho) -> str | None:
    r = subprocess.run([ffmpeg_exe(), "-v", "error", "-i", str(caminho), "-f", "ffmetadata", "-"], capture_output=True)
    for linha in r.stdout.decode("utf-8").splitlines():
        if linha.startswith("comment="):
            return linha.removeprefix("comment=")
    return None


def test_baixar_o_video_inteiro(site, tmp_path):
    base, original = site
    avisos: list[str] = []
    arquivo = baixar(base + "jogo.mp4", tmp_path, avisar=avisos.append)
    assert arquivo == tmp_path / "jogo [jogo].mp4"
    assert [p.name for p in tmp_path.iterdir()] == [arquivo.name]  # sem sobras do download
    fonte, _ = _quadros(original)
    saida, tempos = _quadros(arquivo)
    idx, pior = _de_onde(saida, fonte)
    assert idx == list(range(12 * FPS)) and pior < 1.0  # os mesmos quadros, sem recodificar
    assert all(b > a for a, b in itertools.pairwise(tempos))
    o = ler_comentario(_comentario(arquivo))
    assert o["fonte"] == "generic" and o["id"] == "jogo" and o["url"] == base + "jogo.mp4" and o["trechos"] is None
    assert any("o vídeo inteiro" in a for a in avisos)
    with pytest.raises(ErroBaixar, match="já existe"):
        baixar(base + "jogo.mp4", tmp_path, avisar=avisos.append)


def test_baixar_so_os_trechos(site, tmp_path):
    base, original = site
    arquivo = baixar(base + "jogo.mp4", tmp_path, [(2.3, 4.1), (7.5, 9.0)], avisar=lambda _: None)
    assert arquivo.name == "jogo [jogo] trechos.mp4"
    fonte, _ = _quadros(original)
    saida, tempos = _quadros(arquivo)
    idx, pior = _de_onde(saida, fonte)
    assert pior < 1.0
    assert all(b > a for a, b in itertools.pairwise(tempos)), "os pedaços se juntam em ordem"
    # cada trecho vem do quadro-chave antes do início (2 s e 6 s) até o fim pedido; nada do meio
    corte = next(k for k in range(1, len(idx)) if idx[k] - idx[k - 1] > 10)
    primeiro, segundo = idx[:corte], idx[corte:]
    assert primeiro[0] == 2 * FPS and 4.0 * FPS <= primeiro[-1] <= 4.1 * FPS + 3
    assert segundo[0] == 6 * FPS and 8.9 * FPS <= segundo[-1] <= 9.0 * FPS + 3
    for pedaco in (primeiro, segundo):
        assert pedaco == sorted(pedaco)
        faltam = set(range(pedaco[0], pedaco[-1] + 1)) - set(pedaco)
        assert all(k > pedaco[-1] - 4 for k in faltam), faltam  # só no corte do fim, no meio de um grupo
    assert ler_comentario(_comentario(arquivo))["trechos"] == [[2.3, 4.1], [7.5, 9.0]]


def test_link_que_nao_existe(site, tmp_path):
    base, _ = site
    with pytest.raises(ErroBaixar, match="não existe"):
        baixar(base + "outro.mp4", tmp_path, avisar=lambda _: None)


def test_linha_de_comando(site, tmp_path, capsys):
    base, _ = site
    assert main(["baixar", base + "jogo.mp4", "--trechos", "0:01-0:02.5", "--pasta", str(tmp_path)]) == 0
    saida = capsys.readouterr().out
    assert "Pronto:" in saida and "já tem só os trechos" in saida
    assert (tmp_path / "jogo [jogo] trechos.mp4").exists()
    assert main(["baixar", base + "jogo.mp4", "--trechos", "primeiro tempo", "--pasta", str(tmp_path)]) == 1
    assert "não entendi o trecho" in capsys.readouterr().err


def test_nome_origem_e_mensagens():
    info = {"title": 'Time A x Time B: "final" / 2º tempo?', "id": "dQw4w9WgXcQ", "extractor_key": "Youtube"}
    assert nome_do_arquivo(info, None) == "Time A x Time B final 2º tempo [dQw4w9WgXcQ].mp4"
    assert nome_do_arquivo({"title": "...", "id": "x"}, [(1, 2)]) == "video [x] trechos.mp4"
    o = origem({**info, "webpage_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}, [(300, 3000)])
    assert o == {
        "fonte": "youtube",
        "id": "dQw4w9WgXcQ",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "titulo": info["title"],
        "trechos": [[300, 3000]],
    }
    assert ler_comentario(comentario(o)) == o
    assert ler_comentario("gravado no celular") is None and ler_comentario("anotacao/1 {quebrado") is None
    assert "height<=?720" in formato(720) and formato().startswith("bv*[vcodec^=avc1][height<=?1080][ext=mp4]")
    assert "--cookies-do-navegador" in explicar("ERROR: [youtube] x: Sign in to confirm you’re not a bot", 1080)
    assert "pip install -U yt-dlp" in explicar("ERROR: algo novo", 1080)
    assert ajustar_ao_video([(10, 20), (50, 120), (130, 140)], 100) == [(10, 20), (50, 100.0)]
    assert ajustar_ao_video([(1, 2)], None) == [(1, 2)]
    with pytest.raises(ErroBaixar, match="nenhum trecho cai dentro do vídeo, que tem 1:40"):
        ajustar_ao_video([(130, 140)], 100)
