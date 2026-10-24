"""Unificar: um rótulo aprovado por quadro, a divisão por partida e os problemas listados."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from anotacao import oclusao
from anotacao.camera import Camera
from anotacao.convencoes import REF_PACOTE_GENERICO
from anotacao.formatos import CampoPacote, Divisao
from anotacao.indice import Indice
from anotacao.pasta import escrever_json, mascara_de
from anotacao.unificar import unificar

from conftest import (
    AGORA,
    PARTIDA,
    camera_exemplo,
    criar_partida,
    gravar_pintura,
    gravar_revisao,
    gravar_revisao_oclusao,
    gravar_rotulo,
    placas_do_pacote,
)


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


def test_partida_incompleta_fica_de_fora_e_listada(pasta):
    fila = criar_partida(pasta, [{}], imagens=False)
    nome = gravar_rotulo(pasta, fila.itens[0].quadro, "A01", camera_exemplo())
    gravar_revisao(pasta, fila.itens[0].quadro, nome, "A02")
    sem_fila = "2026-11-05_estadio-sintetico_time-c-time-d"
    criar_partida(pasta, [{}], partida=sem_fila, imagens=False)
    pasta.fila(sem_fila).unlink()  # a fila ainda não sincronizou
    vazia = "2026-11-06_estadio-sintetico_time-e-time-f"
    criar_partida(pasta, [{}], partida=vazia, imagens=False)
    pasta.manifesto(vazia).write_bytes(b"")  # importação interrompida
    assert pasta.listar_partidas() == [PARTIDA, sem_fila]
    destino = unificar(pasta, agora=AGORA)
    assert len(pd.read_parquet(destino / "camera.parquet")) == 1
    prob = json.loads((destino / "problemas.json").read_text(encoding="utf-8"))
    assert [p["arquivo"] for p in prob["invalidos"]] == [f"partidas/{sem_fila}"]


def test_medidas_do_campo_de_cada_rotulo(pasta):
    """O molde esticado vai junto: as medidas do rótulo, ou as do pacote quando ele não tem."""
    fila = criar_partida(pasta, [{}, {}, {}], imagens=False)
    q = [it.quadro for it in fila.itens]
    n0 = gravar_rotulo(pasta, q[0], "A01", camera_exemplo(), campo=CampoPacote(comprimento=102.5, largura=66))
    n1 = gravar_rotulo(pasta, q[1], "A01", camera_exemplo())  # sem medidas (rótulo da 0.2)
    n2 = gravar_rotulo(pasta, q[2], "A01", camera_exemplo(), pacote=REF_PACOTE_GENERICO)
    for quadro, nome in zip(q, (n0, n1, n2), strict=True):
        gravar_revisao(pasta, quadro, nome, "A02")
    # pasta de antes do campo genérico: o pacote dele vem da própria ferramenta
    (pasta.pacote_path("generico", "1.0")).unlink()
    df = pd.read_parquet(unificar(pasta, agora=AGORA) / "camera.parquet").set_index("quadro")
    assert df.loc[q[0], ["campo_comprimento", "campo_largura"]].tolist() == [102.5, 66.0]
    assert df.loc[q[1], ["campo_comprimento", "campo_largura"]].tolist() == [105.0, 68.0]
    assert df.loc[q[2], ["campo_comprimento", "campo_largura", "pacote"]].tolist() == [105.0, 68.0, REF_PACOTE_GENERICO]


def test_pacote_ilegivel_deixa_o_rotulo_pendente(pasta):
    fila = criar_partida(pasta, [{}, {}], imagens=False)
    q = [it.quadro for it in fila.itens]
    n0 = gravar_rotulo(pasta, q[0], "A01", camera_exemplo(), pacote="arena-x/pacote-2.0")
    n1 = gravar_rotulo(pasta, q[1], "A01", camera_exemplo(), campo=CampoPacote(), pacote="arena-x/pacote-2.0")
    gravar_revisao(pasta, q[0], n0, "A02")
    gravar_revisao(pasta, q[1], n1, "A02")
    destino = unificar(pasta, agora=AGORA)
    assert pd.read_parquet(destino / "camera.parquet")["quadro"].tolist() == [q[1]]  # esse tem as medidas
    prob = json.loads((destino / "problemas.json").read_text(encoding="utf-8"))
    assert [p["arquivo"] for p in prob["invalidos"]] == ["estadios/arena-x/pacote-2.0"]
    assert [p["quadro"] for p in prob["pendentes"]] == [q[0]]


def _pessoa_numa_placa(cam):
    """Uma pintura com uma "pessoa" cobrindo metade da primeira placa que se pinta."""
    geo = oclusao.geometria(cam, placas_do_pacote(), cam.w, cam.h)
    alvo = next(p for p in geo.info if not p["pequena"])
    ys, xs = np.nonzero(geo.regiao == alvo["k"] + 1)
    pintura = np.zeros((cam.h, cam.w), np.uint8)
    pintura[ys.min() : ys.max() + 1, xs.min() : (xs.min() + xs.max()) // 2] = oclusao.PESSOA
    return alvo, pintura


def test_oclusao_no_conjunto(pasta):
    """A pintura aprovada de cada quadro com a câmera aprovada: uma linha por quadro e uma por placa,
    as contas refeitas da máscara; "câmera errada" e máscara que não chegou ficam listadas."""
    fila = criar_partida(pasta, [{}, {}, {}, {}, {}], imagens=False)
    q = [it.quadro for it in fila.itens]
    cam = camera_exemplo()
    cameras = []
    for quadro in q[:4]:
        n = gravar_rotulo(pasta, quadro, "A01", cam)
        gravar_revisao(pasta, quadro, n, "A02")
        cameras.append(n)
    alvo, pintura = _pessoa_numa_placa(cam)
    n0 = gravar_pintura(pasta, q[0], "A02", cam, pintura, camera_de=cameras[0])
    gravar_revisao_oclusao(pasta, q[0], n0, "A01", minutos=5)
    n1 = gravar_pintura(pasta, q[1], "A02", cam, situacao="camera_errada", camera_de=cameras[1])
    gravar_revisao_oclusao(pasta, q[1], n1, "A01")
    gravar_pintura(pasta, q[2], "A02", cam, np.zeros_like(pintura), camera_de=cameras[2])  # sem revisão
    n3 = gravar_pintura(pasta, q[3], "A02", cam, pintura, camera_de=cameras[3])
    gravar_revisao_oclusao(pasta, q[3], n3, "A01")
    (pasta.rotulos(PARTIDA, "oclusao") / mascara_de(n3)).unlink()  # a máscara ainda não chegou

    destino = unificar(pasta, agora=AGORA)
    df = pd.read_parquet(destino / "oclusao.parquet")
    assert df["quadro"].tolist() == [q[0]]
    linha = df.iloc[0]
    assert linha["mascara"] == f"partidas/{PARTIDA}/rotulos/oclusao/{mascara_de(n0)}"
    assert linha["camera_de"] == cameras[0] and linha["revisor"] == "A01" and linha["placas_de"] == "pacote"
    assert linha["pessoa_px"] > 0 and linha["livre_frac_minima"] < 0.8
    placas = pd.read_parquet(destino / "oclusao_placas.parquet").set_index("placa")
    p = placas.loc[alvo["id"]]
    assert 0.2 < p["livre_frac"] < 0.8 and p["x1"] > p["x0"] >= 0 and p["y1"] > p["y0"] >= 0
    assert (placas["conjunto"] == "treino").all()
    prob = json.loads((destino / "problemas.json").read_text(encoding="utf-8"))
    errada = [x for x in prob["pendentes"] if x.get("tarefa") == "oclusao"]
    assert [x["quadro"] for x in errada] == [q[1]] and "câmera errada" in errada[0]["motivo"]
    assert any(x["arquivo"].endswith(n3) and "não chegou" in x["erro"] for x in prob["invalidos"])
    man = json.loads((destino / "manifesto.json").read_text(encoding="utf-8"))
    assert man["formato"] == "conjuntos/2"
    assert man["oclusao"]["quadros"] == 1 and man["oclusao"]["placas"] == len(placas)
