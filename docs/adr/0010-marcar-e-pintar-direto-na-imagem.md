# ADR-0010 — Marcar e pintar direto na imagem: pontos com o mapa do campo, todos os jogadores e descarte

**Situação:** aceita (30/10/2026). Substitui o molde do campo da ADR-0006 e as ADRs 0008 e 0009. A
pintura de só os jogadores foi trocada pela de todas as pessoas em campo na
[ADR-0011](0011-pintar-todas-as-pessoas-em-campo.md); os pontos, o descarte, o gabarito e a revisão
seguem como aqui.

## Contexto

Na 0.7, as duas tarefas partiam de um modelo do campo desenhado por cima da imagem. Nos pontos, um
molde do campo genérico que se esticava (medidas do campo) e se arrastava (a câmera do quadro era
ajustada por trás a cada ponto solto). Na oclusão, o contorno das placas, desenhado por essa câmera,
e só dentro dele se pintava o que cobria cada placa. Testando as páginas, isso ficou ruim:

- **O molde atrapalha.** Esticar e arrastar um campo inteiro para fechar com as linhas é lento e
  pouco previsível — um ponto puxa o resto do molde junto —, e quem anota passa mais tempo brigando
  com o ajuste do que olhando a imagem. O que o detector aprende são os pontos na imagem; a câmera
  era só o meio de chegar neles.
- **A oclusão dependia de tudo antes.** Só dava para pintar depois de a câmera do quadro ser
  aprovada, só dentro das placas (as do estádio levantado ou faixas ajustadas à mão) e com várias
  classes. O que serve ao treino é a máscara de jogadores: com ela, o que cobre cada placa se calcula
  depois, onde a placa estiver.
- Faltava um jeito claro de **descartar** a imagem que não dá para anotar, de **fazer o teste** do
  gabarito e de saber **como revisar** às cegas.

## Decisão

- **Pontos direto na imagem.** A página mostra só a imagem (e os pontos de um modelo, quando há
  previsão) e, ao lado, o mapa do campo com os 39 pontos que se marcam — os 43 do laboratório menos
  os quatro que não ficam num cruzamento nem numa marca. Escolhe-se o ponto no mapa e clica-se no
  lugar dele (ou o contrário). O rótulo é a lista de pontos em px da imagem (`rotulo.pontos/1`); não
  há câmera, medidas do campo nem pacote de estádio. Os nomes são os do campo, e como o campo é
  simétrico pela rotação de 180°, a marcação feita como se a câmera estivesse do outro lado vale
  igual no gabarito e na concordância (sem as placas, nada na imagem decide o lado).
- **Todos os jogadores, a imagem inteira.** Pinta-se cada jogador (goleiros inclusive) onde estiver,
  sem contorno de placas e numa classe só; árbitros, gandulas, fotógrafos, comissão técnica, torcida
  e sombras ficam de fora. A máscara binária vai num PNG ao lado do rótulo (`rotulo.jogadores/1`).
- **Descartar** é uma resposta das duas tarefas (`situacao: "descartada"`, com o motivo: transição,
  borrão, grafismo ou outro, com comentário), revisada como qualquer rótulo. Imagem sem pontos ou sem
  jogador não se descarta: salva-se vazia, e ela entra no treino como exemplo de que ali não há o que
  achar. No gabarito, todo item tem resposta, e descartar conta como erro.
- **O gabarito ganha página própria**, com o teste de cada tarefa, o resultado na hora, a resposta
  ("Ver") e os lotes de ouro da pasta. As regras:
  - pontos — certo sem ponto errado (a mais de 8 px ou com o nome trocado), com 80% dos pontos
    visíveis marcados e o erro mediano dos visíveis até 2 px (ref. 960); libera com 8 dos últimos 10;
  - jogadores — com 1 px de tolerância na borda dos jogadores, cada jogador pintado pelo menos na
    metade da área (os menores que 30 px, ref. 960, não contam), nenhuma outra pessoa pintada em 25%
    ou mais e a sobreposição (IoU) de 80%; libera com 4 dos últimos 5.
