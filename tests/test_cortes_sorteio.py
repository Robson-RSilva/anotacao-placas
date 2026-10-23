"""Cortes, agrupamento e sorteio: regras do laboratório e as garantias do sorteio."""

import numpy as np

from anotacao.cortes import TomadaBruta, _kmedias, detectar_cortes, razao_adaptativa, replays_por_vinheta
from anotacao.sorteio import ParametrosSorteio, atribuir, semente_de, sortear


def _razao_referencia(d, janela=15):
    """A versão em laço do laboratório."""
    n = len(d)
    r = np.zeros(n)
    for i in range(1, n):
        w = np.r_[d[max(1, i - janela) : i], d[i + 1 : min(n, i + janela + 1)]]
        if len(w) == 0:
            continue
        med = np.median(w)
        mad = 1.4826 * np.median(np.abs(w - med))
        r[i] = (d[i] - med) / (mad + 1e-3 + 0.1 * med)
    return r


def test_razao_adaptativa_igual_ao_laco():
    rng = np.random.default_rng(1)
    for n in (2, 5, 40, 500):
        d = np.abs(rng.normal(0, 0.02, n))
        d[0] = 0.0
        assert np.allclose(razao_adaptativa(d), _razao_referencia(d), atol=1e-12)


def test_detectar_cortes():
    rng = np.random.default_rng(2)
    d_hist = np.abs(rng.normal(0.01, 0.003, 300))
    d_estr = np.abs(rng.normal(0.02, 0.005, 300))
    for c in (50, 140, 220):
        d_hist[c] = 0.6
        d_estr[c] = 0.8
    assert detectar_cortes(d_hist, d_estr) == [50, 140, 220]


def test_replays_por_vinheta():
    s = np.zeros(200)
    s[20:25] = 0.9  # entrada
    s[80:85] = 0.9  # saída
    replay, trans, grupos = replays_por_vinheta(s)
    assert len(grupos) == 2
    assert replay[20:85].all() and not replay[:20].any() and not replay[86:].any()
    assert trans[20:25].all()


def test_kmedias_deterministico():
    rng = np.random.default_rng(3)
    X = np.r_[rng.normal(0, 0.1, (20, 2)), rng.normal(5, 0.1, (20, 2))]
    a = _kmedias(X, 2, semente=7)
    assert np.array_equal(a, _kmedias(X, 2, semente=7))
    assert len(set(a[:20])) == 1 and len(set(a[20:])) == 1 and a[0] != a[-1]


def _cenario(n_tomadas=12, quadros=100, fps=25.0):
    tomadas = [TomadaBruta(k * quadros, (k + 1) * quadros, None, grupo=k % 3) for k in range(n_tomadas)]
    pts = np.arange(n_tomadas * quadros) * 1000.0 / fps
    return tomadas, pts, np.zeros(len(pts), bool)


def test_sorteio_respeita_tomadas_e_margens():
    tomadas, pts, trans = _cenario()
    p = ParametrosSorteio(alvo=30, margem_s=0.4, max_por_tomada=2, tomada_longa_s=3.0)
    s = sortear(tomadas, pts, trans, p, semente_de("x"))
    assert 12 <= len(s) <= 24
    por_tomada = {}
    for q in s:
        t = tomadas[q.tomada]
        assert pts[t.i0] + 400 <= q.pts_ms <= pts[t.i1 - 1] - 400
        por_tomada[q.tomada] = por_tomada.get(q.tomada, 0) + 1
    assert max(por_tomada.values()) <= 2
    assert len({q.quadro for q in s}) == len(s)
    assert sortear(tomadas, pts, trans, p, semente_de("x")) == s  # determinístico


def test_sorteio_equilibra_grupos_e_marca_duplas():
    tomadas, pts, trans = _cenario(n_tomadas=40)
    for t in tomadas[:30]:
        t.grupo = 0  # um grupo dominante (a câmera principal)
    s = sortear(tomadas, pts, trans, ParametrosSorteio(alvo=20), semente_de("y"))
    grupos = [tomadas[q.tomada].grupo for q in s]
    assert len(s) == 20
    assert grupos.count(0) < 16  # os grupos raros não somem
    assert sum(q.dupla for q in s) == 2 and sum(q.sem_previsao for q in s) == 2


def test_atribuir_dupla_para_pessoas_diferentes():
    tomadas, pts, trans = _cenario()
    s = sortear(tomadas, pts, trans, ParametrosSorteio(alvo=20, frac_dupla=0.5), semente_de("z"))
    atr = atribuir(s, ["A01", "A02", "A03"], semente_de("z"))
    for q, a in zip(s, atr, strict=True):
        assert len(a) == (2 if q.dupla else 1)
        assert len(set(a)) == len(a)
    contagem = {c: sum(c in a for a in atr) for c in ("A01", "A02", "A03")}
    assert max(contagem.values()) - min(contagem.values()) <= 3
    assert atribuir(s, [], 1) == [[] for _ in s]
