# ADR-0006 — Anotar sem equipe nem estádio cadastrados: código digitado, filas abertas e campo genérico

**Situação:** aceita (23/10/2026).

## Contexto

Na 0.2, anotar pedia duas coisas antes: a equipe (quem anota e quem revisa, em `equipe.json`) e o
pacote do estádio levantado (medidas do campo, placas e câmeras). A importação distribuía os quadros
entre os anotadores e sorteava o revisor de cada rótulo. Neste momento não há nem uma coisa nem
outra: o que se quer é só fazer o rotulamento. O molde do campo, por outro lado, já é paramétrico —
as marcações da regra (áreas, círculo, gols) têm medida fixa e só o comprimento e a largura do
campo mudam de um estádio para outro —, então dá para esticá-lo até fechar com as linhas, quadro a
quadro.

## Decisão

- **Quem anota:** cada pessoa digita um código (2 a 10 letras e números, começando por letra; as
  iniciais, por exemplo). Ele só separa os arquivos de cada um e conta o placar. `equipe.json` fica
  opcional e serve só para mostrar nomes.
- **Filas abertas:** a fila da partida não tem dono. Um quadro precisa de um rótulo (ou de duas
  pessoas diferentes nos quadros em dupla às cegas); quem chega pega o próximo, cada código começando
  num ponto próprio da fila (sorteado pelo código e pela partida), para duas pessoas não pegarem o
  mesmo quadro ao mesmo tempo. A revisão também é aberta: qualquer pessoa menos o autor revisa, cada
  rótulo uma vez; nos quadros em dupla, a revisão só abre depois que as duas pessoas anotaram, para
  quem revisa não virar o segundo anotador já sabendo a resposta. Filas da 0.2, com quadros
  atribuídos, continuam valendo como foram atribuídas.
- **Campo genérico:** o pacote `generico/pacote-1.0` (105 × 68 m, sem placas, com posições típicas de
  câmera) é o molde padrão da importação. O rótulo grava as medidas do campo usadas (`campo`), que
  a pessoa ajusta em cada quadro; os próximos quadros da partida abrem com as últimas medidas usadas
  nela. Sem placas, não há como conferir o lado do estádio pela arte, então essa conferência só é
  pedida com o pacote de um estádio levantado. Pacotes de estádio continuam aceitos como molde.
- **Trechos:** a importação aceita os trechos do vídeo que interessam; fora deles, nada é
  decodificado nem sorteado.

## Consequências

Dá para começar a anotar com uma pasta vazia e um vídeo. O placar e a concordância continuam
funcionando pelos códigos. O que se perde sem o pacote do estádio: a conferência do lado pelas
placas e a câmera de partida pelo registro do estádio (vale uma posição típica). Rótulos sem `campo`
(da 0.2) usam as medidas do pacote, e o `unificar` grava as medidas de cada rótulo no conjunto. Duas
pessoas podem, raramente, abrir o mesmo quadro ao mesmo tempo; os dois rótulos ficam (arquivos
diferentes) e a revisão trata os dois.
