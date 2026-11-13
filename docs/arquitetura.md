# Arquitetura

```text
GitHub Pages (site estático)          navegador de cada pessoa                     pasta e Drive
┌───────────────────────────┐  baixa  ┌──────────────────────────────────────┐    ┌──────────────────────┐
│ web/: HTML, CSS, JS,      │ ──────► │ aplicativo de uma página             │    │ pasta de trabalho    │
│ esquemas e o ONNX Runtime │ (uma    │  · filas, gabarito, placar, pintura  │───►│ (um arquivo por      │
│ Web (WebAssembly)         │  vez)   │  · importação num worker (WebCodecs) │    │  pessoa e versão;    │
└───────────────────────────┘         │    e o detector de pontos (ONNX)     │◄───│  modelos/ do         │
                                      │ File System Access API ou OPFS       │    │  laboratório)        │
                                      └──────────────────────────────────────┘    └──────────┬───────────┘
                                                                                             │ sincronização
                                                                                   Google Drive (equipe)
                                      Python (quem coordena e treina): validar, unificar, gabarito, prever,
                                      trazer os lotes de recortes das placas (do simulador; depois, da projeção)
```

- **Por que só páginas estáticas:** cada pessoa anota no próprio computador sem instalar nada. O
  navegador faz tudo o que antes pedia um servidor local: grava numa pasta escolhida (File System
  Access API, Chrome e Edge), decodifica vídeo (WebCodecs) e compara as respostas com o gabarito. O
  GitHub Pages só entrega os arquivos do site; nenhum dado passa por ele (ADR-0005).
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
  (quem chega pega o próximo, cada código começa num ponto diferente da fila): a dos pontos sobre os
  quadros sorteados do vídeo, a das placas sobre os recortes dos lotes da partida.
- **Os pontos, direto na imagem** (ADR-0010): a página só mostra a imagem e um mapa do campo em SVG
  com os 39 pontos que se marcam, que gira de 90 em 90 graus para ficar como a imagem. Cada clique
  grava um ponto em px da imagem; a lupa amplia o pixel em volta do cursor. Nada de câmera nem molde:
  o campo (`nucleo/campo.js`) só dá os nomes, o desenho do mapa e a simetria de 180° com que o
  gabarito e a concordância aceitam a leitura do outro lado do campo.
- **A oclusão nas placas, no recorte da placa** (ADR-0012): a pintura recebe a placa pronta — o
  recorte endireitado, com a região que se pinta —, feita fora das páginas (o simulador, por enquanto;
  depois, a projeção das placas com a câmera de cada quadro) e trazida em lotes (`recortes/<lote>.json`
  + as imagens). O recorte é considerado certo: não se ajusta; o que não está na placa se descarta.
  O pintor guarda uma máscara de 1 byte por pixel (1 onde algo cobre a placa: gente, bola, trave,
  outra placa, o grafismo da emissora), com pincel, laço e borracha, desfazer e refazer, e só pinta
  dentro da região (`nucleo/regiao.js`: o centro do pixel decide, a mesma conta do `mascara.py`); fora
  dela a imagem fica escurecida. A máscara vai num PNG de índices ao lado do rótulo, gravado e lido
  por um codificador próprio (a paleta não passa pelo canvas, que mexeria nas cores). Duas pinturas —
  ou a pintura e a resposta do gabarito — se comparam dentro da região, sem a borda de 1 px do que
  está na frente.
- **O gabarito:** os itens ficam em `gabarito/itens/`, e os rótulos deles em `gabarito/rotulos/`, fora
  das partidas. A fila decide quando servir um item (o teste até a liberação; depois, um a cada 15
  rótulos), e a comparação com a resposta roda na própria página, com o resultado na hora no teste.
