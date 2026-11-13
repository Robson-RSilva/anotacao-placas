"""O ONNX Runtime Web que vem com a página está como saiu do npm (scripts/onnxruntime_web.py)."""

import hashlib
import json
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
VENDOR = RAIZ / "web" / "vendor" / "onnxruntime-web"


def test_arquivos_como_vieram_do_npm():
    info = json.loads((VENDOR / "VERSAO.json").read_text(encoding="utf-8"))
    assert info["pacote"] == "onnxruntime-web" and info["licenca"] == "MIT"
    nomes = sorted(p.name for p in VENDOR.iterdir())
    assert nomes == sorted([*info["arquivos"], "VERSAO.json"])
    for nome, a in info["arquivos"].items():
        assert hashlib.sha256((VENDOR / nome).read_bytes()).hexdigest() == a["sha256"], nome
    cabecalho = (VENDOR / "ort.wasm.bundle.min.js").read_text(encoding="utf-8")[:300]
    assert f"ONNX Runtime Web v{info['versao']}" in cabecalho


def test_a_pagina_carrega_o_que_veio():
    texto = (RAIZ / "web" / "js" / "video" / "previsao.js").read_text(encoding="utf-8")
    m = re.search(r'new URL\("\.\./\.\./vendor/onnxruntime-web/([^"]+)"', texto)
    assert m and (VENDOR / m.group(1)).is_file()
    # a página nunca busca nada fora do próprio site
    assert "https://" not in texto and "cdn" not in texto.lower()
