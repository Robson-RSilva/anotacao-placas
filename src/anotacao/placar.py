"""Placar simples, calculado dos próprios arquivos de rótulo e revisão, com cache local.

Ponto só conta depois de aprovado, para velocidade sem qualidade não subir no placar. O cache em
`metricas/placar.json` é refeito quando algum arquivo muda e pode ser apagado a qualquer momento.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

import numpy as np

from .avaliacao import distancia_cameras
from .gabarito import liberacao, listar_itens, resultados
from .indice import Indice
from .pacote import campo_do_pacote
from .pasta import Pasta, escrever_json


def _assinatura(pasta: Pasta) -> str:
    """Muda quando qualquer rótulo, revisão, fila, equipe ou item do gabarito muda."""
    partes = []
    for base in (pasta.partidas, pasta.gabarito):
        if not base.exists():
            continue
        for p in base.rglob("*.json"):
            st = p.stat()
            partes.append(f"{p.relative_to(pasta.raiz)}:{st.st_mtime_ns}:{st.st_size}")
    for p in (pasta.equipe_path, pasta.divisao_path):
        if p.exists():
            partes.append(f"{p.name}:{p.stat().st_mtime_ns}")
    partes.append(date.today().isoformat())
    return hashlib.sha256("|".join(sorted(partes)).encode("utf-8")).hexdigest()


def _mediana(v: list[float]) -> float | None:
    v = [x for x in v if x is not None and np.isfinite(x)]
    return round(float(np.median(v)), 2) if v else None


def _dias_seguidos(dias: set[date], hoje: date) -> int:
    n, d = 0, hoje
    if d not in dias:
        d = hoje - timedelta(days=1)
    while d in dias:
        n += 1
        d -= timedelta(days=1)
    return n


def calcular(pasta: Pasta, indice: Indice | None = None, agora: datetime | None = None) -> dict:
    indice = indice or Indice(pasta)
    agora = agora or datetime.now(UTC)
    hoje = agora.astimezone().date()
    semana = agora - timedelta(days=7)
    equipe = pasta.ler_equipe()
    pessoas = {m.codigo: m.nome for m in equipe.membros}

    p = defaultdict(lambda: defaultdict(float))
    tempos_rot, tempos_rev = defaultdict(list), defaultdict(list)
    dias = defaultdict(set)
    concord = defaultdict(list)
    devolvidos_semana = defaultdict(int)
    revisados_semana = defaultdict(int)
    partidas = []
    for pid in pasta.listar_partidas():
        ip = indice.partida(pid)
        man = indice.manifesto(pid)
        fila = indice.fila(pid)
        w, h = man.video.largura, man.video.altura
        aprovado_quadro = set()
        for a in ip.rotulos:
            r = indice.rotulo(a)
            p[a.pessoa]["rotulos"] += 1
            tempos_rot[a.pessoa].append(r.segundos_ativos)
            dias[a.pessoa].add(r.criado_em.astimezone().date())
            if r.corrige is not None:
                aprovado_quadro.add(a.quadro)
            rev = ip.ultima_revisao(a.nome)
            if rev is None:
                continue
            p[a.pessoa]["revisados"] += 1
            p[a.pessoa][{"aprovar": "aprovados", "corrigir": "corrigidos", "devolver": "devolvidos"}[rev.decisao]] += 1
            if rev.criado_em >= semana:
                revisados_semana[a.pessoa] += 1
                if rev.decisao == "aprovar":
                    p[a.pessoa]["aprovados_semana"] += 1
                if rev.decisao == "devolver":
                    devolvidos_semana[a.pessoa] += 1
            if rev.decisao == "aprovar":
                aprovado_quadro.add(a.quadro)
        for revs in ip.revisoes_de.values():
            for rv in revs:
                p[rv.revisor]["revisoes_feitas"] += 1
                tempos_rev[rv.revisor].append(rv.segundos_ativos)
                dias[rv.revisor].add(rv.criado_em.astimezone().date())
        # concordância nos rótulos cegos (quadros em dupla)
        ultimos = ip.ultimos()
        pac = pasta.ler_pacote_ref(man.pacote)
        campo = campo_do_pacote(pac)
        for item in fila.itens:
            if not item.dupla or len(item.atribuido_a) < 2:
                continue
            a1, a2 = (ultimos.get((item.quadro, x)) for x in item.atribuido_a[:2])
            if a1 is None or a2 is None:
                continue
            r1, r2 = indice.rotulo(a1), indice.rotulo(a2)
            if r1.camera is None or r2.camera is None:
                continue
            d = distancia_cameras(r1.camera, r2.camera, pac, campo, w, h)
            if d is not None:
                concord[a1.pessoa].append(d[0])
                concord[a2.pessoa].append(d[0])
        anotados = {a.quadro for a in ip.rotulos}
        partidas.append(
            {
                "partida": pid,
                "sorteados": len(fila.itens),
                "anotados": len(anotados),
                "aprovados": len(aprovado_quadro),
                "pendentes_revisao": sum(
                    1 for a in ultimos.values() if not ip.revisoes_de.get(a.nome) and indice.rotulo(a).corrige is None
                ),
            }
        )

    tem_gabarito = bool(listar_itens(pasta))
    linhas = []
    for cod in sorted(set(pessoas) | set(p)):
        s = p[cod]
        res = resultados(pasta, indice, cod)
        lib = liberacao(res, tem_gabarito)
        marcos = []
        if s["aprovados"] >= 100:
            marcos.append("100 aprovados")
        if revisados_semana[cod] >= 10 and devolvidos_semana[cod] == 0:
            marcos.append("uma semana sem devolução")
        linhas.append(
            {
                "pessoa": cod,
                "nome": pessoas.get(cod, ""),
                "rotulos": int(s["rotulos"]),
                "aprovados": int(s["aprovados"]),
                "aprovados_semana": int(s["aprovados_semana"]),
                "devolvidos": int(s["devolvidos"]),
                "taxa_aprovacao": round(s["aprovados"] / s["revisados"], 3) if s["revisados"] else None,
                "tempo_mediano_s": _mediana(tempos_rot[cod]),
                "revisoes_feitas": int(s["revisoes_feitas"]),
                "tempo_mediano_revisao_s": _mediana(tempos_rev[cod]),
                "concordancia_px": _mediana(concord[cod]),
                "gabarito_n": lib["n"],
                "gabarito_mediana_px": None if lib["mediana_px"] is None else round(lib["mediana_px"], 2),
                "liberado": lib["liberado"],
                "dias_seguidos": _dias_seguidos(dias[cod], hoje),
                "marcos": marcos,
            }
        )
    linhas.sort(key=lambda x: (-x["aprovados_semana"], -x["aprovados"], x["pessoa"]))
    total = {k: sum(x[k] for x in partidas) for k in ("sorteados", "anotados", "aprovados", "pendentes_revisao")}
    return {
        "calculado_em": agora.isoformat(),
        "pessoas": linhas,
        "partidas": partidas,
        "total": total,
        "gabarito_importado": tem_gabarito,
    }


def placar(pasta: Pasta, indice: Indice | None = None) -> dict:
    """Placar com cache em `metricas/placar.json` (refeito quando algum arquivo muda)."""
    cache = pasta.metricas / "placar.json"
    assin = _assinatura(pasta)
    if cache.exists():
        try:
            dados = json.loads(cache.read_text(encoding="utf-8"))
            if dados.get("assinatura") == assin:
                return dados["placar"]
        except (json.JSONDecodeError, KeyError):
            pass
    resultado = calcular(pasta, indice)
    escrever_json(cache, {"assinatura": assin, "placar": resultado}, sobrescrever=True)
    return resultado
