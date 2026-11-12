# ADR-0016 — Os pontos do campo no meio das linhas

**Situação:** aceita (12/11/2026). Muda a geometria do campo ([ADR-0001](0001-convencoes.md)) que a câmera dos
rótulos ([ADR-0015](0015-camera-dos-rotulos.md)) e o laboratório de treino usam.

## Contexto

- **A regra mede as áreas até a borda de fora da linha.** As linhas pertencem às áreas que elas fecham e
  têm até 12 cm de largura: a pequena área tem 5,5 m de fundo contados da borda de fora da linha de fundo até
  a borda de fora da linha da área; o círculo tem 9,15 m de raio até a borda de fora; o gol tem 2,44 m até a
  parte de baixo do travessão e 7,32 m entre as faces de dentro das traves. O campo seguia isso ao pé da letra.
- **O anotador clica no meio do cruzamento das linhas** — é o ponto que se enxerga — e, no topo do gol, no
  meio do tubo. Entre o meio da linha de fundo e o meio da linha da pequena área são 5,38 m, não 5,5: os
  cliques ficam 12 cm mais próximos entre si do que o campo diz, e a câmera não consegue absorver isso (cada
  medida encolhe os mesmos 12 cm, não na mesma proporção). Sobra como erro: de 1 a 2 px num plano aberto, 5 px
  ou mais num close — do tamanho dos limites da conferência.
- **Medido nos rótulos reais** (628 quadros, 5 partidas, no laboratório de treino): com os pontos no meio das
  linhas, o erro dos rótulos cai em 4 das 5 partidas (uns 10% em média; no Krieck, de 1,75 para 1,45 px), e o
  acerto da câmera prevista sobe 1,5 a 2 pontos.

## Decisão

- **O campo põe os pontos no meio das linhas.** Com `largura_linha` (12 cm), cada linha anda meia largura
  para dentro da área que ela fecha: entre os meios das linhas, a grande área tem 16,38 × 40,20 m, a pequena
  5,38 × 18,20 m, o círculo e a meia-lua 9,09 m de raio; a marca do pênalti continua a 11 m da borda de fora
  da linha de fundo; o topo da trave fica a 2,50 m de altura e a 3,72 m do centro (o meio do tubo). O
  comprimento e a largura (L, W) continuam as medidas da regra, e a medida do campo pelos rótulos também.
- **A geometria da regra ao pé da letra fica acessível** com `largura_linha=0` (`construirCampo(L, W, 0)` no
  JavaScript): é ela que os testes comparam com a do laboratório antigo (`campo_laboratorio.json`).
- **Nada muda para quem anota**: o clique continua no meio do cruzamento (e no meio do tubo, no gol). Os
  rótulos já feitos continuam valendo — mudam só as coordenadas em metros que a câmera usa.

## Consequências

- A conferência da câmera dos rótulos fica mais justa: menos avisos à toa, sobretudo nos closes.
- O laboratório de treino precisa da versão nova (o conjunto preparado muda de formato e é preparado de novo).
- A distorção da lente (que o laboratório já tem desde a 0.2 dele) ainda não está na câmera da página: num
  estádio de lente forte, a conferência da página continua acusando um pouco mais do que deveria.
