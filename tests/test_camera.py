"""O modelo de câmera da ferramenta é o mesmo do laboratório (fixture gerada pelo laboratório)."""

import numpy as np
import pytest

from anotacao.camera import Camera, canonical_side, mirror_camera, ptr_from_rot, rot_from_ptr


def _camera(c: dict) -> Camera:
    return Camera.from_ptr(c["f"], c["pan"], c["tilt"], c["roll"], c["C"], c["w"], c["h"], c["k1"])


def _pixels(lista) -> np.ndarray:
    return np.array([[np.nan, np.nan] if p is None else p for p in lista], float)


def test_projecao_igual_ao_laboratorio(laboratorio):
    X = np.array(laboratorio["pontos_3d"], float)
    for caso in laboratorio["casos"]:
        cam = _camera(caso["camera"])
        px, z = cam.project(X)
        esperado = _pixels(caso["pixels"])
        assert np.array_equal(np.isnan(px), np.isnan(esperado))
        ok = np.isfinite(esperado).all(1)
        assert np.max(np.abs(px[ok] - esperado[ok])) < 1e-6
        assert np.allclose(z, caso["profundidade"], atol=1e-9)
        assert np.allclose(cam.R, caso["R"], atol=1e-12)


def test_angulos_ida_e_volta(laboratorio):
    for caso in laboratorio["casos"]:
        c = caso["camera"]
        assert np.allclose(
            ptr_from_rot(rot_from_ptr(c["pan"], c["tilt"], c["roll"])), (c["pan"], c["tilt"], c["roll"]), atol=1e-9
        )
        assert _camera(c).hfov == pytest.approx(c["hfov_graus"], abs=1e-9)


def test_espelhada_e_lado_canonico(laboratorio):
    for caso in laboratorio["casos"]:
        cam = _camera(caso["camera"])
        esp = mirror_camera(cam)
        pan, tilt, roll = esp.ptr
        e = caso["espelhada"]
        assert (pan, tilt, roll) == pytest.approx((e["pan"], e["tilt"], e["roll"]), abs=1e-9)
        assert np.allclose(esp.C, e["C"])
        assert canonical_side(cam.C) == caso["lado_canonico"]


def test_rotulo_ida_e_volta():
    cam = Camera.look_at([3.0, -58.0, 14.0], [10.0, 5.0, 0.0], 33.0, 1920, 1080, roll=0.7, k1=-0.05)
    de_volta = Camera.de_rotulo(cam.para_rotulo(), 1920, 1080)
    X = np.array([[0.0, 0.0, 0.0], [20.0, 10.0, 0.0], [-30.0, -20.0, 2.44]])
    assert np.allclose(cam.project(X)[0], de_volta.project(X)[0], atol=1e-9)


def test_espelhada_ve_as_mesmas_marcacoes():
    cam = Camera.look_at([0.0, -58.0, 14.0], [12.0, 3.0, 0.0], 40.0)
    X = np.array([[10.0, 5.0, 0.0], [-20.0, 30.0, 0.0]])
    assert np.allclose(cam.project(X)[0], mirror_camera(cam).project(X * [-1, -1, 1])[0])
