# ADR-0015 — A câmera dos rótulos: conferir os pontos pela geometria

**Situação:** aceita (10/11/2026). Usa o modelo de câmera e as convenções do laboratório
([ADR-0001](0001-convencoes.md)); é a base da ferramenta do estádio.

## Contexto

- **A revisão às cegas deixa passar erros de nome.** Um ponto no cruzamento certo com o nome do vizinho
  (o canto da grande área no lugar do da pequena), os nomes espelhados (esquerda e direita trocados) ou
  girados meia-volta (a câmera principal anotada como se fosse a do outro lado) parecem certos para quem
  olha ponto por ponto. Com perto de 1.000 quadros chegando ao primeiro conjunto, um erro desses vai
  para o treino como verdade.
- **Os pontos de um quadro não são independentes.** Todos vêm da mesma câmera: com 4 pontos no gramado
  a câmera fica determinada, e cada ponto a mais tem de cair onde ela diz. É a conferência que dá para
  fazer sem modelo nenhum, só com a geometria — e a mesma câmera é a que a ferramenta do estádio precisa
  para medir as placas.

## Decisão

- **A câmera de cada quadro sai dos pontos** (`web/js/nucleo/camera.js`), no modelo do laboratório sem a
  distorção: pinhole, pixel quadrado, ponto principal no centro. A homografia do gramado (DLT
  normalizada, com 4 pontos ou mais em posição geral) dá a focal e a pose (Zhang com o ponto principal
  conhecido); um Levenberg–Marquardt refina f, R e C com todos os pontos, o topo das traves junto. Quando
  a homografia não dá a focal (um close, de pouca perspectiva), uma grade de focais acha a câmera.
- **A conferência "deixando um de fora".** Com 6 pontos ou mais, a câmera é refeita sem cada ponto, e
  mede-se onde ela põe esse ponto. Um ponto acusa quando está longe em px (na largura de referência 960,
  como no gabarito) **e** longe para o que os outros pontos sabem dizer dele: o limite cresce com a
  incerteza da previsão (pela matriz chapéu do ajuste), para um ponto isolado num canto da imagem não
  acusar à toa. Atenção acima de 5 px, conferir acima de 10 px. Com 5 pontos, o limite é a metade, no
  resíduo do ajuste; com 4, não dá para acusar um ponto.
- **O espelho e o giro de 180° saem da câmera.** O sinal da pose sai dos pontos (eles ficam na frente da
  câmera); com os nomes espelhados, a câmera que fecha fica embaixo do gramado (`espelhado`, conferir).
  Com os nomes girados meia-volta, ela fica do lado oposto às cabines (`lado_oposto`, atenção: pode ser
  uma câmera de verdade daquele lado). Câmera fora do possível numa transmissão é `impossivel`.
- **A medida do campo sai dos rótulos de cada partida.** As medidas internas são as da regra, mas o
  comprimento e a largura mudam de estádio para estádio, e com a medida errada quase todo quadro acusaria.
  `medirCampo` procura L e W que deixam a homografia de cada quadro mais justa (o erro de cada quadro tem
  teto, para um rótulo errado não puxar), e só troca 105 × 68 quando a mediana do erro cai claramente.
  Só dizem algo da medida os quadros com pontos das duas metades (L) ou da lateral e da área (W); com
  menos de 5 de cada, a medida não é conhecida e **só valem os avisos que não dependem dela** (espelho,
  lado oposto, câmera impossível).
- **Onde aparece.** Na página da partida: um resumo (quantos quadros para conferir, a medida do campo),
  filtros pela conferência, um selo nas miniaturas e, no visor, o diagnóstico e — com `C` — o campo visto
  pela câmera por cima da imagem, com a seta do ponto acusado até onde os outros o põem. Na página de
  marcar e na revisão, uma linha embaixo dos pontos, com 5 pontos ou mais, que **não impede salvar**. Nos
  itens do gabarito a medida do campo não é conhecida (ficam os avisos robustos), do mesmo jeito que numa
  partida com poucos rótulos — o aviso não denuncia o item escondido.

## Calibração

Com quadros sintéticos de transmissão (câmera principal, do 16 m e de trás do gol, ângulos de 5° a 55°,
ruído de clique de 0,5 px na referência e a distorção de uma lente aberta, que o modelo não tem):
nenhum "conferir" e 0,1% de "atenção" em quadros limpos; um ponto 6 px fora é pego em 77% dos quadros,
8 px em 90%, 12 px em 96%, apontando o ponto certo em 95%; nomes trocados entre dois pontos e um nome
trocado por outro são pegos em 98%; o giro de 180° sempre dá "lado oposto" e o espelho, "espelhado"
(99%). A medida do campo acerta 100 × 64 e 110 × 75 com folga de 0,3 m, mesmo com um quarto dos
quadros com um rótulo errado (`tests/js/camera.test.js`).

## Consequências

- Os limites valem para lentes de transmissão comuns; com uma lente bem aberta e muita distorção, a
  atenção sobe (2% dos quadros limpos no sintético com k1 até −0,12). Se os dados reais mostrarem isso,
  o próximo passo é estimar k1 nos quadros com muitos pontos.
- A câmera de cada quadro e a medida do campo ficam prontas para a ferramenta do estádio (triangular as
  placas) e para os recortes reais das placas.
- A conta roda na página: cerca de 3 ms por quadro e meio segundo para medir o campo de uma partida de
  200 quadros, aos poucos, sem travar.
