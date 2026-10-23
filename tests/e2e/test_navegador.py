"""Ponta a ponta no navegador: anotar um quadro arrastando o molde e aprovar na revisão cruzada.

Roda só com `pytest -m e2e` e precisa do Playwright com o Chromium instalado.
"""

from __future__ import annotations

import os
import socket
import threading
import time
from pathlib import Path

import numpy as np
import pytest

from anotacao.campo import Campo
from anotacao.formatos import RevisaoCamera, RotuloCamera
from anotacao.pasta import ler_json
from anotacao.preprocessamento import preprocessar
from anotacao.servidor import Configuracao, criar_app
from anotacao.sorteio import ParametrosSorteio

pytestmark = pytest.mark.e2e
playwright = pytest.importorskip("playwright.sync_api")

CAMPO = Campo()
NOME_REGISTRO = {0: "principal", 1: "16m_dir", 2: "reversa"}  # câmeras das tomadas do vídeo sintético


@pytest.fixture
def servidor(pasta, video, cadastro, tmp_path):
    import uvicorn

    caminho, verdade = video
    r = preprocessar(pasta, caminho, cadastro, params=ParametrosSorteio(alvo=10, frac_dupla=0, frac_sem_previsao=0))
    cfg = Configuracao(pasta=pasta.raiz, pasta_videos=tmp_path / "v", config_local=tmp_path / "c" / "c.json")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        porta = s.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(criar_app(cfg), host="127.0.0.1", port=porta, log_level="warning"))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{porta}", pasta, verdade, r.partida
    srv.should_exit = True
    t.join(timeout=5)


def _tela(pagina, X):
    """Posição na tela (px da janela) de um ponto 3D pela câmera atual do editor, ou None."""
    return pagina.evaluate(
        """(X) => { const px = editor.cam.projetar(X); if (!px) return null;
            const [sx, sy] = editor.paraTela(px[0], px[1]); const r = editor.cv.getBoundingClientRect();
            return [r.left + sx, r.top + sy, px[0], px[1]]; }""",
        list(map(float, X)),
    )


def _imagem_para_janela(pagina, x, y):
    return pagina.evaluate(
        "([x, y]) => { const [sx, sy] = editor.paraTela(x, y); const r = editor.cv.getBoundingClientRect();"
        " return [r.left + sx, r.top + sy]; }",
        [x, y],
    )


def _espalhados(pontos: dict, n: int) -> list[str]:
    nomes = list(pontos)
    escolhidos = [max(nomes, key=lambda k: pontos[k][0])]
    while len(escolhidos) < min(n, len(nomes)):
        resto = [k for k in nomes if k not in escolhidos]
        escolhidos.append(max(resto, key=lambda k: min(np.hypot(*(pontos[k] - pontos[e])) for e in escolhidos)))
    return escolhidos


def test_anotar_arrastando_e_aprovar(servidor, tmp_path):
    url, pasta, verdade, pid = servidor
    shots = Path(os.environ.get("ANOTACAO_CAPTURAS", tmp_path))  # capturas de tela, para olhar depois
    with playwright.sync_playwright() as p:
        exe = os.environ.get("ANOTACAO_CHROMIUM")  # navegador já instalado, se houver
        nav = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        pagina = nav.new_page(viewport={"width": 1400, "height": 860})
        pagina.on("dialog", lambda d: d.accept())
        erros = []
        pagina.on("pageerror", lambda e: erros.append(str(e)))

        pagina.goto(url + "/")
        pagina.select_option("#pessoa", "A01")
        pagina.wait_for_function("document.querySelector('#st-camera').textContent.startsWith('Liberado')")
        pagina.click("#ir-camera")
        pagina.wait_for_function("window.editor !== undefined && window.editor !== null")

        item = next(it for it in pasta.ler_fila(pid).itens if "A01" in it.atribuido_a)
        cam_v = verdade[item.i]
        pagina.select_option("#registro", NOME_REGISTRO[item.tomada])
        pagina.click("#recomecar")
        pagina.screenshot(path=str(shots / "e2e_1_inicio.png"))

        # pontos visíveis na câmera verdadeira e na de partida
        alvos = {}
        for nome in CAMPO.nomes_pontos:
            px, _ = cam_v.project(CAMPO.ponto(nome))
            ini = _tela(pagina, CAMPO.ponto(nome))
            if cam_v.in_image(px, margem=-30)[0] and ini and 0 < ini[2] < cam_v.w and 0 < ini[3] < cam_v.h:
                alvos[nome] = px[0]
        escolhidos = _espalhados(alvos, 5)
        assert len(escolhidos) >= 4, escolhidos
        for nome in escolhidos:
            ini = _tela(pagina, CAMPO.ponto(nome))
            fim = _imagem_para_janela(pagina, *map(float, alvos[nome]))
            pagina.mouse.move(ini[0], ini[1])
            pagina.mouse.down()
            pagina.mouse.move(fim[0], fim[1], steps=12)
            pagina.mouse.up()
        pagina.screenshot(path=str(shots / "e2e_2_ajustado.png"))
        residuos = pagina.evaluate("editor.residuos().map((r) => r.px)")
        assert max(residuos) < 2.0, residuos

        pagina.check("#ck-lado")
        pagina.click("#salvar")
        pagina.wait_for_function(
            "document.querySelector('#erro').textContent === '' && "
            "(window.editor === null || editor.pinos.length === 0)"
        )
        arquivos = list(pasta.rotulos(pid, "camera").glob("*__A01__v1.json"))
        assert len(arquivos) == 1
        r = ler_json(arquivos[0], RotuloCamera)
        assert r.situacao == "ok" and r.residuo_mediano_px < 2.0 and r.segundos_ativos >= 0
        cam_r = r.camera
        assert abs(cam_r.pan - cam_v.ptr[0]) < 0.3 and abs(cam_r.tilt - cam_v.ptr[1]) < 0.3
        assert abs(cam_r.hfov_graus - cam_v.hfov) < 0.5

        # revisão cruzada às cegas por outra pessoa
        pagina.goto(url + "/")
        pagina.select_option("#pessoa", "A02")
        pagina.wait_for_function("document.querySelector('#st-revisao').textContent.includes('esperando')")
        pagina.click("#ir-revisao")
        pagina.wait_for_selector("#aprovar", state="visible")
        pagina.screenshot(path=str(shots / "e2e_3_revisao.png"))
        assert "A01" not in pagina.inner_text("body")
        pagina.click("#aprovar")
        pagina.wait_for_selector("#vazio", state="visible")
        revs = list(pasta.revisoes(pid, "camera").glob("*__A02__v1.json"))
        assert len(revs) == 1 and ler_json(revs[0], RevisaoCamera).decisao == "aprovar"
        assert not erros, erros
        nav.close()
