# ADR-0011 — Pintar todas as pessoas em campo, e o tempo do placar

**Situação:** aceita (30/10/2026). Muda a pintura da [ADR-0010](0010-marcar-e-pintar-direto-na-imagem.md),
que era só dos jogadores; os pontos, o descarte, o gabarito e a revisão seguem como lá.

## Contexto

- **A máscara serve para saber o que cobre cada placa.** Quem fica na frente de uma placa não é só
  jogador: árbitros e assistentes, gandulas, fotógrafos e cinegrafistas, comissão técnica, reservas
  aquecendo, seguranças e maqueiros ficam justamente entre o gramado e as placas — muitas vezes mais
  na frente delas que os jogadores. Com a regra da 0.8 (só os jogadores), essa gente ficava fora da
  máscara: o modelo aprenderia a não ver justamente quem mais tapa as placas, e o gabarito ainda
  contava como erro pintá-la.
- **O "tempo mediano" do placar misturava coisas.** Entravam na mesma mediana os descartes (que levam
  segundos) e as correções feitas na revisão (o tempo de revisar contado como tempo de anotar, para
  quem revisou — e as correções contavam como rótulos dessa pessoa). E o número saía como "0:42"
  (minutos:segundos), que se lê como horas e minutos.

## Decisão

- **Pessoas em campo** (`#/pessoas`): pinta-se toda pessoa no gramado e em volta dele, até as placas —
  qualquer um que possa ficar na frente de uma placa, seja quem for. A torcida (na arquibancada) e as
  sombras não se pintam. Pessoa atrás de outra, ou de uma placa: pinta-se o que aparece.
- **Formatos novos**, em vez de uma versão nova dos de jogadores: `rotulo.pessoas/1`,
  `revisao.pessoas/1` (motivos `faltou_pessoa`, `contorno_impreciso`, `pintou_o_que_nao_e_pessoa`,
  `descarte_errado`, `outro`) e `gabarito.pessoas/1` (a máscara verdadeira com as pessoas de 1 a N;
  sem as "outras pessoas" de 255 para baixo). Pastas `rotulos/pessoas`, `revisoes/pessoas` e
  `previsoes/pessoas`; `pessoas.parquet` no `unificar` (manifesto `conjuntos/4`); Manual
  `pessoas-0.1` e revisão `revisao-0.3`. Os endereços `#/jogadores` e `#/revisao-jogadores` levam às
  páginas novas.
- **Os rótulos e os lotes da 0.8 não entram em nada.** Foram pintados com a regra antiga e falta neles
  quem não joga; aproveitá-los como estão poria no treino máscaras incompletas, e como pré-pintura
  ensinariam a esquecer as mesmas pessoas. As imagens se pintam de novo (a fila das pessoas começa do
  zero; os pontos não mudam).
- **Gabarito:** cada pessoa pintada em pelo menos metade da área (as menores que 30 px, ref. 960,
  não contam) e a sobreposição (IoU) de 80%; libera com 4 certos dos últimos 5. O que se pinta a mais
  (a torcida, uma sombra, um contorno largo) derruba a sobreposição, e o motivo do erro diz se foi a
  mais ou a menos. Uma imagem sem ninguém dá certo sem nada pintado.
- **Lotes de ouro novos**, em ids novos (os g2xxx da 0.8 podem estar na pasta, e um item com um id
  que já existe não é importado): PE1-treino (g3001–g3012) e PE2-variado (g3101–g3116). Quase todo
  item tem o árbitro ou quem trabalha em volta do campo; cada lote tem um item só com um gandula ou
  fotógrafo (que se pinta) e um só com a torcida (nada se pinta). O índice `indice-pessoas.csv` diz
  quem é quem em cada máscara.
- **Placar:** o tempo por imagem é a mediana do tempo ativo dos rótulos da própria pessoa, sem os
  descartes e sem as correções que ela fez revisando; o tempo por revisão é a mediana do tempo ativo
  das revisões (aprovar, corrigir ou devolver). As correções deixam de contar como rótulos de quem
  revisou. Os dois aparecem com a unidade ("42 s", "1 min 5 s"), com a conta explicada no cabeçalho.

## Conferência das regras

Anotadores simulados nos lotes novos, com as contas da própria página (`scripts/conferir_regras.py`).

| Pessoas (28 itens) | Itens certos | IoU mediana |
| --- | --- | --- |
| laço no contorno, cuidadoso ou rápido (vértices a 0,7–2,5 px) | 96–100% | 0,98–1,00 |
| pincel vazando 1 px para fora | 100% | 0,98 |
| vazando 2 px | 86% | 0,87 |
| vazando 3 px | 29% | 0,78 |
| comendo 1 px da borda | 100% | 0,97 |
| esquecendo as pessoas menores que 150 px (ref. 960) | 89% | 0,99 |
| pintando só os jogadores (a regra da 0.8) | 25% | 0,90 |

Quem pinta só os jogadores acerta apenas os itens em que não há mais ninguém — 3 dos 12 do treino —,
e com a meta de 4 certos em 5 seguidos não há como ser liberado assim. Quem contorna com cuidado passa
quase sempre.

## Consequências

- A máscara cobre quem de fato tapa as placas, e o cálculo da exposição pode tirar da placa qualquer
  pessoa na frente dela, não só os jogadores.
- Cada imagem leva um pouco mais de tempo (mais gente para contornar, sobretudo perto das placas).
- O tempo do placar passa a dizer quanto custa anotar uma imagem e quanto custa revisar uma, que é o
  que se usa para orçar um lote.
