"""Pré-processamento num vídeo sintético com três tomadas de câmeras diferentes."""

import cv2
import pytest

from anotacao.preprocessamento import PartidaJaExiste, preprocessar
from anotacao.sorteio import ParametrosSorteio


def test_preprocessar(pasta, video, cadastro):
    caminho, verdade = video
    etapas = []
    r = preprocessar(
        pasta, caminho, cadastro, params=ParametrosSorteio(alvo=10), progresso=lambda e, f: etapas.append(e)
    )
    assert r.partida == "2026-11-02_estadio-sintetico_time-a-time-b"
    assert r.n_quadros_video == len(verdade) == 150
    man = pasta.ler_manifesto(r.partida)
    assert man.video.fps == pytest.approx(25.0) and (man.video.largura, man.video.altura) == (640, 360)
    assert man.pre_processamento.parametros["pts"] == "decodificador"
    tom = pasta.ler_tomadas(r.partida)
    assert tom.cortes == [50, 100]
    assert [(t.i0, t.i1) for t in tom.tomadas] == [(0, 50), (50, 100), (100, 150)]
    fila = pasta.ler_fila(r.partida)
    assert len(fila.itens) == r.n_sorteados == 3  # tomadas de 2 s: um quadro por tomada
    for it in fila.itens:
        assert it.quadro == f"t{round(it.i * 40):010d}"  # o ID é o PTS em ms
        assert it.atribuido_a and set(it.atribuido_a) <= {"A01", "A02"}
        img = cv2.imread(str(pasta.quadro(r.partida, it.quadro)))
        assert img.shape == (360, 640, 3)
    assert {"hash", "leitura", "extracao", "fim"} <= set(etapas)


def test_nao_importa_duas_vezes(pasta, video, cadastro):
    caminho, _ = video
    preprocessar(pasta, caminho, cadastro, params=ParametrosSorteio(alvo=5))
    with pytest.raises(PartidaJaExiste):
        preprocessar(pasta, caminho, cadastro)
    with pytest.raises(PartidaJaExiste, match="já foi importado"):
        preprocessar(pasta, caminho, cadastro.model_copy(update={"mandante": "Outro"}))


def test_pacote_inexistente(pasta, video, cadastro):
    with pytest.raises(FileNotFoundError):
        preprocessar(pasta, video[0], cadastro.model_copy(update={"estadio": "nao-existe"}))
