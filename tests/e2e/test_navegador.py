"""Ponta a ponta no navegador: importar um vídeo (inteiro ou só uns trechos), anotar arrastando o
molde do campo genérico, revisar às cegas e unificar em Python os arquivos que a página gravou.

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

from anotacao.camera import Camera, mirror_camera
from anotacao.campo import Campo
from anotacao.cli import main
from anotacao.formatos import Fila, GabaritoCamera, Manifesto, RevisaoCamera, RotuloCamera, Tomadas
from anotacao.pacote import pacote_generico, pacote_sintetico

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


def _preencher_importacao(pagina, video: Path, trechos: str = "") -> None:
    """O formulário de importação como a pessoa preenche (o molde fica o campo genérico)."""
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


def _importar(pagina, site: str, video: Path, trechos: str = "") -> None:
    """Cria a pasta de exemplo no navegador e importa o vídeo, como na página."""
    pagina.goto(site)
    pagina.click("#btn-navegador")
    pagina.click("#criar-exemplo")
    _escolher_pessoa(pagina, site, "A01")
    pagina.click("#ir-importar")
    _preencher_importacao(pagina, video, trechos)
    assert _processar(pagina) == ""


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


def _ajustar_molde(pagina, cam_v: Camera, registro: str, campo: Campo = CAMPO) -> None:
    """Recomeça pela câmera do registro, abre o molde um pouco fora da verdade (como uma previsão
    imprecisa) e arrasta 5 pontos espalhados até onde a câmera verdadeira os põe (no campo de
    `campo`, que precisa ser o do molde do editor)."""
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
    for nome in campo.nomes_pontos:
        px, _ = cam_v.project(campo.ponto(nome))
        ini = _tela(pagina, campo.ponto(nome))
        if cam_v.in_image(px, margem=-30)[0] and ini and 0 < ini[2] < cam_v.w and 0 < ini[3] < cam_v.h:
            alvos[nome] = px[0]
    escolhidos = _espalhados(alvos, 5)
    assert len(escolhidos) >= 4, escolhidos
    for nome in escolhidos:
        ini = _tela(pagina, campo.ponto(nome))
        fim = _imagem_para_janela(pagina, *map(float, alvos[nome]))
        pagina.mouse.move(ini[0], ini[1])
        pagina.mouse.down()
        pagina.mouse.move(fim[0], fim[1], steps=12)
        pagina.mouse.up()
    residuos = pagina.evaluate("editor.residuos().map((r) => r.px)")
    assert max(residuos) < 2.0, residuos


def _escolher_pessoa(pagina, url: str, codigo: str) -> None:
    """Digita o código no alto da página central (não há equipe cadastrada) e espera a central dele."""
    pagina.goto(url + "#/")
    pagina.wait_for_selector("#pessoa:not([disabled])")
    pagina.fill("#pessoa", codigo)
    pagina.press("#pessoa", "Enter")
    pagina.wait_for_function(f"localStorage.getItem('anotacao.pessoa') === '{codigo}'")
    pagina.wait_for_selector(f"#aviso-codigo[data-codigo='{codigo}']", state="attached")


def _proximo(pagina, pessoa: str) -> dict:
    """O próximo quadro da fila aberta para a pessoa, como a página de anotação vai abrir."""
    return pagina.evaluate(
        "async (p) => await (await import('./js/nucleo/filas.js')).proximoCamera(anotacao.indice, p)", pessoa
    )


def _bate_com_o_video(pagina, fila: Fila, quadros: Path) -> None:
    """Cada JPEG gravado é o quadro certo do vídeo (o mais parecido entre os vizinhos)."""
    for it in fila.itens:
        jpg = _bytes(pagina, f"partidas/{PARTIDA}/quadros/{it.quadro}.jpg")
        img = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
        psnr = {k: cv2.PSNR(img, cv2.imread(str(quadros / f"{k:05d}.png"))) for k in range(it.i - 2, it.i + 3)}
        assert max(psnr, key=psnr.get) == it.i, psnr


def test_importar_anotar_revisar_e_unificar(site, video, navegador, capturas, tmp_path):
    caminho, verdade = video
    erros: list[str] = []
    pagina = _pagina(navegador, erros)

    # 1) guardar no navegador e criar a pasta de exemplo
    pagina.goto(site)
    pagina.click("#btn-navegador")
    pagina.click("#criar-exemplo")
    _escolher_pessoa(pagina, site, "A01")
    pagina.wait_for_function("document.querySelector('#st-camera').textContent.startsWith('Pode anotar')")
    pagina.screenshot(path=str(capturas / "e2e_1_central.png"), full_page=True)

    # 2) importar o vídeo no navegador, com o molde do campo genérico (sem o levantamento do estádio)
    pagina.click("#ir-importar")
    _preencher_importacao(pagina, caminho)
    assert pagina.input_value("select[name=pacote]") == "generico/pacote-1.0"
    assert _processar(pagina) == ""
    pagina.screenshot(path=str(capturas / "e2e_2_importado.png"))
    man = Manifesto.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/manifesto.json"))
    tomadas = Tomadas.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/tomadas.json"))
    fila = Fila.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/fila.json"))
    assert man.pacote == "generico/pacote-1.0" and man.cadastro.pacote_versao is None
    assert man.cadastro.estadio == "estadio-sintetico"
    assert man.cadastro.chuva is True and man.cadastro.data_hora.isoformat().startswith("2026-11-02T21:30")
    assert man.video.n_quadros == 150 and (man.video.largura, man.video.altura) == (640, 360)
    assert man.video.sha256 == hashlib.sha256(caminho.read_bytes()).hexdigest()
    assert tomadas.cortes == [50, 100]
    assert len(fila.itens) == 3 and {i.tomada for i in fila.itens} == {0, 1, 2}
    assert fila.equipe == [] and all(it.atribuido_a == [] for it in fila.itens)  # fila aberta
    assert "trechos" not in man.pre_processamento.parametros
    jpgs = _listar(pagina, f"partidas/{PARTIDA}/quadros")
    assert sorted(jpgs) == sorted(f"{i.quadro}.jpg" for i in fila.itens)
    for it in fila.itens:
        assert it.quadro == f"t{round(it.i * 40):010d}"  # 25 fps: PTS = 40 ms por quadro

    # 3) anotar arrastando o molde (o quadro que a fila aberta dá para A01)
    proximo = _proximo(pagina, "A01")
    item = next(it for it in fila.itens if it.quadro == proximo["quadro"])
    assert proximo["campo"] == {"comprimento": 105, "largura": 68}
    pagina.goto(site + "#/camera")
    _ajustar_molde(pagina, verdade[item.i], REGISTRO_DA_TOMADA[item.tomada])
    pagina.screenshot(path=str(capturas / "e2e_3_ajustado.png"))
    assert pagina.is_hidden("#ck-lado-item")  # sem placas no molde, não há o lado para conferir
    # esticar o molde: o que está travado continua; desfazer volta as medidas
    assert (pagina.input_value("#comprimento"), pagina.input_value("#largura")) == ("105", "68")
    travados = pagina.evaluate("editor.pinos.length")
    pagina.fill("#comprimento", "100")
    pagina.dispatch_event("#comprimento", "change")
    assert pagina.evaluate("[editor.molde.L, editor.molde.W, editor.pinos.length]") == [100, 68, travados]
    pagina.click("#desfazer")
    assert pagina.evaluate("[editor.molde.L, editor.pinos.length]") == [105, travados]
    assert pagina.input_value("#comprimento") == "105"
    pagina.fill("#largura", "30")
    pagina.dispatch_event("#largura", "change")
    assert "fora da regra" in pagina.inner_text("#erro") and pagina.evaluate("editor.molde.W") == 68
    pagina.fill("#largura", "68")
    pagina.dispatch_event("#largura", "change")
    assert max(pagina.evaluate("editor.residuos().map((r) => r.px)")) < 2.0
    pagina.click("#salvar")
    pagina.wait_for_function(
        "document.querySelector('#erro').textContent === '' && (window.editor === null || editor.pinos.length === 0)"
    )
    rotulos = _listar(pagina, f"partidas/{PARTIDA}/rotulos/camera")
    assert rotulos == [f"{item.quadro}__A01__v1.json"]
    r = RotuloCamera.model_validate_json(_ler(pagina, f"partidas/{PARTIDA}/rotulos/camera/{rotulos[0]}"))
    cam_v = verdade[item.i]
    assert r.situacao == "ok" and r.residuo_mediano_px < 2.0 and r.segundos_ativos >= 0
    assert r.pacote == "generico/pacote-1.0" and (r.campo.comprimento, r.campo.largura) == (105, 68)
    assert abs(r.camera.pan - cam_v.ptr[0]) < 0.3 and abs(r.camera.tilt - cam_v.ptr[1]) < 0.3
    assert abs(r.camera.hfov_graus - cam_v.hfov) < 0.5

    # 4) revisão cruzada às cegas por outra pessoa
    _escolher_pessoa(pagina, site, "A02")
    pagina.wait_for_function("document.querySelector('#st-revisao').textContent.includes('esperando')")
    pagina.click("#ir-revisao")
    pagina.wait_for_selector("#aprovar", state="visible")
    pagina.screenshot(path=str(capturas / "e2e_4_revisao.png"))
    assert "A01" not in pagina.inner_text("main")
    assert pagina.inner_text("#r-campo") == "105 × 68 m"
    # na correção dá para esticar o molde; "Voltar" devolve o rótulo como estava
    pagina.click("#corrigir")
    pagina.fill("#comprimento", "100")
    pagina.dispatch_event("#comprimento", "change")
    assert pagina.evaluate("editor.molde.L") == 100
    pagina.click("#secao-corrigir [data-voltar]")
    assert pagina.evaluate("[editor.molde.L, editor.molde.W, editor.somenteLeitura]") == [105, 68, True]
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
    assert (df.loc[0, "campo_comprimento"], df.loc[0, "campo_largura"]) == (105, 68)
    assert json.loads((conjunto / "manifesto.json").read_text(encoding="utf-8"))["por_conjunto"] == {"treino": 1}

    # 7) trazer o mesmo .zip de volta não sobrescreve nada
    pagina.set_input_files("#trazer-zip", str(zip_path))
    pagina.wait_for_function("document.querySelector('#res-pasta').textContent.includes('já existiam')")
    assert pagina.inner_text("#res-pasta").startswith("0 arquivo(s) novo(s)")
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


def _sem_marcacoes(pagina) -> None:
    """Salva o quadro aberto como "sem marcações suficientes" (rápido, sem ajustar o molde)."""
    pagina.wait_for_selector("#painel:not([hidden])")
    antes = pagina.evaluate("editor && editor.img.src")
    pagina.check("input[name=situacao][value=sem_marcacoes]")
    pagina.click("#salvar")
    pagina.wait_for_function(
        "(antes) => document.querySelector('#erro').textContent === '' && (!window.editor || editor.img.src !== antes)",
        arg=antes,
    )


def test_dois_computadores_na_pasta_sincronizada(site, video, navegador, capturas):
    """Cada pessoa no seu computador, com a mesma pasta sincronizada (aqui, dois navegadores separados
    e o papel do Drive feito à mão): Ana anota, Bruno revisa no dele e devolve, Ana recebe de volta. As
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
    bruno.goto(site + "#/revisao")
    bruno.wait_for_selector("#vazio:has-text('Nenhum rótulo')")
    # a Ana anota os três quadros da partida
    ana.goto(site + "#/camera")
    for _ in range(3):
        _sem_marcacoes(ana)
    ana.wait_for_selector("#vazio:has-text('Nada na sua fila')")
    assert len(_listar(ana, f"partidas/{PARTIDA}/rotulos/camera")) == 3
    # chegam no computador do Bruno: a revisão, parada, acha os rótulos sem recarregar
    _sincronizar(ana, bruno)
    bruno.wait_for_selector("#devolver", state="visible", timeout=10_000)
    assert "A01" not in bruno.inner_text("main")
    # os três chegaram (a contagem no alto é a da hora em que o primeiro abriu, que pode ter sido no
    # meio da sincronização; ela se refaz a cada decisão)
    n = bruno.evaluate(
        "async () => (await (await import('./js/nucleo/filas.js')).pendentesRevisao(anotacao.indice, 'B02')).length"
    )
    assert n == 3
    bruno.click("#devolver")
    bruno.select_option("#motivo", "outro")
    bruno.fill("#comentario-dev", "confira o quadro")
    bruno.click("#confirmar-devolver")
    bruno.wait_for_function("document.querySelector('#pendentes').textContent.startsWith('2')")
    revisoes = _listar(bruno, f"partidas/{PARTIDA}/revisoes/camera")
    assert len(revisoes) == 1 and "__B02__v1" in revisoes[0]
    # a decisão volta para a Ana: a página da câmera, parada, mostra o devolvido
    _sincronizar(bruno, ana)
    ana.wait_for_selector("#devolvido:not([hidden])", timeout=10_000)
    assert "confira o quadro" in ana.inner_text("#devolvido")
    ana.screenshot(path=str(capturas / "e2e_8_devolvido_de_outro_computador.png"))
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
    ana.goto(site)
    ana.click("#btn-navegador")
    ana.click("#criar-vazia")
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
    bruno.screenshot(path=str(capturas / "e2e_9_mesmo_codigo.png"))
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
    ana.goto(site + "#/camera")
    _sem_marcacoes(ana)
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
    bruno.goto(site + "#/revisao")
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
    assert any("/revisoes/camera/" in n and "__B02__" in n for n in nomes)
    assert not any("/quadros/" in n or "__A01__" in n for n in nomes), nomes  # só o que é dele
    # a Ana traz os arquivos do Bruno: a revisão conta no placar dela
    ana.set_input_files("#trazer-zip", str(do_bruno))
    ana.wait_for_function("document.querySelector('#res-pasta').textContent.includes('novo')")
    assert "conflito" not in ana.inner_text("#res-pasta")
    # a central se refaz com o que chegou: o rótulo da Ana aprovado pelo Bruno
    ana.wait_for_function(
        """() => [...document.querySelectorAll('#placar tbody tr')]
            .some((tr) => tr.children[0]?.textContent.startsWith('A01') && tr.children[2]?.textContent === '1')""",
        timeout=20_000,
    )
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
    pagina.goto(site)
    pagina.click("#btn-navegador")
    pagina.click("#criar-exemplo")
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
    pagina.screenshot(path=str(capturas / "e2e_7_trechos.png"))
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
    # só seletores aqui: wait_for_function roda texto como código, o que a CSP não deixa
    pagina.wait_for_selector("#pessoa:not([disabled])")
    pagina.fill("#pessoa", "A01")
    pagina.press("#pessoa", "Enter")
    pagina.wait_for_selector("#st-camera:has-text('Pode anotar')")
    pagina.goto(site + "#/importar")
    _preencher_importacao(pagina, video[0], "0:01-0:05")
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


