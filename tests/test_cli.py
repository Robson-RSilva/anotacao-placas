"""Linha de comando: exemplo, gabarito, prever, validar, unificar e esquemas."""

from __future__ import annotations

import json

import cv2
import numpy as np
import pytest

from anotacao.cli import main
from anotacao.formatos import ESQUEMAS, DispositivoPessoa, GabaritoJogadores, GabaritoPontos, PrevisaoPontos
from anotacao.gabarito import listar_itens
from anotacao.mascara import gravar_png, ler_png
from anotacao.pasta import Pasta, escrever_json, ler_json, mascara_de

from conftest import AGORA, PARTIDA, camera_exemplo, criar_partida, gravar_jogadores, gravar_pontos, gravar_revisao
from sintetico import renderizar


def test_exemplo_validar_e_unificar(tmp_path, capsys):
    destino = tmp_path / "trabalho"
    assert main(["exemplo", str(destino)]) == 0
    pasta = Pasta(destino)
    assert [m.codigo for m in pasta.ler_equipe().membros] == ["A01", "A02"]
    assert main(["exemplo", str(destino)]) == 0  # de novo não estraga nada
    fila = criar_partida(pasta, [{}, {}])
    nome = gravar_pontos(pasta, fila.itens[0].quadro, "A01", None)  # descartada
    gravar_revisao(pasta, "pontos", fila.itens[0].quadro, nome, "A02")
    capsys.readouterr()
    assert main(["validar", "--pasta", str(destino)]) == 0
    assert "0 problema(s) em 1 partida(s)" in capsys.readouterr().out
    assert main(["unificar", "--pasta", str(destino)]) == 0
    saida = capsys.readouterr().out
    assert "pontos: 0 quadros" in saida and "descartados em pontos: {'transicao': 1}" in saida


def test_validar_aponta_problemas(pasta, capsys):
    fila = criar_partida(pasta, [{}, {}], imagens=False)
    pasta.rotulos(PARTIDA, "pontos").mkdir(parents=True, exist_ok=True)
    (pasta.rotulos(PARTIDA, "pontos") / f"{fila.itens[0].quadro}__A01__v1.json").write_text("{}", encoding="utf-8")
    gravar_pontos(pasta, "t0000099999", "A01", {"centro": (1.0, 2.0)})  # um quadro que não está na fila
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 1
    saida = capsys.readouterr().out
    assert "2 quadro(s) da fila sem imagem" in saida
    assert f"{fila.itens[0].quadro}__A01__v1.json" in saida
    assert "t0000099999__A01__v1.json: o quadro não está na fila" in saida


def test_validar_mascara_dos_jogadores(pasta, capsys):
    """A máscara existe, tem o tamanho da imagem, só 0 e 1, e os pixels que o rótulo diz."""
    fila = criar_partida(pasta, [{}], imagens=False)
    q = fila.itens[0].quadro
    m = np.zeros((360, 640), np.uint8)
    m[100:150, 200:220] = 1
    nome = gravar_jogadores(pasta, q, "A01", m)
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 1  # (só os quadros sem imagem)
    assert "jogadores" not in capsys.readouterr().out
    caminho = pasta.rotulos(PARTIDA, "jogadores") / nome
    r = json.loads(caminho.read_text(encoding="utf-8"))
    r["pixels"] += 50  # o rótulo diz uma coisa e a máscara outra
    caminho.write_text(json.dumps(r), encoding="utf-8")
    main(["validar", "--pasta", str(pasta.raiz)])
    assert "o rótulo diz 1050 pixels pintados, a máscara tem 1000" in capsys.readouterr().out
    (pasta.rotulos(PARTIDA, "jogadores") / mascara_de(nome)).unlink()  # o rótulo chegou antes da máscara
    main(["validar", "--pasta", str(pasta.raiz)])
    assert "a máscara ainda não chegou" in capsys.readouterr().out


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


def _item_pontos(origem, gid="g1001"):
    img, verdade = renderizar(camera_exemplo(), 1)
    cv2.imwrite(str(origem / f"{gid}.jpg"), img)
    g = GabaritoPontos(
        id=gid,
        lote="P1-treino",
        imagem=f"{gid}.jpg",
        largura=640,
        altura=360,
        pontos=[{"ponto": n, "x": x, "y": y, "visivel": True} for n, (x, y) in verdade["pontos"].items()],
        origem="simulador",
    )
    (origem / f"{gid}.json").write_text(g.model_dump_json(), encoding="utf-8")
    return g, verdade


