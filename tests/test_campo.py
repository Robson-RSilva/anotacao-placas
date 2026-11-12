"""O campo: com `largura_linha=0`, a geometria da regra é a do laboratório (nomes, geometria, amostras e
simetria); no padrão, os pontos ficam no meio das linhas (ADR-0016)."""

import numpy as np

from anotacao.campo import PONTOS_SEM_MARCA, Campo, perm180_dos_nomes, pontos_marcaveis


def test_campo_igual_ao_laboratorio(laboratorio):
    for ref in laboratorio["campos"]:
        F = Campo(L=ref["L"], W=ref["W"], largura_linha=0.0)
        assert F.nomes_elementos == [e["nome"] for e in ref["elementos"]]
        assert F.nomes_pontos == [p["nome"] for p in ref["pontos"]]
        for el, e in zip(F.elementos, ref["elementos"], strict=True):
            assert el.tipo == e["tipo"]
            assert el.grupo == e["grupo"]
            if el.tipo == "line":
                assert np.allclose(el.A, e["A"]) and np.allclose(el.B, e["B"])
            else:
                assert np.allclose(el.centro, e["centro"])
                assert np.isclose(el.raio, e["raio"]) and np.isclose(el.a0, e["a0"]) and np.isclose(el.a1, e["a1"])
            assert np.allclose(el.amostrar(1.0), e["amostras_1m"], atol=1e-12)
        for (nome, (X, tipo)), p in zip(F.pontos.items(), ref["pontos"], strict=True):
            assert nome == p["nome"] and tipo == p["tipo"]
            assert np.allclose(X, p["X"])
        pe, pk = F.perm180()
        assert pe == ref["perm180_elementos"]
        assert pk == ref["perm180_pontos"]


def test_pontos_no_meio_das_linhas():
    """Cada linha anda meia largura (6 cm) para dentro da área que ela fecha; o topo da trave fica no meio do
    tubo. A simetria e os nomes não mudam."""
    for L, W in ((105.0, 68.0), (100.0, 64.0)):
        F = Campo(L=L, W=W)
        P = {n: X for n, (X, _) in F.pontos.items()}
        assert np.allclose(P["canto_esq_cab"], [-L / 2 + 0.06, -W / 2 + 0.06, 0])
        assert np.isclose(P["ga_esq_frente_cab"][0] - P["ga_esq_fundo_cab"][0], 16.38)
        assert np.isclose(P["ga_esq_frente_opo"][1] - P["ga_esq_frente_cab"][1], 40.20)
        assert np.isclose(P["pa_esq_frente_cab"][0] - P["pa_esq_fundo_cab"][0], 5.38)
        assert np.isclose(P["pa_esq_frente_opo"][1] - P["pa_esq_frente_cab"][1], 18.20)
        assert np.allclose(P["gol_esq_topo_cab"], [-L / 2 + 0.06, -3.72, 2.50])
        assert np.allclose(P["penalti_esq"], [-L / 2 + 11.0, 0, 0])  # 11 m da borda de fora da linha de fundo
        assert np.isclose(np.linalg.norm(P["circ_meio_cab"]), 9.09)
        ml = P["ml_esq_cab"]
        assert np.isclose(np.hypot(ml[0] - P["penalti_esq"][0], ml[1]), 9.09)
        assert np.isclose(ml[0], P["ga_esq_frente_cab"][0])  # a meia-lua encontra a linha da grande área no meio dela
        assert F.perm180() == Campo(L=L, W=W, largura_linha=0.0).perm180()


def test_contagens_e_simetria():
    F = Campo()
    assert len(F.elementos) == 26
    assert len(F.pontos) == 43
    pe, pk = F.perm180()
    assert sorted(pe) == list(range(26))
    assert [pk[i] for i in pk] == list(range(43))  # a rotação de 180° aplicada duas vezes é a identidade


def test_para_web():
    geo = Campo(L=100, W=64).para_web()
    assert geo["L"] == 100 and len(geo["elementos"]) == 26 and len(geo["pontos"]) == 43
    assert {e["tipo"] for e in geo["elementos"]} == {"reta", "arco"}
    assert len(geo["perm180"]["pontos"]) == 43


def test_pontos_que_se_marcam():
    nomes = pontos_marcaveis()
    assert len(nomes) == 39 and not set(nomes) & set(PONTOS_SEM_MARCA)
    assert nomes[0] == "canto_esq_cab" and "gol_dir_topo_opo" in nomes
    p = perm180_dos_nomes()
    assert p["canto_esq_cab"] == "canto_dir_opo" and p["centro"] == "centro" and p["penalti_esq"] == "penalti_dir"
    assert all(p[p[n]] == n for n in p)  # a rotação duas vezes é a identidade
    assert {p[n] for n in nomes} == set(nomes)  # o outro lado de um ponto que se marca também se marca
