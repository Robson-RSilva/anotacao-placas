"""Pré-processamento ao subir um vídeo. Tudo roda na máquina; só os quadros sorteados vão para a pasta.

1. hash do arquivo e relógio de cada quadro (PTS);
2. cortes e replays (regras do laboratório), só para organizar o sorteio;
3. agrupamento das tomadas por aparência e zoom;
4. sorteio de 1 ou 2 quadros por tomada e distribuição na equipe;
5. extração dos quadros sorteados em JPEG, na resolução original;
6. câmera prevista por quadro, quando há previsor;
7. manifesto, tomadas e fila — o manifesto por último: partida sem manifesto não existe.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import cv2
import numpy as np

from . import __version__
from .convencoes import id_partida
from .cortes import (
    agrupar,
    descrever,
    detectar_cortes,
    detectar_graduais,
    gabaritos_vinheta,
    montar_tomadas,
    pontuar_vinheta,
    replays_por_vinheta,
)
from .formatos import (
    Cadastro,
    Fila,
    ItemFila,
    Manifesto,
    PreProcessamento,
    Previsao,
    Tomada,
    Tomadas,
    VideoInfo,
)
from .pasta import Pasta, escrever_json
from .previsores import Previsor
from .sorteio import ParametrosSorteio, atribuir, semente_de, sortear
from .video import corrigir_pts, extrair, info_video, percorrer, sha256_arquivo

Progresso = Callable[[str, float], None]
TAMANHO_ANALISE = (160, 90)


class PartidaJaExiste(Exception):
    """A partida (ou o mesmo vídeo) já foi importada."""


@dataclass
class Resultado:
    partida: str
    n_quadros_video: int
    n_tomadas: int
    n_sorteados: int
    segundos: float


def preprocessar(
    pasta: Pasta,
    video: Path,
    cadastro: Cadastro,
    *,
    nome_original: str | None = None,
    sha256: str | None = None,
    params: ParametrosSorteio | None = None,
    previsor: Previsor | None = None,
    progresso: Progresso | None = None,
) -> Resultado:
    t0 = time.time()
    params = params or ParametrosSorteio()
    prog = progresso or (lambda etapa, frac: None)
    video = Path(video)
    pacote = pasta.ler_pacote(cadastro.estadio, cadastro.pacote_versao)
    pid = id_partida(cadastro.data_hora.date().isoformat(), cadastro.estadio, cadastro.mandante, cadastro.visitante)
    if pasta.manifesto(pid).exists():
        raise PartidaJaExiste(f"a partida {pid} já foi importada")

    info = info_video(video)
    prog("hash", 0.0)
    sha = sha256 or sha256_arquivo(video, progresso=lambda f: prog("hash", f))
    for outra in pasta.listar_partidas():
        if pasta.ler_manifesto(outra).video.sha256 == sha:
            raise PartidaJaExiste(f"este vídeo já foi importado como {outra}")

    vinheta_path = pasta.vinheta_path(cadastro.emissora)
    vinheta = cv2.imread(str(vinheta_path)) if vinheta_path.exists() else None
    gabs = gabaritos_vinheta(vinheta, TAMANHO_ANALISE[0] / info.largura) if vinheta is not None else []

    # 1) leitura: só descritores de quadros reduzidos ficam na memória
    pts, d_hist, d_estr, gram, bord, vinh = [], [], [], [], [], []
    curtos: dict[int, np.ndarray] = {}
    passo_curto = max(1, round(info.fps / 5))
    anterior = None
    n_est = max(info.n_quadros, 1)
    for i, p, img in percorrer(video, TAMANHO_ANALISE):
        d = descrever(img)
        if anterior is None:
            d_hist.append(0.0)
            d_estr.append(0.0)
        else:
            d_hist.append(float(0.5 * np.sum((anterior.hist - d.hist) ** 2 / (anterior.hist + d.hist + 1e-12))))
            d_estr.append(1.0 - float((anterior.estrutura * d.estrutura).sum()))
        anterior = d
        gram.append(d.gramado)
        bord.append(d.bordas)
        if gabs:
            vinh.append(pontuar_vinheta(img, gabs))
        if i % passo_curto == 0:
            curtos[i] = d.hist_curto
        pts.append(p)
        if i % 100 == 0:
            prog("leitura", min(i / n_est, 1.0))
    n = len(pts)
    if n == 0:
        raise ValueError("o vídeo não tem quadros legíveis")
    prog("leitura", 1.0)
    pts_arr, fonte_pts = corrigir_pts(np.array(pts), info.fps)

    # 2) cortes, transições e replays
    dh, de = np.array(d_hist), np.array(d_estr)
    cortes = detectar_cortes(dh, de)
    graduais = detectar_graduais(dh, cortes)
    transicao = np.zeros(n, bool)
    for a, b in graduais:
        transicao[a:b] = True
    if gabs:
        replay, trans_v, grupos_v = replays_por_vinheta(np.array(vinh))
        transicao |= trans_v
    else:
        replay, grupos_v = None, []
    tomadas = montar_tomadas(n, cortes, grupos_v, replay)

    # 3 e 4) agrupamento, sorteio e distribuição
    semente = semente_de(pid)
    agrupar(tomadas, curtos, np.array(gram), np.array(bord), semente)
    sorteados = sortear(tomadas, pts_arr, transicao, params, semente)
    anotadores = pasta.ler_equipe().com_papel("anotador")
    atribuicoes = atribuir(sorteados, anotadores, semente)

    # 5) extração dos quadros sorteados
    destinos = {s.i: pasta.quadro(pid, s.quadro) for s in sorteados}
    tamanhos = extrair(video, destinos, progresso=lambda f: prog("extracao", f))
    if tamanhos and any(t != (info.largura, info.altura) for t in tamanhos.values()):
        info.largura, info.altura = next(iter(tamanhos.values()))

    # 6) previsões
    if previsor is not None:
        for k, s in enumerate(sorteados):
            img = cv2.imread(str(destinos[s.i]))
            cam, conf = previsor(img, pacote)
            escrever_json(
                pasta.previsao(pid, s.quadro),
                Previsao(
                    partida=pid,
                    quadro=s.quadro,
                    fonte=previsor.nome,
                    versao=previsor.versao,
                    camera=cam,
                    confianca=conf,
                ),
                sobrescrever=True,
            )
            prog("previsao", (k + 1) / len(sorteados))

    # 7) arquivos da partida (manifesto por último)
    agora = datetime.now(UTC)
    escrever_json(
        pasta.tomadas(pid),
        Tomadas(
            partida=pid,
            cortes=[int(c) for c in cortes],
            transicoes=[(int(a), int(b)) for a, b in graduais] + [(g[0], g[-1] + 1) for g in grupos_v],
            tomadas=[
                Tomada(
                    id=k,
                    i0=t.i0,
                    i1=t.i1,
                    inicio_ms=round(float(pts_arr[t.i0])),
                    fim_ms=round(float(pts_arr[t.i1 - 1])),
                    replay=t.replay,
                    zoom=t.zoom,
                    grupo=t.grupo,
                )
                for k, t in enumerate(tomadas)
            ],
        ),
        sobrescrever=True,
    )
    escrever_json(
        pasta.fila(pid),
        Fila(
            partida=pid,
            criado_em=agora,
            equipe=anotadores,
            itens=[
                ItemFila(
                    quadro=s.quadro,
                    tomada=s.tomada,
                    i=s.i,
                    pts_ms=s.pts_ms,
                    atribuido_a=a,
                    dupla=s.dupla,
                    sem_previsao=s.sem_previsao,
                )
                for s, a in zip(sorteados, atribuicoes, strict=True)
            ],
        ),
        sobrescrever=True,
    )
    segundos = time.time() - t0
    parametros: dict[str, float | int | str | bool] = dict(params.como_dict())
    parametros.update(
        pts=fonte_pts,
        cortes=len(cortes),
        transicoes=len(graduais),
        vinheta=bool(gabs),
        analise=f"{TAMANHO_ANALISE[0]}x{TAMANHO_ANALISE[1]}",
    )
    escrever_json(
        pasta.manifesto(pid),
        Manifesto(
            partida=pid,
            pacote=pacote.ref,
            cadastro=cadastro,
            video=VideoInfo(
                nome_original=nome_original or video.name,
                sha256=sha,
                bytes=video.stat().st_size,
                duracao_s=float((pts_arr[-1] - pts_arr[0]) / 1000.0 + 1.0 / info.fps),
                fps=info.fps,
                largura=info.largura,
                altura=info.altura,
                n_quadros=n,
            ),
            pre_processamento=PreProcessamento(
                ferramenta=__version__,
                criado_em=agora,
                segundos=round(segundos, 2),
                parametros=parametros,
                previsor=f"{previsor.nome}@{previsor.versao}" if previsor is not None else None,
            ),
        ),
    )
    prog("fim", 1.0)
    return Resultado(pid, n, len(tomadas), len(sorteados), segundos)
