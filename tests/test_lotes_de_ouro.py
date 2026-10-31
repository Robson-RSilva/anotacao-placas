"""Os lotes de ouro (scripts/lotes_de_ouro.py): a definição dos lotes e as contas da resposta.

A geração em si precisa do simulador do laboratório e não roda aqui; estes testes guardam a definição
dos lotes (faixas de id, sementes, o que cada um pede) e as funções que montam a resposta de cada item
— onde o ponto aparece, quando marcá-lo é opcional; o recorte endireitado da placa, a região dela e o
que está na frente, com uma câmera e uma "tela" de mentira.
"""

import importlib.util
import itertools
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from anotacao.campo import Campo, pontos_marcaveis
from anotacao.formatos import GabaritoPlacas
from anotacao.gabarito import conferir_mascara
from anotacao.mascara import gravar_png, ler_png, rasterizar

from sintetico import Camera


@pytest.fixture(scope="module")
def lotes():
    caminho = Path(__file__).resolve().parents[1] / "scripts" / "lotes_de_ouro.py"
    spec = importlib.util.spec_from_file_location("lotes_de_ouro", caminho)
    modulo = importlib.util.module_from_spec(spec)
    sys.modules["lotes_de_ouro"] = modulo  # o dataclass procura o módulo pelo nome
    spec.loader.exec_module(modulo)
    return modulo


def _como_o_laboratorio(cam: Camera, k1: float = 0.0):
    """A câmera dos testes com a cara da do laboratório (ponto principal e distorção radial)."""

    def project(X):
        Xc = (np.atleast_2d(np.asarray(X, float)) - cam.C) @ cam.R.T
        z = Xc[:, 2]
        px = np.full((len(Xc), 2), np.nan)
        ok = z > 1e-3
        n = Xc[ok, :2] / z[ok, None]
        r2 = (n**2).sum(1, keepdims=True)
        px[ok] = cam.f * n * (1 + k1 * r2) + [cam.w / 2, cam.h / 2]
        return px, z

    return SimpleNamespace(
        f=cam.f, R=cam.R, C=cam.C, w=cam.w, h=cam.h, k1=k1, k2=0.0, cx=cam.w / 2, cy=cam.h / 2, project=project
    )


def test_faixas_de_id_separadas(lotes):
    """Nenhum id se repete entre os lotes, nem nome, nem semente; os pontos em g1xxx, as placas em g4xxx
    (os g2xxx e g3xxx eram os jogadores e as pessoas das 0.8 e 0.9, que podem estar na pasta de quem já
    importou), longe dos itens de demonstração (g19xx, g49xx) dos testes e das capturas."""
    faixas = sorted((lt.primeiro, lt.primeiro + lt.n - 1, lt.tarefa) for lt in lotes.LOTES)
    for (_, fim, _), (inicio, _, _) in itertools.pairwise(faixas):
        assert fim < inicio
    for inicio, fim, tarefa in faixas:
        milhar = 1000 if tarefa == "pontos" else 4000
        assert milhar <= inicio and fim < milhar + 900, (inicio, fim, tarefa)
    assert len({lt.nome for lt in lotes.LOTES}) == len(lotes.LOTES)
    assert len({lt.semente for lt in lotes.LOTES}) == len(lotes.LOTES)


def test_cada_tarefa_tem_treino_e_controle(lotes):
    """O teste de quem começa usa os lotes com "treino" no nome; os itens escondidos, os outros."""
    for tarefa in ("pontos", "placas"):
        nomes = [lt.nome for lt in lotes.LOTES if lt.tarefa == tarefa]
        assert any("treino" in n for n in nomes) and any("treino" not in n for n in nomes)
    regra = {"pontos": 10, "placas": 5}  # os N últimos itens da liberação (REGRA em gabarito.js)
    for lt in lotes.LOTES:
        if "treino" in lt.nome:
            assert lt.n >= 2 * regra[lt.tarefa], f"{lt.nome}: pouco item para treinar e liberar"


