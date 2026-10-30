"""Os lotes de ouro (scripts/lotes_de_ouro.py): a definição dos lotes e as contas da resposta.

A geração em si precisa do simulador do laboratório e não roda aqui; estes testes guardam a definição
dos lotes (faixas de id, sementes, o que cada um pede) e as funções que montam a resposta de cada item
— onde o ponto aparece, quando marcá-lo é opcional, quem é quem na máscara das pessoas.
"""

import importlib.util
import itertools
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from anotacao.campo import Campo, pontos_marcaveis
from anotacao.formatos import GabaritoPessoas
from anotacao.gabarito import conferir_mascara
from anotacao.mascara import gravar_png, ler_png

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
    """Nenhum id se repete entre os lotes, nem nome, nem semente; os pontos em g1xxx, as pessoas em
    g3xxx (os g2xxx eram os jogadores da 0.8, que podem estar na pasta de quem já importou), longe dos
    itens de demonstração (g19xx, g39xx) dos testes e das capturas."""
    faixas = sorted((lt.primeiro, lt.primeiro + lt.n - 1, lt.tarefa) for lt in lotes.LOTES)
    for (_, fim, _), (inicio, _, _) in itertools.pairwise(faixas):
        assert fim < inicio
    for inicio, fim, tarefa in faixas:
        milhar = 1000 if tarefa == "pontos" else 3000
        assert milhar <= inicio and fim < milhar + 900, (inicio, fim, tarefa)
    assert len({lt.nome for lt in lotes.LOTES}) == len(lotes.LOTES)
    assert len({lt.semente for lt in lotes.LOTES}) == len(lotes.LOTES)


def test_cada_tarefa_tem_treino_e_controle(lotes):
    """O teste de quem começa usa os lotes com "treino" no nome; os itens escondidos, os outros."""
    for tarefa in ("pontos", "pessoas"):
        nomes = [lt.nome for lt in lotes.LOTES if lt.tarefa == tarefa]
        assert any("treino" in n for n in nomes) and any("treino" not in n for n in nomes)
    regra = {"pontos": 10, "pessoas": 5}  # os N últimos itens da liberação (REGRA em gabarito.js)
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
            assert 1 <= lt.pessoas[0] <= lt.pessoas[1]
            assert lt.com_outras + lt.so_outras + lt.so_torcida <= lt.n
            assert lt.inteiros <= lt.pessoas[0]
            # a regra nova pinta quem não joga: todo lote de pessoas tem gente que não joga, uma imagem
            # só com ela e uma só com a torcida (que não se pinta)
            assert lt.com_outras >= 4 and lt.so_outras >= 1 and lt.so_torcida >= 1


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


def test_moda_por_bloco(lotes):
    """Como o renderizador reduz a máscara dele: gente onde mais da metade do bloco é gente; o número,
    o de quem mais aparece no bloco."""
    tela = np.array(
        [
            [1, 1, 0, 2, 0, 0],
            [1, 2, 2, 2, 0, 3],
            [0, 0, 4, 4, 0, 0],
            [0, 0, 4, 0, 0, 0],
        ],
        np.uint16,
    )
    assert lotes.moda_por_bloco(tela, 2).tolist() == [[1, 2, 0], [0, 4, 0]]


def test_numerar_pessoas(lotes):
    """Todo mundo (jogadores, goleiros, árbitro, gandulas e fotógrafos) de 1 a N, da esquerda para a
    direita; a máscara passa na conferência da importação."""
    w, h = 640, 360
    inst = np.zeros((h, w), np.uint16)
    inst[100:160, 300:320] = 1  # jogador no meio
    inst[100:160, 20:40] = 2  # goleiro à esquerda
    inst[50:110, 500:520] = 3  # árbitro
    inst[0:20, 600:640] = 4  # gandula, cortado pela borda
    inst[200:204, 100:104] = 5  # jogador pequeno, mas exigido (16 px; 36 na referência de 960)
    inst[300:302, 200:202] = 6  # fotógrafo pequeno demais (4 px; 9 na referência): a página não exige
    tipos = ["jogador", "goleiro", "arbitro", "staff", "jogador", "staff", "jogador"]  # o 7 não aparece
    m, pessoas = lotes.numerar_pessoas(inst, tipos, w)
    assert [p["j"] for p in pessoas] == [1, 4, 5, 0, 2, 3]  # da esquerda para a direita
    assert [p["numero"] for p in pessoas] == [1, 2, 3, 4, 5, 6]
    assert [p["tipo"] for p in pessoas] == ["goleiro", "jogador", "staff", "jogador", "arbitro", "staff"]
    assert [p["pequeno"] for p in pessoas] == [False, False, True, False, False, False]
    assert [p["borda"] for p in pessoas] == [False, False, False, False, False, True]
    assert m[130, 30] == 1 and m[130, 310] == 4 and m[80, 510] == 5 and m[5, 630] == 6 and m[0, 0] == 0
    item = GabaritoPessoas(
        id="g3001",
        imagem="g3001.jpg",
        mascara="g3001.png",
        largura=w,
        altura=h,
        pessoas=len(pessoas),
        origem="simulador",
    )
    png = gravar_png(m, lotes.paleta_da_verdade(item.pessoas))
    conferir_mascara(png, item)
    assert np.array_equal(ler_png(png), m)
    with pytest.raises(ValueError, match="além das 5 pessoas"):
        conferir_mascara(png, item.model_copy(update={"pessoas": 5}))
    vazio, ninguem = lotes.numerar_pessoas(np.zeros((h, w), np.uint16), tipos, w)  # só a torcida
    assert ninguem == [] and not vazio.any()


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
