"""Ponta a ponta no navegador: importar um vídeo, anotar arrastando o molde, revisar às cegas e
unificar em Python os arquivos que a página gravou.

Roda só com `pytest -m e2e`; precisa do Playwright com o Chromium e do ffmpeg (para o vídeo de
teste em AV1 ou VP9 — o Chromium do Playwright não decodifica H.264). A página usa o armazenamento
do navegador; a escolha de pasta é simulada com uma pasta dentro dele.
"""

from __future__ import annotations

import base64
import functools
import hashlib
import json
import os
import threading
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
import pytest

from anotacao.camera import Camera
from anotacao.campo import Campo
from anotacao.cli import main
from anotacao.formatos import Fila, GabaritoCamera, Manifesto, RevisaoCamera, RotuloCamera, Tomadas
from anotacao.pacote import pacote_sintetico

from sintetico import (
    REGISTRO_DA_TOMADA,
    codificadores_ffmpeg,
    codificar,
    gravar_quadros,
    marcar_chaves_falsas,
    renderizar,
)

pytestmark = pytest.mark.e2e
playwright = pytest.importorskip("playwright.sync_api")

WEB = Path(__file__).resolve().parents[2] / "web"
CAMPO = Campo()
PARTIDA = "2026-11-02_estadio-sintetico_time-a-time-b"


class _Silencioso(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def site():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Silencioso, directory=str(WEB)))
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_port}/"
    srv.shutdown()


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    if not codificadores_ffmpeg() & {"libsvtav1", "libvpx-vp9", "libaom-av1"}:
        pytest.skip("precisa do ffmpeg com AV1 ou VP9")
    pasta = tmp_path_factory.mktemp("video")
    verdade = gravar_quadros(pasta / "quadros", pacote_sintetico())
    return codificar(pasta / "quadros", pasta / "jogo.mp4"), verdade


@pytest.fixture
def navegador():
    with playwright.sync_playwright() as p:
        exe = os.environ.get("ANOTACAO_CHROMIUM")  # navegador já instalado, se houver
        nav = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        yield nav
        nav.close()


@pytest.fixture
def capturas(tmp_path) -> Path:
    return Path(os.environ.get("ANOTACAO_CAPTURAS", tmp_path))


def _pagina(nav, erros: list[str]):
    contexto = nav.new_context(viewport={"width": 1400, "height": 860}, bypass_csp=True, accept_downloads=True)
    pagina = contexto.new_page()
    pagina.on("dialog", lambda d: d.accept())
    pagina.on("pageerror", lambda e: erros.append(str(e)))
    return pagina


def _ler(pagina, caminho: str) -> str:
    return pagina.evaluate("async (c) => await (await anotacao.pasta.arquivo(c)).text()", caminho)


def _listar(pagina, diretorio: str) -> list[str]:
    return pagina.evaluate("async (d) => (await anotacao.pasta.listar(d)).map((x) => x.nome)", diretorio)


def _bytes(pagina, caminho: str) -> bytes:
    return base64.b64decode(
        pagina.evaluate(
            """async (c) => {
                const b = new Uint8Array(await (await anotacao.pasta.arquivo(c)).arrayBuffer());
                let s = "";
                for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
                return btoa(s); }""",
            caminho,
        )
    )


def _importar(pagina, site: str, video: Path) -> None:
    """Cria a pasta de exemplo no navegador e importa o vídeo, como na página."""
    pagina.goto(site)
    pagina.click("#btn-navegador")
    pagina.click("#criar-exemplo")
    _escolher_pessoa(pagina, site, "A01")
    pagina.click("#ir-importar")
    pagina.wait_for_selector("#form-importar")
    pagina.fill("input[name=emissora]", "Emissora X")
    pagina.fill("input[name=competicao]", "Estadual")
    pagina.fill("input[name=data_hora]", "2026-11-02T21:30")
    pagina.fill("input[name=mandante]", "Time A")
    pagina.fill("input[name=visitante]", "Time B")
    pagina.check("input[name=chuva]")
    pagina.fill("input[name=alvo]", "10")
    pagina.set_input_files("input[name=video]", str(video))
    pagina.click("#processar")
    pagina.wait_for_function(
        "document.querySelector('#res-importar').textContent.startsWith('Pronto')"
        " || document.querySelector('#erro-importar').textContent !== ''",
        timeout=120_000,
    )
    assert pagina.inner_text("#erro-importar") == ""


def _tela(pagina, X):
    """Posição na janela de um ponto 3D pela câmera atual do editor, ou None."""
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


