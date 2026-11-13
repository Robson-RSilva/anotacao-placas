"""Traz o ONNX Runtime Web (só o que a página usa) do npm para `web/vendor/onnxruntime-web/`.

    python scripts/onnxruntime_web.py 1.31.1

Baixa o pacote `onnxruntime-web` da versão pedida do registro do npm, confere a integridade (o sha512 que
o registro publica) e copia os dois arquivos que a página carrega, sem mudar nada neles:

* `ort.wasm.bundle.min.mjs`, gravado como `ort.wasm.bundle.min.js` (todo servidor manda o `.js` como
  JavaScript, que o navegador exige de um módulo; o conteúdo é o mesmo): a API e a cola do WebAssembly
  (só a CPU, sem WebGPU nem WebGL);
* `ort-wasm-simd-threaded.wasm`: o motor.

A licença (MIT) e os avisos dos componentes de terceiros vêm do repositório do ONNX Runtime, na mesma
versão. `VERSAO.json` guarda a versão, de onde veio cada arquivo e o sha256 dele (o teste
`test_onnxruntime_web.py` confere). A página não busca nada fora do próprio site: a rede roda inteira no
navegador. Só usa a biblioteca padrão.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import tarfile
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
DESTINO = RAIZ / "web" / "vendor" / "onnxruntime-web"
# no pacote -> aqui
DO_PACOTE = {
    "ort.wasm.bundle.min.mjs": "ort.wasm.bundle.min.js",
    "ort-wasm-simd-threaded.wasm": "ort-wasm-simd-threaded.wasm",
}
DO_REPOSITORIO = ("LICENSE", "ThirdPartyNotices.txt")


def _baixar(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("versao", help="a versão do onnxruntime-web, por exemplo 1.31.1")
    versao = ap.parse_args().versao
    meta = json.loads(_baixar(f"https://registry.npmjs.org/onnxruntime-web/{versao}"))
    tarball = meta["dist"]["tarball"]
    algoritmo, esperado = meta["dist"]["integrity"].split("-", 1)
    if algoritmo != "sha512":
        raise SystemExit(f"integridade em {algoritmo}: esperava sha512")
    pacote = _baixar(tarball)
    if base64.b64encode(hashlib.sha512(pacote).digest()).decode() != esperado:
        raise SystemExit(f"{tarball}: o sha512 não bate com o do registro do npm")
    DESTINO.mkdir(parents=True, exist_ok=True)
    for antigo in DESTINO.iterdir():
        antigo.unlink()
    arquivos = {}
    with tarfile.open(fileobj=io.BytesIO(pacote), mode="r:gz") as tar:
        for nome, local in DO_PACOTE.items():
            dados = tar.extractfile(f"package/dist/{nome}").read()
            (DESTINO / local).write_bytes(dados)
            arquivos[local] = {"de": f"{tarball}#package/dist/{nome}", "sha256": hashlib.sha256(dados).hexdigest()}
    for nome in DO_REPOSITORIO:
        url = f"https://raw.githubusercontent.com/microsoft/onnxruntime/v{versao}/{nome}"
        dados = _baixar(url)
        (DESTINO / nome).write_bytes(dados)
        arquivos[nome] = {"de": url, "sha256": hashlib.sha256(dados).hexdigest()}
    info = {"pacote": "onnxruntime-web", "versao": versao, "licenca": meta.get("license", ""), "arquivos": arquivos}
    (DESTINO / "VERSAO.json").write_text(json.dumps(info, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    total = sum((DESTINO / n).stat().st_size for n in arquivos) / 2**20
    print(f"{DESTINO.relative_to(RAIZ)}: onnxruntime-web {versao}, {len(arquivos)} arquivos, {total:.1f} MB")


if __name__ == "__main__":
    main()
