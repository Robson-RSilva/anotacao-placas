"""Linha de comando: exemplo, recortes, gabarito, prever, validar, unificar e esquemas."""

from __future__ import annotations

import json

import cv2
import numpy as np
import pytest

from anotacao.cli import main
from anotacao.formatos import (
    ESQUEMAS,
    DispositivoPessoa,
    GabaritoPlacas,
    GabaritoPontos,
    LoteRecortes,
    PrevisaoPontos,
)
from anotacao.gabarito import listar_itens
from anotacao.mascara import gravar_png, ler_png, rasterizar
from anotacao.pasta import ArquivoExiste, Pasta, escrever_json, ler_json, mascara_de
from anotacao.recortes import montar_lote

from conftest import (
    AGORA,
    PARTIDA,
    camera_exemplo,
    criar_partida,
    criar_recortes,
    gravar_placas,
    gravar_pontos,
    gravar_revisao,
)
from sintetico import recorte_sintetico, renderizar


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


def test_validar_recortes_e_mascara_das_placas(pasta, capsys):
    """Os recortes têm a imagem do tamanho que o lote diz; a máscara existe, tem o tamanho do recorte, só 0
    e 1, nada fora da região da placa e os pixels que o rótulo diz."""
    criar_partida(pasta, [{}])
    rec = criar_recortes(pasta, 2)
    r0, r1 = list(rec)
    m = np.zeros((72, 240), np.uint8)
    m[20:40, 100:150] = 1
    nome = gravar_placas(pasta, r0, "A01", m)
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 0
    capsys.readouterr()
    caminho = pasta.rotulos(PARTIDA, "placas") / nome
    r = json.loads(caminho.read_text(encoding="utf-8"))
    r["pixels"] += 50  # o rótulo diz uma coisa e a máscara outra
    caminho.write_text(json.dumps(r), encoding="utf-8")
    main(["validar", "--pasta", str(pasta.raiz)])
    assert "o rótulo diz 1050 pixels pintados, a máscara tem 1000" in capsys.readouterr().out
    fora = m.copy()
    fora[2, 2] = 1  # na arquibancada, fora da placa
    gravar_placas(pasta, r1, "A01", fora)
    main(["validar", "--pasta", str(pasta.raiz)])
    assert f"{r1}__A01__v1.json: a máscara tem pintura fora da região da placa" in capsys.readouterr().out
    (pasta.rotulos(PARTIDA, "placas") / mascara_de(nome)).unlink()  # o rótulo chegou antes da máscara
    gravar_placas(pasta, "t0000099999_p9", "A02", m)  # um recorte que não está nos lotes
    pasta.recorte(PARTIDA, r1).write_bytes(b"\xff\xd8\xff nada")  # imagem estragada
    main(["validar", "--pasta", str(pasta.raiz)])
    saida = capsys.readouterr().out
    assert "a máscara ainda não chegou" in saida
    assert "t0000099999_p9__A02__v1.json: o recorte não está nos lotes da partida" in saida
    assert f"{r1}.jpg: não é um JPEG do tamanho que o lote diz" in saida


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
    assert [x.id for x in listar_itens(pasta, "pontos")] == ["g1001"] and listar_itens(pasta, "pessoas") == []
    # itens das versões anteriores na pasta (a câmera da 0.7, os jogadores da 0.8) não atrapalham: ficam fora
    (pasta.gabarito / "itens" / "g0001.json").write_text(json.dumps({"formato": "gabarito.camera/1", "id": "g0001"}))
    (pasta.gabarito / "itens" / "g2001.json").write_text(json.dumps({"formato": "gabarito.jogadores/1", "id": "g2001"}))
    assert [x.id for x in listar_itens(pasta)] == ["g1001"]
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 0
    # imagem que não é JPEG é recusada
    img, _ = renderizar(camera_exemplo(), 2)
    cv2.imwrite(str(origem / "g1002.png"), img)
    (origem / "g1002.json").write_text(g.model_copy(update={"id": "g1002", "imagem": "g1002.png"}).model_dump_json())
    with pytest.raises(ValueError, match="JPEG"):
        main(["gabarito", str(origem), "--pasta", str(pasta.raiz)])