def _ajustar_molde(pagina, cam_v: Camera, registro: str) -> None:
    """Recomeça pela câmera do registro, abre o molde um pouco fora da verdade (como uma previsão
    imprecisa) e arrasta 5 pontos espalhados até onde a câmera verdadeira os põe."""
    pagina.wait_for_function("window.editor !== undefined && window.editor !== null")
    pagina.select_option("#registro", registro)
    pagina.click("#recomecar")
    assert pagina.evaluate("editor.pinos.length") == 0
    pan, tilt, roll = cam_v.ptr
    pagina.evaluate(
        """async ([hfov, pan, tilt, roll, C]) => {
            const { Camera } = await import("./js/nucleo/camera.js");
            editor.recomecar(Camera.deHfov(hfov, pan, tilt, roll, C, editor.w, editor.h)); }""",
        [cam_v.hfov * 1.08, pan + 2.5, tilt + 1.5, roll, [float(v) for v in cam_v.C]],
    )
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
    residuos = pagina.evaluate("editor.residuos().map((r) => r.px)")
    assert max(residuos) < 2.0, residuos


def _escolher_pessoa(pagina, url: str, codigo: str) -> None:
    pagina.goto(url + "#/")
    pagina.wait_for_selector("#pessoa:not([disabled])")
    pagina.select_option("#pessoa", codigo)
    pagina.wait_for_function(f"localStorage.getItem('anotacao.pessoa') === '{codigo}'")
    pagina.wait_for_selector("#st-camera")


