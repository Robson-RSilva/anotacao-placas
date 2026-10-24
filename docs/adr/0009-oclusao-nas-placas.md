# ADR-0009 — Oclusão nas placas: faixas de placas, máscara PNG ao lado do rótulo e comparação com 1 px de tolerância

**Situação:** aceita (24/10/2026).

## Contexto

A segunda tarefa do Manual, "Oclusão nas placas", pinta o que está na frente de cada placa visível:
gente, bola, rede, grafismo da emissora, objeto. A ferramenta desenha o contorno das placas pela
câmera aprovada do quadro e o trabalho é corrigir, só dentro das placas. O conjunto treina e testa a
máscara de pessoas sobre as placas (~300 placas), e a medida de concordância do Manual é a fração
livre de cada placa (até 0,05 de diferença entre duas pessoas).

Três coisas não estavam decididas:

- **De onde vêm as placas.** Desde a ADR-0006 os quadros abrem no campo genérico, sem o
  levantamento do estádio — e sem placas.
- **Onde fica a máscara.** Uma por placa seriam dezenas de arquivos por quadro, ruins para o Drive.
- **Como comparar duas pinturas.** Medida nos lotes de ouro, a diferença na fração livre de cada
  placa (a maior do quadro) passava de 5 pontos em 40% dos itens quando a pintura era a verdadeira
  com 1 px a mais em volta — o que o próprio Manual aceita ("borda a até 1 px").

## Decisão

- **Placas.** Do item do gabarito (os polígonos exatos), do pacote do estádio quando ele tem as
  placas do levantamento, ou, no campo genérico, das **faixas de placas**: uma faixa em cada lado do
  campo, com a distância da linha, a altura, o comprimento (centrado; vazio, de canto a canto) e um
  vão no meio (atrás do gol). As duas laterais têm as mesmas medidas, e os dois fundos também: no
  campo genérico a câmera espelhada desenha o mesmo campo (ADR-0008), então nada diz qual lateral é
  qual. Cada faixa se divide em trechos de ~8 m, que contam como placas. Quem pinta ajusta as faixas
  no primeiro quadro da partida; os seguintes abrem com as medidas da última pintura. Com essas
  cinco medidas, as faixas reproduzem exatamente o estádio do laboratório.
- **Quais quadros.** Os da fila da partida com a câmera aprovada (a aprovada primeiro na revisão, ou
  a correção de quem revisou — a regra do `unificar`) e alguma placa de 10 px ou mais (ref. 960); a
  dupla às cegas e o "sem previsão" da fila valem também aqui. Placas de costas para a câmera não
  aparecem; a mais perto cobre a mais longe. Placa mais baixa que 10 px é "pequena demais" e não se
  pinta.
- **Arquivos.** `rotulos/oclusao/<quadro>__<pessoa>__v<n>.json` (`rotulo.oclusao/1`), com a máscara
  `.png` ao lado, de mesmo nome: um PNG de 8 bits com paleta, uma classe por pixel (0 fora das
  placas, 1 livre, 2 pessoa, 3 bola, 4 rede, 5 grafismo, 6 objeto, 7 não é placa). A máscara é
  gravada antes do rótulo; no outro computador, um rótulo que chegou antes da máscara espera por
  ela. O rótulo traz o que a máscara diz de cada placa (pixels por classe e fração livre) e a câmera
  e as faixas que desenharam as placas; o `unificar` refaz essas contas da máscara (os números do
  rótulo servem para ler sem abrir o PNG, e o `validar` confere os dois). PNG e geometria têm
  implementação própria nas páginas e no Python, com os mesmos pixels (um teste confere).
- **Comparação.** Duas pinturas do mesmo quadro (a de quem pinta e a verdade, no gabarito; as duas
  da dupla às cegas) se comparam placa a placa pela fração da placa em que uma cobre e a outra não,
  **fora da faixa de 1 px** em volta do que a outra pintou, nos dois sentidos. Pintar 1 px mais largo
  ou mais estreito não conta; esquecer uma pessoa conta quase toda a área dela. A meta continua 5% da
  placa (a do Manual), agora com a tolerância de borda que o Manual já dava. A rede não cobre por
  enquanto (na fração livre ela conta como livre; o rótulo guarda os pixels dela para decidir depois).
- **Gabarito.** `gabarito.oclusao/1`: o quadro, a câmera exata, as placas exatas e a máscara
  verdadeira (PNG). Liberação própria da tarefa: a mediana dos últimos 5 itens até 5%; depois, um
  item escondido a cada 15 pinturas. Os lotes L5 e L6 saem do simulador do laboratório, com a
  verdade tirada das máscaras do renderizador dentro das placas.

## Consequências

A oclusão funciona sem o levantamento do estádio, e um pacote com placas troca as faixas pelas
placas reais sem mudar mais nada. A máscara inteira do quadro num PNG só cabe em poucos KB (quase
tudo é 0) e se abre em qualquer visualizador, com as cores da paleta. A fração livre por placa
continua no rótulo e nos conjuntos (`oclusao_placas.parquet`), para a exposição; o que decide o
gabarito e a concordância é a comparação das máscaras. Uma câmera que não fecha com as placas vira
"câmera errada": a pintura não entra no conjunto e o quadro aparece em `problemas.json` para refazer
a câmera. Os trechos das faixas não coincidem com as placas reais, então a fração livre "por placa"
no campo genérico é por trecho de ~8 m; com o levantamento, é por placa de verdade.