def test_gabarito_das_placas(pasta, tmp_path, capsys):
    """O item das placas vem com a máscara verdadeira (um número por coisa na frente da placa): as três partes
    vão para a pasta; o item para descartar vem sem máscara."""
    origem = tmp_path / "gab"
    origem.mkdir()
    img, regiao, verdade = recorte_sintetico(7, oclusores=3)
    cv2.imwrite(str(origem / "g4001.jpg"), img)
    (origem / "g4001.png").write_bytes(gravar_png(verdade, [(0, 0, 0)] * 256))
    h, w = verdade.shape
    g = GabaritoPlacas(
        id="g4001",
        imagem="g4001.jpg",
        mascara="g4001.png",
        largura=w,
        altura=h,
        regiao=regiao,
        oclusores=3,
        origem="simulador",
    )
    (origem / "g4001.json").write_text(g.model_dump_json(), encoding="utf-8")
    cv2.imwrite(str(origem / "g4002.jpg"), img)
    descartar = g.model_copy(update={"id": "g4002", "imagem": "g4002.jpg", "mascara": None, "oclusores": 0})
    (origem / "g4002.json").write_text(descartar.model_copy(update={"resposta": "descartar"}).model_dump_json())
    assert main(["gabarito", str(origem), "--pasta", str(pasta.raiz)]) == 0
    assert capsys.readouterr().out.strip() == "2 itens novos no gabarito"
    nomes = sorted(p.name for p in (pasta.gabarito / "itens").iterdir())
    assert nomes == ["g4001.jpg", "g4001.json", "g4001.png", "g4002.jpg", "g4002.json"]
    assert [type(x).__name__ for x in listar_itens(pasta)] == ["GabaritoPlacas"] * 2
    # um item das pessoas (0.9) na pasta fica fora, sem atrapalhar
    (pasta.gabarito / "itens" / "g3001.json").write_text(json.dumps({"formato": "gabarito.pessoas/1", "id": "g3001"}))
    assert [x.id for x in listar_itens(pasta)] == ["g4001", "g4002"]
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 0
    capsys.readouterr()
    # números além dos oclusores do item, ou pintura fora da placa: recusado
    for gid, mexer, erro in (
        ("g4003", lambda m: m.__setitem__((30, 120), 9), "além dos 3 oclusores"),
        ("g4004", lambda m: m.__setitem__((1, 1), 1), "fora da região da placa"),
    ):
        m = verdade.copy()
        mexer(m)
        (origem / f"{gid}.png").write_bytes(gravar_png(m, [(0, 0, 0)] * 256))
        (origem / f"{gid}.json").write_text(g.model_copy(update={"id": gid, "mascara": f"{gid}.png"}).model_dump_json())
        with pytest.raises(ValueError, match=erro):
            main(["gabarito", str(origem), "--pasta", str(pasta.raiz)])
        (origem / f"{gid}.json").unlink()
    (origem / "g4005.json").write_text(g.model_copy(update={"id": "g4005", "mascara": "g4005.png"}).model_dump_json())
    with pytest.raises(FileNotFoundError, match=r"g4005\.png"):
        main(["gabarito", str(origem), "--pasta", str(pasta.raiz)])


def _lote_para_importar(origem, n=3, lote="r1", partida=PARTIDA, primeiro=0):
    itens = []
    for k in range(primeiro, primeiro + n):
        img, regiao, _ = recorte_sintetico(k)
        recorte = f"t{1000 * (k + 1):010d}_cab-{k + 1:02d}"
        cv2.imwrite(str(origem / f"{recorte}.jpg"), img)
        h, w = img.shape[:2]
        itens.append({"recorte": recorte, "largura": w, "altura": h, "regiao": regiao, "placa": regiao,
                      "no_quadro": [[x * 2, y * 2] for x, y in regiao]})  # fmt: skip
    lr = montar_lote(partida, lote, itens, origem="simulador", gerador="testes", semente=3, criado_em=AGORA)
    escrever_json(origem / f"{lote}.json", lr)
    return lr


