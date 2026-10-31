"""O gabarito arbitrado (`anotacao ouro`): os itens aprovados viram lotes de ouro, rodada a rodada,
sem repetir item nem id, e nunca vão para quem trabalhou neles."""

from __future__ import annotations

import shutil
import zipfile

from anotacao.cli import main
from anotacao.formatos import GabaritoPlacas, GabaritoPontos
from anotacao.gabarito import importar
from anotacao.mascara import ler_png
from anotacao.ouro import gerar_lote_real, ler_registro
from anotacao.pasta import Pasta

from conftest import AGORA, PARTIDA, cenario_ouro, gravar_revisao


def _itens(arquivo):
    with zipfile.ZipFile(arquivo) as z:
        nomes = z.namelist()
        jsons = {n.split("/")[-1][:-5]: z.read(n) for n in nomes if n.endswith(".json")}
        return nomes, jsons, {n.split("/")[-1]: z.read(n) for n in nomes if not n.endswith(".json")}


def test_os_aprovados_viram_lotes_de_ouro(pasta):
    q, r, rec, _ = cenario_ouro(pasta)
    rodada = gerar_lote_real(pasta, agora=AGORA)
    assert rodada.arquivo == pasta.conjuntos / "ouro-reais-1.zip"
    _, jsons, binarios = _itens(rodada.arquivo)
    # pontos na ordem da aprovação: o aprovado aos 10 min (g5001) e o corrigido aos 25 (g5002)
    g1 = GabaritoPontos.model_validate_json(jsons["g5001"])
    g2 = GabaritoPontos.model_validate_json(jsons["g5002"])
    assert g1.origem == g2.origem == "arbitrado"
    assert {p.ponto: (p.x, p.y, p.visivel) for p in g1.pontos} == {
        "centro": (320.0, 180.0, True),
        "canto_esq_cab": (1.0, 200.0, False),  # rente à borda (menos de 3 px, ref. 960): opcional
    }
    assert g1.fora_de == ["A01", "A02"]
    assert [(p.ponto, p.x) for p in g2.pontos] == [("centro", 312.0)]  # a correção de quem revisou
    assert g2.fora_de == ["A01", "A02"]
    assert binarios["g5001.jpg"] == pasta.quadro(PARTIDA, q[0]).read_bytes()
    assert g1.lote.startswith("PR1-") and g1.lote.split("-")[1] in ("treino", "controle")
    # placas: pintado (duas coisas, numeradas da esquerda para a direita), nada na frente, fora do lugar
    p1 = GabaritoPlacas.model_validate_json(jsons["g6001"])
    p2 = GabaritoPlacas.model_validate_json(jsons["g6002"])
    p3 = GabaritoPlacas.model_validate_json(jsons["g6003"])
    assert (p1.resposta, p1.oclusores, p1.mascara) == ("pintar", 2, "g6001.png")
    verdade = ler_png(binarios["g6001.png"])
    assert verdade[35, 50] == 1 and verdade[35, 160] == 2 and verdade[10, 10] == 0
    assert (p2.resposta, p2.oclusores) == ("pintar", 0) and not ler_png(binarios["g6002.png"]).any()
    assert (p3.resposta, p3.oclusores, p3.mascara) == ("descartar", 0, None) and "g6003.png" not in binarios
    assert p1.regiao == rec[r[0]]["item"].regiao and p1.fora_de == ["A01", "A02"]
    assert binarios["g6003.jpg"] == pasta.recorte(PARTIDA, r[2]).read_bytes()
    assert set(jsons) == {"g5001", "g5002", "g6001", "g6002", "g6003"}
    # o que ficou de fora, e por quê (o devolvido e o sem revisão não têm aprovado: nem contam)
    assert rodada.fora == {
        "esperando revisão (ou a outra pessoa da dupla)": 1,
        "descartados": 1,
        "descartados (por outro motivo que não o recorte fora do lugar)": 1,
    }
    assert sum(rodada.por_lote.values()) == 5
    reg = ler_registro(pasta)
    assert reg["itens"]["pontos"] == {f"{PARTIDA}/{q[0]}": "g5001", f"{PARTIDA}/{q[4]}": "g5002"}
    assert reg["itens"]["placas"] == {f"{PARTIDA}/{r[k]}": f"g600{k + 1}" for k in range(3)}
    assert [x["n"] for x in reg["rodadas"]] == [1]


