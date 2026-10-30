"""O campo é o mesmo do laboratório: nomes, geometria, amostras e simetria."""

import numpy as np

from anotacao.campo import PONTOS_SEM_MARCA, Campo, perm180_dos_nomes, pontos_marcaveis


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


def test_pontos_que_se_marcam():
    nomes = pontos_marcaveis()
    assert len(nomes) == 39 and not set(nomes) & set(PONTOS_SEM_MARCA)
    assert nomes[0] == "canto_esq_cab" and "gol_dir_topo_opo" in nomes
    p = perm180_dos_nomes()
    assert p["canto_esq_cab"] == "canto_dir_opo" and p["centro"] == "centro" and p["penalti_esq"] == "penalti_dir"
    assert all(p[p[n]] == n for n in p)  # a rotação duas vezes é a identidade
    assert {p[n] for n in nomes} == set(nomes)  # o outro lado de um ponto que se marca também se marca
