# Changelog

Formato de [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões em
[SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.2.0] - 2026-10-23

Tudo roda no navegador de cada pessoa, publicado no GitHub Pages: ninguém precisa instalar nada para
anotar (ADR-0005).

### Adicionado

- Aplicativo de uma página (central, câmera, revisão, importar e coordenação) em `web/`, publicado
  pelo CI no GitHub Pages; funciona sem internet depois da primeira visita.
- Pasta de trabalho escolhida no computador (File System Access API, Chrome e Edge), lembrada entre
  visitas, ou guardada no próprio navegador, com entrada e saída por .zip.
- Importação de partida no navegador: leitor de MP4/MOV (comum e fragmentado; H.264, H.265, VP9 e
  AV1), decodificação com WebCodecs num worker, SHA-256 por partes, os mesmos descritores, cortes,
  agrupamento e sorteio da 0.1, e extração dos quadros sorteados em JPEG.
- Página de coordenação: equipe, projeto (link do Manual), pacotes de estádio, gabarito e divisão por
  partida.
- `projeto.json` (formato `projeto/1`, opcional): nome e link do Manual mostrados nas páginas.
- `anotacao prever`: grava as previsões do modelo para os quadros sorteados (antes era na importação).
- Validação no navegador pelos mesmos JSON Schemas do Python, mais as regras entre campos.
- Testes: lógica das páginas no Node (filas, gabarito, placar, formatos, pasta, .zip, leitor de MP4
  comparado com o ffprobe, descritores e cortes comparados com a 0.1) e ponta a ponta no navegador
  (importar, anotar, revisar e unificar em Python o que a página gravou).

### Mudado

- O Python fica para quem coordena e treina: `exemplo`, `gabarito`, `prever`, `validar`, `unificar`
  e `esquemas`. Os esquemas passam para `web/esquemas/` (`scripts/gerar_arquivos_web.py`).
- A data e a hora da partida guardam o fuso local (antes iam em UTC e uma partida à noite podia ganhar
  o dia seguinte no ID).
- O placar é calculado em cada navegador e não grava mais `metricas/placar.json` (um arquivo escrito
  por várias máquinas dava conflito no Drive).
- O gabarito escondido conta a partir da liberação de verdade, não dos 10 primeiros itens.
- Rótulo ou revisão cujo conteúdo não bate com o nome do arquivo conta como inválido.
- O gabarito só aceita imagens JPEG.

### Removido

- O servidor local (`anotacao abrir`, FastAPI) e a importação pela linha de comando
  (`anotacao importar`): a importação é feita nas páginas.
- A detecção de replays pela vinheta da emissora (replays são conferidos na solução assistida).

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