def test_o_que_cada_lote_pede_cabe(lotes):
    for lt in lotes.LOTES:
        assert lt.dominios and set(lt.dominios) <= {"A", "B"}
        assert lt.hfov[0] < lt.hfov[1]
        for camera, minimo in lotes.HFOV_MINIMO.items():
            if camera in lt.cameras:
                assert lt.hfov[1] > minimo, f"{lt.nome}: o simulador abre a câmera {camera} pelo menos até {minimo}°"
        if lt.tarefa == "pontos":
            assert 1 <= lt.pontos[0] <= lt.pontos[1] <= len(pontos_marcaveis())
            assert lt.sem_pontos < lt.n
        else:
            assert set(lt.tipos) <= set(lotes.TIPOS_PLACAS)
            assert lt.n == sum(lt.tipos.values())
            # todo lote de placas tem gente e trave na frente, placa sem nada na frente (salvar sem
            # pintar) e recorte fora do lugar (descartar); o que pintar é a maior parte
            assert lt.tipos["pessoas"] >= 4 and lt.tipos["trave"] >= 1
            assert lt.tipos["nada"] >= 1 and lt.tipos["fora"] >= 1
            assert lt.tipos["nada"] + lt.tipos["fora"] <= lt.n // 3


def test_medidas_sorteadas(lotes):
    rng = np.random.default_rng(0)
    vistos = set()
    for modo in ("padrao", "mistas"):
        for _ in range(300):
            comprimento, largura = lotes.sortear_medidas(rng, modo)
            assert 90 <= comprimento <= 120 and 45 <= largura <= 90 and comprimento > largura
            assert (2 * comprimento).is_integer() and (2 * largura).is_integer()
            if modo == "padrao":
                assert (comprimento, largura) == lotes.PADRAO
            vistos.add((modo, (comprimento, largura) == lotes.PADRAO))
    assert ("mistas", True) in vistos and ("mistas", False) in vistos


def test_o_ponto_vai_para_onde_o_renderizador_desenha(lotes):
    """O renderizador desenha meio pixel da tela super-amostrada para a direita e para baixo da
    projeção: sem distorção, 0,25 px na imagem (super-amostragem 2); com distorção, quase isso."""
    cam = _como_o_laboratorio(Camera.look_at([0.0, -58.0, 16.0], [-8.0, 0.0, 0.0], 40.0, 1280, 720))
    X = Campo().KP
    bruto, _ = cam.project(X)
    px = lotes.projetar_como_o_desenho(cam, X)
    ok = np.isfinite(bruto).all(1)
    assert np.allclose(px[ok] - bruto[ok], 0.25)
    assert np.allclose(lotes.projetar_como_o_desenho(cam, X, super_amostragem=4)[ok] - bruto[ok], 0.125)
    atras = lotes.projetar_como_o_desenho(cam, np.array([[0.0, -80.0, 16.0]]))
    assert np.isnan(atras).all(), "ponto atrás da câmera"

    torta = _como_o_laboratorio(Camera.look_at([0.0, -58.0, 16.0], [-8.0, 0.0, 0.0], 40.0, 1280, 720), k1=-0.05)
    bruto, _ = torta.project(X)
    px = lotes.projetar_como_o_desenho(torta, X)
    dentro = np.isfinite(bruto).all(1) & (np.abs(bruto - [640, 360]) < [640, 360]).all(1)
    assert dentro.sum() >= 6
    assert np.abs(px[dentro] - bruto[dentro] - 0.25).max() < 0.03


def test_angulo_do_cruzamento_na_imagem(lotes):
    campo = Campo()
    assert len(lotes.direcoes_no_ponto(campo, "canto_esq_cab")) == 2
    assert len(lotes.direcoes_no_ponto(campo, "circ_meio_cab")) == 2  # o círculo e a linha do meio
    assert len(lotes.direcoes_no_ponto(campo, "gol_esq_topo_cab")) == 2  # a trave e o travessão
    assert (
        lotes.angulo_na_imagem(None, campo.ponto("penalti_esq"), lotes.direcoes_no_ponto(campo, "penalti_esq")) is None
    )
    de_cima = Camera.look_at([0.0, -0.01, 120.0], [0.0, 0.0, 0.0], 70.0, 1280, 720)
    for nome in ("canto_esq_cab", "meio_opo", "ga_dir_frente_cab", "circ_meio_opo"):
        a = lotes.angulo_na_imagem(de_cima, campo.ponto(nome), lotes.direcoes_no_ponto(campo, nome))
        assert a == pytest.approx(90.0, abs=1.0), nome
    # rente ao chão, olhando ao longo da lateral: a lateral e a linha de fundo quase se sobrepõem
    rasante = Camera.look_at([60.0, -45.0, 1.0], [-52.5, -34.0, 0.0], 20.0, 1280, 720)
    a = lotes.angulo_na_imagem(rasante, campo.ponto("canto_esq_cab"), lotes.direcoes_no_ponto(campo, "canto_esq_cab"))
    assert a < lotes.ANGULO_MIN


