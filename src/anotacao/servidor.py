"""Servidor local: páginas e API. Só atende a própria máquina.

Proteções de um servidor local: escuta só em 127.0.0.1 (CLI), recusa pedidos com outro `Host`
(proteção contra DNS rebinding) e exige o cabeçalho `X-Anotacao` nos pedidos que gravam, que um site
de fora não consegue mandar sem o navegador pedir permissão (CORS não é liberado).

Cada item entregue a uma página ganha uma ficha opaca: a página não vê de que partida ou de que
pessoa é o item, então o gabarito escondido e o autor do rótulo em revisão continuam escondidos.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError

from . import __version__
from .avaliacao import distancia_cameras, residuo_mediano
from .camera import canonical_side
from .convencoes import MANUAL, PARTIDA_GABARITO
from .filas import achar_por_ref, pendentes_revisao, proximo_camera, ref_cega, situacao_anotador
from .formatos import (
    Cadastro,
    CameraRotulo,
    LinhaTravada,
    Motivo,
    PartiuDe,
    PontoTravado,
    RevisaoCamera,
    RotuloCamera,
    Situacao,
)
from .gabarito import LIMITE_LIBERACAO_PX, listar_itens
from .indice import Indice
from .pacote import campo_do_pacote
from .pasta import ArquivoExiste, Pasta, escrever_json, nome_arquivo
from .placar import placar
from .preprocessamento import PartidaJaExiste, preprocessar
from .previsores import carregar_previsor
from .sorteio import ParametrosSorteio
from .unificar import unificar

WEB = Path(__file__).parent / "web"
CABECALHO = "X-Anotacao"
FORMATOS_VIDEO = {".mp4", ".mov", ".mkv", ".avi", ".ts", ".m4v", ".mxf", ".webm"}


@dataclass
class Configuracao:
    pasta: Path
    pasta_videos: Path
    config_local: Path
    previsor: str | None = None
    manual_url: str = ""
    hosts_extras: tuple[str, ...] = ()

    def ler_local(self) -> dict:
        try:
            return json.loads(self.config_local.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def gravar_local(self, dados: dict) -> None:
        escrever_json(self.config_local, dados, sobrescrever=True)


@dataclass
class Tarefa:
    id: str
    tipo: str
    estado: str = "na_fila"
    etapa: str = ""
    progresso: float = 0.0
    resultado: Any = None
    erro: str | None = None


@dataclass
class Tarefas:
    """Tarefas longas (importar vídeo) numa thread só, com progresso consultável pela página."""

    executor: ThreadPoolExecutor = field(default_factory=lambda: ThreadPoolExecutor(max_workers=1))
    dados: dict[str, Tarefa] = field(default_factory=dict)
    trava: threading.Lock = field(default_factory=threading.Lock)

    def enviar(self, tipo: str, funcao) -> Tarefa:
        t = Tarefa(uuid.uuid4().hex[:12], tipo)
        with self.trava:
            self.dados[t.id] = t

        def progresso(etapa: str, frac: float) -> None:
            t.etapa, t.progresso = etapa, round(float(frac), 4)

        def rodar() -> None:
            t.estado = "rodando"
            try:
                t.resultado = funcao(progresso)
                t.estado = "ok"
            except Exception as e:
                t.estado, t.erro = "erro", f"{type(e).__name__}: {e}"

        self.executor.submit(rodar)
        return t


@dataclass(frozen=True)
class Ficha:
    partida: str
    quadro: str
    pessoa: str
    treino: bool = False


# ----------------------------------------------------------------------------- corpos dos pedidos
class PedidoAnotador(BaseModel):
    codigo: str


class PedidoPartida(BaseModel):
    cadastro: Cadastro
    video_sha256: str
    nome_original: str
    alvo: int = 100


class PedidoRotulo(BaseModel):
    partiu_de: PartiuDe
    camera: CameraRotulo | None = None
    pontos_travados: list[PontoTravado] = []
    linhas_travadas: list[LinhaTravada] = []
    situacao: Situacao
    comentario: str = ""
    segundos_ativos: float = 0.0


class PedidoRevisao(BaseModel):
    ref: str
    decisao: Literal["aprovar", "corrigir", "devolver"]
    motivo: Motivo | None = None
    comentario: str = ""
    segundos_ativos: float = 0.0
    correcao: PedidoRotulo | None = None


def criar_app(cfg: Configuracao) -> FastAPI:
    pasta = Pasta(cfg.pasta)
    pasta.criar()
    cfg.pasta_videos.mkdir(parents=True, exist_ok=True)
    indice = Indice(pasta)
    tarefas = Tarefas()
    previsor = carregar_previsor(cfg.previsor)
    hosts = {"127.0.0.1", "localhost", "testserver", *cfg.hosts_extras}
    fichas: dict[str, Ficha] = {}

    app = FastAPI(title="Anotação de placas", version=__version__, docs_url="/api/docs", redoc_url=None)

    @app.middleware("http")
    async def protecao_local(request: Request, call_next):
        host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
        if host not in hosts:
            return JSONResponse({"detail": "servidor local: host não permitido"}, status_code=403)
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get(CABECALHO) != "1":
            return JSONResponse({"detail": f"cabeçalho {CABECALHO} ausente"}, status_code=403)
        return await call_next(request)

    @app.exception_handler(ValidationError)
    async def _erro_validacao(_req, exc: ValidationError):
        return JSONResponse({"detail": "; ".join(e["msg"] for e in exc.errors())}, status_code=422)

    @app.exception_handler(PartidaJaExiste)
    async def _ja_existe(_req, exc: PartidaJaExiste):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    # ------------------------------------------------------------------ apoio
    def pessoa_atual() -> str:
        cod = cfg.ler_local().get("anotador")
        if not cod or cod not in {m.codigo for m in pasta.ler_equipe().membros}:
            raise HTTPException(409, "escolha o seu código na página central")
        return cod

    def emitir(f: Ficha) -> str:
        token = secrets.token_urlsafe(12)
        fichas[token] = f
        return token

    def ficha(token: str, cod: str) -> Ficha:
        f = fichas.get(token)
        if f is None or f.pessoa != cod:
            raise HTTPException(409, "item expirado; a página vai carregar o próximo")
        return f

    def tamanho(partida: str, quadro: str) -> tuple[int, int, str]:
        if partida == PARTIDA_GABARITO:
            g = next((g for g in listar_itens(pasta) if g.id == quadro), None)
            if g is None:
                raise HTTPException(404, "item do gabarito não encontrado")
            return g.largura, g.altura, g.pacote
        man = indice.manifesto(partida)
        return man.video.largura, man.video.altura, man.pacote

    def url_pacote(ref: str) -> str:
        estadio, _, versao = ref.partition("/pacote-")
        return f"/api/pacotes/{estadio}/{versao}"

    def gravar_rotulo(
        p: PedidoRotulo, cod: str, partida: str, quadro: str, corrige: str | None
    ) -> tuple[Path, RotuloCamera]:
        w, h, pacote_ref = tamanho(partida, quadro)
        pac = pasta.ler_pacote_ref(pacote_ref)
        diretorio = pasta.rotulos(partida, "camera")
        versao = pasta.proxima_versao(diretorio, quadro, cod)
        lado = None if p.camera is None else ("canonico" if canonical_side(p.camera.C) else "espelhado")
        r = RotuloCamera(
            partida=partida,
            pacote=pacote_ref,
            quadro=quadro,
            anotador=cod,
            versao=versao,
            ferramenta=__version__,
            manual=MANUAL["camera"],
            criado_em=datetime.now(UTC),
            segundos_ativos=round(p.segundos_ativos, 1),
            partiu_de=p.partiu_de,
            camera=p.camera,
            lado=lado,
            pontos_travados=p.pontos_travados,
            linhas_travadas=p.linhas_travadas,
            situacao=p.situacao,
            comentario=p.comentario.strip(),
            corrige=corrige,
        )
        if r.camera is not None:
            res = residuo_mediano(r, campo_do_pacote(pac), w, h)
            r = r.model_copy(update={"residuo_mediano_px": None if res is None else round(res, 3)})
        try:
            caminho = escrever_json(diretorio / nome_arquivo(quadro, cod, versao), r)
        except ArquivoExiste as e:
            raise HTTPException(409, "esta versão já foi salva; recarregue a página") from e
        return caminho, r

    # ------------------------------------------------------------------ páginas
    @app.get("/", include_in_schema=False)
    def pagina_central():
        return FileResponse(WEB / "index.html")

    @app.get("/camera", include_in_schema=False)
    def pagina_camera():
        return FileResponse(WEB / "camera.html")

    @app.get("/revisao", include_in_schema=False)
    def pagina_revisao():
        return FileResponse(WEB / "revisao.html")

    app.mount("/static", StaticFiles(directory=WEB), name="static")

    # ------------------------------------------------------------------ estado e equipe
    @app.get("/api/estado")
    def estado():
        equipe = pasta.ler_equipe()
        cod = cfg.ler_local().get("anotador")
        membro = next((m for m in equipe.membros if m.codigo == cod), None)
        out: dict[str, Any] = {
            "versao": __version__,
            "pasta": str(pasta.raiz),
            "manual_url": cfg.manual_url,
            "anotador": membro.codigo if membro else None,
            "nome": membro.nome if membro else None,
            "papeis": membro.papeis if membro else [],
            "equipe": [m.model_dump() for m in equipe.membros],
            "pacotes": pasta.listar_pacotes(),
            "previsor": f"{previsor.nome}@{previsor.versao}" if previsor else None,
            "gabarito_itens": len(listar_itens(pasta)),
        }
        if membro:
            out["situacao"] = situacao_anotador(pasta, indice, membro.codigo)
            out["pendentes_revisao"] = (
                len(pendentes_revisao(pasta, indice, membro.codigo)) if "revisor" in membro.papeis else 0
            )
        return out

    @app.post("/api/anotador")
    def escolher_anotador(p: PedidoAnotador):
        if p.codigo not in {m.codigo for m in pasta.ler_equipe().membros}:
            raise HTTPException(400, "código fora da equipe (equipe.json)")
        dados = cfg.ler_local()
        dados["anotador"] = p.codigo
        cfg.gravar_local(dados)
        return {"anotador": p.codigo}

    # ------------------------------------------------------------------ pacotes
    @app.get("/api/pacotes/{estadio}/{versao}")
    def pacote(estadio: str, versao: str):
        try:
            pac = pasta.ler_pacote(estadio, versao)
        except FileNotFoundError as e:
            raise HTTPException(404, "pacote do estádio não encontrado") from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return {"pacote": pac.model_dump(), "campo": campo_do_pacote(pac).para_web()}

    # ------------------------------------------------------------------ partidas
    @app.get("/api/partidas")
    def partidas():
        resumo = {p["partida"]: p for p in placar(pasta, indice)["partidas"]}
        out = []
        for pid in reversed(pasta.listar_partidas()):
            man = indice.manifesto(pid)
            out.append(
                {
                    "partida": pid,
                    "cadastro": json.loads(man.cadastro.model_dump_json()),
                    "video": man.video.model_dump(),
                    "progresso": resumo.get(pid, {}),
                }
            )
        return out

    @app.put("/api/videos")
    async def enviar_video(request: Request, nome: str):
        """Recebe o vídeo no corpo do pedido e grava na pasta de vídeos, calculando o hash junto."""
        sufixo = Path(nome).suffix.lower() or ".mp4"
        if sufixo not in FORMATOS_VIDEO:
            raise HTTPException(400, f"formato de vídeo não suportado: {sufixo}")
        tmp = cfg.pasta_videos / f".envio-{uuid.uuid4().hex}{sufixo}"
        h = hashlib.sha256()
        total = 0
        try:
            with open(tmp, "wb") as f:
                async for chunk in request.stream():
                    h.update(chunk)
                    f.write(chunk)
                    total += len(chunk)
            if total == 0:
                raise HTTPException(400, "vídeo vazio")
            sha = h.hexdigest()
            final = cfg.pasta_videos / f"{sha}{sufixo}"
            if final.exists():
                tmp.unlink()
            else:
                tmp.replace(final)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        return {"video_sha256": sha, "bytes": total, "nome_original": Path(nome).name}

    @app.post("/api/partidas")
    def importar_partida(p: PedidoPartida):
        sha = p.video_sha256
        if not (len(sha) == 64 and all(c in "0123456789abcdef" for c in sha)):
            raise HTTPException(400, "hash inválido")
        achados = sorted(cfg.pasta_videos.glob(f"{sha}.*"))
        if not achados:
            raise HTTPException(404, "vídeo não encontrado; envie de novo")
        try:
            pasta.ler_pacote(p.cadastro.estadio, p.cadastro.pacote_versao)
        except FileNotFoundError as e:
            raise HTTPException(400, f"não há pacote {p.cadastro.estadio}/pacote-{p.cadastro.pacote_versao}") from e
        params = ParametrosSorteio(alvo=max(1, min(int(p.alvo), 5000)))

        def rodar(progresso):
            r = preprocessar(
                pasta,
                achados[0],
                p.cadastro,
                nome_original=p.nome_original,
                sha256=sha,
                params=params,
                previsor=previsor,
                progresso=progresso,
            )
            return r.__dict__

        return {"tarefa": tarefas.enviar("importar", rodar).id}

    @app.get("/api/tarefas/{tid}")
    def tarefa(tid: str):
        t = tarefas.dados.get(tid)
        if t is None:
            raise HTTPException(404, "tarefa não encontrada")
        return t.__dict__

    # ------------------------------------------------------------------ itens (fichas)
    @app.get("/api/fichas/{token}/imagem")
    def imagem(token: str):
        f = fichas.get(token)
        if f is None:
            raise HTTPException(404, "item expirado")
        caminho = pasta.quadro(f.partida, f.quadro)
        if not caminho.exists():
            raise HTTPException(404, "imagem não encontrada")
        return FileResponse(caminho, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})

    # ------------------------------------------------------------------ câmera
    @app.get("/api/fila/camera")
    def fila_camera():
        cod = pessoa_atual()
        item = proximo_camera(pasta, indice, cod)
        if item is None:
            sit = situacao_anotador(pasta, indice, cod)
            motivo = (
                "Nada na sua fila agora."
                if sit["liberado"]
                else "O gabarito acabou antes da liberação: fale com o responsável técnico."
            )
            return {"item": None, "motivo": motivo}
        token = emitir(Ficha(item.partida, item.quadro, cod, item.treino))
        return {
            "item": {
                "ficha": token,
                "imagem_url": f"/api/fichas/{token}/imagem",
                "pacote_url": url_pacote(item.pacote),
                "largura": item.largura,
                "altura": item.altura,
                "versao": item.versao,
                "camera_inicial": item.camera_inicial.model_dump(),
                "partiu_de": item.partiu_de.model_dump(),
                "treino": item.treino,
                "devolvido": item.devolvido,
            }
        }

    @app.post("/api/rotulos/camera")
    def salvar_rotulo(p: PedidoRotulo, ficha_token: str):
        cod = pessoa_atual()
        f = ficha(ficha_token, cod)
        caminho, r = gravar_rotulo(p, cod, f.partida, f.quadro, None)
        fichas.pop(ficha_token, None)
        out: dict[str, Any] = {"arquivo": caminho.name, "residuo_mediano_px": r.residuo_mediano_px}
        if f.treino:
            g = next(g for g in listar_itens(pasta) if g.id == f.quadro)
            res: dict[str, Any] = {"mediana_px": None, "p90_px": None}
            if r.camera is not None:
                pac = pasta.ler_pacote_ref(g.pacote)
                d = distancia_cameras(r.camera, g.camera, pac, campo_do_pacote(pac), g.largura, g.altura)
                if d is not None:
                    res = {"mediana_px": round(d[0], 2), "p90_px": round(d[1], 2)}
            res["ok"] = res["mediana_px"] is not None and res["mediana_px"] <= LIMITE_LIBERACAO_PX
            res["situacao"] = situacao_anotador(pasta, indice, cod)
            out["gabarito"] = res
        return out

    # ------------------------------------------------------------------ revisão cruzada
    @app.get("/api/fila/revisao")
    def fila_revisao():
        cod = pessoa_atual()
        pend = pendentes_revisao(pasta, indice, cod)
        if not pend:
            return {"item": None, "pendentes": 0}
        a, r = pend[0]
        w, h, pacote_ref = tamanho(a.partida, a.quadro)
        token = emitir(Ficha(a.partida, a.quadro, cod))
        rotulo = r.model_dump(
            mode="json",
            include={
                "camera",
                "pontos_travados",
                "linhas_travadas",
                "situacao",
                "comentario",
                "residuo_mediano_px",
                "lado",
            },
        )
        rotulo["partiu_de"] = r.partiu_de.fonte
        return {
            "pendentes": len(pend),
            "item": {
                "ref": ref_cega(a.nome),
                "ficha": token,
                "imagem_url": f"/api/fichas/{token}/imagem",
                "pacote_url": url_pacote(pacote_ref),
                "largura": w,
                "altura": h,
                "rotulo": rotulo,
            },
        }

    @app.post("/api/revisoes/camera")
    def salvar_revisao(p: PedidoRevisao):
        cod = pessoa_atual()
        achado = achar_por_ref(pasta, indice, cod, p.ref)
        if achado is None:
            raise HTTPException(409, "este rótulo não está mais na sua fila de revisão")
        a, _ = achado
        nova = None
        if p.decisao == "corrigir":
            if p.correcao is None:
                raise HTTPException(400, "a correção precisa da câmera corrigida")
            corr = p.correcao.model_copy(update={"partiu_de": PartiuDe(fonte="rotulo_revisado", referencia=a.nome)})
            caminho, _ = gravar_rotulo(corr, cod, a.partida, a.quadro, a.nome)
            nova = caminho.name
        diretorio = pasta.revisoes(a.partida, "camera")
        versao = pasta.proxima_versao(diretorio, a.quadro, cod)
        rev = RevisaoCamera(
            partida=a.partida,
            quadro=a.quadro,
            rotulo=a.nome,
            revisor=cod,
            versao=versao,
            decisao=p.decisao,
            motivo=p.motivo,
            comentario=p.comentario.strip(),
            nova_versao=nova,
            ferramenta=__version__,
            manual=MANUAL["revisao"],
            criado_em=datetime.now(UTC),
            segundos_ativos=round(p.segundos_ativos, 1),
        )
        caminho = escrever_json(diretorio / nome_arquivo(a.quadro, cod, versao), rev)
        return {"arquivo": caminho.name, "correcao": nova}

    # ------------------------------------------------------------------ placar e conjuntos
    @app.get("/api/placar")
    def obter_placar():
        return placar(pasta, indice)

    @app.post("/api/unificar")
    def rodar_unificar():
        destino = unificar(pasta)
        man = json.loads((destino / "manifesto.json").read_text(encoding="utf-8"))
        return {
            "destino": str(destino.relative_to(pasta.raiz)),
            "quadros": man["quadros"],
            "por_conjunto": man["por_conjunto"],
        }

    app.state.pasta = pasta
    app.state.tarefas = tarefas
    return app