def test_importar_anotar_revisar_e_unificar(site, video, navegador, capturas, tmp_path):
    caminho, verdade = video
    erros: list[str] = []
    pagina = _pagina(navegador, erros)

    # 1) guardar no navegador e criar a pasta de exemplo
    pagina.goto(site)
    pagina.click("#btn-navegador")
    pagina.click("#criar-exemplo")
    _escolher_pessoa(pagina, site, "A01")
    pagina.wait_for_function("document.querySelector('#st-camera').textContent.startsWith('Liberado')")
    pagina.screenshot(path=str(capturas / "e2e_1_central.png"), full_page=True)

    # 2) importar o vídeo no navegador
    pagina.click("#ir-importar")
    pagina.wait_for_selector("#form-importar")
    pagina.fill("input[name=emissora]", "Emissora X")
    pagina.fill("input[name=competicao]", "Estadual")
    pagina.fill("input[name=data_hora]", "2026-11-02T21:30")
    pagina.fill("input[name=mandante]", "Time A")
    pagina.fill("input[name=visitante]", "Time B")
    pagina.check("input[name=chuva]")
    pagina.fill("input[name=alvo]", "10")
    pagina.set_input_files("input[name=video]", str(caminho))
    pagina.click("#processar")
    pagina.wait_for_function(
        "document.querySelector('#res-importar').textContent.startsWith('Pronto')", timeout=120_000
    )
    pagina.screenshot(path=str(capturas / "e2e_2_importado.png"))
    man = Manifesto.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/manifesto.json"))
    tomadas = Tomadas.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/tomadas.json"))
    fila = Fila.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/fila.json"))
    assert man.cadastro.chuva is True and man.cadastro.data_hora.isoformat().startswith("2026-11-02T21:30")
    assert man.video.n_quadros == 150 and (man.video.largura, man.video.altura) == (640, 360)
    assert man.video.sha256 == hashlib.sha256(caminho.read_bytes()).hexdigest()
    assert tomadas.cortes == [50, 100]
    assert len(fila.itens) == 3 and {i.tomada for i in fila.itens} == {0, 1, 2}
    jpgs = _listar(pagina, f"partidas/{PARTIDA}/quadros")
    assert sorted(jpgs) == sorted(f"{i.quadro}.jpg" for i in fila.itens)
    for it in fila.itens:
        assert it.quadro == f"t{round(it.i * 40):010d}"  # 25 fps: PTS = 40 ms por quadro

    # 3) anotar arrastando o molde (o primeiro quadro de A01 na fila)
    item = next(it for it in fila.itens if "A01" in it.atribuido_a)
    pagina.goto(site + "#/camera")
    _ajustar_molde(pagina, verdade[item.i], REGISTRO_DA_TOMADA[item.tomada])
    pagina.screenshot(path=str(capturas / "e2e_3_ajustado.png"))
    pagina.check("#ck-lado")
    pagina.click("#salvar")
    pagina.wait_for_function(
        "document.querySelector('#erro').textContent === '' && (window.editor === null || editor.pinos.length === 0)"
    )
    rotulos = _listar(pagina, f"partidas/{PARTIDA}/rotulos/camera")
    assert rotulos == [f"{item.quadro}__A01__v1.json"]
    r = RotuloCamera.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/rotulos/camera/{rotulos[0]}"))
    cam_v = verdade[item.i]
    assert r.situacao == "ok" and r.residuo_mediano_px < 2.0 and r.segundos_ativos >= 0
    assert abs(r.camera.pan - cam_v.ptr[0]) < 0.3 and abs(r.camera.tilt - cam_v.ptr[1]) < 0.3
    assert abs(r.camera.hfov_graus - cam_v.hfov) < 0.5

    # 4) revisão cruzada às cegas por outra pessoa
    _escolher_pessoa(pagina, site, "A02")
    pagina.wait_for_function("document.querySelector('#st-revisao').textContent.includes('esperando')")
    pagina.click("#ir-revisao")
    pagina.wait_for_selector("#aprovar", state="visible")
    pagina.screenshot(path=str(capturas / "e2e_4_revisao.png"))
    assert "A01" not in pagina.inner_text("main")
    pagina.click("#aprovar")
    pagina.wait_for_selector("#vazio", state="visible")
    revisoes = _listar(pagina, f"partidas/{PARTIDA}/revisoes/camera")
    assert revisoes == [f"{item.quadro}__A02__v1.json"]
    rev = RevisaoCamera.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/revisoes/camera/{revisoes[0]}"))
    assert rev.decisao == "aprovar" and rev.rotulo == rotulos[0]

    # 5) placar e cópia da pasta em .zip
    pagina.goto(site + "#/")
    pagina.wait_for_function("document.querySelectorAll('#placar tbody tr td').length > 1")
    linhas = pagina.eval_on_selector_all(
        "#placar tbody tr", "trs => trs.map(tr => [...tr.children].map(td => td.textContent))"
    )
    a01 = next((x for x in linhas if x[0].startswith("A01")), None)
    assert a01 is not None and a01[2] == "1", linhas
    pagina.screenshot(path=str(capturas / "e2e_5_placar.png"), full_page=True)
    with pagina.expect_download() as baixado:
        pagina.click("#baixar-tudo")
    zip_path = tmp_path / "pasta.zip"
    baixado.value.save_as(zip_path)

    # 6) o Python lê, valida e unifica o que o navegador gravou
    destino = tmp_path / "trabalho"
    with zipfile.ZipFile(zip_path) as z:
        assert z.testzip() is None
        z.extractall(destino)
    assert main(["validar", "--pasta", str(destino)]) == 0
    assert main(["unificar", "--pasta", str(destino)]) == 0
    conjunto = next((destino / "conjuntos").iterdir())
    df = pd.read_parquet(conjunto / "camera.parquet")
    assert len(df) == 1
    assert (df.loc[0, "anotador"], df.loc[0, "revisor"], df.loc[0, "decisao"]) == ("A01", "A02", "aprovar")
    assert json.loads((conjunto / "manifesto.json").read_text(encoding="utf-8"))["por_conjunto"] == {"treino": 1}

    # 7) trazer o mesmo .zip de volta não sobrescreve nada
    pagina.set_input_files("#trazer-zip", str(zip_path))
    pagina.wait_for_function("document.querySelector('#res-pasta').textContent.includes('já existiam')")
    assert pagina.inner_text("#res-pasta").startswith("0 arquivo(s) novo(s)")
    assert not erros, erros


