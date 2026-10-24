# Arquitetura

```text
GitHub Pages (site estático)          navegador de cada pessoa                     pasta e Drive
┌───────────────────────────┐  baixa  ┌──────────────────────────────────────┐    ┌──────────────────────┐
│ web/: HTML, CSS, JS,      │ ──────► │ aplicativo de uma página             │    │ pasta de trabalho    │
│ esquemas e exemplo        │ (uma    │  · filas, gabarito, placar, molde    │───►│ (um arquivo por      │
└───────────────────────────┘  vez)   │  · importação num worker (WebCodecs) │    │  pessoa e versão)    │
                                      │ File System Access API ou OPFS       │    └──────────┬───────────┘
                                      └──────────────────────────────────────┘               │ sincronização
                                                                                   Google Drive (equipe)
                                      Python (quem coordena e treina): validar, unificar, gabarito, prever
```

- **Por que só páginas estáticas:** cada pessoa anota no próprio computador sem instalar nada. O
  navegador faz tudo o que antes pedia um servidor local: grava numa pasta escolhida (File System
  Access API, Chrome e Edge), decodifica vídeo (WebCodecs) e roda o ajuste da câmera. O GitHub Pages
  só entrega os arquivos do site; nenhum dado passa por ele (ADR-0005).
- **Onde ficam os dados:** na pasta escolhida — de preferência a pasta da equipe sincronizada pelo
  Google Drive para computador — ou, sem ela, no armazenamento do próprio navegador (Origin Private
  File System), com entrada e saída por .zip. A alça da pasta fica no IndexedDB, então a página lembra
  a escolha; a permissão o navegador confirma com um clique.
- **Sem banco de dados:** a verdade são os arquivos JSON na pasta. Filas, placar e conjuntos são
  sempre recalculados deles (com cache por data de modificação e tamanho), e dão o mesmo resultado em
  qualquer máquina. Nada que várias pessoas escrevam vai para um arquivo só.
- **Cada pessoa no seu computador:** o que liga quem anota a quem revisa é a pasta sincronizada — um
  arquivo por pessoa e por versão, que o Drive leva de um computador para o outro (ou um .zip, sem
  Drive). As páginas paradas sem nada a fazer (`ui/vigia.js`) conferem a pasta de tempos em tempos e
  quando a pessoa volta para a aba, e mostram o que chegou sem recarregar. `pessoas/<código>/` diz em
  que computadores cada código é usado, para avisar duas pessoas que escolheram o mesmo.
- **Sem cadastro prévio:** ninguém precisa estar numa equipe nem o estádio precisa estar levantado.
  Cada pessoa digita um código, que só separa os arquivos e conta o placar; as filas são abertas
  (quem chega pega o próximo, cada código começa num ponto diferente da fila). O molde é o campo
  genérico — as marcações da regra num campo cujo comprimento e largura se ajustam em cada rótulo —
  ou, quando houver, o pacote de um estádio levantado.
- **O molde arrastável:** a página projeta o campo inteiro pela câmera; arrastar um ponto roda um
  Levenberg–Marquardt em 8 parâmetros (pan, tilt, roll, zoom, distorção e posição) que leva aquele
  ponto ao cursor sem tirar do lugar os já travados. Uma âncora em torno da câmera de partida decide
  o que se mexe com poucas pistas: com um ponto só giram pan e tilt; com dois entram zoom e roll; com
  quatro, a posição; com cinco, a distorção.
- **A importação:** um worker lê o MP4 em blocos (o índice com um leitor próprio de ISO BMFF), faz o
  SHA-256 por partes, decodifica os quadros com o WebCodecs e guarda só os descritores de quadros
  reduzidos a 160 × 90. Com trechos escolhidos, decodifica só do quadro-chave anterior a cada trecho
  até o fim dele; o resto do arquivo só passa pelo hash. Depois acha os cortes (o começo e o fim de
  cada trecho também cortam), agrupa as tomadas, sorteia e decodifica de novo só os grupos de quadros
  (GOP) com sorteados, para gravá-los em JPEG na resolução original.

## Módulos

### Páginas (`web/js/`)

| Módulo | Papel |
| --- | --- |
| `nucleo/convencoes.js` | referencial, IDs, código da pessoa, versões da ferramenta e do manual |
| `nucleo/camera.js`, `nucleo/campo.js` | modelo de câmera e molde do campo em qualquer medida — idênticos ao laboratório |
| `nucleo/pacote.js` | o campo genérico, a câmera de partida e as placas do pacote |
| `nucleo/trechos.js` | ler os trechos do vídeo como a pessoa escreve |
| `nucleo/solver.js` | ajuste da câmera ao que se arrasta e trava |
| `nucleo/esquema.js`, `nucleo/formatos.js` | validação pelos JSON Schemas do Python e pelas regras entre campos |
| `nucleo/pasta.js`, `nucleo/indice.js` | layout da pasta, escrita que nunca sobrescreve, índice com cache |
| `nucleo/filas.js`, `nucleo/gabarito.js`, `nucleo/placar.js`, `nucleo/avaliacao.js` | o que cada pessoa faz a seguir, liberação, placar e medidas em px |
| `nucleo/rotulos.js` | montar e gravar rótulos e revisões |
| `nucleo/zip.js`, `nucleo/transferencia.js` | levar e trazer arquivos em .zip |
| `nucleo/hash.js`, `nucleo/aleatorio.js`, `nucleo/estatistica.js` | SHA-256 por partes, sorteio reprodutível, mediana e percentil |
| `video/mp4.js` | índice do MP4: codec e tabela de amostras |
| `video/descritores.js`, `video/cortes.js`, `video/sorteio.js` | do vídeo aos quadros sorteados (as contas da v0.1) |
| `video/importar.js`, `video/trabalhador.js` | a importação, num worker |
| `ui/` | as vistas (central, câmera, revisão, importar, coordenação), o editor, a escolha da pasta e a vigia que pega o que chega de outros computadores |

`nucleo/` e as contas de `video/` não dependem da página: rodam no Node (`node --test`) e no worker.

### Python (`src/anotacao/`)

| Módulo | Papel |
| --- | --- |
| `convencoes.py`, `camera.py`, `campo.py` | as mesmas convenções e o mesmo modelo, testados contra o laboratório |
| `formatos.py` | modelos dos arquivos (pydantic) e JSON Schemas |
| `pasta.py`, `indice.py` | layout da pasta, escrita atômica, índice |
| `pacote.py` | validação do pacote, o campo genérico e o estádio sintético |
| `gabarito.py`, `previsores.py` | importar o gabarito; previsões do modelo para o molde |
| `unificar.py` | conjuntos de treino em Parquet |
| `geracao.py` | arquivos que as páginas leem e saem do Python (esquemas, exemplo, convenções) |
| `cli.py` | linha de comando |

## Segurança e privacidade

- A página só fala com o próprio site: a CSP (`connect-src 'self'`) impede que ela mande dados para
  outro endereço, e o service worker só guarda os arquivos do site.
- O acesso à pasta é o que o navegador concede: só a pasta escolhida, com permissão confirmada pela
  pessoa. Todos os caminhos passam pela validação dos IDs (nada de `../`).
- A página não mostra a partida, o quadro nem o autor do que está anotando ou revisando, para o
  gabarito escondido e a revisão às cegas continuarem escondidos na interface. Como os arquivos estão
  na pasta de cada um, isso é um combinado de uso, não um segredo técnico.