- **A importação:** um worker lê o MP4 em blocos (o índice com um leitor próprio de ISO BMFF), faz o
  SHA-256 por partes, decodifica os quadros com o WebCodecs e guarda só os descritores de quadros
  reduzidos a 160 × 90. Com trechos escolhidos, decodifica só do quadro-chave anterior a cada trecho
  até o fim dele; o resto do arquivo só passa pelo hash. Depois acha os cortes (o começo e o fim de
  cada trecho também cortam), agrupa as tomadas, sorteia e decodifica de novo só os grupos de quadros
  (GOP) com sorteados, para gravá-los em JPEG na resolução original.
- **O detector na importação** (ADR-0017): com a detecção ligada, o mesmo worker abre o modelo de
  `modelos/` da pasta (o `detector.onnx` e o cartão que o laboratório exporta; o sha256 é conferido) no
  ONNX Runtime Web, que vem junto com o site (`web/vendor/onnxruntime-web/`: WebAssembly, na CPU, uma
  thread), lê cada JPEG gravado, prepara a entrada como o `modelo.py` do laboratório (a janela de 16:9 e
  a INTER_AREA do OpenCV, portadas e conferidas byte a byte), roda a rede e grava os pontos de escore
  0,5 ou mais em `previsoes/pontos/`. O WebAssembly só roda nos workers, que não herdam a CSP do
  documento: a política da página continua sem `'wasm-unsafe-eval'`.

## Módulos

### Páginas (`web/js/`)

| Módulo | Papel |
| --- | --- |
| `nucleo/convencoes.js` | referencial, IDs, código da pessoa, versões da ferramenta e do manual, motivos de descarte |
| `nucleo/campo.js` | o campo em qualquer medida — idêntico ao laboratório —, os 39 pontos que se marcam e a simetria de 180° |
| `nucleo/trechos.js` | ler os trechos do vídeo como a pessoa escreve |
| `nucleo/esquema.js`, `nucleo/formatos.js` | validação pelos JSON Schemas do Python e pelas regras entre campos |
| `nucleo/pasta.js`, `nucleo/indice.js` | layout da pasta, escrita que nunca sobrescreve, índice com cache |
| `nucleo/filas.js`, `nucleo/gabarito.js`, `nucleo/placar.js` | o que cada pessoa faz a seguir em cada tarefa, a comparação com o gabarito e a liberação, o placar e a concordância |
| `nucleo/regiao.js` | a região da placa no recorte: o polígono em pixels (a mesma conta do Python) |
| `nucleo/camera.js` | a câmera de um quadro pelos pontos (homografia, focal e pose, refino), a conferência deixando um ponto de fora e a medida do campo — o modelo de câmera do laboratório, sem a distorção |
| `nucleo/detector.js` | o detector sem o navegador: a janela, a INTER_AREA, a ampliação e o warpAffine do OpenCV (byte a byte), o tensor da rede e a decodificação dos mapas (a do `modelo.py`) |
| `nucleo/modelos.js` | os modelos de `modelos/`: o cartão que a página consegue usar, o mais novo, o identificador (`nome@sha12`) e quem começa da previsão |
| `nucleo/rotulos.js`, `nucleo/png.js` | montar e gravar rótulos (com a máscara) e revisões; o PNG de índices |
| `nucleo/zip.js`, `nucleo/transferencia.js` | levar e trazer arquivos em .zip |
| `nucleo/hash.js`, `nucleo/aleatorio.js`, `nucleo/estatistica.js` | SHA-256 por partes, sorteio reprodutível, mediana e percentil |
| `video/mp4.js` | índice do MP4: codec e tabela de amostras |
| `video/descritores.js`, `video/cortes.js`, `video/sorteio.js` | do vídeo aos quadros sorteados (as contas da v0.1) |
| `video/importar.js`, `video/trabalhador.js` | a importação e as previsões, num worker |
| `video/previsao.js` | o ONNX Runtime Web: abrir o modelo da pasta, decodificar o JPEG e gravar as previsões dos quadros (na importação e no botão da página da partida) |
| `ui/mapa.js`, `ui/marcador.js` | o mapa do campo e a imagem em que se marcam os pontos (zoom, lupa, arrastar, apagar) |
| `ui/pintor.js` | a pintura no recorte (pincel, laço, borracha, só dentro da região da placa) e o resultado do teste por cima |
| `ui/tarefa.js` | o que as duas tarefas têm em comum: abrir a imagem (o quadro ou o recorte), descartar, confirmar, os avisos |
| `ui/conferencia.js` | a conferência da câmera nas páginas: o rótulo que vale, a medida do campo guardada, os textos dos avisos e o campo desenhado por cima |
| `ui/vista-*.js` | as páginas: central, importar, pontos, placas, revisões, gabarito e coordenação |
| `ui/app.js`, `ui/armazenamento.js` | as rotas (`#/pontos`, `#/placas`, …; os endereços da 0.8 e da 0.9 levam às páginas novas) e onde fica a pasta (escolhida ou do navegador) |
| `ui/vigia.js`, `ui/tempo.js`, `ui/util.js` | pegar o que chega de outros computadores, o tempo ativo, utilidades |

