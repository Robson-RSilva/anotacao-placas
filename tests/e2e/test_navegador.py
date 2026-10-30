"""Ponta a ponta no navegador: importar um vídeo (inteiro ou só uns trechos), marcar os pontos e pintar
os jogadores direto na imagem, descartar, revisar às cegas, fazer o teste do gabarito e unificar em
Python os arquivos que a página gravou.

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

from anotacao.cli import main
from anotacao.formatos import (
    Fila,
    GabaritoJogadores,
    GabaritoPontos,
    Manifesto,
    RevisaoPontos,
    RotuloJogadores,
    RotuloPontos,
    Tomadas,
)
from anotacao.mascara import gravar_png, ler_png

from conftest import PLANOS
from sintetico import Camera, codificadores_ffmpeg, codificar, gravar_quadros, marcar_chaves_falsas, renderizar

pytestmark = pytest.mark.e2e
playwright = pytest.importorskip("playwright.sync_api")

WEB = Path(__file__).resolve().parents[2] / "web"
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
    verdade = gravar_quadros(pasta / "quadros")
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


def _preencher_importacao(pagina, video: Path, trechos: str = "") -> None:
    """O formulário de importação como a pessoa preenche."""
    pagina.wait_for_selector("#form-importar")
    pagina.fill("input[name=estadio]", "Estádio Sintético")
    pagina.fill("input[name=emissora]", "Emissora X")
    pagina.fill("input[name=competicao]", "Estadual")
    pagina.fill("input[name=data_hora]", "2026-11-02T21:30")
    pagina.fill("input[name=mandante]", "Time A")
    pagina.fill("input[name=visitante]", "Time B")
    pagina.check("input[name=chuva]")
    pagina.fill("input[name=alvo]", "10")
    pagina.fill("input[name=trechos]", trechos)
    pagina.set_input_files("input[name=video]", str(video))


def _processar(pagina) -> str:
    """Manda processar e espera terminar; devolve o erro mostrado ('' quando deu certo)."""
    pagina.click("#processar")
    pagina.wait_for_function(
        "document.querySelector('#res-importar').textContent.startsWith('Pronto')"
        " || document.querySelector('#erro-importar').textContent !== ''",
        timeout=120_000,
    )
    return pagina.inner_text("#erro-importar")


def _criar_pasta(pagina, site: str) -> None:
    pagina.goto(site)
    pagina.click("#btn-navegador")
    pagina.click("#criar-vazia")
    pagina.wait_for_selector("#pessoa:not([disabled])")


def _importar(pagina, site: str, video: Path, trechos: str = "") -> None:
    """Cria a pasta no navegador e importa o vídeo, como na página."""
    _criar_pasta(pagina, site)
    _escolher_pessoa(pagina, site, "A01")
    pagina.click("#ir-importar")
    _preencher_importacao(pagina, video, trechos)
    assert _processar(pagina) == ""


def _escolher_pessoa(pagina, url: str, codigo: str) -> None:
    """Digita o código no alto da página central (não há equipe cadastrada) e espera a central dele."""
    pagina.goto(url + "#/")
    pagina.wait_for_selector("#pessoa:not([disabled])")
    pagina.fill("#pessoa", codigo)
    pagina.press("#pessoa", "Enter")
    pagina.wait_for_function(f"localStorage.getItem('anotacao.pessoa') === '{codigo}'")
    pagina.wait_for_selector(f"#aviso-codigo[data-codigo='{codigo}']", state="attached")


def _bate_com_o_video(pagina, fila: Fila, quadros: Path) -> None:
    """Cada JPEG gravado é o quadro certo do vídeo (o mais parecido entre os vizinhos)."""
    for it in fila.itens:
        jpg = _bytes(pagina, f"partidas/{PARTIDA}/quadros/{it.quadro}.jpg")
        img = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
        psnr = {k: cv2.PSNR(img, cv2.imread(str(quadros / f"{k:05d}.png"))) for k in range(it.i - 2, it.i + 3)}
        assert max(psnr, key=psnr.get) == it.i, psnr


# ---------------------------------------------------------------- marcar e pintar com o mouse


def _janela(pagina, objeto: str, x: float, y: float) -> tuple[float, float]:
    """Um ponto da imagem na janela, pela vista atual do marcador ou do pintor (`objeto`)."""
    return tuple(
        pagina.evaluate(
            f"([x, y]) => {{ const [sx, sy] = {objeto}.paraTela(x, y); const r = {objeto}.cv.getBoundingClientRect();"
            " return [r.left + sx, r.top + sy]; }",
            [x, y],
        )
    )


def _marcar(pagina, nome: str, x: float, y: float, *, imagem_primeiro: bool = False) -> None:
    """Marca um ponto: escolhe no mapa e clica na imagem (ou clica na imagem e depois no mapa)."""
    alvo = _janela(pagina, "marcador", x, y)
    if imagem_primeiro:
        pagina.mouse.click(*alvo)
        assert pagina.evaluate("marcador.pendente") is not None
        pagina.click(f"[data-ponto={nome}]")
    else:
        pagina.click(f"[data-ponto={nome}]")
        assert pagina.evaluate("marcador.selecionado") == nome
        pagina.mouse.click(*alvo)
    pagina.wait_for_function("(n) => marcador.pontos.has(n) && !marcador.pendente", arg=nome)


def _pontos_visiveis(verdade: dict, n: int, margem: float = 12, longe: float = 14) -> dict:
    """Até n pontos que caem bem dentro da imagem (longe da borda) e longe uns dos outros."""
    out = {}
    for k, v in verdade["pontos"].items():
        dentro = margem < v[0] < 640 - margem and margem < v[1] < 360 - margem
        if dentro and all(np.hypot(v[0] - o[0], v[1] - o[1]) >= longe for o in out.values()):
            out[k] = v
        if len(out) == n:
            break
    return out


def _verdade_do_quadro(pagina, fila: Fila, verdade: list[dict], janela: str) -> dict:
    quadro = pagina.evaluate(f"{janela}.quadro")
    return verdade[next(it.i for it in fila.itens if it.quadro == quadro)]


def _laco(pagina, contorno: np.ndarray, *, fechar_no_mouse: bool = True) -> None:
    """Contorna à mão (arrastando) com o laço, e solta onde começou."""
    pagina.keyboard.press("l")
    pts = [_janela(pagina, "pintor", float(x), float(y)) for x, y in contorno]
    pagina.mouse.move(*pts[0])
    pagina.mouse.down()
    for p in [*pts[1:], pts[0]]:
        pagina.mouse.move(*p, steps=3)
    pagina.mouse.up()
    if fechar_no_mouse:
        assert pagina.evaluate("pintor.laco") is None, "o laço à mão livre fecha ao soltar, mesmo onde começou"


def _contornos(mascara: np.ndarray) -> list[np.ndarray]:
    """O contorno de cada jogador da máscara, um pouco por fora (o centro do pixel decide no laço)."""
    m = cv2.dilate(mascara.astype(np.uint8), np.ones((2, 2), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return [c.reshape(-1, 2).astype(float) + 0.5 for c in cs if len(c) >= 3]


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    a, b = a > 0, b > 0
    return float((a & b).sum() / max(1, (a | b).sum()))


# ---------------------------------------------------------------- de ponta a ponta: pontos


def test_importar_marcar_revisar_e_unificar(site, video, navegador, capturas, tmp_path):
    caminho, verdade = video
    erros: list[str] = []
    pagina = _pagina(navegador, erros)

    # 1) guardar no navegador e criar a pasta de trabalho
    _criar_pasta(pagina, site)
    _escolher_pessoa(pagina, site, "A01")
    pagina.wait_for_function("document.querySelector('#st-pontos').textContent.startsWith('Pode anotar')")
    pagina.screenshot(path=str(capturas / "e2e_1_central.png"), full_page=True)

    # 2) importar o vídeo no navegador
    pagina.click("#ir-importar")
    _preencher_importacao(pagina, caminho)
    assert _processar(pagina) == ""
    man = Manifesto.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/manifesto.json"))
    tomadas = Tomadas.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/tomadas.json"))
    fila = Fila.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/fila.json"))
    assert man.pacote is None and man.cadastro.pacote_versao is None
    assert man.cadastro.estadio == "estadio-sintetico"
    assert man.cadastro.chuva is True and man.cadastro.data_hora.isoformat().startswith("2026-11-02T21:30")
    assert man.video.n_quadros == 150 and (man.video.largura, man.video.altura) == (640, 360)
    assert man.video.sha256 == hashlib.sha256(caminho.read_bytes()).hexdigest()
    assert tomadas.cortes == [50, 100]
    assert len(fila.itens) == 3 and {i.tomada for i in fila.itens} == {0, 1, 2}
    assert fila.equipe == [] and all(it.atribuido_a == [] for it in fila.itens)  # fila aberta
    assert "trechos" not in man.pre_processamento.parametros
    for it in fila.itens:
        assert it.quadro == f"t{round(it.i * 40):010d}"  # 25 fps: PTS = 40 ms por quadro

    # 3) marcar os pontos direto na imagem: escolher no mapa e clicar (ou o contrário)
    pagina.goto(site + "#/pontos")
    pagina.wait_for_function("window.itemPontos && window.marcador")
    v = _verdade_do_quadro(pagina, fila, verdade, "itemPontos")
    alvos = _pontos_visiveis(v, 6)
    assert len(alvos) >= 3, alvos
    for k, (nome, (x, y)) in enumerate(alvos.items()):
        _marcar(pagina, nome, x, y, imagem_primeiro=k % 2 == 1)
    assert pagina.inner_text("#n-pontos") == f"({len(alvos)})"
    # apagar com o botão direito e desfazer
    primeiro = next(iter(alvos))
    pagina.mouse.click(*_janela(pagina, "marcador", *alvos[primeiro]), button="right")
    assert not pagina.evaluate("(n) => marcador.pontos.has(n)", primeiro)
    pagina.keyboard.press("Control+z")
    assert pagina.evaluate("(n) => marcador.pontos.has(n)", primeiro)
    # arrastar um ponto para longe e de volta
    a = _janela(pagina, "marcador", *alvos[primeiro])
    pagina.mouse.move(*a)
    pagina.mouse.down()
    pagina.mouse.move(a[0] + 30, a[1] + 20, steps=5)
    pagina.mouse.move(*a, steps=5)
    pagina.mouse.up()
    # girar o mapa não muda os nomes
    pagina.keyboard.press("r")
    assert pagina.evaluate("document.querySelector('.mapa g').getAttribute('transform')") == "rotate(90)"
    pagina.keyboard.press("r")
    pagina.keyboard.press("r")
    pagina.keyboard.press("r")
    pagina.screenshot(path=str(capturas / "e2e_2_pontos.png"))
    quadro_marcado = pagina.evaluate("itemPontos.quadro")
    pagina.keyboard.press("s")
    pagina.wait_for_function("(q) => window.itemPontos && itemPontos.quadro !== q", arg=quadro_marcado)
    # a segunda imagem é descartada
    quadro_descartado = pagina.evaluate("itemPontos.quadro")
    pagina.keyboard.press("d")
    pagina.wait_for_selector("#caixa-descartar", state="visible")
    pagina.click("#confirmar-descartar")
    assert pagina.inner_text("#erro-descartar") == "Escolha o motivo."
    pagina.check("input[name=motivo-descarte][value=outro]")
    pagina.click("#confirmar-descartar")
    assert "comentário" in pagina.inner_text("#erro-descartar")
    pagina.fill("#comentario-descarte", "replay com tela dividida")
    pagina.screenshot(path=str(capturas / "e2e_3_descartar.png"))
    pagina.click("#confirmar-descartar")
    pagina.wait_for_function("(q) => window.itemPontos && itemPontos.quadro !== q", arg=quadro_descartado)
    # a terceira, sem nenhum ponto: a página confirma antes
    quadro_vazio = pagina.evaluate("itemPontos.quadro")
    pagina.click("#salvar")
    pagina.wait_for_selector("#caixa-confirmar", state="visible")
    assert "sem nenhum ponto" in pagina.inner_text("#titulo-confirmar")
    pagina.click("#sim-confirmar")
    pagina.wait_for_selector("#vazio:has-text('Nada para marcar agora')")

    d = f"partidas/{PARTIDA}/rotulos/pontos"
    assert sorted(_listar(pagina, d)) == sorted(
        f"{q}__A01__v1.json" for q in (quadro_marcado, quadro_descartado, quadro_vazio)
    )
    r = RotuloPontos.model_validate_json(_ler(pagina, f"{d}/{quadro_marcado}__A01__v1.json"))
    assert r.situacao == "ok" and {p.ponto for p in r.pontos} == set(alvos)
    for p in r.pontos:
        assert np.hypot(p.x - alvos[p.ponto][0], p.y - alvos[p.ponto][1]) < 1.0, p
    d2 = RotuloPontos.model_validate_json(_ler(pagina, f"{d}/{quadro_descartado}__A01__v1.json"))
    assert (d2.situacao, d2.motivo_descarte, d2.comentario, d2.pontos) == (
        "descartada",
        "outro",
        "replay com tela dividida",
        [],
    )
    assert RotuloPontos.model_validate_json(_ler(pagina, f"{d}/{quadro_vazio}__A01__v1.json")).pontos == []

    # 4) revisão às cegas por outra pessoa: aprovar, corrigir e devolver
    _escolher_pessoa(pagina, site, "A02")
    pagina.wait_for_function("document.querySelector('#st-revisao').textContent.includes('3 de pontos')")
    pagina.click("#ir-revisao-pontos")
    decisoes = {}
    for decisao in ("aprovar", "corrigir", "devolver"):
        pagina.wait_for_function("window.itemRevisao && !document.querySelector('#painel').hidden")
        item = pagina.evaluate("itemRevisao")
        assert "A01" not in pagina.inner_text("main")
        if decisao == "aprovar":
            pagina.screenshot(path=str(capturas / "e2e_4_revisao.png"))
            pagina.keyboard.press("a")
        elif decisao == "corrigir":
            pagina.keyboard.press("c")
            pagina.wait_for_selector("#secao-corrigir", state="visible")
            # a correção, como na página de pontos: apaga um ponto (botão direito) e marca de novo;
            # numa imagem descartada, marca um ponto
            vq = _verdade_do_quadro(pagina, fila, verdade, "itemRevisao")
            pagina.evaluate("window.marcador = revisando")
            marcados = pagina.evaluate("revisando.lista()")
            if marcados:
                nome = marcados[0]["ponto"]
                pagina.mouse.click(*_janela(pagina, "marcador", marcados[0]["x"], marcados[0]["y"]), button="right")
                assert not pagina.evaluate("(n) => revisando.pontos.has(n)", nome)
                x, y = vq["pontos"][nome]
            else:
                nome, (x, y) = next(iter(_pontos_visiveis(vq, 1).items()))
            _marcar(pagina, nome, x, y)
            pagina.click("#salvar-correcao")
        else:
            pagina.keyboard.press("d")
            pagina.select_option("#motivo", "faltou_ponto")
            pagina.fill("#comentario-dev", "faltou o meio-campo")
            pagina.click("#confirmar-devolver")
        decisoes[item["quadro"]] = decisao
        pagina.wait_for_function("(q) => !window.itemRevisao || itemRevisao.quadro !== q", arg=item["quadro"])
    pagina.wait_for_selector("#vazio:has-text('Nenhum rótulo de pontos')")
    revisoes = _listar(pagina, f"partidas/{PARTIDA}/revisoes/pontos")
    assert len(revisoes) == 3
    for nome in revisoes:
        rev = RevisaoPontos.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/revisoes/pontos/{nome}"))
        assert rev.decisao == decisoes[rev.quadro]
        if rev.decisao == "corrigir":
            assert rev.nova_versao == f"{rev.quadro}__A02__v1.json"

    # 5) o devolvido volta primeiro para quem marcou, com o comentário e os pontos de antes
    devolvido = next(q for q, x in decisoes.items() if x == "devolver")
    _escolher_pessoa(pagina, site, "A01")
    pagina.click("#ir-pontos")
    pagina.wait_for_selector("#devolvido:not([hidden])")
    assert "faltou o meio-campo" in pagina.inner_text("#devolvido")
    assert pagina.evaluate("itemPontos.quadro") == devolvido
    antes = RotuloPontos.model_validate_json(_ler(pagina, f"{d}/{devolvido}__A01__v1.json"))
    assert pagina.evaluate("marcador.lista().length") == len(antes.pontos)
    pagina.screenshot(path=str(capturas / "e2e_5_devolvido.png"))
    if antes.situacao == "descartada":
        pagina.click("#descartar")
        pagina.check("input[name=motivo-descarte][value=transicao]")
        pagina.click("#confirmar-descartar")
    else:
        pagina.click("#salvar")
        if not antes.pontos:
            pagina.click("#sim-confirmar")
    pagina.wait_for_selector("#vazio:has-text('Nada para marcar agora')")
    assert f"{devolvido}__A01__v2.json" in _listar(pagina, d)

    # 6) placar e cópia da pasta em .zip
    pagina.goto(site + "#/")
    pagina.wait_for_function("document.querySelectorAll('#placar tbody tr td').length > 1")
    linhas = pagina.eval_on_selector_all(
        "#placar tbody tr", "trs => trs.map(tr => [...tr.children].map(td => td.textContent))"
    )
    a01 = next((x for x in linhas if x[0].startswith("A01")), None)
    assert a01 is not None and a01[2] == "1", linhas  # aprovado só o que A02 aprovou (a correção é dela)
    pagina.screenshot(path=str(capturas / "e2e_6_placar.png"), full_page=True)
    with pagina.expect_download() as baixado:
        pagina.click("#baixar-tudo")
    zip_path = tmp_path / "pasta.zip"
    baixado.value.save_as(zip_path)

    # 7) o Python lê, valida e unifica o que o navegador gravou
    destino = tmp_path / "trabalho"
    with zipfile.ZipFile(zip_path) as z:
        assert z.testzip() is None
        z.extractall(destino)
    assert main(["validar", "--pasta", str(destino)]) == 0
    assert main(["unificar", "--pasta", str(destino)]) == 0
    conjunto = next((destino / "conjuntos").iterdir())
    df = pd.read_parquet(conjunto / "pontos.parquet").set_index("quadro")
    man = json.loads((conjunto / "manifesto.json").read_text(encoding="utf-8"))
    aprovados = {q for q, x in decisoes.items() if x in ("aprovar", "corrigir")}
    entram = {q for q in aprovados if q != quadro_descartado or decisoes[q] == "corrigir"}
    assert set(df.index) == entram
    for q in entram:
        esperado = ("A02", "A02", "corrigir") if decisoes[q] == "corrigir" else ("A01", "A02", "aprovar")
        assert tuple(df.loc[q, ["anotador", "revisor", "decisao"]]) == esperado
    descartes = 1 if decisoes[quadro_descartado] == "aprovar" else 0
    assert man["descartados"]["pontos"] == ({"outro": 1} if descartes else {})
    lista = pd.read_parquet(conjunto / "pontos_lista.parquet")
    assert len(lista) == int(df["n_pontos"].sum())

    # 8) trazer o mesmo .zip de volta não sobrescreve nada
    pagina.set_input_files("#trazer-zip", str(zip_path))
    pagina.wait_for_function("document.querySelector('#res-pasta').textContent.includes('já existiam')")
    assert pagina.inner_text("#res-pasta").startswith("0 arquivo(s) novo(s)")
    assert not erros, erros


# ---------------------------------------------------------------- de ponta a ponta: jogadores


def test_pintar_revisar_e_unificar(site, video, navegador, capturas, tmp_path):
    """Os jogadores de ponta a ponta: pintar com o laço (num quadro) e com o pincel e a borracha (no
    outro), descartar o terceiro; outra pessoa revisa às cegas, aprova e corrige; o `unificar` monta o
    conjunto dos jogadores com as máscaras que a página gravou."""
    caminho, verdade = video
    erros: list[str] = []
    pagina = _pagina(navegador, erros)
    _importar(pagina, site, caminho)
    pagina.goto(site + "#/jogadores")
    feitos = {}
    # 1) o laço em volta de cada jogador
    pagina.wait_for_function("window.itemJogadores && window.pintor")
    fila = Fila.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/fila.json"))
    v = _verdade_do_quadro(pagina, fila, verdade, "itemJogadores")
    for contorno in _contornos(v["jogadores"]):
        _laco(pagina, contorno)
    pintado = np.array(pagina.evaluate("Array.from(pintor.mascara())"), np.uint8).reshape(360, 640)
    assert _iou(pintado, v["jogadores"]) > 0.8
    pagina.screenshot(path=str(capturas / "e2e_7_jogadores.png"))
    q1 = pagina.evaluate("itemJogadores.quadro")
    feitos[q1] = v["jogadores"]
    pagina.keyboard.press("s")
    pagina.wait_for_function("(q) => window.itemJogadores && itemJogadores.quadro !== q", arg=q1)
    # 2) o pincel, a borracha e o desfazer
    q2 = pagina.evaluate("itemJogadores.quadro")
    pagina.keyboard.press("b")
    pagina.evaluate("pintor.raio = 5")
    a, b = _janela(pagina, "pintor", 100, 100), _janela(pagina, "pintor", 140, 100)
    pagina.mouse.move(*a)
    pagina.mouse.down()
    pagina.mouse.move(*b, steps=8)
    pagina.mouse.up()
    n = pagina.evaluate("pintor.pixels()")
    assert n > 200
    pagina.keyboard.press("e")  # borracha
    assert pagina.get_attribute("#borracha", "aria-pressed") == "true"
    c = _janela(pagina, "pintor", 120, 100)
    pagina.mouse.move(*c)
    pagina.mouse.down()
    pagina.mouse.move(c[0], c[1] + 1)
    pagina.mouse.up()
    assert pagina.evaluate("pintor.pixels()") < n
    pagina.keyboard.press("Control+z")
    assert pagina.evaluate("pintor.pixels()") == n
    pagina.keyboard.press("e")
    pagina.keyboard.press("s")
    pagina.wait_for_function("(q) => window.itemJogadores && itemJogadores.quadro !== q", arg=q2)
    # 3) descartar
    q3 = pagina.evaluate("itemJogadores.quadro")
    pagina.click("#descartar")
    pagina.check("input[name=motivo-descarte][value=borrao]")
    pagina.click("#confirmar-descartar")
    pagina.wait_for_selector("#vazio:has-text('Nada para pintar agora')")
    d = f"partidas/{PARTIDA}/rotulos/jogadores"
    assert sorted(_listar(pagina, d)) == sorted(
        [
            f"{q1}__A01__v1.json",
            f"{q1}__A01__v1.png",
            f"{q2}__A01__v1.json",
            f"{q2}__A01__v1.png",
            f"{q3}__A01__v1.json",
        ]
    )
    r1 = RotuloJogadores.model_validate_json(_ler(pagina, f"{d}/{q1}__A01__v1.json"))
    m1 = ler_png(_bytes(pagina, f"{d}/{r1.mascara}"))
    assert m1.shape == (360, 640) and set(np.unique(m1)) <= {0, 1} and int(m1.sum()) == r1.pixels
    assert _iou(m1, feitos[q1]) > 0.8
    r3 = RotuloJogadores.model_validate_json(_ler(pagina, f"{d}/{q3}__A01__v1.json"))
    assert (r3.situacao, r3.motivo_descarte, r3.mascara) == ("descartada", "borrao", None)

    # 4) outra pessoa revisa às cegas: corrige a pintura do pincel, aprova as outras
    _escolher_pessoa(pagina, site, "A02")
    pagina.click("#ir-revisao-jogadores")
    corrigido = None
    for _ in range(3):
        pagina.wait_for_function("window.itemRevisao && !document.querySelector('#painel').hidden")
        q = pagina.evaluate("itemRevisao.quadro")
        if q == q2:
            pagina.keyboard.press("c")
            pagina.wait_for_selector("#secao-corrigir", state="visible")
            pagina.evaluate("window.pintor = revisando")
            vq = verdade[next(it.i for it in fila.itens if it.quadro == q)]
            pagina.evaluate("pintor.definir(null)")  # apaga tudo e pinta de novo
            for contorno in _contornos(vq["jogadores"]):
                _laco(pagina, contorno)
            pagina.fill("#comentario-corr", "a pintura não era de jogador")
            pagina.click("#salvar-correcao")
            corrigido = q
        else:
            if q == q3:
                assert pagina.inner_text("#r-situacao").startswith("Descartada")
            pagina.keyboard.press("a")
        pagina.wait_for_function("(q) => !window.itemRevisao || itemRevisao.quadro !== q", arg=q)
    pagina.wait_for_selector("#vazio:has-text('Nenhuma pintura')")
    assert corrigido == q2
    assert f"{q2}__A02__v1.png" in _listar(pagina, d)

    # 5) o Python lê o que a página gravou
    raiz = tmp_path / "copia"
    for caminho_arq, dados in _arquivos(pagina).items():
        (raiz / caminho_arq).parent.mkdir(parents=True, exist_ok=True)
        (raiz / caminho_arq).write_bytes(dados)
    assert main(["validar", "--pasta", str(raiz)]) == 0
    assert main(["unificar", "--pasta", str(raiz)]) == 0
    conjunto = next((raiz / "conjuntos").iterdir())
    df = pd.read_parquet(conjunto / "jogadores.parquet").set_index("quadro")
    assert set(df.index) == {q1, q2}
    assert tuple(df.loc[q2, ["anotador", "decisao"]]) == ("A02", "corrigir")
    assert df.loc[q1, "mascara"] == f"partidas/{PARTIDA}/rotulos/jogadores/{q1}__A01__v1.png"
    man = json.loads((conjunto / "manifesto.json").read_text(encoding="utf-8"))
    assert man["descartados"]["jogadores"] == {"borrao": 1}
    assert not erros, erros


# ---------------------------------------------------------------- o teste do gabarito


def _lote_de_ouro(destino: Path) -> tuple[Path, dict]:
    """Um lote de ouro pequeno: 2 itens dos pontos e 1 dos jogadores (com uma "outra pessoa")."""
    lote = destino / "ouro-teste.zip"
    verdades = {}
    with zipfile.ZipFile(lote, "w") as z:
        for gid, (C, alvo, hfov) in zip(["g1901", "g2901", "g1902"], PLANOS, strict=True):
            cam = Camera.look_at(C, alvo, hfov, 640, 360)
            img, v = renderizar(cam, int(gid[1:]))
            z.writestr(
                f"gabarito/itens/{gid}.jpg", cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()
            )
            if gid.startswith("g1"):
                g = GabaritoPontos(
                    id=gid,
                    lote="T1-teste",
                    imagem=f"{gid}.jpg",
                    largura=640,
                    altura=360,
                    pontos=[{"ponto": n, "x": x, "y": y, "visivel": True} for n, (x, y) in v["pontos"].items()],
                    origem="simulador",
                )
            else:
                n, rot = cv2.connectedComponents(v["jogadores"])
                rot = rot.astype(np.uint8)
                rot[rot == n - 1] = 255  # o último "jogador" vira uma outra pessoa
                z.writestr(f"gabarito/itens/{gid}.png", gravar_png(rot, [(i, i, i) for i in range(256)]))
                g = GabaritoJogadores(
                    id=gid,
                    lote="T2-teste",
                    imagem=f"{gid}.jpg",
                    mascara=f"{gid}.png",
                    largura=640,
                    altura=360,
                    jogadores=n - 2,
                    outras_pessoas=1,
                    origem="simulador",
                )
                v = {**v, "jogadores": ((rot >= 1) & (rot <= n - 2)).astype(np.uint8)}
            z.writestr(f"gabarito/itens/{gid}.json", g.model_dump_json())
            verdades[gid] = v
    return lote, verdades


def test_teste_do_gabarito(site, navegador, capturas, tmp_path):
    """O lote de ouro entra pela página do gabarito; quem começa vê "Fazer o teste", anota as imagens
    com resposta e vê na hora o resultado e a resposta; a página do gabarito mostra os resultados e
    abre cada um ("Ver")."""
    lote, verdades = _lote_de_ouro(tmp_path)
    erros: list[str] = []
    pagina = _pagina(navegador, erros)
    _criar_pasta(pagina, site)
    _escolher_pessoa(pagina, site, "A01")
    pagina.click("#ir-gabarito")
    pagina.wait_for_selector("#lotes tbody td")
    assert "Nenhum lote" in pagina.inner_text("#lotes")
    pagina.set_input_files("#importar-lote", str(lote))
    pagina.wait_for_function("document.querySelector('#res-lote').textContent.startsWith('7 arquivo(s) novo(s)')")
    pagina.wait_for_function("document.querySelector('#lotes').textContent.includes('T1-teste')")
    linhas = pagina.eval_on_selector_all(
        "#lotes tbody tr", "trs => trs.map(tr => [...tr.children].map(td => td.textContent))"
    )
    assert linhas == [["T1-teste", "pontos", "2", "g1901 a g1902"], ["T2-teste", "jogadores", "1", "g2901 a g2901"]]
    pagina.wait_for_function("document.querySelector('[data-tarefa=pontos] .st').textContent.startsWith('Em teste')")
    pagina.screenshot(path=str(capturas / "e2e_8_gabarito.png"), full_page=True)
    pagina.goto(site + "#/")
    pagina.wait_for_function("document.querySelector('#ir-pontos').textContent === 'Fazer o teste'")

    # pontos: marca a resposta no primeiro, erra o nome no segundo
    pagina.click("#ir-pontos")
    certo = None
    for k in range(2):
        pagina.wait_for_selector("#treino:not([hidden])")
        pagina.wait_for_function("window.itemPontos && itemPontos.treino")
        gid = pagina.evaluate("itemPontos.quadro")
        certo = certo or gid
        alvos = _pontos_visiveis(verdades[gid], 99, margem=1, longe=0)  # todos: a cobertura conta
        nomes = list(alvos)
        for nome in nomes:
            x, y = alvos[nome]
            if k == 1 and nome == nomes[0]:
                nome = "penalti_dir" if nome != "penalti_dir" else "penalti_esq"  # o nome errado
            _marcar(pagina, nome, x, y)
        pagina.keyboard.press("s")
        pagina.wait_for_selector("#resultado:not([hidden])")
        titulo = pagina.inner_text("#resultado-titulo")
        assert titulo == ("Certo" if k == 0 else "Errado"), pagina.inner_text("#resultado-texto")
        if k == 0:
            assert "Para a liberação" in pagina.inner_text("#resultado-texto")
            pagina.screenshot(path=str(capturas / "e2e_9_resultado_pontos.png"))
            pagina.keyboard.press("v")
            assert pagina.inner_text("#ver-resposta") == "Ver o meu"
            pagina.keyboard.press("v")
        else:
            assert "nome trocado" in pagina.inner_text("#resultado-texto")
        pagina.keyboard.press("n")
    pagina.wait_for_selector("#vazio:has-text('acabou antes da liberação')")
    assert sorted(_listar(pagina, "gabarito/rotulos/pontos")) == ["g1901__A01__v1.json", "g1902__A01__v1.json"]

    # jogadores: pinta a resposta com o laço
    pagina.goto(site + "#/jogadores")
    pagina.wait_for_function("window.itemJogadores && itemJogadores.treino && window.pintor")
    for contorno in _contornos(verdades["g2901"]["jogadores"]):
        _laco(pagina, contorno)
    pagina.keyboard.press("s")
    pagina.wait_for_selector("#resultado:not([hidden])")
    assert pagina.inner_text("#resultado-titulo") == "Certo", pagina.inner_text("#resultado-texto")
    pagina.screenshot(path=str(capturas / "e2e_10_resultado_jogadores.png"))
    pagina.click("#ver-resposta")
    assert pagina.inner_text("#ver-resposta") == "Ver a minha pintura"
    pagina.click("#ver-resposta")
    assert pagina.inner_text("#ver-resposta") == "Ver o resultado"

    # a página do gabarito: os resultados, e "Ver" abre o item com a resposta
    pagina.goto(site + "#/gabarito")
    pagina.wait_for_function("document.querySelectorAll('#resultados tbody tr').length === 2")
    linhas = pagina.eval_on_selector_all("#resultados tbody tr", "trs => trs.map(tr => tr.children[4].textContent)")
    assert sorted(linhas) == ["certo", "errado"]
    pagina.click(f"#resultados tbody tr:has-text('{certo}') a:has-text('Ver')")
    pagina.wait_for_selector("#resultado:not([hidden])")
    assert pagina.inner_text("#resultado-titulo") == "Certo"
    assert pagina.is_visible("#voltar-gabarito") and pagina.is_hidden("#proximo")
    pagina.click("#voltar-gabarito")
    pagina.wait_for_selector("[data-res=jogadores]")
    pagina.click("[data-res=jogadores]")
    pagina.wait_for_function("document.querySelector('#resultados tbody').textContent.includes('g2901')")
    assert not erros, erros


# ---------------------------------------------------------------- duas pessoas, dois computadores


def _arquivos(pagina) -> dict[str, bytes]:
    """Todos os arquivos da pasta de trabalho deste navegador: caminho -> conteúdo."""
    lista = pagina.evaluate(
        """async () => {
            const out = [];
            async function andar(alca, prefixo) {
                for await (const [nome, h] of alca.entries()) {
                    const caminho = prefixo ? `${prefixo}/${nome}` : nome;
                    if (h.kind === "directory") { await andar(h, caminho); continue; }
                    if (nome.endsWith(".crswap")) continue;
                    const b = new Uint8Array(await (await h.getFile()).arrayBuffer());
                    let s = "";
                    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
                    out.push([caminho, btoa(s)]);
                }
            }
            await andar(anotacao.pasta.raiz, "");
            return out;
        }"""
    )
    return {c: base64.b64decode(b) for c, b in lista}


def _sincronizar(origem, destino) -> int:
    """Faz o papel do Drive: o que é novo ou mudou na pasta de um computador chega na do outro."""
    no_destino = _arquivos(destino)
    novos = [[c, base64.b64encode(d).decode()] for c, d in _arquivos(origem).items() if no_destino.get(c) != d]
    destino.evaluate(
        """async (arquivos) => {
            for (const [caminho, b64] of arquivos) {
                const s = atob(b64);
                const b = new Uint8Array(s.length);
                for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
                await anotacao.pasta.escrever(caminho, b, { sobrescrever: true });
            }
        }""",
        novos,
    )
    return len(novos)


def _sem_pontos(pagina) -> None:
    """Salva a imagem aberta sem nenhum ponto (rápido, com a confirmação)."""
    pagina.wait_for_function("window.itemPontos && !document.querySelector('#painel').hidden")
    antes = pagina.evaluate("itemPontos.quadro")
    pagina.click("#salvar")
    pagina.click("#sim-confirmar")
    pagina.wait_for_function("(a) => !window.itemPontos || itemPontos.quadro !== a", arg=antes)


def test_dois_computadores_na_pasta_sincronizada(site, video, navegador, capturas):
    """Cada pessoa no seu computador, com a mesma pasta sincronizada (aqui, dois navegadores separados
    e o papel do Drive feito à mão): Ana marca, Bruno revisa no dele e devolve, Ana recebe de volta. As
    páginas paradas sem nada a fazer pegam sozinhas o que chega."""
    caminho, _ = video
    erros: list[str] = []
    ana = _pagina(navegador, erros)
    bruno = _pagina(navegador, erros)
    _importar(ana, site, caminho)
    ana.evaluate("anotacao.intervaloAtualizar = 300")  # nos testes, a página parada confere a cada 0,3 s
    # o computador do Bruno abre a pasta antes de o Drive terminar de trazer os arquivos
    bruno.goto(site)
    bruno.evaluate("anotacao.intervaloAtualizar = 300")
    bruno.click("#btn-navegador")
    bruno.wait_for_selector("#aviso-vazia", state="visible")
    assert _sincronizar(ana, bruno) > 0
    _escolher_pessoa(bruno, site, "B02")  # a central aparece sozinha quando a pasta chega
    assert bruno.is_hidden("#aviso-codigo")
    bruno.goto(site + "#/revisao-pontos")
    bruno.wait_for_selector("#vazio:has-text('Nenhum rótulo')")
    # a Ana marca os três quadros da partida
    ana.goto(site + "#/pontos")
    for _ in range(3):
        _sem_pontos(ana)
    ana.wait_for_selector("#vazio:has-text('Nada para marcar agora')")
    assert len(_listar(ana, f"partidas/{PARTIDA}/rotulos/pontos")) == 3
    # chegam no computador do Bruno: a revisão, parada, acha os rótulos sem recarregar
    _sincronizar(ana, bruno)
    bruno.wait_for_selector("#devolver", state="visible", timeout=10_000)
    assert "A01" not in bruno.inner_text("main")
    n = bruno.evaluate(
        "async () => (await (await import('./js/nucleo/filas.js'))"
        ".pendentesRevisao(anotacao.indice, 'pontos', 'B02')).length"
    )
    assert n == 3
    bruno.click("#devolver")
    bruno.select_option("#motivo", "outro")
    bruno.fill("#comentario-dev", "confira a imagem")
    bruno.click("#confirmar-devolver")
    bruno.wait_for_function(
        "(d) => anotacao.pasta.listar(d).then((l) => l.length === 1)", arg=f"partidas/{PARTIDA}/revisoes/pontos"
    )
    bruno.wait_for_function("document.querySelector('#pendentes').textContent.startsWith('2')")
    revisoes = _listar(bruno, f"partidas/{PARTIDA}/revisoes/pontos")
    assert len(revisoes) == 1 and "__B02__v1" in revisoes[0]
    # a decisão volta para a Ana: a página de pontos, parada, mostra o devolvido
    _sincronizar(bruno, ana)
    ana.wait_for_selector("#devolvido:not([hidden])", timeout=10_000)
    assert "confira a imagem" in ana.inner_text("#devolvido")
    ana.screenshot(path=str(capturas / "e2e_11_devolvido_de_outro_computador.png"))
    # e o placar dos dois computadores conta igual
    _sincronizar(ana, bruno)
    for p in (ana, bruno):
        p.goto(site + "#/")
        p.wait_for_function("document.querySelectorAll('#placar tbody tr td').length > 1")
    linhas = [p.eval_on_selector_all("#placar tbody tr", "trs => trs.map(tr => tr.textContent)") for p in (ana, bruno)]
    assert linhas[0] == linhas[1]
    assert not erros, erros


def test_mesmo_codigo_em_dois_computadores(site, navegador, capturas):
    """Duas pessoas com o mesmo código gravariam uma por cima da outra e uma não revisaria a outra: a
    página avisa quando o código já é usado em outro computador."""
    erros: list[str] = []
    ana = _pagina(navegador, erros)
    bruno = _pagina(navegador, erros)
    _criar_pasta(ana, site)
    _escolher_pessoa(ana, site, "AB")
    assert ana.is_hidden("#aviso-codigo")
    assert len(_listar(ana, "pessoas/AB")) == 1  # o computador da Ana usa o código AB
    bruno.goto(site)
    bruno.evaluate("anotacao.intervaloAtualizar = 300")
    bruno.click("#btn-navegador")
    bruno.wait_for_selector("#aviso-vazia", state="visible")
    _sincronizar(ana, bruno)
    _escolher_pessoa(bruno, site, "AB")
    assert bruno.is_visible("#aviso-codigo")
    assert "também é usado em outro computador" in bruno.inner_text("#aviso-codigo")
    bruno.screenshot(path=str(capturas / "e2e_12_mesmo_codigo.png"))
    assert len(_listar(bruno, "pessoas/AB")) == 1  # o Bruno ainda não conta como usando o AB
    # era engano: com outro código, o aviso some, e o computador da Ana não fica sabendo do engano
    _escolher_pessoa(bruno, site, "BR")
    assert bruno.is_hidden("#aviso-codigo")
    _sincronizar(bruno, ana)
    ana.reload()
    ana.wait_for_selector("#aviso-codigo[data-codigo='AB']", state="attached")
    assert ana.is_hidden("#aviso-codigo")
    # a mesma pessoa em dois computadores: "sou eu" e o aviso não volta
    _escolher_pessoa(bruno, site, "AB")
    assert bruno.is_visible("#aviso-codigo")
    bruno.click("#sou-eu")
    assert bruno.is_hidden("#aviso-codigo")
    bruno.reload()
    bruno.wait_for_selector("#aviso-codigo[data-codigo='AB']", state="attached")
    assert bruno.is_hidden("#aviso-codigo")
    assert len(_listar(bruno, "pessoas/AB")) == 2
    assert not erros, erros


def test_dois_computadores_por_zip(site, video, navegador, tmp_path):
    """Sem pasta sincronizada: quem importou manda a cópia da pasta, a outra pessoa revisa e devolve
    só os arquivos dela."""
    caminho, _ = video
    erros: list[str] = []
    ana = _pagina(navegador, erros)
    bruno = _pagina(navegador, erros)
    _importar(ana, site, caminho)
    ana.goto(site + "#/pontos")
    _sem_pontos(ana)
    ana.goto(site + "#/")
    with ana.expect_download() as baixado:
        ana.click("#baixar-tudo")
    copia = tmp_path / "pasta-da-ana.zip"
    baixado.value.save_as(copia)
    # o Bruno começa com o armazenamento vazio e traz a cópia direto
    bruno.goto(site)
    bruno.click("#btn-navegador")
    bruno.wait_for_selector("#aviso-vazia", state="visible")
    bruno.set_input_files("#trazer-zip-vazia", str(copia))
    bruno.wait_for_selector("#conteudo-central:not([hidden])", timeout=20_000)
    _escolher_pessoa(bruno, site, "B02")
    bruno.goto(site + "#/revisao-pontos")
    bruno.wait_for_selector("#aprovar", state="visible")
    bruno.click("#aprovar")
    bruno.wait_for_selector("#vazio", state="visible")
    bruno.goto(site + "#/")
    bruno.wait_for_selector("#baixar-meus:not([disabled])")
    with bruno.expect_download() as baixado:
        bruno.click("#baixar-meus")
    do_bruno = tmp_path / "do-bruno.zip"
    baixado.value.save_as(do_bruno)
    with zipfile.ZipFile(do_bruno) as z:
        nomes = z.namelist()
    assert any("/revisoes/pontos/" in n and "__B02__" in n for n in nomes)
    assert not any("/quadros/" in n or "__A01__" in n for n in nomes), nomes  # só o que é dele
    # a Ana traz os arquivos do Bruno: a revisão conta no placar dela
    ana.set_input_files("#trazer-zip", str(do_bruno))
    ana.wait_for_function("document.querySelector('#res-pasta').textContent.includes('novo')")
    assert "conflito" not in ana.inner_text("#res-pasta")
    ana.wait_for_function(
        """() => [...document.querySelectorAll('#placar tbody tr')]
            .some((tr) => tr.children[0]?.textContent.startsWith('A01') && tr.children[2]?.textContent === '1')""",
        timeout=20_000,
    )
    assert not erros, erros


# ---------------------------------------------------------------- importação do vídeo


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
    _bate_com_o_video(pagina, fila, origem.parent / "quadros")
    assert not erros, erros


def test_trecho_que_comeca_numa_chave_falsa(site, video, navegador, tmp_path):
    """O trecho começa num grupo cujo quadro-chave marcado não é chave (o navegador recusa começar ali)
    e o próximo também não é: a leitura volta até um quadro-chave que o navegador aceita."""
    origem, _ = video
    caminho = tmp_path / "chaves_falsas.mp4"
    _, depois = marcar_chaves_falsas(origem, caminho)
    marcadas = [e - 1 for e in depois]  # 1, 25, 51, 76, ...: só a 25 é chave de verdade
    assert marcadas[:4] == [1, 25, 51, 76]
    erros: list[str] = []
    pagina = _pagina(navegador, erros)
    _importar(pagina, site, caminho, trechos="0:02.2-0:03.8")  # quadros 55 a 94: grupo da 51
    man = Manifesto.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/manifesto.json"))
    fila = Fila.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/fila.json"))
    par = man.pre_processamento.parametros
    assert par["quadros_nos_trechos"] == 40 and par["quadros_perdidos"] == 0, par
    assert par["quadros_nao_extraidos"] == 0 and par["quadros_sem_chave_no_inicio"] == 0
    assert fila.itens and all(55 <= it.i <= 94 for it in fila.itens)
    _bate_com_o_video(pagina, fila, origem.parent / "quadros")
    assert not erros, erros


def test_importar_so_os_trechos(site, video, navegador, capturas):
    """Só os trechos escolhidos são lidos e sorteados; trecho ilegível ou fora do vídeo avisa antes."""
    caminho, _ = video  # 6 s a 25 quadros/s, cortes em 2 s e 4 s
    erros: list[str] = []
    pagina = _pagina(navegador, erros)
    _criar_pasta(pagina, site)
    _escolher_pessoa(pagina, site, "A01")
    pagina.click("#ir-importar")
    _preencher_importacao(pagina, caminho, "segundo tempo")
    pagina.click("#processar")
    assert "não entendi o trecho “segundo tempo”" in pagina.inner_text("#erro-importar")
    assert pagina.is_hidden("#progresso")  # nem começou
    pagina.fill("input[name=trechos]", "0:10-0:20")
    assert "nenhum trecho cai dentro do vídeo, que tem 0:06" in _processar(pagina)
    pagina.fill("input[name=trechos]", "0:03.4-0:03.8, 0:02.2-0:03.5")  # fora de ordem e sobrepostos
    assert _processar(pagina) == ""
    pagina.screenshot(path=str(capturas / "e2e_13_trechos.png"))
    man = Manifesto.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/manifesto.json"))
    fila = Fila.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/fila.json"))
    tomadas = Tomadas.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/tomadas.json"))
    par = man.pre_processamento.parametros
    assert par["trechos"] == "2.2-3.8" and par["quadros_nos_trechos"] == 40  # quadros 55 a 94
    assert par["quadros_perdidos"] == 0 and par["quadros_nao_extraidos"] == 0
    assert par["quadros_sem_chave_no_inicio"] == 0
    assert man.video.n_quadros == 150
    assert fila.itens and all(55 <= it.i <= 94 and it.tomada == 1 for it in fila.itens), fila.itens
    # os limites do trecho cortam (nenhuma tomada atravessa o que não foi lido); os cortes de fora
    # dele (2 s e 4 s) nem são procurados
    assert tomadas.cortes == [55, 95]
    _bate_com_o_video(pagina, fila, caminho.parent / "quadros")
    assert not erros, erros


def test_campo_de_numero_aceita_o_que_se_digita(site, video, navegador):
    """ "Quadros a sortear" é um campo de texto: digitar vale como se digita (nada de setinhas que mudam
    o valor no clique, nem a roda do mouse), e o que não é número avisa antes de processar."""
    erros: list[str] = []
    pagina = _pagina(navegador, erros)
    _criar_pasta(pagina, site)
    _escolher_pessoa(pagina, site, "A01")
    pagina.click("#ir-importar")
    _preencher_importacao(pagina, video[0])
    campo = pagina.locator("input[name=alvo]")
    assert campo.get_attribute("type") == "text" and campo.get_attribute("inputmode") == "numeric"
    campo.click(click_count=3)
    pagina.keyboard.type("150")
    caixa = campo.bounding_box()
    pagina.mouse.move(caixa["x"] + caixa["width"] - 6, caixa["y"] + caixa["height"] / 2)
    pagina.mouse.wheel(0, -300)
    pagina.mouse.click(caixa["x"] + caixa["width"] - 6, caixa["y"] + 5)  # onde ficariam as setinhas
    assert campo.input_value() == "150"
    campo.fill("muitos")
    pagina.click("#processar")
    assert "Quadros a sortear: um número inteiro de 1 a 5000" in pagina.inner_text("#erro-importar")
    assert pagina.is_hidden("#progresso")
    campo.fill("5001")
    pagina.click("#processar")
    assert "de 1 a 5000" in pagina.inner_text("#erro-importar")
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
    pagina.click("#criar-vazia")
    # só seletores aqui: wait_for_function roda texto como código, o que a CSP não deixa
    pagina.wait_for_selector("#pessoa:not([disabled])")
    pagina.fill("#pessoa", "A01")
    pagina.press("#pessoa", "Enter")
    pagina.wait_for_selector("#st-pontos:has-text('Pode anotar')")
    pagina.goto(site + "#/importar")
    _preencher_importacao(pagina, video[0], "0:01-0:05")
    pagina.click("#processar")
    pagina.wait_for_selector("#res-importar:has-text('Pronto'), #erro-importar:not(:empty)", timeout=120_000)
    assert pagina.inner_text("#erro-importar") == ""
    for rota, seletor in [
        ("#/pontos", "#painel:not([hidden]) .mapa, #vazio:not([hidden])"),
        ("#/jogadores", "#painel:not([hidden]), #vazio:not([hidden])"),
        ("#/revisao-pontos", "#vazio:not([hidden])"),
        ("#/revisao-jogadores", "#vazio:not([hidden])"),
        ("#/gabarito", "#lotes tbody td"),
        ("#/coordenacao", "#equipe"),
        ("#/", "#placar tbody td"),
    ]:
        pagina.goto(site + rota)
        pagina.wait_for_selector(seletor)
    assert not avisos, avisos
    contexto.close()


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
    pagina.click("#criar-vazia")
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
    """Depois da primeira visita, o site abre e cria a pasta sem rede (o service worker guardou tudo)."""
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
    pagina.click("#criar-vazia")
    pagina.wait_for_selector("#pessoa:not([disabled])")
    nomes = pagina.evaluate("anotacao.pasta.listar('').then((l) => l.map((x) => x.nome))")
    assert nomes == ["conjuntos", "divisao.json", "equipe.json", "gabarito", "partidas"]
    pagina.goto(site_montado + "#/gabarito")
    pagina.wait_for_selector("#lotes tbody td")
    pagina.context.set_offline(False)
    assert not erros, erros