def test_recortes_trazidos_para_a_partida(pasta, tmp_path, capsys):
    """`anotacao recortes` traz o lote e as imagens para a partida, conferindo cada imagem; trazer de novo
    não muda nada; um recorte que já veio em outro lote é recusado."""
    origem = tmp_path / "lote"
    origem.mkdir()
    lr = _lote_para_importar(origem, n=10)
    assert [it.dupla for it in lr.itens].count(True) == 1 and [it.sem_previsao for it in lr.itens].count(True) == 1
    args = ["recortes", str(origem / "r1.json"), "--pasta", str(pasta.raiz)]
    with pytest.raises(ValueError, match="importe o vídeo dela antes"):
        main(args)
    criar_partida(pasta, [{}])
    assert main(args) == 0
    assert capsys.readouterr().out.strip() == f"{PARTIDA}/r1: 10 recorte(s), 10 imagem(ns) nova(s)"
    assert ler_json(pasta.lote_recortes(PARTIDA, "r1"), LoteRecortes) == lr
    assert (
        pasta.recorte(PARTIDA, lr.itens[0].recorte).read_bytes() == (origem / f"{lr.itens[0].recorte}.jpg").read_bytes()
    )
    assert main(args) == 0  # de novo: nada muda
    assert "0 imagem(ns) nova(s)" in capsys.readouterr().out
    escrever_json(origem / "r2.json", lr.model_copy(update={"lote": "r2"}))
    with pytest.raises(ValueError, match="já vieram em outro lote"):
        main(["recortes", str(origem / "r2.json"), "--pasta", str(pasta.raiz)])
    escrever_json(origem / "r1.json", lr.model_copy(update={"gerador": "outro"}), sobrescrever=True)
    with pytest.raises(ArquivoExiste, match="outro conteúdo"):
        main(args)
    # imagem com outro tamanho, ou faltando: recusado antes de gravar qualquer coisa
    novo = tmp_path / "novo"
    novo.mkdir()
    lr3 = _lote_para_importar(novo, n=2, lote="r3", primeiro=20)
    cv2.imwrite(str(novo / f"{lr3.itens[1].recorte}.jpg"), np.zeros((10, 10, 3), np.uint8))
    with pytest.raises(ValueError, match="o lote diz 240 x 72"):
        main(["recortes", str(novo / "r3.json"), "--pasta", str(pasta.raiz)])
    (novo / f"{lr3.itens[1].recorte}.jpg").unlink()
    with pytest.raises(FileNotFoundError, match="falta a imagem"):
        main(["recortes", str(novo / "r3.json"), "--pasta", str(pasta.raiz)])
    assert not pasta.lote_recortes(PARTIDA, "r3").exists()
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 0


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


def test_prever_placas(pasta, capsys):
    """A pré-pintura de cada recorte (menos os "sem previsão"), só dentro da região da placa."""
    criar_partida(pasta, [{}], imagens=False)
    rec = criar_recortes(pasta, 3, sem_previsao=(1,))
    r = list(rec)
    args = ["prever", "--tarefa", "placas", "--pasta", str(pasta.raiz), "--previsor", "previsor_teste:MascaraFixa"]
    assert main(args) == 0
    assert "2 previsões gravadas (mascara-fixa@1)" in capsys.readouterr().out
    m = ler_png(pasta.previsao_placas(PARTIDA, r[0]))
    it = rec[r[0]]["item"]
    assert m.shape == (72, 240) and set(np.unique(m)) == {0, 1}
    assert not m[~rasterizar(it.regiao, it.largura, it.altura)].any()  # a faixa do previsor saía da placa
    assert m[30, 90] == 1 and m[2, 90] == 0
    assert not pasta.previsao_placas(PARTIDA, r[1]).exists()


def test_esquemas(tmp_path):
    assert main(["esquemas", str(tmp_path)]) == 0
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(ESQUEMAS)
    assert json.loads((tmp_path / "rotulo.pontos.json").read_text(encoding="utf-8"))["title"] == "RotuloPontos"
