# Como contribuir

## Ambiente

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pre-commit install            # opcional: roda o ruff a cada commit
```

Python 3.11+ e, para os testes do JavaScript, Node 20+ (sem `npm install`: só `node --test`).

## Antes de abrir um PR

```bash
ruff check . && ruff format --check .
pytest
node --test tests/js/*.test.js
pytest -m e2e                 # quando mexer nas páginas (precisa do Playwright e do Chromium)
```

O CI roda tudo isso em cada push e PR.

## Fluxo

- `main` sempre verde e protegida; cada mudança num ramo (`feat/...`, `fix/...`, `docs/...`) e PR.
- Commits no estilo Conventional Commits, em português: `feat: página de oclusão`,
  `fix: versão da revisão`, `docs: formato do rótulo`.
- Mudança visível para quem anota entra no `CHANGELOG.md`, na seção "Não lançado".
- Versões seguem SemVer; cada versão vira uma tag `vX.Y.Z`.

## Regras do projeto

- **Só dados de treino** (ADR-0003). Uma tarefa nova só entra se o que ela grava treina ou testa um
  modelo.
- **Código próprio.** Nada de código, pesos, anotações ou avaliadores de repositórios públicos de
  calibração; só bibliotecas gerais.
- **Formato mudou, versão muda.** Mudar um modelo em `formatos.py` exige subir o sufixo do formato
  quando quebra arquivos antigos (`rotulo.camera/2`), atualizar `docs/formatos.md` e regenerar os
  esquemas: `anotacao esquemas src/anotacao/esquemas` (há um teste que confere).
- **Câmera e molde idênticos ao laboratório.** Mudou o modelo no laboratório, rode
  `python scripts/fixture_do_laboratorio.py --laboratorio ../placas-exposicao` e ajuste
  `camera.py`/`campo.py` e os espelhos em `web/js/` até os testes passarem.
- **Nunca dados no Git.** Vídeos, quadros, rótulos e conjuntos ficam na pasta de trabalho do Drive.
- **Manual junto.** Regra de anotação nova vai primeiro para o Manual de anotação, com versão; a
  versão que a ferramenta grava em cada rótulo está em `convencoes.py` (`MANUAL`).