def test_cada_rodada_leva_so_o_que_e_novo(pasta):
    q, _, _, nomes = cenario_ouro(pasta)
    gerar_lote_real(pasta, agora=AGORA)
    # sem nada novo, nada se grava
    nada = gerar_lote_real(pasta, agora=AGORA)
    assert nada.arquivo is None and len(ler_registro(pasta)["rodadas"]) == 1
    # a dupla fica assentada (a revisão da segunda pessoa) e outro quadro é aprovado
    gravar_revisao(pasta, "pontos", q[1], nomes["n1b"], "A01", minutos=40)
    gravar_revisao(pasta, "pontos", q[5], nomes["n5"], "A02", minutos=30)
    rodada = gerar_lote_real(pasta, agora=AGORA)
    assert rodada.arquivo == pasta.conjuntos / "ouro-reais-2.zip"
    _, jsons, _ = _itens(rodada.arquivo)
    assert set(jsons) == {"g5003", "g5004"}  # os ids continuam; nada da primeira rodada se repete
    g3 = GabaritoPontos.model_validate_json(jsons["g5003"])  # a dupla, aprovada aos 20 min
    assert g3.fora_de == ["A01", "A02", "A03"] and g3.lote.startswith("PR2-")
    assert GabaritoPontos.model_validate_json(jsons["g5004"]).fora_de == ["A01", "A02"]
    assert [x["n"] for x in ler_registro(pasta)["rodadas"]] == [1, 2]


def test_o_mesmo_conteudo_da_os_mesmos_bytes(pasta, tmp_path):
    cenario_ouro(pasta)
    copia = Pasta(shutil.copytree(pasta.raiz, tmp_path / "copia"))
    a = gerar_lote_real(pasta, agora=AGORA)
    b = gerar_lote_real(copia, agora=AGORA)
    assert a.arquivo.read_bytes() == b.arquivo.read_bytes()


def test_os_ids_nunca_repetem_os_do_gabarito_da_pasta(pasta, tmp_path):
    cenario_ouro(pasta)
    rodada = gerar_lote_real(pasta, agora=AGORA)
    destino = tmp_path / "extraido"
    with zipfile.ZipFile(rodada.arquivo) as z:
        z.extractall(destino)
    importar(pasta, destino / "gabarito" / "itens")
    (pasta.conjuntos / "ouro-reais.json").unlink()  # o registro se perdeu
    de_novo = gerar_lote_real(pasta, agora=AGORA)
    assert de_novo.arquivo == pasta.conjuntos / "ouro-reais-1.zip"  # o .zip que sobrou é trocado
    _, jsons, _ = _itens(de_novo.arquivo)
    assert sorted(jsons) == ["g5003", "g5004", "g6004", "g6005", "g6006"]  # repete as imagens, nunca os ids


def test_o_lote_entra_no_gabarito_e_passa_no_validar(pasta, tmp_path, capsys):
    cenario_ouro(pasta)
    assert main(["ouro", "--pasta", str(pasta.raiz)]) == 0
    saida = capsys.readouterr().out
    assert "rodada 1, 5 itens" in saida and "fora desta vez: 1 descartados" in saida
    destino = tmp_path / "extraido"
    with zipfile.ZipFile(pasta.conjuntos / "ouro-reais-1.zip") as z:
        z.extractall(destino)
    novos = importar(pasta, destino / "gabarito" / "itens")
    assert sorted(novos) == ["g5001", "g5002", "g6001", "g6002", "g6003"]
    assert main(["validar", "--pasta", str(pasta.raiz)]) == 0
    assert "0 problema(s)" in capsys.readouterr().out
