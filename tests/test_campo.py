"""O molde do campo é o mesmo do laboratório: nomes, geometria, amostras e simetria."""

import numpy as np

from anotacao.campo import Campo


def test_campo_igual_ao_laboratorio(laboratorio):
    for ref in laboratorio["campos"]:
        F = Campo(L=ref["L"], W=ref["W"])
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
