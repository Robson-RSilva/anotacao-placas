## O que muda

<!-- uma ou duas frases -->

## Checklist

- [ ] Só dados de treino (ADR-0003): a mudança não traz tarefa da solução assistida
- [ ] `ruff check .`, `ruff format --check .`, `pytest` e `node --test tests/js/*.test.js` passando
- [ ] Mexeu nas páginas? `pytest -m e2e` passando e a página não fala com outro endereço (CSP)
- [ ] Mudou formato? Subiu a versão do formato, atualizou `docs/formatos.md` e rodou `python scripts/gerar_arquivos_web.py`
- [ ] Mudou regra de anotação? Atualizou o Manual de anotação e `MANUAL` em `convencoes.py` e `convencoes.js`
- [ ] `CHANGELOG.md` atualizado (seção "Não lançado")
- [ ] Nenhum dado (vídeo, quadro, rótulo) no commit