- **A resposta dos lotes de ouro sai do renderizador do laboratório.** Nos pontos, onde ele desenhou
  cada ponto: ele desenha meio pixel da tela super-amostrada à direita e abaixo da própria projeção
  (medido: 0,24 e 0,25 px em 1280 × 720), e a resposta leva esse deslocamento. Um ponto é opcional
  (`visivel: false`) quando algo está na frente, quando fica rente à borda ou quando as linhas se
  cruzam a menos de 15° na imagem; um quadro com um ponto fora da imagem, mas rente à borda, não
  entra. Nos jogadores, o renderizador passou a guardar quem é quem (a máscara dele junta todas as
  pessoas), e a união das pessoas confere pixel a pixel com a máscara dele.
- **A revisão às cegas traz o passo a passo** ("Como revisar") de cada tarefa, e o motivo de devolver
  é da lista da tarefa.

## Conferência das regras

Anotadores simulados nos lotes de ouro, com as contas da própria página (`web/js/nucleo/gabarito.js`);
`scripts/conferir_regras.py` refaz a tabela.

| Pontos (90 itens, 4 vezes cada) | Itens certos | Erro mediano (px, ref. 960) |
| --- | --- | --- |
| clique com erro de 0,5 px (por eixo) | 100% | 0,58 |
| 0,9 px e 4% dos pontos esquecidos | 98% | 1,05 |
| 1,5 px | 71% | 1,75 |
| 2,2 px e 12% esquecidos | 17% | 2,56 |
| 0,9 px, trocando `cab` e `opo` de um ponto na metade dos itens | 79% | 1,06 |

| Jogadores (28 itens) | Itens certos | IoU mediana |
| --- | --- | --- |
| laço no contorno, cuidadoso ou rápido (vértices a 0,7–2,5 px) | 100% | 0,98–1,00 |
| pincel vazando 1 px para fora | 100% | 0,98 |
| vazando 2 px | 93% | 0,87 |
| vazando 3 px | 39% | 0,77 |
| comendo 1 px da borda | 100% | 0,98 |
| esquecendo os jogadores menores que 150 px (ref. 960) | 93% | 1,00 |
| pintando também o árbitro e os gandulas | 29% | 0,88 |

Quem marca com cuidado (até ~1 px) e quem contorna a silhueta passam quase sempre; erro de 2 px ou
mais, borda vazada em 3 px, jogador esquecido ou árbitro pintado reprovam. Com 8 de 10 (pontos) e 4
de 5 (jogadores), quem acerta 95% dos itens é liberado com mais de 90% de chance.

## Consequências

- Anotar fica mais rápido e previsível, e as duas tarefas são independentes: dá para pintar um quadro
  cujos pontos ainda não foram marcados.
- A câmera de cada quadro e o que cobre cada placa deixam de ser rótulos: saem dos modelos (o detector
  de pontos dá a câmera; a máscara de jogadores, a oclusão), e a verdade de campo deles vem dos pontos
  e das máscaras aprovados. Onde as placas estão é assunto do cálculo da exposição (o levantamento do
  estádio ou as placas achadas na imagem), não da anotação.
- O ponto é o centro do cruzamento: perto da câmera a faixa branca tem vários pixels, e marcar na
  beirada dela já passa dos 2 px. O Manual e a página dizem "no centro exato do cruzamento".
- Os arquivos das versões até a 0.7 (câmera, oclusão, pacotes de estádio, gabarito antigo) ficam na
  pasta e não entram em nada; as partidas importadas continuam valendo, e o manifesto aceita o
  `pacote` antigo sem usá-lo. Os lotes de ouro novos têm outros ids (g1xxx nos pontos, g2xxx nos
  jogadores), para não colidir com os da 0.7 já importados.