`nucleo/` e as contas de `video/` não dependem da página: rodam no Node (`node --test`) e no worker.

### Python (`src/anotacao/`)

| Módulo | Papel |
| --- | --- |
| `convencoes.py`, `campo.py` | as mesmas convenções e o mesmo campo, testados contra o laboratório |
| `formatos.py` | modelos dos arquivos (pydantic) e JSON Schemas |
| `pasta.py`, `indice.py` | layout da pasta, escrita atômica, índice |
| `recortes.py` | montar um lote de recortes das placas (com a dupla e o "sem previsão" sorteados) e trazê-lo para a partida |
| `gabarito.py`, `previsores.py` | importar o gabarito (conferindo a máscara verdadeira); a pré-pintura (ou os pontos de outro modelo) por um previsor em Python |
| `mascara.py` | o PNG de índices e o polígono em pixels, os mesmos das páginas |
| `unificar.py` | conjuntos de treino em Parquet (pontos e placas) |
| `ouro.py` | o gabarito arbitrado: lotes de ouro tirados dos rótulos aprovados, rodada a rodada (o mesmo que `web/js/nucleo/ouro.js`, o botão da central) |
| `geracao.py` | arquivos que as páginas leem e saem do Python (esquemas, convenções, PNGs de teste) |
| `cli.py` | linha de comando |

Fora do pacote, `scripts/lotes_de_ouro.py` gera com o simulador do laboratório os lotes de ouro e a
partida de demonstração das placas, e `scripts/conferir_regras.py` passa anotadores simulados por
esses lotes, com as contas da própria página. `scripts/casos_do_detector.py` (no ambiente do
exposicao-treino) gera os casos de teste do detector — uma rede pequena de pesos sorteados, exportada
pelo próprio laboratório, e o que o OpenCV e o `modelo.py` dão em imagens de vários tamanhos — e
`scripts/onnxruntime_web.py` traz o ONNX Runtime Web do npm, conferindo a integridade.

## Segurança e privacidade

- A página só fala com o próprio site: a CSP (`connect-src 'self'`) impede que ela mande dados para
  outro endereço, e o service worker só guarda os arquivos do site. O ONNX Runtime Web vem com o site
  (do npm, sem mudar nada; os sha256 em `web/vendor/onnxruntime-web/VERSAO.json`), e o modelo, da pasta
  da equipe: nenhum dos dois é buscado fora.
- O acesso à pasta é o que o navegador concede: só a pasta escolhida, com permissão confirmada pela
  pessoa. Todos os caminhos passam pela validação dos IDs (nada de `../`).
- A página não mostra a partida, o quadro nem o autor do que está anotando ou revisando, para o
  gabarito escondido e a revisão às cegas continuarem escondidos na interface. Como os arquivos estão
  na pasta de cada um, isso é um combinado de uso, não um segredo técnico.