def test_quando_marcar_e_opcional(lotes):
    w, h = 1280, 720
    oclusor = np.zeros((h, w), bool)
    oclusor[300:340, 600:640] = True  # alguém na frente
    trave = np.zeros((h, w), bool)
    trave[100:200, 900:903] = True
    casos = [  # nome, tipo, (x, y), ângulo, esperado (None: não entra)
        ("canto_esq_cab", "linha", (100.5, 100.5), 80.0, True),
        ("canto_esq_opo", "linha", (601.0, 320.0), 80.0, False),  # coberto
        ("canto_dir_cab", "linha", (597.5, 320.0), 80.0, False),  # a 2,5 px de quem está na frente
        ("canto_dir_opo", "linha", (590.0, 320.0), 80.0, True),
        ("gol_esq_pe_cab", "gol", (901.0, 150.0), 80.0, True),  # a própria trave não cobre o ponto do gol
        ("pa_esq_fundo_cab", "linha", (901.0, 150.0), 80.0, False),  # mas cobre o do gramado
        ("meio_cab", "linha", (2.0, 400.0), 80.0, False),  # rente à borda
        ("meio_opo", "linha", (700.0, 500.0), 10.0, False),  # linhas quase paralelas
        ("penalti_esq", "marca", (700.0, 600.0), None, True),
        ("centro", "marca", (-3.0, 400.0), None, None),  # fora, mas rente: conta como rente
        ("circ_meio_cab", "circulo", (-30.0, 400.0), 80.0, None),  # fora e longe
        ("circ_meio_opo", "circulo", (np.nan, np.nan), 80.0, None),  # atrás da câmera
    ]
    nomes = [c[0] for c in casos]
    pontos, rentes = lotes.pontos_verdadeiros(
        nomes,
        [c[1] for c in casos],
        np.array([c[2] for c in casos], float),
        [c[3] for c in casos],
        oclusor,
        trave,
        w,
        h,
    )
    assert rentes == 1
    assert {p["ponto"]: p["visivel"] for p in pontos} == {c[0]: c[4] for c in casos if c[4] is not None}
    assert all(0 <= p["x"] <= w and 0 <= p["y"] <= h for p in pontos)
    assert lotes.espalhamento(pontos, w) == pytest.approx(np.hypot(901 - 100.5, 150 - 100.5) / w, abs=1e-3)


def _placa(lado: str = "opo", x: float = 0.0, y: float = 38.0, largura: float = 8.0, altura: float = 1.0):
    """Uma placa como as do laboratório (os cantos BL, BR, TR, TL, de frente para o campo)."""
    n = np.array([0.0, -1.0 if y > 0 else 1.0, 0.0])
    direita = np.cross(-n, [0.0, 0.0, 1.0])
    b = np.array([x, y, 0.0])
    V = np.array([b - largura / 2 * direita, b + largura / 2 * direita])
    V = np.array([V[0], V[1], V[1] + [0, 0, altura], V[0] + [0, 0, altura]])
    return SimpleNamespace(
        V=V,
        n=n,
        width=largura,
        height=altura,
        side=lado,
        e_u=(V[1] - V[0]) / largura,
        e_v=(V[3] - V[0]) / altura,
        center=V.mean(0),
    )


def _cena_de_placas(alvo=(0.0, 38.0, 0.5), hfov=12.0, placas=None):
    cam = _como_o_laboratorio(Camera.look_at((0.0, -45.0, 12.0), alvo, hfov, 960, 540))
    estadio = SimpleNamespace(boards=placas or [_placa(), _placa(x=8.0), _placa("dir", 30.0, 30.0)])
    gente = [SimpleNamespace(kind="jogador"), SimpleNamespace(kind="staff")]
    return SimpleNamespace(cam=cam, stadium=estadio, people=gente)


