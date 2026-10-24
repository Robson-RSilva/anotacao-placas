"""Baixar do YouTube o vídeo de uma partida, para importar na página: inteiro ou só uns trechos.

    anotacao baixar "https://www.youtube.com/watch?v=…" --trechos "0:05:00-0:50:00, 1:05:00-1:50:00"

A página não consegue baixar do YouTube (o navegador não deixa uma página ler o vídeo de outro
site), então quem importa baixa por aqui, no próprio computador, e escolhe o arquivo na página.

- Só a imagem, sem som, em MP4 com H.264 até 1080p (AV1 quando não houver H.264): o que o Chrome e o
  Edge decodificam, de preferência pela placa de vídeo.
- Com trechos, baixa só eles — cada um do quadro-chave antes do início até o fim, sem recodificar — e
  junta tudo num arquivo só.
- O arquivo guarda de onde veio no comentário do MP4 (`anotacao/1 {...}`): a página registra a origem
  no manifesto e não aplica os mesmos trechos de novo.

Precisa do extra `baixar`: o yt-dlp, o Deno (que o yt-dlp usa nos desafios do YouTube) e um ffmpeg,
todos pelo pip.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable
from fractions import Fraction
from pathlib import Path

from .convencoes import PREFIXO_ORIGEM
from .trechos import formatar_trechos, tempo_exato

INSTALAR = 'pip install "anotacao-placas[baixar] @ git+https://github.com/Robson-RSilva/anotacao-placas"'
Trechos = list[tuple[float, float]]


class ErroBaixar(RuntimeError):
    """O vídeo não pôde ser baixado; a mensagem diz o que fazer."""


def ffmpeg_exe() -> str:
    """O ffmpeg que vem pelo pip (imageio-ffmpeg) ou, sem ele, o do sistema."""
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        pass
    exe = shutil.which("ffmpeg")
    if not exe:
        raise ErroBaixar(f"não achei o ffmpeg; instale com: {INSTALAR}")
    return exe


def deno_exe() -> str | None:
    """O Deno que vem pelo pip, ou o do sistema. Sem ele o YouTube oferece menos formatos (o yt-dlp avisa)."""
    try:
        import deno

        return deno.find_deno_bin()
    except (ImportError, OSError):
        return shutil.which("deno")


def formato(altura_max: int = 1080) -> str:
    """Só a imagem, em MP4: H.264 primeiro (decodificação pela placa de vídeo em quase todo computador)."""
    h = int(altura_max)
    return "/".join(
        [
            f"bv*[vcodec^=avc1][height<=?{h}][ext=mp4]",
            f"bv*[vcodec^=av01][height<=?{h}][ext=mp4]",
            f"bv*[height<=?{h}][ext=mp4]",
            f"b[height<=?{h}][ext=mp4]",
        ]
    )


def origem(info: dict, trechos: Trechos | None) -> dict:
    """De onde veio o arquivo: o que vai no comentário do MP4 e, pela página, no manifesto."""
    return {
        "fonte": str(info.get("extractor_key") or "link").lower(),
        "id": str(info.get("id") or ""),
        "url": str(info.get("webpage_url") or info.get("original_url") or ""),
        "titulo": str(info.get("title") or ""),
        "trechos": [[a, b] for a, b in trechos] if trechos else None,
    }


def comentario(dados: dict) -> str:
    return PREFIXO_ORIGEM + json.dumps(dados, ensure_ascii=False, separators=(",", ":"))


def ler_comentario(texto: str | None) -> dict | None:
    """O inverso de `comentario` (None quando o arquivo não veio deste comando)."""
    if not texto or not texto.startswith(PREFIXO_ORIGEM):
        return None
    try:
        dados = json.loads(texto[len(PREFIXO_ORIGEM) :])
    except ValueError:
        return None
    return dados if isinstance(dados, dict) else None


def nome_do_arquivo(info: dict, trechos: Trechos | None) -> str:
    """O nome do arquivo, "<título> [<id>].mp4" ou "... trechos.mp4" — o mesmo em qualquer sistema."""

    def limpo(texto: str) -> str:
        texto = re.sub(r'[\x00-\x1f<>:"/\\|?*]+', " ", texto)
        return re.sub(r"\s+", " ", texto).strip(" .")

    titulo = limpo(str(info.get("title") or "video"))[:80].strip(" .") or "video"
    ident = limpo(str(info.get("id") or ""))
    return f"{titulo} [{ident}]{' trechos' if trechos else ''}.mp4"


def ajustar_ao_video(trechos: Trechos | None, duracao: float | None) -> Trechos | None:
    """Os trechos dentro da duração do vídeo (o fim de um trecho que passa do fim vira o fim do vídeo)."""
    if not trechos or not duracao:
        return trechos
    dentro = [(a, min(b, float(duracao))) for a, b in trechos if a < duracao]
    if not dentro:
        raise ErroBaixar(f"nenhum trecho cai dentro do vídeo, que tem {tempo_exato(float(duracao))}")
    return dentro


def explicar(mensagem: str, altura_max: int) -> str:
    """O erro do yt-dlp com o que fazer, em português."""
    m = re.sub(r"^ERROR:\s*", "", mensagem.strip())
    baixo = m.lower()
    if "not a bot" in baixo or "sign in to confirm" in baixo:
        return (
            "o YouTube pediu para confirmar que não é um robô. Abra o YouTube num navegador em que você está "
            "logado e rode de novo com --cookies-do-navegador firefox (ou chrome, edge…)"
        )
    if "requested format is not available" in baixo:
        return f"o vídeo não tem um formato MP4 (H.264 ou AV1) até {altura_max}p; tente outra --altura-max"
    if "unsupported url" in baixo:
        return "o link não é de um vídeo: copie o endereço da página do vídeo no YouTube"
    if "http error 404" in baixo:
        return "o link não existe (erro 404): confira o endereço"
    rede = ("unable to connect", "name resolution", "getaddrinfo", "timed out", "network is unreachable")
    if any(t in baixo for t in rede):
        return f"não consegui falar com o site (sem internet, proxy ou firewall?): {m}"
    if any(t in baixo for t in ("private video", "video unavailable", "this video is not available")):
        return f"o vídeo não está disponível (privado, removido ou com restrição): {m}"
    return f"o yt-dlp não conseguiu baixar: {m}. Se o YouTube mudou algo, atualizar resolve: pip install -U yt-dlp"


def _rodar(args: list[str]) -> str:
    r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode:
        raise ErroBaixar(f"o ffmpeg falhou: {r.stderr.strip()[-400:]}")
    return r.stdout


def duracao_exibida(ffmpeg: str, arquivo: Path) -> Fraction:
    """Do primeiro quadro exibido ao fim do último, em segundos, pelos pacotes do vídeo (sem decodificar).

    É o tamanho de cada pedaço na junção: o último quadro de um pedaço cortado pode ficar além da
    duração que o arquivo declara (os quadros B depois dele em ordem de decodificação ficaram de fora),
    e o pedaço seguinte não pode começar antes dele.
    """
    saida = _rodar([ffmpeg, "-v", "error", "-i", str(arquivo), "-map", "0:v:0", "-c", "copy", "-f", "framemd5", "-"])
    base = None
    ini = fim = None
    for linha in saida.splitlines():
        if linha.startswith("#tb 0:"):
            base = Fraction(linha.split(":", 1)[1].strip())
        elif linha and not linha.startswith("#"):
            campos = [c.strip() for c in linha.split(",")]
            if len(campos) < 4 or not campos[2].lstrip("-").isdigit():
                continue
            pts, dur = int(campos[2]), int(campos[3])
            ini = pts if ini is None else min(ini, pts)
            fim = pts + dur if fim is None else max(fim, pts + dur)
    if base is None or ini is None:
        return Fraction(0)
    return (fim - ini) * base


def _aspas(caminho: Path) -> str:
    """Caminho na lista do concat do ffmpeg (entre aspas simples; uma aspa vira '\\'')."""
    return "'" + str(caminho).replace("'", "'\\''") + "'"


def juntar(ffmpeg: str, partes: list[Path], destino: Path, texto_comentario: str) -> None:
    """Um arquivo só com a imagem das partes, em sequência, sem recodificar, e o comentário da origem."""
    meta = ["-metadata", f"comment={texto_comentario}"]
    if len(partes) == 1:
        args = [ffmpeg, "-hide_banner", "-v", "error", "-y", "-i", str(partes[0])]
        _rodar([*args, "-map", "0:v:0", "-c", "copy", *meta, str(destino)])
        return
    linhas = [f"file {_aspas(p.resolve())}\nduration {float(duracao_exibida(ffmpeg, p)):.6f}\n" for p in partes]
    lista = destino.with_suffix(".txt")
    lista.write_text("".join(linhas), encoding="utf-8")
    args = [ffmpeg, "-hide_banner", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lista)]
    _rodar([*args, "-map", "0:v:0", "-c", "copy", *meta, str(destino)])


