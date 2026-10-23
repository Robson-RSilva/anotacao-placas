# Como contribuir

## Ambiente

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pre-commit install            # opcional: roda o ruff a cada commit
```

Python 3.11+ e, para os testes do JavaScript, Node 20+ (sem `npm install`: só `node --test`). Para o
teste de ponta a ponta, o Playwright com o Chromium e o ffmpeg (com AV1 ou VP9).

Para ver as páginas: `python -m http.server 8000 --bind 127.0.0.1 --directory web` e abrir
<http://127.0.0.1:8000> no Chrome ou no Edge (o endereço local conta como seguro, então a escolha de
pasta e o WebCodecs funcionam).

## Antes de abrir um PR

```bash
ruff check . && ruff format --check .
pytest
node --test tests/js/*.test.js
pytest -m e2e                 # quando mexer nas páginas
```

O CI roda tudo isso em cada push e PR, e publica o site no GitHub Pages quando um push em `main`
passa.

## Fluxo

- `main` sempre verde e protegida; cada mudança num ramo (`feat/...`, `fix/...`, `docs/...`) e PR.
- Commits no estilo Conventional Commits, em português: `feat: página de oclusão`,
  `fix: versão da revisão`, `docs: formato do rótulo`.
- Mudança visível para quem anota entra no `CHANGELOG.md`, na seção "Não lançado".
- Versões seguem SemVer; cada versão vira uma tag `vX.Y.Z`. A versão está em três lugares que um
  teste confere: `pyproject.toml`, `src/anotacao/__init__.py` e `web/js/nucleo/convencoes.js`.

## Regras do projeto

- **Só dados de treino** (ADR-0003). Uma tarefa nova só entra se o que ela grava treina ou testa um
  modelo.
- **Código próprio.** Nada de código, pesos, anotações ou avaliadores de repositórios públicos de
  calibração; só bibliotecas gerais. As páginas não têm dependências de front-end.
- **A página não fala com a internet.** Nada de CDN, análise de uso ou envio de dados: a CSP do
  `index.html` só permite o próprio site.
- **Formato mudou, versão muda.** Mudar um modelo em `formatos.py` exige subir o sufixo do formato
  quando quebra arquivos antigos (`rotulo.camera/2`), atualizar `docs/formatos.md` e regenerar os
  arquivos das páginas: `python scripts/gerar_arquivos_web.py` (há um teste que confere). Regras entre
  campos ficam nos dois lados: `model_validator` no Python e `REGRAS` em `web/js/nucleo/formatos.js`.
- **Câmera e molde idênticos ao laboratório.** Mudou o modelo no laboratório, rode
  `python scripts/fixture_do_laboratorio.py --laboratorio ../placas-exposicao` e ajuste
  `camera.py`/`campo.py` e os espelhos em `web/js/nucleo/` até os testes passarem.
- **Nunca dados no Git.** Vídeos, quadros, rótulos e conjuntos ficam na pasta de trabalho do Drive.
  Os únicos vídeos do repositório são os de teste, de poucos KB, em `tests/fixtures/video/`.
- **Manual junto.** Regra de anotação nova vai primeiro para o Manual de anotação, com versão; a
  versão que a ferramenta grava em cada rótulo está em `convencoes.py` e `convencoes.js` (`MANUAL`).
