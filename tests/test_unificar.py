"""Unificar: um rótulo aprovado por item e tarefa, a divisão por partida, os descartes e os problemas."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from anotacao.formatos import Divisao
from anotacao.indice import Indice
from anotacao.pasta import escrever_json, mascara_de
from anotacao.unificar import unificar

from conftest import AGORA, PARTIDA, criar_partida, criar_recortes, gravar_placas, gravar_pontos, gravar_revisao

P1 = {"centro": (320.0, 180.0), "meio_cab": (330.5, 350.25)}
P2 = {"centro": (321.0, 181.0), "meio_cab": (330.0, 350.0), "meio_opo": (300.0, 20.0)}


def test_um_rotulo_aprovado_por_quadro(pasta):
    fila = criar_partida(pasta, [{"dupla": True}, {}, {}, {}, {}, {}], imagens=False)
    q = [it.quadro for it in fila.itens]
    # dupla: os dois aprovados; vale o aprovado primeiro (A02 às 10 min, A01 às 30 min)
    n1 = gravar_pontos(pasta, q[0], "A01", P1)
    n2 = gravar_pontos(pasta, q[0], "A02", P2, minutos=5)
    gravar_revisao(pasta, "pontos", q[0], n1, "A02", minutos=30)
    gravar_revisao(pasta, "pontos", q[0], n2, "A01", minutos=10)
    # corrigido pelo revisor: vale a correção, com o revisor como autor
    n3 = gravar_pontos(pasta, q[1], "A01", P1)
    gravar_pontos(pasta, q[1], "A02", P2, corrige=n3)
    gravar_revisao(pasta, "pontos", q[1], n3, "A02", decisao="corrigir", nova_versao=f"{q[1]}__A02__v1.json")
    # devolvido: fica pendente
    n4 = gravar_pontos(pasta, q[2], "A01", P1)
    gravar_revisao(pasta, "pontos", q[2], n4, "A02", decisao="devolver")
    # descartada e aprovada: fora do treino, contada por motivo
    n5 = gravar_pontos(pasta, q[3], "A01", None)
    gravar_revisao(pasta, "pontos", q[3], n5, "A02")
    # nenhum ponto à vista, aprovada: entra (o exemplo de que ali não há ponto)
    n6 = gravar_pontos(pasta, q[5], "A01", {})
    gravar_revisao(pasta, "pontos", q[5], n6, "A02")
    # inválido: listado em problemas
    (pasta.rotulos(PARTIDA, "pontos") / f"{q[4]}__A01__v1.json").write_text("{ quebrado", encoding="utf-8")

    destino = unificar(pasta, agora=AGORA)
    df = pd.read_parquet(destino / "pontos.parquet").set_index("quadro")
    assert list(df.index) == [q[0], q[1], q[5]]
    assert df.loc[q[0], "anotador"] == "A02" and df.loc[q[0], "revisor"] == "A01" and df.loc[q[0], "n_pontos"] == 3
    assert df.loc[q[1], "anotador"] == "A02" and df.loc[q[1], "decisao"] == "corrigir"
    assert df.loc[q[5], "n_pontos"] == 0
    assert (df["conjunto"] == "treino").all()
    assert df.loc[q[0], "imagem"] == f"partidas/{PARTIDA}/quadros/{q[0]}.jpg"
    assert df.loc[q[0], ["largura", "altura", "emissora"]].tolist() == [640, 360, "Emissora X"]
    lista = pd.read_parquet(destino / "pontos_lista.parquet")
    assert len(lista) == 6 and set(lista["quadro"]) == {q[0], q[1]}
    centro = lista[(lista["quadro"] == q[0]) & (lista["ponto"] == "centro")].iloc[0]
    assert (centro["x"], centro["y"]) == (321.0, 181.0)
    prob = json.loads((destino / "problemas.json").read_text(encoding="utf-8"))
    pend = [(p["item"], p["tarefa"]) for p in prob["pendentes"]]
    assert pend == [(q[2], "pontos"), (q[4], "pontos")]  # sem recortes, nada pendente nas placas
    assert len(prob["invalidos"]) == 1
    man = json.loads((destino / "manifesto.json").read_text(encoding="utf-8"))
    assert man["formato"] == "conjuntos/5"
    assert man["pontos"]["quadros"] == 3 and man["pontos"]["pontos"] == 6 and man["pontos"]["sem_pontos"] == 1
    assert man["pontos"]["por_conjunto"] == {"treino": 3} and len(man["pontos"]["hash_conteudo"]) == 64
    assert man["descartados"] == {"pontos": {"transicao": 1}, "placas": {}}


def test_placas_no_conjunto(pasta):
    """A pintura aprovada de cada recorte, com a máscara ao lado, a região e onde a placa está no quadro;
    sem nada na frente também entra; máscara que não chegou, estragada ou com pintura fora da placa
    fica listada."""
    criar_partida(pasta, [{}], imagens=False)
    rec = criar_recortes(pasta, 6, imagens=False)
    r = list(rec)
    verdade = rec[r[0]]["verdade"]
    m = (verdade > 0).astype(np.uint8)
    n0 = gravar_placas(pasta, r[0], "A02", m)
    gravar_revisao(pasta, "placas", r[0], n0, "A01", minutos=5)
    n1 = gravar_placas(pasta, r[1], "A02", np.zeros_like(m))  # nada na frente da placa
    gravar_revisao(pasta, "placas", r[1], n1, "A01")
    n2 = gravar_placas(pasta, r[2], "A02", None, motivo="placa_fora_do_lugar")
    gravar_revisao(pasta, "placas", r[2], n2, "A01")
    n3 = gravar_placas(pasta, r[3], "A02", m)
    gravar_revisao(pasta, "placas", r[3], n3, "A01")
    (pasta.rotulos(PARTIDA, "placas") / mascara_de(n3)).unlink()  # a máscara ainda não chegou
    n4 = gravar_placas(pasta, r[4], "A02", m)
    gravar_revisao(pasta, "placas", r[4], n4, "A01")
    (pasta.rotulos(PARTIDA, "placas") / mascara_de(n4)).write_bytes(b"\x89PNG estragado")
    fora = m.copy()
    fora[0, 0] = 1  # na arquibancada, fora da placa
    n5 = gravar_placas(pasta, r[5], "A02", fora)
    gravar_revisao(pasta, "placas", r[5], n5, "A01")

    destino = unificar(pasta, agora=AGORA)
    df = pd.read_parquet(destino / "placas.parquet").set_index("recorte")
    assert list(df.index) == [r[0], r[1]]
    linha = df.loc[r[0]]
    assert linha["mascara"] == f"partidas/{PARTIDA}/rotulos/placas/{mascara_de(n0)}"
    assert linha["imagem"] == f"partidas/{PARTIDA}/recortes/{r[0]}.jpg"
    assert (linha["quadro"], linha["placa"], linha["lote"]) == ("t0000001000", "p0", "r1")
    assert linha["pixels"] == int(m.sum()) and df.loc[r[1], "pixels"] == 0
    assert linha["pixels_regiao"] == (240 - 28) * (72 - 28)
    assert linha["cobertura"] == round(int(m.sum()) / ((240 - 28) * (72 - 28)), 6)
    assert json.loads(linha["regiao"]) == [[14, 14], [226, 14], [226, 58], [14, 58]]
    assert json.loads(linha["placa_no_quadro"])[0] == [128, 78]
    assert (linha["revisor"], linha["anotador"], linha["largura"], linha["altura"]) == ("A01", "A02", 240, 72)
    prob = json.loads((destino / "problemas.json").read_text(encoding="utf-8"))
    assert any(x["arquivo"].endswith(n3) and "não chegou" in x["erro"] for x in prob["invalidos"])
    motivos = {x["item"]: x["motivo"] for x in prob["pendentes"] if x["tarefa"] == "placas"}
    assert "máscara ilegível" in motivos[r[4]]
    assert motivos[r[5]] == "a máscara tem pintura fora da região da placa"
    man = json.loads((destino / "manifesto.json").read_text(encoding="utf-8"))
    assert man["placas"]["recortes"] == 2 and man["placas"]["sem_nada_na_frente"] == 1
    assert man["descartados"]["placas"] == {"placa_fora_do_lugar": 1}


def test_recortes_de_dois_lotes(pasta):
    """Os recortes de todos os lotes da partida entram; o que se repete num lote depois fica de fora."""
    criar_partida(pasta, [{}], imagens=False)
    criar_recortes(pasta, 2, lote="r1", imagens=False)
    rec = Indice(pasta).recortes(PARTIDA)
    assert list(rec.itens) == ["t0000001000_p0", "t0000002000_p1"]
    escrever_json(
        pasta.lote_recortes(PARTIDA, "r2"),
        {**json.loads(pasta.lote_recortes(PARTIDA, "r1").read_text(encoding="utf-8")), "lote": "r2"},
    )
    (pasta.recortes(PARTIDA) / "r3.json").write_text("{ quebrado", encoding="utf-8")
    rec = Indice(pasta).recortes(PARTIDA)
    assert [lote for lote, _ in rec.itens.values()] == ["r1", "r1"]
    assert rec.repetidos == [("r2", "t0000001000_p0"), ("r2", "t0000002000_p1")]
    assert len(rec.invalidos) == 1
    destino = unificar(pasta, agora=AGORA)
    prob = json.loads((destino / "problemas.json").read_text(encoding="utf-8"))
    assert sum("já veio em outro lote" in x["erro"] for x in prob["invalidos"]) == 2
    assert len([x for x in prob["pendentes"] if x["tarefa"] == "placas"]) == 2


def test_divisao_por_partida(pasta):
    fila = criar_partida(pasta, [{}], imagens=False)
    nome = gravar_pontos(pasta, fila.itens[0].quadro, "A01", P1)
    gravar_revisao(pasta, "pontos", fila.itens[0].quadro, nome, "A02")
    escrever_json(pasta.divisao_path, Divisao(teste_congelado=[PARTIDA]), sobrescrever=True)
    destino = unificar(pasta, agora=AGORA)
    df = pd.read_parquet(destino / "pontos.parquet")
    assert len(df) == 1 and df.loc[0, "conjunto"] == "teste_congelado"
    lista = pd.read_parquet(destino / "pontos_lista.parquet")
    assert (lista["conjunto"] == "teste_congelado").all()
    man = json.loads((destino / "manifesto.json").read_text(encoding="utf-8"))
    assert man["partidas_por_conjunto"] == {"teste_congelado": [PARTIDA]}


def test_indice_recusa_arquivo_com_nome_trocado(pasta):
    fila = criar_partida(pasta, [{}], imagens=False)
    nome = gravar_pontos(pasta, fila.itens[0].quadro, "A01", P1)
    d = pasta.rotulos(PARTIDA, "pontos")
    (d / nome.replace("A01", "A02")).write_text((d / nome).read_text(encoding="utf-8"), encoding="utf-8")
    ip = Indice(pasta).partida(PARTIDA, "pontos")
    assert [a.nome for a in ip.rotulos] == [nome]
    assert "não bate" in ip.invalidos[0][1]


def test_rotulos_das_versoes_anteriores_ficam_de_fora(pasta):
    """As pastas das tarefas antigas (câmera e oclusão da 0.7, jogadores da 0.8, pessoas da 0.9) não entram
    em nada."""
    fila = criar_partida(pasta, [{}], imagens=False)
    for tarefa in ("camera", "oclusao", "jogadores", "pessoas"):
        antigo = pasta.partida(PARTIDA) / "rotulos" / tarefa / f"{fila.itens[0].quadro}__A01__v1.json"
        antigo.parent.mkdir(parents=True)
        antigo.write_text(json.dumps({"formato": f"rotulo.{tarefa}/1"}), encoding="utf-8")
    destino = unificar(pasta, agora=AGORA)
    prob = json.loads((destino / "problemas.json").read_text(encoding="utf-8"))
    assert prob["invalidos"] == []
    assert pd.read_parquet(destino / "placas.parquet").empty


def test_partida_incompleta_fica_de_fora_e_listada(pasta):
    fila = criar_partida(pasta, [{}], imagens=False)
    nome = gravar_pontos(pasta, fila.itens[0].quadro, "A01", P1)
    gravar_revisao(pasta, "pontos", fila.itens[0].quadro, nome, "A02")
    sem_fila = "2026-11-05_estadio-sintetico_time-c-time-d"
    criar_partida(pasta, [{}], partida=sem_fila, imagens=False)
    pasta.fila(sem_fila).unlink()  # a fila ainda não sincronizou
    vazia = "2026-11-06_estadio-sintetico_time-e-time-f"
    criar_partida(pasta, [{}], partida=vazia, imagens=False)
    pasta.manifesto(vazia).write_bytes(b"")  # importação interrompida
    assert pasta.listar_partidas() == [PARTIDA, sem_fila]
    destino = unificar(pasta, agora=AGORA)
    assert len(pd.read_parquet(destino / "pontos.parquet")) == 1
    prob = json.loads((destino / "problemas.json").read_text(encoding="utf-8"))
    assert [p["arquivo"] for p in prob["invalidos"]] == [f"partidas/{sem_fila}"]
