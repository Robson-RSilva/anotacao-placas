"""Linha de comando: exemplo, gabarito, prever, validar, unificar e esquemas."""

from __future__ import annotations

import json

import cv2
import numpy as np

from anotacao.camera import Camera
from anotacao.campo import Campo
from anotacao.cli import main
from anotacao.formatos import ESQUEMAS, DispositivoPessoa, GabaritoCamera, Previsao
from anotacao.pasta import Pasta, escrever_json, ler_json

from conftest import AGORA, PARTIDA, criar_partida, gravar_revisao, gravar_rotulo
from sintetico import renderizar


def test_exemplo_validar_e_unificar(tmp_path, capsys):
    destino = tmp_path / "trabalho"
    assert main(["exemplo", str(destino)]) == 0
    pasta = Pasta(destino)
    assert pasta.listar_pacotes() == ["estadio-sintetico/pacote-1.0", "generico/pacote-1.0"]
    assert [m.codigo for m in pasta.ler_equipe().membros] == ["A01", "A02"]
    assert main(["exemplo", str(destino)]) == 0  # de novo não estraga nada
    fila = criar_partida(pasta, [{}, {}])
    nome = gravar_rotulo(pasta, fila.itens[0].quadro, "A01", None)
    gravar_revisao(pasta, fila.itens[0].quadro, nome, "A02")
    capsys.readouterr()
    assert main(["validar", "--pasta", str(destino)]) == 0
    assert "0 problema(s) em 1 partida(s)" in capsys.readouterr().out
    assert main(["unificar", "--pasta", str(destino)]) == 0
    assert "0 quadros" in capsys.readouterr().out  # o aprovado é "sem marcações": não entra


def test_validar_aponta_problemas(pasta, capsys):
    fila = criar_partida(pasta, [{}, {}], imagens=False)
    (pasta.rotulos(PARTIDA, "camera")).mkdir(parents=True, exist_ok=True)
    (pasta.rotulos(PARTIDA, "camera") / f"{fila.itens[0].quadro}__A01__v1.json").write_text("{}", encoding="utf-8")
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 1
    saida = capsys.readouterr().out
    assert "2 quadro(s) da fila sem imagem" in saida
    assert "__A01__v1.json" in saida


def test_validar_registros_dos_codigos(pasta, capsys):
    """pessoas/<codigo>/<dispositivo>.json: em que computadores cada código é usado."""
    dispositivo = "3f2a6c1e-8b9d-4e2f-a1b3-c4d5e6f70812"
    certo = DispositivoPessoa(codigo="AB", dispositivo=dispositivo, criado_em=AGORA)
    escrever_json(pasta.pessoas / "AB" / f"{dispositivo}.json", certo)
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 0
    capsys.readouterr()
    escrever_json(pasta.pessoas / "CD" / f"{dispositivo}.json", certo)  # o código não bate com a pasta
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 1
    assert f"pessoas/CD/{dispositivo}.json: o conteúdo não bate" in capsys.readouterr().out


def test_validar_partida_incompleta(pasta, capsys):
    criar_partida(pasta, [{}], imagens=False)
    pasta.fila(PARTIDA).unlink()  # a fila ainda não sincronizou
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 1
    assert f"{PARTIDA}: partida incompleta ou inválida" in capsys.readouterr().out


def test_gabarito(pasta, pacote, tmp_path, capsys):
    origem = tmp_path / "gab"
    origem.mkdir()
    cam = Camera.look_at(np.asarray(pacote.cameras[0].T, float), [-10.0, 3.0, 0.0], 30, 640, 360)
    cv2.imwrite(str(origem / "g0001.jpg"), renderizar(cam, Campo(), pacote, 1))
    g = GabaritoCamera(
        id="g0001",
        pacote=pacote.ref,
        imagem="g0001.jpg",
        largura=640,
        altura=360,
        camera=cam.para_rotulo(),
        origem="simulador",
    )
    (origem / "g0001.json").write_text(g.model_dump_json(), encoding="utf-8")
    assert main(["gabarito", str(origem), "--pasta", str(pasta.raiz)]) == 0
    assert main(["gabarito", str(origem), "--pasta", str(pasta.raiz)]) == 0  # o que já existe fica
    assert capsys.readouterr().out.splitlines() == ["1 itens novos no gabarito", "0 itens novos no gabarito"]
    assert (pasta.gabarito / "itens" / "g0001.jpg").exists()
    # imagem que não é JPEG é recusada
    cv2.imwrite(str(origem / "g0002.png"), renderizar(cam, Campo(), pacote, 2))
    g2 = g.model_copy(update={"id": "g0002", "imagem": "g0002.png"})
    (origem / "g0002.json").write_text(g2.model_dump_json(), encoding="utf-8")
    try:
        main(["gabarito", str(origem), "--pasta", str(pasta.raiz)])
    except ValueError as e:
        assert "JPEG" in str(e)
    else:
        raise AssertionError("aceitou PNG")


def test_prever(pasta, capsys):
    fila = criar_partida(pasta, [{}, {"sem_previsao": True}, {}])
    args = ["prever", "--pasta", str(pasta.raiz), "--previsor", "previsor_teste:PrevisorFixo"]
    assert main(args) == 0
    assert "2 previsões gravadas (fixo@1)" in capsys.readouterr().out
    p = ler_json(pasta.previsao(PARTIDA, fila.itens[0].quadro), Previsao)
    assert p.fonte == "fixo" and p.camera is not None and p.confianca == 0.5
    assert not pasta.previsao(PARTIDA, fila.itens[1].quadro).exists()
    assert main(args) == 0
    assert "0 previsões" in capsys.readouterr().out
    assert main([*args, "--refazer"]) == 0
    assert "2 previsões" in capsys.readouterr().out


def test_esquemas(tmp_path):
    assert main(["esquemas", str(tmp_path)]) == 0
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(ESQUEMAS)
    assert json.loads((tmp_path / "rotulo.camera.json").read_text(encoding="utf-8"))["title"] == "RotuloCamera"
