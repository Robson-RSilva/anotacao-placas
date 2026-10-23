"""A API do servidor local, de ponta a ponta: importar, anotar, revisar às cegas, gabarito, placar e unificar."""

from __future__ import annotations

import time

import cv2
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from anotacao.camera import Camera
from anotacao.campo import Campo
from anotacao.formatos import CameraRotulo, GabaritoCamera
from anotacao.gabarito import importar
from anotacao.preprocessamento import preprocessar
from anotacao.servidor import Configuracao, criar_app
from anotacao.sorteio import ParametrosSorteio
from sintetico import renderizar

H = {"X-Anotacao": "1"}
CAMPO = Campo()


@pytest.fixture
def ambiente(pasta, video, cadastro, tmp_path):
    caminho, verdade = video
    r = preprocessar(pasta, caminho, cadastro, params=ParametrosSorteio(alvo=10, frac_dupla=0.0, frac_sem_previsao=0.0))
    cfg = Configuracao(pasta=pasta.raiz, pasta_videos=tmp_path / "videos", config_local=tmp_path / "cfg" / "c.json")
    cliente = TestClient(criar_app(cfg))
    return cliente, pasta, verdade, r.partida


def entrar(cliente, codigo):
    assert cliente.post("/api/anotador", json={"codigo": codigo}, headers=H).status_code == 200


def corpo_da_camera(cam: Camera, pontos=("centro", "meio_cab", "circ_esq", "circ_dir")) -> dict:
    pins = []
    for nome in CAMPO.nomes_pontos:
        px, _ = cam.project(CAMPO.ponto(nome))
        if cam.in_image(px)[0] and (nome in pontos or len(pins) < 4):
            pins.append({"ponto": nome, "x": float(px[0, 0]), "y": float(px[0, 1])})
    return {
        "partiu_de": {"fonte": "registro"},
        "camera": cam.para_rotulo(),
        "pontos_travados": pins,
        "linhas_travadas": [],
        "situacao": "ok",
        "comentario": "",
        "segundos_ativos": 12.5,
    }


def itens_de(pasta, partida, pessoa):
    return [it for it in pasta.ler_fila(partida).itens if pessoa in it.atribuido_a]


def test_protecoes_de_servidor_local(ambiente):
    cliente, *_ = ambiente
    assert cliente.get("/api/estado", headers={"Host": "site-malicioso.com"}).status_code == 403
    assert cliente.post("/api/anotador", json={"codigo": "A01"}).status_code == 403
    assert cliente.post("/api/anotador", json={"codigo": "Z99"}, headers=H).status_code == 400
    assert cliente.get("/api/fila/camera").status_code == 409  # ninguém escolheu o código ainda


def test_paginas_e_pacote(ambiente):
    cliente, *_ = ambiente
    for url in ("/", "/camera", "/revisao", "/static/js/editor.js", "/static/css/estilo.css"):
        assert cliente.get(url).status_code == 200, url
    geo = cliente.get("/api/pacotes/estadio-sintetico/1.0").json()
    assert len(geo["campo"]["elementos"]) == 26 and len(geo["pacote"]["placas"]) > 0
    assert cliente.get("/api/pacotes/nao-existe/1.0").status_code == 404


