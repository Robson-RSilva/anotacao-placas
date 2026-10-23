"""Linha de comando: exemplo, importar, validar, esquemas e unificar."""

from anotacao.cli import main
from anotacao.formatos import ESQUEMAS
from anotacao.pasta import Pasta


def test_exemplo_importar_validar_unificar(tmp_path, video, capsys):
    destino = tmp_path / "trabalho"
    assert main(["exemplo", str(destino)]) == 0
    pasta = Pasta(destino)
    assert pasta.listar_pacotes() == ["estadio-sintetico/pacote-1.0"]
    assert [m.codigo for m in pasta.ler_equipe().membros] == ["A01", "A02"]
    assert main(["exemplo", str(destino)]) == 0  # de novo não estraga nada
    args = [
        "importar",
        str(video[0]),
        "--pasta",
        str(destino),
        "--estadio",
        "estadio-sintetico",
        "--emissora",
        "X",
        "--competicao",
        "Y",
        "--data-hora",
        "2026-11-02T16:00:00-03:00",
        "--mandante",
        "A",
        "--visitante",
        "B",
        "--iluminacao",
        "noite",
        "--chuva",
        "--alvo",
        "5",
    ]
    assert main(args) == 0
    assert "3 sorteados" in capsys.readouterr().out
    assert pasta.ler_manifesto(pasta.listar_partidas()[0]).cadastro.chuva is True
    assert main(["validar", "--pasta", str(destino)]) == 0
    assert main(["unificar", "--pasta", str(destino)]) == 0
    assert "0 quadros" in capsys.readouterr().out


def test_esquemas(tmp_path):
    assert main(["esquemas", str(tmp_path)]) == 0
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(ESQUEMAS)