def test_gabarito_dos_pontos(pasta, tmp_path, capsys):
    origem = tmp_path / "gab"
    origem.mkdir()
    g, _ = _item_pontos(origem)
    assert len(g.pontos) >= 4
    assert main(["gabarito", str(origem), "--pasta", str(pasta.raiz)]) == 0
    assert main(["gabarito", str(origem), "--pasta", str(pasta.raiz)]) == 0  # o que já existe fica
    assert capsys.readouterr().out.splitlines() == ["1 itens novos no gabarito", "0 itens novos no gabarito"]
    assert (pasta.gabarito / "itens" / "g1001.jpg").exists()
    assert [x.id for x in listar_itens(pasta, "pontos")] == ["g1001"] and listar_itens(pasta, "jogadores") == []
    # um item da 0.7 (câmera) na pasta não atrapalha: fica fora
    (pasta.gabarito / "itens" / "g0001.json").write_text(json.dumps({"formato": "gabarito.camera/1", "id": "g0001"}))
    assert [x.id for x in listar_itens(pasta)] == ["g1001"]
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 0
    # imagem que não é JPEG é recusada
    img, _ = renderizar(camera_exemplo(), 2)
    cv2.imwrite(str(origem / "g1002.png"), img)
    (origem / "g1002.json").write_text(g.model_copy(update={"id": "g1002", "imagem": "g1002.png"}).model_dump_json())
    with pytest.raises(ValueError, match="JPEG"):
        main(["gabarito", str(origem), "--pasta", str(pasta.raiz)])


def test_gabarito_dos_jogadores(pasta, tmp_path, capsys):
    """O item dos jogadores vem com a máscara verdadeira (um número por jogador): as três partes vão para a pasta."""
    origem = tmp_path / "gab"
    origem.mkdir()
    img, verdade = renderizar(camera_exemplo(), 1)
    cv2.imwrite(str(origem / "g2001.jpg"), img)
    m = verdade["jogadores"].copy()
    m[0:4, 0:4] = 255  # uma "outra pessoa"
    (origem / "g2001.png").write_bytes(gravar_png(m, [(0, 0, 0)] * 256))
    g = GabaritoJogadores(
        id="g2001",
        imagem="g2001.jpg",
        mascara="g2001.png",
        largura=640,
        altura=360,
        jogadores=1,
        outras_pessoas=1,
        origem="simulador",
    )
    (origem / "g2001.json").write_text(g.model_dump_json(), encoding="utf-8")
    assert main(["gabarito", str(origem), "--pasta", str(pasta.raiz)]) == 0
    assert capsys.readouterr().out.strip() == "1 itens novos no gabarito"
    assert sorted(p.name for p in (pasta.gabarito / "itens").iterdir()) == ["g2001.jpg", "g2001.json", "g2001.png"]
    assert [type(x).__name__ for x in listar_itens(pasta)] == ["GabaritoJogadores"]
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 0
    capsys.readouterr()
    # números além dos jogadores do item: recusado
    m[10, 10] = 9
    (origem / "g2002.png").write_bytes(gravar_png(m, [(0, 0, 0)] * 256))
    (origem / "g2002.json").write_text(g.model_copy(update={"id": "g2002", "mascara": "g2002.png"}).model_dump_json())
    with pytest.raises(ValueError, match=r"além dos 1 jogadores e das 1 outras pessoas"):
        main(["gabarito", str(origem), "--pasta", str(pasta.raiz)])
    (origem / "g2002.png").unlink()
    with pytest.raises(FileNotFoundError, match=r"g2002\.png"):
        main(["gabarito", str(origem), "--pasta", str(pasta.raiz)])


def test_prever_pontos(pasta, capsys):
    fila = criar_partida(pasta, [{}, {"sem_previsao": True}, {}])
    args = ["prever", "--tarefa", "pontos", "--pasta", str(pasta.raiz), "--previsor", "previsor_teste:PontosFixos"]
    assert main(args) == 0
    assert "2 previsões gravadas (fixo@1)" in capsys.readouterr().out
    p = ler_json(pasta.previsao_pontos(PARTIDA, fila.itens[0].quadro), PrevisaoPontos)
    assert p.fonte == "fixo" and [x.ponto for x in p.pontos] == ["centro", "meio_cab"]
    assert not pasta.previsao_pontos(PARTIDA, fila.itens[1].quadro).exists()
    assert main(args) == 0
    assert "0 previsões" in capsys.readouterr().out
    assert main([*args, "--refazer"]) == 0
    assert "2 previsões" in capsys.readouterr().out


def test_prever_jogadores(pasta, capsys):
    fila = criar_partida(pasta, [{}, {"sem_previsao": True}, {}])
    args = ["prever", "--tarefa", "jogadores", "--pasta", str(pasta.raiz), "--previsor", "previsor_teste:MascaraFixa"]
    assert main(args) == 0
    assert "2 previsões gravadas (mascara-fixa@1)" in capsys.readouterr().out
    m = ler_png(pasta.previsao_jogadores(PARTIDA, fila.itens[0].quadro))
    assert m.shape == (360, 640) and set(np.unique(m)) == {0, 1}
    assert not pasta.previsao_jogadores(PARTIDA, fila.itens[1].quadro).exists()


def test_esquemas(tmp_path):
    assert main(["esquemas", str(tmp_path)]) == 0
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(ESQUEMAS)
    assert json.loads((tmp_path / "rotulo.pontos.json").read_text(encoding="utf-8"))["title"] == "RotuloPontos"
