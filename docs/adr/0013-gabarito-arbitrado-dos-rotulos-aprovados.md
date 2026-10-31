# ADR-0013 — Gabarito arbitrado: lotes de ouro tirados dos rótulos aprovados

**Situação:** aceita (31/10/2026). Complementa os lotes do simulador da
[ADR-0010](0010-marcar-e-pintar-direto-na-imagem.md) e da [ADR-0012](0012-pintar-a-oclusao-no-recorte-da-placa.md),
que continuam valendo.

## Contexto

- **O simulador é diferente do jogo de verdade.** Os lotes de ouro do simulador têm a resposta exata
  e os casos raros de propósito, mas as imagens não têm o borrão, a compressão, as cores e o grafismo
  das transmissões. E um item escondido que se reconhece como sintético mede mal: quem percebe que é
  teste capricha mais.
- **A resposta já existe.** Cada imagem aprovada na revisão foi conferida por duas pessoas (quem
  anotou e quem revisou). Os formatos do gabarito já previam `origem: "arbitrado"`.
- **Quem trabalhou na imagem não pode ser testado nela.** Seria medido contra o próprio rótulo (ou
  contra o que já aprovou).

## Decisão

- **O botão "Gerar lote de ouro (.zip)", na central** (desde a 0.12; na 0.11, só o
  `anotacao ouro --pasta P`, que continua montando os mesmos itens) monta um .zip de lote de ouro, no
  formato dos do simulador, e o baixa, com os itens aprovados (a regra do `unificar`) que já não vão
  mudar: todo rótulo do item revisado e, na dupla às cegas, as duas pessoas já anotaram. Nos pontos, a
  resposta são os pontos do rótulo aprovado — os rentes à borda (a menos de 3 px, ref. 960) ficam
  opcionais, como no simulador. Nas placas, a máscara aprovada, com cada pedaço pintado (vizinhos em 8
  direções) como uma coisa na frente da placa; o recorte descartado e aprovado como "o recorte não está
  na placa" vira um item para descartar. Os outros descartes não viram gabarito.
- **`fora_de`**, um campo opcional novo nos itens do gabarito (`gabarito.pontos/1` e
  `gabarito.placas/1`, compatível com os arquivos de antes): quem anotou, revisou ou corrigiu a imagem.
  Para essas pessoas o item não existe — nem no teste, nem escondido, nem na liberação.
- **Rodadas, sem repetir.** O registro `conjuntos/ouro-reais.json` guarda o que já foi para algum lote
  e o id de cada item. Cada rodada leva só o que é novo, em lotes novos (`PR<n>` nos pontos, `PLR<n>`
  nas placas), com ids sequenciais em faixas próprias (g5001–g5999 e g6001–g6999), na ordem da
  aprovação. Um id nunca é reusado — os do gabarito da pasta também contam —, então importar os .zip em
  qualquer ordem, ou duas vezes, não cria conflito. Sem nada novo, a rodada não grava nada.
- **Treino e escondidos por sorteio fixo:** um em cada três itens vai para o lote de treino
  (`…-treino`), os outros para o de controle, pelo hash do item — o mesmo item sempre no mesmo lado.
- **O .zip não entra sozinho no gabarito:** é baixado e fica também em `conjuntos/`, e quem coordena
  importa pela página do gabarito quando quiser usá-lo.
- **Duas implementações, os mesmos itens.** A página (`web/js/nucleo/ouro.js`) e o Python
  (`src/anotacao/ouro.py`) seguem as mesmas regras e o mesmo registro; o e2e gera o lote pelo botão e
  pelo Python na mesma pasta e compara item a item.

## Consequências

- O gabarito passa a ter imagens de verdade, indistinguíveis das da fila, e cresce com o trabalho da
  equipe, sem curadoria manual.
- A resposta é a de um rótulo aprovado, não uma verdade exata: um ponto que a dupla de anotador e
  revisor deixou passar conta como errado para quem o marca; a revisão é o que segura isso. Erros que
  a equipe inteira comete do mesmo jeito não aparecem nesse gabarito — os lotes do simulador continuam
  necessários para isso e para os casos raros.
- Numa equipe pequena, quase toda imagem tem as mesmas pessoas em `fora_de`: o gabarito arbitrado
  mede sobretudo quem chega depois.
- O registro é um arquivo só, que cada rodada reescreve: duas pessoas gerando ao mesmo tempo, em
  computadores diferentes, criariam a mesma rodada. Gerar é coisa de quem coordena, uma pessoa por vez.
- Fica para depois: só aceitar itens em que as duas pessoas da dupla concordam, com uma terceira para
  decidir quando divergem.