def test_quadros_marcados_como_chave_sem_ser(site, video, navegador, tmp_path):
    """O MP4 marca como chave quadros que não são (como os quadros I de H.264 que não são IDR) e o
    navegador recusa começar a decodificar neles: a leitura começa no primeiro que ele aceita, e a
    extração volta até um começo aceito. Cada JPEG continua sendo o quadro certo."""
    origem, _ = video
    caminho = tmp_path / "chaves_falsas.mp4"
    antes, depois = marcar_chaves_falsas(origem, caminho)
    erros: list[str] = []
    pagina = _pagina(navegador, erros)
    _importar(pagina, site, caminho)

    man = Manifesto.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/manifesto.json"))
    fila = Fila.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/fila.json"))
    aceita = depois[1] - 1  # a única chave de verdade antes das falsas (índice a partir de 0)
    assert "importando.json" not in _listar(pagina, f"partidas/{PARTIDA}")  # a marca some no fim
    assert man.pre_processamento.parametros["quadros_sem_chave_no_inicio"] == aceita
    assert man.pre_processamento.parametros["quadros_perdidos"] == 0
    assert man.pre_processamento.parametros["quadros_nao_extraidos"] == 0
    assert len(fila.itens) == 3 and all(it.i >= aceita for it in fila.itens)
    # algum quadro sorteado está num grupo que começa numa chave falsa: a extração teve de voltar
    marcadas = [e - 1 for e in depois]
    falsas = set(marcadas) - {e - 1 for e in antes}
    assert any(max(m for m in marcadas if m <= it.i) in falsas for it in fila.itens)
    quadros = origem.parent / "quadros"
    for it in fila.itens:
        jpg = _bytes(pagina, f"partidas/{PARTIDA}/quadros/{it.quadro}.jpg")
        img = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
        psnr = {k: cv2.PSNR(img, cv2.imread(str(quadros / f"{k:05d}.png"))) for k in range(it.i - 2, it.i + 3)}
        assert max(psnr, key=psnr.get) == it.i, psnr
    assert not erros, erros


def test_politica_de_seguranca_nao_bloqueia_nada(site, video, navegador):
    """Com a CSP ligada (os outros testes a desligam para poder rodar JavaScript na página), as vistas
    abrem e a importação roda no worker sem nenhuma violação nem erro no console."""
    contexto = navegador.new_context(viewport={"width": 1400, "height": 860})
    pagina = contexto.new_page()
    avisos: list[str] = []
    pagina.on("console", lambda m: avisos.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pagina.on("pageerror", lambda e: avisos.append(str(e)))
    pagina.goto(site)
    pagina.click("#btn-navegador")
    pagina.click("#criar-exemplo")
    pagina.wait_for_selector("#pessoa:not([disabled])")
    pagina.select_option("#pessoa", "A01")
    pagina.goto(site + "#/importar")
    pagina.fill("input[name=emissora]", "Emissora X")
    pagina.fill("input[name=competicao]", "Estadual")
    pagina.fill("input[name=data_hora]", "2026-11-02T21:30")
    pagina.fill("input[name=mandante]", "Time A")
    pagina.fill("input[name=visitante]", "Time B")
    pagina.fill("input[name=alvo]", "10")
    pagina.set_input_files("input[name=video]", str(video[0]))
    pagina.click("#processar")
    pagina.wait_for_selector("#res-importar:has-text('Pronto'), #erro-importar:not(:empty)", timeout=120_000)
    assert pagina.inner_text("#erro-importar") == ""
    for rota, seletor in [
        ("#/camera", "#painel:not([hidden]), #vazio:not([hidden])"),
        ("#/revisao", "#vazio:not([hidden])"),
        ("#/coordenacao", "#equipe"),
        ("#/", "#placar tbody td"),
    ]:
        pagina.goto(site + rota)
        pagina.wait_for_selector(seletor)
    assert not avisos, avisos
    contexto.close()


def test_treino_com_gabarito(site, navegador, capturas, tmp_path):
    """Quem começa anota o gabarito e vê na hora a diferença para a câmera verdadeira."""
    pacote = pacote_sintetico()
    origem = tmp_path / "gabarito"
    origem.mkdir()
    cams = {}
    for k in range(2):
        cam = Camera.look_at(np.asarray(pacote.cameras[0].T, float), [-20 + 10 * k, 4.0, 0], 32, 640, 360)
        gid = f"g{k + 1:04d}"
        cv2.imwrite(str(origem / f"{gid}.jpg"), renderizar(cam, CAMPO, pacote, k))
        g = GabaritoCamera(
            id=gid,
            pacote=pacote.ref,
            imagem=f"{gid}.jpg",
            largura=640,
            altura=360,
            camera=cam.para_rotulo(),
            origem="simulador",
        )
        (origem / f"{gid}.json").write_text(g.model_dump_json(), encoding="utf-8")
        cams[gid] = cam
    erros: list[str] = []
    pagina = _pagina(navegador, erros)
    pagina.goto(site)
    pagina.click("#btn-navegador")
    pagina.click("#criar-exemplo")
    pagina.wait_for_selector("#pessoa:not([disabled])")
    pagina.goto(site + "#/coordenacao")
    pagina.wait_for_selector("#st-gabarito")
    pagina.set_input_files("#arquivos-gabarito", sorted(str(p) for p in origem.iterdir()))
    pagina.wait_for_function("document.querySelector('#erro-gabarito').textContent.startsWith('2 item')")
    _escolher_pessoa(pagina, site, "A01")
    pagina.wait_for_function("document.querySelector('#st-camera').textContent.startsWith('Em treino')")
    pagina.click("#ir-camera")
    pagina.wait_for_selector("#treino", state="visible")
    gid = pagina.evaluate("anotacao.indice.itensGabarito().then((g) => g.map((x) => x.id))")
    ids = _listar(pagina, "gabarito/itens")
    assert sorted(ids) == ["g0001.jpg", "g0001.json", "g0002.jpg", "g0002.json"]
    # qual item abriu: o que tem a imagem igual à do editor
    tamanho = pagina.evaluate("[editor.w, editor.h]")
    assert tamanho == [640, 360]
    atual = None
    for g in gid:
        ref = cv2.imread(str(origem / f"{g}.jpg"))
        b64 = pagina.evaluate(
            "() => { const c = document.createElement('canvas'); c.width = editor.w; c.height = editor.h;"
            " c.getContext('2d').drawImage(editor.img, 0, 0); return c.toDataURL('image/png').split(',')[1]; }"
        )
        mostrado = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR)
        if cv2.PSNR(mostrado, ref) > 35:
            atual = g
    assert atual in cams
    _ajustar_molde(pagina, cams[atual], "principal")
    pagina.check("#ck-lado")
    pagina.click("#salvar")
    pagina.wait_for_selector("#modal", state="visible")
    assert pagina.inner_text("#modal-titulo") == "Dentro da tolerância"
    assert "Faltam acertos no gabarito (1/10" in pagina.inner_text("#modal-texto")
    pagina.screenshot(path=str(capturas / "e2e_6_treino.png"))
    rot = _listar(pagina, "gabarito/rotulos/camera")
    assert rot == [f"{atual}__A01__v1.json"]
    assert not erros, erros


