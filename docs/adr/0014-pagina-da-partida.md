# ADR-0014 — A página da partida: ver, editar e excluir; a correção do aprovado o substitui

**Situação:** aceita (06/11/2026). Complementa a revisão às cegas da
[ADR-0010](0010-marcar-e-pintar-direto-na-imagem.md) e muda a regra do aprovado do `unificar`.

## Contexto

- **Não havia onde ver uma partida inteira.** A central mostra só contagens; para conferir os quadros
  sorteados, as anotações e os arquivos de uma importação era preciso abrir os JSON à mão. Uma
  importação ruim (quadros quase iguais, como os das vinhetas da 0.12) só se desfazia apagando a pasta
  fora da página — e no armazenamento do navegador nem isso.
- **Um erro aprovado ficava para sempre.** Vale o aprovado primeiro: uma correção feita depois de
  aprovado não mudava o conjunto. Quem coordena e acha um ponto fora do lugar numa imagem aprovada
  não tinha como consertar.

## Decisão

- **A página da partida** (`#/partida?id=<partida>`), aberta pelo nome da partida na central: a ficha
  (jogo, vídeo, importação), as miniaturas dos quadros e dos recortes com a anotação por cima e a
  situação de cada um (sem rótulo, esperando revisão, devolvido, aprovado, descartado), um visor com
  zoom e lupa onde se escolhe a versão que aparece (cada versão de cada pessoa, com as revisões, a
  previsão do modelo ou só a imagem), a lista de arquivos (para ver os JSON e baixar), baixar a partida
  em .zip e excluir.
- **Editar abre a página de marcar (ou de pintar) com o item e a versão que estava na tela.** Ao
  salvar (`salvarEdicao` em `web/js/nucleo/rotulos.js`):
  - com um rótulo aprovado no item, a versão nova é a **correção do aprovado** (`corrige` aponta para
    ele) e vale como revisão;
  - sem aprovado, partindo do rótulo de outra pessoa, é a correção desse rótulo — e ele ganha a revisão
    "corrigir", como na revisão às cegas (sai da fila de revisão e, se tinha voltado, da fila de quem o
    anotou);
  - senão (partindo do próprio rótulo, da previsão ou do zero), é um rótulo da pessoa, que vai para a
    revisão como qualquer outro.
- **A regra do aprovado** (`aprovado` em `web/js/nucleo/filas.js` e em `src/anotacao/unificar.py`):
  vale o aprovado primeiro, como antes; **uma correção do próprio aprovado o substitui**, e de correção
  em correção vale a mais recente. Na revisão às cegas o rótulo corrigido nunca está aprovado (a
  revisão dele é "corrigir"), então nada muda nos dados de antes.
- **Excluir apaga de verdade** (no Drive, os arquivos vão para a lixeira dele), depois de mostrar o que
  vai junto: um quadro sai da fila com a imagem, os rótulos e revisões dos pontos, a previsão e os
  recortes das placas tirados dele; um recorte sai do lote (o lote vazio sai inteiro) com a pintura, as
  revisões e a pré-pintura; um lote inteiro; ou a partida inteira, só com o nome dela escrito. Nada se
  exclui enquanto a partida está sendo importada. A fila e os lotes são reescritos (com `sobrescrever`,
  pedido de propósito — ADR-0002); o resto são arquivos de cada pessoa, que só se apagam.

## Consequências

- Quem coordena conserta um rótulo aprovado sem passar pela revisão às cegas: a edição pela página da
  partida é um ato de quem revisa, com o nome de quem editou no arquivo (`anotador`, `corrige`). A
  página avisa, antes de salvar, o que a edição vai fazer.
- A edição da própria imagem já aprovada também vale direto. Numa equipe, quem coordena decide quem
  usa a página para isso; numa pessoa só, é o único jeito de consertar.
- Um lote de ouro já gerado não muda com uma correção feita depois: o .zip guarda o que valia na hora.
- Reescrever a fila e os lotes pode dar conflito no Drive se duas pessoas excluírem itens da mesma
  partida ao mesmo tempo; excluir é coisa de quem coordena, uma pessoa por vez.
