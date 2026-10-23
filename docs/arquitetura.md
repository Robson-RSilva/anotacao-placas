# Arquitetura

```text
navegador (páginas estáticas)          máquina (Python)                  pasta e Drive
┌──────────────────────────┐   HTTP   ┌──────────────────────────┐      ┌──────────────────────┐
│ central, câmera, revisão │ ───────► │ servidor local (FastAPI) │ ───► │ pasta de trabalho    │
│ molde + solver em JS     │ 127.0.0.1│ pré-processamento, filas,│      │ (um arquivo por      │
└──────────────────────────┘          │ placar, unificar         │      │  pessoa e versão)    │
                                      └──────────────────────────┘      └──────────┬───────────┘
                                                                                   │ sincronização
                                                                            Google Drive (equipe)
```

- **Por que um servidor local e não só páginas estáticas:** o pré-processamento usa OpenCV, e uma
  página estática sozinha não roda isso nem grava livremente numa pasta. O servidor só atende a
  própria máquina; nada sai dela a não ser pela sincronização do Drive.
- **Sem banco de dados:** a verdade são os arquivos JSON na pasta. Filas, placar e conjuntos são
  sempre recalculados deles (com cache por data de modificação), e dão o mesmo resultado em qualquer
  máquina da equipe.
- **O molde arrastável:** a página projeta o campo inteiro pela câmera; arrastar um ponto roda um
  Levenberg–Marquardt em 8 parâmetros (pan, tilt, roll, zoom, distorção e posição) que leva aquele
  ponto ao cursor sem tirar do lugar os já travados. Uma âncora em torno da câmera de partida decide
  o que se mexe com poucas pistas: com um ponto só giram pan e tilt; com dois entram zoom e roll; com
  quatro, a posição; com cinco, a distorção.

## Módulos (`src/anotacao/`)

| Módulo | Papel |
| --- | --- |
| `convencoes.py` | referencial, IDs, versão do manual |
| `camera.py`, `campo.py` | modelo de câmera e molde do campo — idênticos ao laboratório |
| `formatos.py` | modelos dos arquivos (pydantic) e JSON Schemas |
| `pasta.py` | layout da pasta, nomes de arquivo, escrita atômica |
| `pacote.py` | pacote do estádio: validação, amostras das placas, câmera padrão |
| `video.py`, `cortes.py`, `sorteio.py`, `preprocessamento.py` | do vídeo aos quadros sorteados |
| `previsores.py` | interface do previsor de câmera (opcional) |
| `indice.py`, `filas.py` | o que cada pessoa faz a seguir; revisão às cegas |
| `avaliacao.py`, `gabarito.py`, `placar.py` | resíduos, concordância, liberação e placar |
| `unificar.py` | conjuntos de treino em Parquet |
| `servidor.py`, `cli.py` | API local e linha de comando |
| `web/` | páginas (HTML, CSS e JavaScript sem build) |

O JavaScript tem espelhos de `camera.py` e de `campo.py` (`web/js/camera.js`, `web/js/campo.js`),
testados contra o laboratório com a mesma fixture dos testes em Python.

## Segurança

- O servidor escuta só em 127.0.0.1, recusa pedidos com outro `Host` (DNS rebinding) e exige o
  cabeçalho `X-Anotacao` em todo pedido que grava (um site de fora não consegue mandar sem o
  navegador pedir permissão, e o CORS não é liberado).
- A página não recebe a partida, o quadro nem o autor do que está anotando ou revisando: cada item
  vem com uma ficha opaca. Assim o gabarito escondido e a revisão às cegas continuam escondidos na
  interface.
- Todos os caminhos passam pela validação dos IDs (nada de `../`).