def test_pasta_escolhida_e_lembrada(site, navegador):
    """A pasta escolhida fica lembrada: ao voltar, a página abre direto nela."""
    erros: list[str] = []
    pagina = _pagina(navegador, erros)
    pagina.add_init_script(
        "window.showDirectoryPicker = async () =>"
        " (await navigator.storage.getDirectory()).getDirectoryHandle('pasta-da-equipe', { create: true });"
    )
    pagina.goto(site)
    pagina.click("#btn-escolher")
    pagina.wait_for_selector("#aviso-vazia", state="visible")
    assert "pasta-da-equipe" in pagina.inner_text("#nome-vazia")
    pagina.click("#criar-exemplo")
    pagina.wait_for_selector("#pessoa:not([disabled])")
    pagina.reload()
    pagina.wait_for_selector("#pessoa:not([disabled])")
    assert "pasta-da-equipe" in pagina.inner_text("#pasta-nome")
    pagina.click("#trocar-pasta")
    pagina.wait_for_selector("#btn-escolher")
    assert not erros, erros


@pytest.fixture(scope="module")
def site_montado(tmp_path_factory):
    """O site como o GitHub Pages publica (com a lista de arquivos para o trabalho offline)."""
    import subprocess
    import sys

    destino = tmp_path_factory.mktemp("site") / "_site"
    subprocess.run([sys.executable, str(WEB.parent / "scripts" / "montar_site.py"), str(destino)], check=True)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Silencioso, directory=str(destino)))
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_port}/"
    srv.shutdown()


def test_funciona_sem_internet(site_montado, navegador):
    """Depois da primeira visita, o site abre e importa sem rede (o service worker guardou tudo)."""
    erros: list[str] = []
    pagina = _pagina(navegador, erros)
    pagina.goto(site_montado)
    pagina.wait_for_selector("#btn-navegador")
    pagina.wait_for_function("navigator.serviceWorker.ready.then(() => true)")
    pagina.wait_for_function(
        "caches.open('anotacao-site').then((c) => c.keys())"
        ".then((k) => k.some((r) => r.url.endsWith('trabalhador.js')))"
    )
    pagina.context.set_offline(True)
    pagina.reload()
    pagina.wait_for_selector("#btn-navegador")
    pagina.click("#btn-navegador")
    pagina.click("#criar-exemplo")
    pagina.wait_for_selector("#pessoa:not([disabled])")
    assert pagina.evaluate("anotacao.pasta.listarPacotes()") == ["estadio-sintetico/pacote-1.0"]
    pagina.context.set_offline(False)
    assert not erros, erros