def _item_aberto(pagina, imagens: dict[str, np.ndarray]) -> str:
    """Qual item do gabarito o editor abriu: o que tem a imagem igual à mostrada."""
    b64 = pagina.evaluate(
        "() => { const c = document.createElement('canvas'); c.width = editor.w; c.height = editor.h;"
        " c.getContext('2d').drawImage(editor.img, 0, 0); return c.toDataURL('image/png').split(',')[1]; }"
    )
    mostrado = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR)
    return max(imagens, key=lambda g: cv2.PSNR(mostrado, imagens[g]))


def test_lote_de_ouro_no_campo_generico(site, navegador, capturas, tmp_path):
    """Um lote de ouro em .zip, no campo genérico: um item de um campo de 100 x 64 m, que abre no molde
    de 105 x 68 m e só fecha com as medidas certas, e um de câmera reversa anotado do lado espelhado —
    sem placas, nada decide o lado, e as duas câmeras desenham o mesmo campo."""
    generico = pacote_generico()
    lote = tmp_path / "L0-teste.zip"
    cams, campos, imagens = {}, {}, {}
    with zipfile.ZipFile(lote, "w") as z:
        for gid, C, alvo, medidas in [
            ("g0901", [0.0, -56.0, 18.0], [-22.0, 6.0, 0.0], (100.0, 64.0)),
            ("g0902", [6.0, 50.0, 12.0], [-24.0, -6.0, 0.0], None),
        ]:
            campo = Campo(L=medidas[0], W=medidas[1]) if medidas else CAMPO
            cam = Camera.look_at(np.asarray(C), alvo, 40.0, 640, 360)
            img = renderizar(cam, campo, generico, int(gid[1:]))
            jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])[1]
            z.writestr(f"gabarito/itens/{gid}.jpg", jpg.tobytes())
            g = GabaritoCamera(
                id=gid,
                pacote=generico.ref,
                imagem=f"{gid}.jpg",
                largura=640,
                altura=360,
                camera=cam.para_rotulo(),
                campo={"comprimento": medidas[0], "largura": medidas[1]} if medidas else None,
                origem="simulador",
            )
            z.writestr(f"gabarito/itens/{gid}.json", g.model_dump_json())
            cams[gid], campos[gid], imagens[gid] = cam, campo, img
    erros: list[str] = []
    pagina = _pagina(navegador, erros)
    pagina.goto(site)
    pagina.evaluate("anotacao.intervaloAtualizar = 300")
    pagina.click("#btn-navegador")
    pagina.click("#criar-vazia")  # a pasta só com o campo genérico
    _escolher_pessoa(pagina, site, "A01")
    pagina.set_input_files("#trazer-zip", str(lote))
    pagina.wait_for_function("document.querySelector('#res-pasta').textContent.startsWith('4 arquivo(s) novo(s)')")
    pagina.wait_for_function("document.querySelector('#st-camera').textContent.startsWith('Em treino')")
    pagina.click("#ir-camera")
    pagina.wait_for_selector("#treino", state="visible")
    feitos = []
    for _ in range(2):
        pagina.wait_for_function("window.editor !== undefined && window.editor !== null && !editor.pinos.length")
        gid = _item_aberto(pagina, imagens)
        assert gid not in feitos
        assert pagina.evaluate("[editor.molde.L, editor.molde.W]") == [105, 68], "o item abre no molde genérico"
        assert pagina.is_hidden("#ck-lado-item"), "sem placas no molde, não há lado a conferir"
        if campos[gid] is not CAMPO:
            pagina.fill("#comprimento", "100")
            pagina.dispatch_event("#comprimento", "change")
            pagina.fill("#largura", "64")
            pagina.dispatch_event("#largura", "change")
            assert pagina.evaluate("[editor.molde.L, editor.molde.W]") == [100, 64]
            _ajustar_molde(pagina, cams[gid], "principal", campos[gid])
        else:
            # a câmera reversa anotada do lado das cabines: o mesmo campo desenhado
            _ajustar_molde(pagina, mirror_camera(cams[gid]), "principal")
        pagina.click("#salvar")
        pagina.wait_for_selector("#modal", state="visible")
        assert pagina.inner_text("#modal-titulo") == "Dentro da tolerância", pagina.inner_text("#modal-texto")
        if not feitos:
            pagina.screenshot(path=str(capturas / "e2e_10_lote_de_ouro.png"))
        feitos.append(gid)
        pagina.click("#modal-ok")
    pagina.wait_for_selector("#vazio:has-text('O gabarito acabou')")
    rotulos = sorted(_listar(pagina, "gabarito/rotulos/camera"))
    assert rotulos == ["g0901__A01__v1.json", "g0902__A01__v1.json"]
    espelhado = json.loads(_ler(pagina, "gabarito/rotulos/camera/g0902__A01__v1.json"))
    assert espelhado["lado"] == "canonico" and cams["g0902"].C[1] > 0, "o rótulo ficou do lado oposto ao da verdade"
    medidas = json.loads(_ler(pagina, "gabarito/rotulos/camera/g0901__A01__v1.json"))["campo"]
    assert medidas == {"comprimento": 100, "largura": 64}
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
    assert pagina.evaluate("anotacao.pasta.listarPacotes()") == ["estadio-sintetico/pacote-1.0", "generico/pacote-1.0"]
    pagina.context.set_offline(False)
    assert not erros, erros
