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
- Commits no estilo Conventional Commits, em português: `feat: página das placas`,
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
  quando quebra arquivos antigos (`rotulo.pontos/2`), atualizar `docs/formatos.md` e regenerar os
  arquivos das páginas: `python scripts/gerar_arquivos_web.py` (há um teste que confere). Regras entre
  campos ficam nos dois lados: `model_validator` no Python e `REGRAS` em `web/js/nucleo/formatos.js`.
- **O campo idêntico ao do laboratório.** Os nomes dos pontos, a ordem e a simetria de 180° vêm do
  campo do laboratório. Mudou o campo lá, rode
  `python scripts/fixture_do_laboratorio.py --laboratorio ../placas-exposicao` e ajuste `campo.py` e
  `web/js/nucleo/campo.js` até os testes passarem.
- **O PNG e a região da placa são os mesmos nos dois lados.** `mascara.py` e `web/js/nucleo/png.js`
  gravam e leem as máscaras do mesmo jeito, e `mascara.rasterizar` e `web/js/nucleo/regiao.js` põem os
  mesmos pixels dentro de um polígono; as referências ficam em `tests/fixtures/png.json` e
  `tests/fixtures/regioes.json` (`python scripts/gerar_arquivos_web.py`).
- **As regras do gabarito ficam na página** (`REGRA` em `web/js/nucleo/gabarito.js`). Mudou uma regra,
  confira de novo com os anotadores simulados (`python scripts/conferir_regras.py --lotes <lotes>
  --saida <tmp>`, ADR-0010 e ADR-0012) e atualize o README, `docs/formatos.md` e o texto da página do
  gabarito. Lotes novos saem de `scripts/lotes_de_ouro.py`, com faixas de id que não se sobrepõem às
  dos lotes já entregues (nem às de lotes que não valem mais, como os g2xxx e g3xxx da pintura da 0.8 e
  da 0.9: um item com o id de outro que já está na pasta não é importado). As faixas g5xxx e g6xxx são
  do gabarito arbitrado (`anotacao ouro`).
- **Nunca dados no Git.** Vídeos, quadros, rótulos e conjuntos ficam na pasta de trabalho do Drive.
  Os únicos vídeos do repositório são os de teste, de poucos KB, em `tests/fixtures/video/`.
- **Manual junto.** Regra de anotação nova vai primeiro para o Manual de anotação, com versão; a
  versão que a ferramenta grava em cada rótulo está em `convencoes.py` e `convencoes.js` (`MANUAL`).