def _mb(n: float) -> str:
    return f"{n / 2**30:.1f} GB" if n >= 2**30 else f"{n / 2**20:.0f} MB"


class _Avisos:
    """O logger do yt-dlp: os avisos vão para a pessoa; os erros viram ErroBaixar com explicação."""

    def __init__(self, avisar: Callable[[str], None]):
        self.avisar = avisar

    def debug(self, msg: str) -> None:
        pass

    info = debug
    error = debug

    def warning(self, msg: str) -> None:
        self.avisar(f"aviso do yt-dlp: {msg}")


class _Progresso:
    """Uma linha a cada poucos segundos durante o download do vídeo inteiro."""

    def __init__(self, avisar: Callable[[str], None], intervalo: float = 5.0):
        self.avisar, self.intervalo, self.ultimo = avisar, intervalo, 0.0

    def __call__(self, d: dict) -> None:
        if d.get("status") != "downloading" or time.monotonic() - self.ultimo < self.intervalo:
            return
        self.ultimo = time.monotonic()
        feito = d.get("downloaded_bytes") or 0
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        eta = d.get("eta")
        partes = [f"{100 * feito / total:.0f}% de {_mb(total)}" if total else _mb(feito)]
        if eta:
            partes.append(f"faltam ~{max(1, round(eta / 60))} min")
        self.avisar("baixando: " + ", ".join(partes))


