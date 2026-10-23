# Changelog

Formato de [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões em
[SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.1.0] - 2026-10-23

### Adicionado

- Servidor local (só 127.0.0.1) e linha de comando `anotacao` (`exemplo`, `abrir`, `importar`,
  `gabarito`, `validar`, `unificar`, `esquemas`).
- Página central: escolha de quem anota, importação de partida com progresso, partidas, placar e
  unificar.
- Pré-processamento local: hash, PTS, cortes e replays (regras do laboratório), agrupamento das
  tomadas, sorteio de 1 ou 2 quadros por tomada, dupla às cegas (~10%), quadros sem previsão (~10%) e
  distribuição na equipe.
- Página de câmera do quadro: molde do campo arrastável com ajuste da câmera no navegador, pontos e
  linhas travados, virar o lado, placas com o nome, situações e tempo ativo.
- Revisão cruzada às cegas: aprovar, corrigir (versão nova do revisor) ou devolver com motivo.
- Gabarito: treino com resultado na hora, liberação (mediana ≤ 2 px nos últimos 10) e itens escondidos
  na fila.
- Placar com cache local; unificar em Parquet com manifesto e divisão por partida.
- Formatos versionados com JSON Schemas; modelo de câmera e molde testados contra o laboratório em
  Python e em JavaScript; teste de ponta a ponta no navegador.
