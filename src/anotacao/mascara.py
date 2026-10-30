"""Máscaras: PNG de índices, 8 bits por pixel, só com a biblioteca padrão (zlib).

Cada pixel guarda um número — nos rótulos dos jogadores, 1 onde há jogador e 0 no resto; no gabarito,
o número de cada jogador. A paleta só serve para quem abre o arquivo num visualizador de imagens ver
as cores. Lê também o PNG em tons de cinza que o OpenCV grava (a previsão de um modelo, por
exemplo). Espelho de `web/js/nucleo/png.js`.

O OpenCV não serve para ler a máscara: ele troca a paleta pelas cores.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import cv2
import numpy as np

ASSINATURA = b"\x89PNG\r\n\x1a\n"


def _pedaco(tipo: bytes, dados: bytes) -> bytes:
    return struct.pack(">I", len(dados)) + tipo + dados + struct.pack(">I", zlib.crc32(tipo + dados) & 0xFFFFFFFF)


def gravar_png(indices: np.ndarray, paleta) -> bytes:
    """PNG com paleta: `indices` (h, w) uint8 e `paleta` [(r, g, b), ...]."""
    a = np.ascontiguousarray(indices, dtype=np.uint8)
    if a.ndim != 2:
        raise ValueError("a máscara precisa ter duas dimensões")
    h, w = a.shape
    bruto = np.zeros((h, w + 1), np.uint8)  # cada linha: o filtro (0, nenhum) e os pixels
    bruto[:, 1:] = a
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 3, 0, 0, 0)
    plte = bytes(int(v) for cor in paleta for v in cor)
    return b"".join(
        [
            ASSINATURA,
            _pedaco(b"IHDR", ihdr),
            _pedaco(b"PLTE", plte),
            _pedaco(b"IDAT", zlib.compress(bruto.tobytes(), 9)),
            _pedaco(b"IEND", b""),
        ]
    )


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def _desfiltrar(bruto: bytes, w: int, h: int) -> np.ndarray:
    linhas = np.frombuffer(bruto, np.uint8)[: h * (w + 1)].reshape(h, w + 1)
    out = np.zeros((h, w), np.uint8)
    anterior = np.zeros(w, np.int64)
    for y in range(h):
        filtro, v = int(linhas[y, 0]), linhas[y, 1:].astype(np.int64)
        if filtro == 0:
            r = v
        elif filtro == 1:
            r = np.cumsum(v) & 0xFF
        elif filtro == 2:
            r = (v + anterior) & 0xFF
        elif filtro in (3, 4):  # dependem do pixel ao lado: um por um
            r = np.zeros(w, np.int64)
            for x in range(w):
                a = int(r[x - 1]) if x else 0
                b = int(anterior[x])
                if filtro == 3:
                    r[x] = (int(v[x]) + ((a + b) >> 1)) & 0xFF
                else:
                    c = int(anterior[x - 1]) if x else 0
                    r[x] = (int(v[x]) + _paeth(a, b, c)) & 0xFF
        else:
            raise ValueError(f"PNG com filtro desconhecido ({filtro})")
        out[y] = r
        anterior = r.astype(np.int64)
    return out


def ler_png(dados: bytes | Path) -> np.ndarray:
    """Índices (h, w) uint8 de um PNG de 8 bits com paleta, ou os tons de um PNG de 8 bits em cinza."""
    if isinstance(dados, Path):
        dados = dados.read_bytes()
    if not dados.startswith(ASSINATURA):
        raise ValueError("não é um PNG")
    p, cab, idat = 8, None, []
    while p + 12 <= len(dados):
        (n,) = struct.unpack(">I", dados[p : p + 4])
        tipo, conteudo = dados[p + 4 : p + 8], dados[p + 8 : p + 8 + n]
        if len(conteudo) < n:
            raise ValueError("PNG cortado")
        if tipo == b"IHDR":
            cab = struct.unpack(">IIBBBBB", conteudo)
        elif tipo == b"IDAT":
            idat.append(conteudo)
        elif tipo == b"IEND":
            break
        p += 12 + n
    if cab is None:
        raise ValueError("PNG sem cabeçalho")
    w, h, bits, cor, _, _, entrelacado = cab
    if bits != 8 or cor not in (0, 3) or entrelacado != 0:
        raise ValueError("a máscara precisa ser um PNG de 8 bits, com paleta ou em tons de cinza, sem entrelaçamento")
    if cor == 0:  # o que o OpenCV grava
        img = cv2.imdecode(np.frombuffer(dados, np.uint8), cv2.IMREAD_UNCHANGED)
        if img is None or img.shape != (h, w):
            raise ValueError("PNG em tons de cinza ilegível")
        return img
    bruto = zlib.decompress(b"".join(idat))
    if len(bruto) < h * (w + 1):
        raise ValueError("PNG cortado")
    return _desfiltrar(bruto, w, h)


def eh_png(dados: bytes) -> bool:
    return dados[:8] == ASSINATURA