def test_anotar_revisar_aprovar_e_unificar(ambiente):
    cliente, pasta, verdade, pid = ambiente
    entrar(cliente, "A01")
    est = cliente.get("/api/estado").json()
    assert est["anotador"] == "A01" and est["situacao"]["liberado"]  # sem gabarito importado, não há bloqueio
    meus = itens_de(pasta, pid, "A01")
    it = cliente.get("/api/fila/camera").json()["item"]
    assert it["partiu_de"]["fonte"] == "registro" and not it["treino"]
    assert "partida" not in it and "quadro" not in it  # a página não sabe de onde é o item
    assert cliente.get(it["imagem_url"]).headers["content-type"] == "image/jpeg"
    cam = verdade[meus[0].i]
    r = cliente.post(f"/api/rotulos/camera?ficha_token={it['ficha']}", json=corpo_da_camera(cam), headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["residuo_mediano_px"] < 0.01
    assert r.json()["arquivo"] == f"{meus[0].quadro}__A01__v1.json"
    # a mesma ficha não serve duas vezes
    assert (
        cliente.post(f"/api/rotulos/camera?ficha_token={it['ficha']}", json=corpo_da_camera(cam), headers=H).status_code
        == 409
    )
    # o próximo quadro de A01 é outro; o rótulo salvo serve de partida se for da mesma tomada
    prox = cliente.get("/api/fila/camera").json()["item"]
    assert prox is None or prox["ficha"] != it["ficha"]

    entrar(cliente, "A02")
    rev = cliente.get("/api/fila/revisao").json()
    assert rev["pendentes"] == 1
    item = rev["item"]
    assert "anotador" not in item["rotulo"] and "A01" not in str(item)  # revisão às cegas
    assert (
        cliente.post("/api/revisoes/camera", json={"ref": item["ref"], "decisao": "aprovar"}, headers=H).status_code
        == 200
    )
    assert cliente.get("/api/fila/revisao").json()["item"] is None

    placar = cliente.get("/api/placar").json()
    a01 = next(p for p in placar["pessoas"] if p["pessoa"] == "A01")
    assert a01["aprovados"] == 1 and a01["taxa_aprovacao"] == 1.0 and a01["tempo_mediano_s"] == 12.5

    u = cliente.post("/api/unificar", headers=H).json()
    assert u["quadros"] == 1 and u["por_conjunto"] == {"treino": 1}
    df = pd.read_parquet(pasta.raiz / u["destino"] / "camera.parquet")
    assert df.loc[0, "quadro"] == meus[0].quadro and df.loc[0, "revisor"] == "A02"
    assert df.loc[0, "emissora"] == "Emissora X"


def test_devolver_e_corrigir(ambiente):
    cliente, pasta, verdade, pid = ambiente
    meus = itens_de(pasta, pid, "A01")
    entrar(cliente, "A01")
    it = cliente.get("/api/fila/camera").json()["item"]
    errada = verdade[meus[0].i]
    errada = Camera.from_hfov(errada.hfov * 1.1, *errada.ptr, errada.C, errada.w, errada.h)
    cliente.post(f"/api/rotulos/camera?ficha_token={it['ficha']}", json=corpo_da_camera(errada), headers=H)

    entrar(cliente, "A02")
    item = cliente.get("/api/fila/revisao").json()["item"]
    r = cliente.post("/api/revisoes/camera", json={"ref": item["ref"], "decisao": "devolver"}, headers=H)
    assert r.status_code == 422  # devolver exige motivo
    r = cliente.post(
        "/api/revisoes/camera",
        json={"ref": item["ref"], "decisao": "devolver", "motivo": "molde_fora_da_tolerancia", "comentario": "zoom"},
        headers=H,
    )
    assert r.status_code == 200, r.text

    entrar(cliente, "A01")
    volta = cliente.get("/api/fila/camera").json()["item"]
    assert volta["devolvido"] == {"motivo": "molde_fora_da_tolerancia", "comentario": "zoom"}
    assert volta["versao"] == 2 and volta["partiu_de"]["fonte"] == "rotulo_anterior"
    cliente.post(f"/api/rotulos/camera?ficha_token={volta['ficha']}", json=corpo_da_camera(errada), headers=H)

    entrar(cliente, "A02")
    item = cliente.get("/api/fila/revisao").json()["item"]
    certa = corpo_da_camera(verdade[meus[0].i])
    r = cliente.post(
        "/api/revisoes/camera", json={"ref": item["ref"], "decisao": "corrigir", "correcao": certa}, headers=H
    )
    assert r.status_code == 200, r.text
    assert r.json()["correcao"] == f"{meus[0].quadro}__A02__v1.json"
    assert cliente.get("/api/fila/revisao").json()["item"] is None  # correção não volta para a fila

    u = cliente.post("/api/unificar", headers=H).json()
    df = pd.read_parquet(pasta.raiz / u["destino"] / "camera.parquet")
    assert len(df) == 1 and df.loc[0, "anotador"] == "A02" and df.loc[0, "decisao"] == "corrigir"
    assert df.loc[0, "hfov_graus"] == pytest.approx(verdade[meus[0].i].hfov)


def _gabarito(pasta, pacote, origem, n=12):
    origem.mkdir(parents=True, exist_ok=True)
    T = np.asarray(pacote.cameras[0].T, float)
    for k in range(n):
        cam = Camera.look_at(T + np.array([k * 0.3, 0, 0]), [-20 + 4 * k, (-1) ** k * 6.0, 0], 30 + k, 640, 360)
        cv2.imwrite(str(origem / f"g{k + 1:04d}.jpg"), renderizar(cam, CAMPO, pacote, k))
        (origem / f"g{k + 1:04d}.json").write_text(
            GabaritoCamera(
                id=f"g{k + 1:04d}",
                pacote=pacote.ref,
                imagem=f"g{k + 1:04d}.jpg",
                largura=640,
                altura=360,
                camera=CameraRotulo(**cam.para_rotulo()),
                origem="simulador",
            ).model_dump_json(),
            encoding="utf-8",
        )
    return importar(pasta, origem)


def test_gabarito_treina_e_libera(ambiente, pacote, tmp_path):
    cliente, pasta, _verdade, _pid = ambiente
    assert len(_gabarito(pasta, pacote, tmp_path / "origem")) == 12
    assert _gabarito(pasta, pacote, tmp_path / "origem") == []  # importar de novo não duplica
    entrar(cliente, "A01")
    itens = {g.id: g for g in __import__("anotacao.gabarito", fromlist=["x"]).listar_itens(pasta)}
    for k in range(10):
        est = cliente.get("/api/estado").json()["situacao"]
        assert not est["liberado"]
        it = cliente.get("/api/fila/camera").json()["item"]
        assert it["treino"], k
        # descobre o item pela imagem (a página não sabe qual é) e responde com a câmera verdadeira
        img = cv2.imdecode(np.frombuffer(cliente.get(it["imagem_url"]).content, np.uint8), cv2.IMREAD_COLOR)
        g = min(
            itens.values(),
            key=lambda g: float(
                np.abs(cv2.imread(str(pasta.gabarito / "itens" / g.imagem)).astype(int) - img.astype(int)).mean()
            ),
        )
        cam = Camera.de_rotulo(g.camera.model_dump(), g.largura, g.altura)
        r = cliente.post(f"/api/rotulos/camera?ficha_token={it['ficha']}", json=corpo_da_camera(cam), headers=H)
        res = r.json()["gabarito"]
        assert res["ok"] and res["mediana_px"] < 0.01
    assert cliente.get("/api/estado").json()["situacao"]["liberado"]
    it = cliente.get("/api/fila/camera").json()["item"]
    assert not it["treino"]
    placar = cliente.get("/api/placar").json()
    a01 = next(p for p in placar["pessoas"] if p["pessoa"] == "A01")
    assert a01["gabarito_n"] == 10 and a01["liberado"]


def test_importar_pelo_navegador(ambiente, video, cadastro):
    cliente, *_ = ambiente
    caminho, _ = video
    env = cliente.put("/api/videos?nome=jogo.mp4", content=caminho.read_bytes(), headers=H).json()
    assert len(env["video_sha256"]) == 64
    novo = cadastro.model_copy(update={"mandante": "Time C"})
    t = cliente.post(
        "/api/partidas",
        json={
            "cadastro": novo.model_dump(mode="json"),
            "alvo": 5,
            "video_sha256": env["video_sha256"],
            "nome_original": "jogo.mp4",
        },
        headers=H,
    ).json()["tarefa"]
    for _ in range(100):
        st = cliente.get(f"/api/tarefas/{t}").json()
        if st["estado"] in ("ok", "erro"):
            break
        time.sleep(0.1)
    # o mesmo vídeo já é outra partida
    assert st["estado"] == "erro" and "já foi importado" in st["erro"]
    assert cliente.put("/api/videos?nome=x.exe", content=b"abc", headers=H).status_code == 400