def _vigiar(pasta: Path, estimado: float | None, avisar: Callable[[str], None], parar: threading.Event) -> None:
    """Os trechos vêm pelo ffmpeg, que não conta o progresso: conta pelo tamanho do que já chegou."""
    while not parar.wait(5.0):
        feito = 0
        for f in list(pasta.iterdir()):
            try:
                feito += f.stat().st_size
            except OSError:
                continue  # renomeado no meio da conta
        if estimado:
            avisar(f"baixando os trechos: ~{min(99, round(100 * feito / estimado))}% de ~{_mb(estimado)}")
        else:
            avisar(f"baixando os trechos: {_mb(feito)}")


def baixar(
    url: str,
    pasta: Path | str = ".",
    trechos: Trechos | None = None,
    altura_max: int = 1080,
    navegador: str | None = None,
    avisar: Callable[[str], None] = print,
) -> Path:
    """Baixa o vídeo (ou só os trechos, em segundos) para `pasta` e devolve o arquivo pronto para importar."""
    try:
        import yt_dlp
        from yt_dlp.utils import DownloadError, download_range_func
    except ImportError as e:
        raise ErroBaixar(f"falta o yt-dlp; instale com: {INSTALAR}") from e
    pasta = Path(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    ffmpeg = ffmpeg_exe()
    opcoes: dict = {
        "format": formato(altura_max),
        "noplaylist": True,
        "quiet": True,
        "noprogress": True,
        "logger": _Avisos(avisar),
        "ffmpeg_location": ffmpeg,
        "retries": 10,
        "fragment_retries": 10,
    }
    if deno := deno_exe():
        opcoes["js_runtimes"] = {"deno": {"path": deno}}
    if navegador:
        opcoes["cookiesfrombrowser"] = (navegador,)

    avisar("lendo o link…")
    try:
        with yt_dlp.YoutubeDL(opcoes) as ydl:
            info = ydl.sanitize_info(ydl.extract_info(url, download=False))
    except DownloadError as e:
        raise ErroBaixar(explicar(str(e), altura_max)) from e
    if info.get("_type") in ("playlist", "multi_video"):
        raise ErroBaixar("o link é de uma lista de vídeos: use o link de um vídeo só")
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming", "post_live"):
        raise ErroBaixar("a transmissão ainda está ao vivo, ou acabou e o YouTube ainda processa: tente mais tarde")
    duracao = info.get("duration")
    trechos = ajustar_ao_video(trechos, duracao)
    final = pasta / nome_do_arquivo(info, trechos)
    if final.exists():
        raise ErroBaixar(f"já existe {final}: apague-o ou baixe em outra pasta (--pasta)")
    w, h, codec = info.get("width"), info.get("height"), info.get("vcodec")
    detalhes = [f"{w}×{h}" if w and h else "", codec if codec and codec != "none" else "", "sem som"]
    alvo = f"os trechos {formatar_trechos(trechos)}" if trechos else "o vídeo inteiro"
    avisar(f"baixando {alvo} de “{info.get('title') or url}” ({', '.join(d for d in detalhes if d)})")

    with tempfile.TemporaryDirectory(prefix=".baixando-", dir=pasta) as tmp:
        tmp = Path(tmp)
        modelo = "trecho-%(section_start)s.%(ext)s" if trechos else "video.%(ext)s"
        opcoes_download = {**opcoes, "outtmpl": {"default": str(tmp / modelo)}}
        parar = threading.Event()
        if trechos:
            opcoes_download["download_ranges"] = download_range_func(None, trechos)
            # cada pedaço começa no quadro-chave com tempo zero, sem pré-rolagem escondida: assim os
            # pedaços se juntam em ordem
            opcoes_download["external_downloader_args"] = {"ffmpeg_o": ["-avoid_negative_ts", "make_zero"]}
            tamanho = info.get("filesize") or info.get("filesize_approx")
            estimado = tamanho * sum(b - a for a, b in trechos) / duracao if tamanho and duracao else None
            threading.Thread(target=_vigiar, args=(tmp, estimado, avisar, parar), daemon=True).start()
        else:
            opcoes_download["progress_hooks"] = [_Progresso(avisar)]
        try:
            with yt_dlp.YoutubeDL(opcoes_download) as ydl:
                feito = ydl.process_ie_result(info, download=True)
        except DownloadError as e:
            raise ErroBaixar(explicar(str(e), altura_max)) from e
        finally:
            parar.set()
        baixados = sorted(feito.get("requested_downloads") or [], key=lambda d: d.get("section_start") or 0)
        partes = [Path(d["filepath"]) for d in baixados if d.get("filepath")]
        if not partes or not all(p.exists() for p in partes):
            raise ErroBaixar("o yt-dlp terminou sem gravar o vídeo")
        if trechos:
            for (a, b), p in zip(trechos, partes, strict=False):
                if duracao_exibida(ffmpeg, p) <= 0:
                    trecho = f"{tempo_exato(a)}-{tempo_exato(b)}"
                    raise ErroBaixar(f"o trecho {trecho} veio sem nenhum quadro (passa do fim do vídeo?)")
        avisar("juntando os trechos…" if len(partes) > 1 else "gravando…")
        pronto = tmp / "pronto.mp4"
        juntar(ffmpeg, partes, pronto, comentario(origem(info, trechos)))
        shutil.move(str(pronto), str(final))
    return final