def test_recortar_poligono(lotes):
    quadrado = [(0, 0), (10, 0), (10, 10), (0, 10)]
    assert lotes.recortar_poligono(quadrado, 0, 0, 10, 10) == [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
    cortado = lotes.recortar_poligono(quadrado, 2, -1, 6, 20)
    assert sorted(cortado) == [(2.0, 0.0), (2.0, 10.0), (6.0, 0.0), (6.0, 10.0)]
    assert lotes.recortar_poligono(quadrado, 20, 20, 30, 30) == []


def test_recorte_da_placa_inteira(lotes):
    """A placa inteira no quadro: o recorte é o retângulo dela com a margem em volta, e a região é esse
    retângulo, de cantos inteiros; os cantos no quadro são onde o renderizador desenha a placa."""
    cena = _cena_de_placas()
    img = np.full((540, 960, 3), 90, np.uint8)
    r = lotes.recortar(cena, img, 0)
    assert r is not None and r.a_vista == 1.0
    h, w = r.imagem.shape[:2]
    m = round(lotes.MARGEM * r.altura_placa)
    assert h == r.altura_placa + 2 * m
    assert r.regiao == [[m, m], [w - m, m], [w - m, h - m], [m, h - m]]
    assert r.placa == [[m, m], [w - m, m], [w - m, h - m], [m, h - m]]
    b = cena.stadium.boards[0]
    cantos = lotes.projetar_como_o_desenho(cena.cam, np.array([b.V[3], b.V[2], b.V[1], b.V[0]]))
    assert np.allclose(r.no_quadro, cantos, atol=0.01)
    assert rasterizar(r.regiao, w, h).sum() == (w - 2 * m) * (h - 2 * m)
    # longe e baixa demais (um grande angular): não vira recorte
    assert lotes.recortar(_cena_de_placas(hfov=60.0), img, 0) is None


def test_recorte_da_placa_cortada_pelo_lado(lotes):
    """A placa que sai pelo lado do quadro: só a parte de dentro entra, e a região acaba onde o quadro
    acaba; cortada pela borda de cima ou de baixo, não vira recorte."""
    img = np.full((540, 960, 3), 90, np.uint8)
    cena = _cena_de_placas(alvo=(-7.0, 38.0, 0.5), hfov=10.0)  # a placa de x = 0 sai pela direita
    r = lotes.recortar(cena, img, 0)
    assert r is not None and 0.2 < r.a_vista < 1.0
    w = r.imagem.shape[1]
    m = round(lotes.MARGEM * r.altura_placa)
    xs = [x for x, _ in r.regiao]
    assert min(xs) == m and max(xs) < w  # a região começa na placa e para antes do fim do recorte
    assert (r.imagem[:, -2:] == lotes.FUNDO_FORA).all()  # depois do quadro, o cinza
    # mais fechado, a placa sai pelos dois lados: as duas pontas da região acabam no quadro
    r2 = lotes.recortar(_cena_de_placas(alvo=(0.0, 38.0, 0.5), hfov=4.0), img, 0)
    assert r2 is not None and r2.a_vista < 0.8
    m2 = round(lotes.MARGEM * r2.altura_placa)
    xs = [x for x, _ in r2.regiao]
    assert min(xs) == m2 and max(xs) == r2.imagem.shape[1] - m2
    assert (r2.imagem[:, :2] == lotes.FUNDO_FORA).all() and (r2.imagem[:, -2:] == lotes.FUNDO_FORA).all()
    # a placa cortada pela borda de baixo do quadro
    assert lotes.recortar(_cena_de_placas(alvo=(0.0, 38.0, 1.6), hfov=2.0), img, 0) is None


def test_o_que_esta_na_frente_da_placa(lotes):
    """A verdade do recorte: a pessoa e o grafismo na frente, numerados da esquerda para a direita; a
    placa vizinha do mesmo lado não está na frente, a de outro lado, sim; e o recorte fora do lugar."""
    cena = _cena_de_placas()
    img = np.full((540, 960, 3), 90, np.uint8)
    r = lotes.recortar(cena, img, 0)
    b = cena.stadium.boards[0]
    cantos = lotes.projetar_como_o_desenho(cena.cam, np.array([b.V[3], b.V[2], b.V[1], b.V[0]]))
    (x0, y0), (x1, _), (_, y1) = cantos[0], cantos[1], cantos[2]
    xm = (x0 + x1) / 2
    ids = np.zeros((540, 960), np.int32)
    ids[int(y0) - 5 : int(y1) + 5, int(x0) : int(xm)] = lotes.PLACA + 0  # a própria placa
    ids[int(y0) - 5 : int(y1) + 5, int(xm) : int(x1) + 30] = lotes.PLACA + 1  # a vizinha do mesmo lado
    ids[int(y0) : int(y1) + 9, int(xm) - 40 : int(xm) - 20] = lotes.PESSOA + 1  # o fotógrafo
    ids[int(y0) - 9 : int(y0) + 4, int(x1) - 30 : int(x1) - 10] = lotes.PLACA + 2  # a placa do fundo
    grafismos = np.zeros((540, 960), np.int32)
    grafismos[: int(y0) + 3, int(x0) - 50 : int(x0) + 20] = 1  # o placar da emissora, em cima à esquerda
    gt = {"quem_aparece": ids, "tela": cena.cam, "grafismos": grafismos}
    lotes.verdade_do_recorte(cena, gt, r)
    assert r.quem == ["grafismo", "pessoa:staff", "placa"]
    h, w = r.imagem.shape[:2]
    dentro = rasterizar(r.regiao, w, h)
    assert not r.verdade[~dentro].any()
    areas = np.bincount(r.verdade.ravel(), minlength=4)
    assert areas[2] > 3 * areas[3] > 0  # o fotógrafo cobre mais que a pontinha da placa do fundo
    assert lotes.tipo_do_recorte(r) == "grafismo"
    # sem nada na frente: "nada"; só com uma coisa pequena: não serve
    gt["quem_aparece"] = np.where(ids >= lotes.PESSOA, 0, ids)
    gt["grafismos"] = np.zeros_like(grafismos)
    lotes.verdade_do_recorte(cena, gt, r)
    assert r.quem == ["placa"] and lotes.tipo_do_recorte(r) in ("placa", None)
    gt["quem_aparece"] = np.where(ids == lotes.PLACA + 2, 0, gt["quem_aparece"])
    lotes.verdade_do_recorte(cena, gt, r)
    assert r.quem == [] and lotes.tipo_do_recorte(r) == "nada"
    # o recorte fora do lugar: o retângulo uma altura acima da placa
    fora = lotes.recortar(cena, img, 0, deslocar=(0.0, 1.0))
    assert fora is not None and fora.deslocado == (0.0, 1.0)
    assert fora.no_quadro[3][1] == pytest.approx(cantos[0][1], abs=0.5)  # embaixo dele, o alto da placa
    # a resposta passa na conferência da importação
    lotes.verdade_do_recorte(cena, {"quem_aparece": ids, "tela": cena.cam, "grafismos": grafismos}, r)
    item = GabaritoPlacas(
        id="g4001",
        imagem="g4001.jpg",
        mascara="g4001.png",
        largura=w,
        altura=h,
        regiao=r.regiao,
        oclusores=len(r.quem),
        origem="simulador",
    )
    png = gravar_png(r.verdade, lotes.paleta_da_verdade(item.oclusores))
    conferir_mascara(png, item)
    assert np.array_equal(ler_png(png), r.verdade)


def test_paleta_da_verdade(lotes):
    pal = lotes.paleta_da_verdade(3)
    assert len(pal) == 256 and pal[0] == (0, 0, 0)
    assert len({pal[1], pal[2], pal[3]}) == 3
    assert pal[4] == pal[255] == (0, 0, 0)


def test_intercalar(lotes):
    cheios, vazios = list(range(37)), ["a", "b", "c"]
    juntos = lotes.intercalar(cheios, vazios)
    assert [x for x in juntos if isinstance(x, int)] == cheios
    assert [juntos.index(v) for v in vazios] == [10, 20, 30]
    assert lotes.intercalar([1, 2], []) == [1, 2]
