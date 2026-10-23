"""Unificar: um rótulo aprovado por quadro, a divisão por partida e os problemas listados."""

from __future__ import annotations

import json

import pandas as pd

from anotacao.camera import Camera
from anotacao.formatos import Divisao
from anotacao.indice import Indice
from anotacao.pasta import escrever_json
from anotacao.unificar import unificar

from conftest import AGORA, PARTIDA, camera_exemplo, criar_partida, gravar_revisao, gravar_rotulo


def test_um_rotulo_aprovado_por_quadro(pasta):
    fila = criar_partida(pasta, [{"dupla": True, "atribuido_a": ["A01", "A02"]}, {}, {}, {}, {}], imagens=False)
    q = [it.quadro for it in fila.itens]
    cam = camera_exemplo()
    r = cam.para_rotulo()
    quase = Camera.from_hfov(r["hfov_graus"], r["pan"] + 0.05, r["tilt"], r["roll"], r["C"], 640, 360)
    # dupla: os dois aprovados; vale o aprovado primeiro (A02 às 10 min, A01 às 30 min)
    n1 = gravar_rotulo(pasta, q[0], "A01", cam)
    n2 = gravar_rotulo(pasta, q[0], "A02", quase, minutos=5)
    gravar_revisao(pasta, q[0], n1, "A02", minutos=30)
    gravar_revisao(pasta, q[0], n2, "A01", minutos=10)
    # corrigido pelo revisor: vale a correção, com o revisor como autor
    n3 = gravar_rotulo(pasta, q[1], "A01", cam)
    gravar_rotulo(pasta, q[1], "A02", quase, corrige=n3)
    gravar_revisao(pasta, q[1], n3, "A02", decisao="corrigir", nova_versao=f"{q[1]}__A02__v1.json")
    # devolvido: fica pendente
    n4 = gravar_rotulo(pasta, q[2], "A01", cam)
    gravar_revisao(pasta, q[2], n4, "A02", decisao="devolver")
    # sem marcações: aprovado, mas não entra no treino
    n5 = gravar_rotulo(pasta, q[3], "A01", None)
    gravar_revisao(pasta, q[3], n5, "A02")
    # inválido: listado em problemas
    (pasta.rotulos(PARTIDA, "camera") / f"{q[4]}__A01__v1.json").write_text("{ quebrado", encoding="utf-8")

    destino = unificar(pasta, agora=AGORA)
    df = pd.read_parquet(destino / "camera.parquet").set_index("quadro")
    assert list(df.index) == [q[0], q[1]]
    assert df.loc[q[0], "anotador"] == "A02" and df.loc[q[0], "revisor"] == "A01"
    assert df.loc[q[1], "anotador"] == "A02" and df.loc[q[1], "decisao"] == "corrigir"
    assert (df["conjunto"] == "treino").all()
    assert df.loc[q[0], "imagem"] == f"partidas/{PARTIDA}/quadros/{q[0]}.jpg"
    prob = json.loads((destino / "problemas.json").read_text(encoding="utf-8"))
    assert [p["quadro"] for p in prob["pendentes"]] == [q[2], q[4]]
    assert len(prob["invalidos"]) == 1
    man = json.loads((destino / "manifesto.json").read_text(encoding="utf-8"))
    assert man["quadros"] == 2 and man["por_conjunto"] == {"treino": 2} and len(man["hash_conteudo"]) == 64


def test_divisao_por_partida(pasta):
    fila = criar_partida(pasta, [{}], imagens=False)
    nome = gravar_rotulo(pasta, fila.itens[0].quadro, "A01", camera_exemplo())
    gravar_revisao(pasta, fila.itens[0].quadro, nome, "A02")
    escrever_json(pasta.divisao_path, Divisao(teste_congelado=[PARTIDA]), sobrescrever=True)
    df = pd.read_parquet(unificar(pasta, agora=AGORA) / "camera.parquet")
    assert len(df) == 1 and df.loc[0, "conjunto"] == "teste_congelado"


def test_indice_recusa_arquivo_com_nome_trocado(pasta):
    fila = criar_partida(pasta, [{}], imagens=False)
    nome = gravar_rotulo(pasta, fila.itens[0].quadro, "A01", camera_exemplo())
    d = pasta.rotulos(PARTIDA, "camera")
    (d / nome.replace("A01", "A02")).write_text((d / nome).read_text(encoding="utf-8"), encoding="utf-8")
    ip = Indice(pasta).partida(PARTIDA)
    assert [a.nome for a in ip.rotulos] == [nome]
    assert "não bate" in ip.invalidos[0][1]
