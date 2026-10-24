"""Servidor HTTP local com Range (como o CDN de um site de vídeo), para testar o `anotacao baixar`."""

from __future__ import annotations

import functools
import http.server
import os
import re
import threading
from pathlib import Path


class _ComRange(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_head(self):
        caminho = self.translate_path(self.path)
        if not os.path.isfile(caminho) or "Range" not in self.headers:
            return super().send_head()
        tamanho = os.path.getsize(caminho)
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers["Range"].strip())
        if not m or not (m.group(1) or m.group(2)):
            self.send_error(416)
            return None
        ini = int(m.group(1)) if m.group(1) else max(0, tamanho - int(m.group(2)))
        fim = min(int(m.group(2)), tamanho - 1) if m.group(1) and m.group(2) else tamanho - 1
        f = open(caminho, "rb")  # noqa: SIM115 - quem fecha é o SimpleHTTPRequestHandler
        f.seek(ini)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(caminho))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {ini}-{fim}/{tamanho}")
        self.send_header("Content-Length", str(fim - ini + 1))
        self.end_headers()
        self._resta = fim - ini + 1
        return f

    def copyfile(self, source, outputfile):
        resta = getattr(self, "_resta", None)
        if resta is None:
            return super().copyfile(source, outputfile)
        while resta > 0:
            bloco = source.read(min(1 << 16, resta))
            if not bloco:
                break
            outputfile.write(bloco)
            resta -= len(bloco)
        return None


class _Servidor(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass  # o ffmpeg fecha a conexão quando pula para outro trecho


class ServidorDeVideo:
    """`with ServidorDeVideo(pasta) as base:` serve os arquivos da pasta em `base + nome`."""

    def __init__(self, pasta: Path):
        self.srv = _Servidor(("127.0.0.1", 0), functools.partial(_ComRange, directory=str(pasta)))

    def __enter__(self) -> str:
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        return f"http://127.0.0.1:{self.srv.server_port}/"

    def __exit__(self, *exc):
        self.srv.shutdown()
        self.srv.server_close()
