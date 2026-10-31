# ADR-0012 — Pintar a oclusão no recorte da placa

**Situação:** aceita (30/10/2026). Muda a pintura da [ADR-0011](0011-pintar-todas-as-pessoas-em-campo.md),
que era de todas as pessoas na imagem inteira; os pontos, o descarte, a revisão e o tempo do placar
seguem como lá.

## Contexto

- **O que se mede é a placa.** A exposição de cada placa é a parte dela que quem assiste vê. A
  pintura da 0.9 pedia todas as pessoas do quadro inteiro: gastava tempo com gente longe de qualquer
  placa e deixava de fora o resto que esconde a placa — a trave, a bola, outra placa mais perto, o
  grafismo da emissora.
- **A placa pode chegar pronta.** O laboratório já sabe projetar cada placa no quadro (com a câmera
  dele); com a câmera de cada quadro tirada dos pontos aprovados e o cadastro das placas do estádio, a
  projeção vai dar o recorte de cada placa nos quadros reais. No piloto, o simulador dá esses recortes
  com a verdade exata — servem para fazer a página, os lotes de ouro e uma partida de demonstração.
- **O recorte é considerado certo.** Ajustar o contorno de cada placa em cada quadro seria outra
  tarefa (a da câmera, que a 0.8 tirou); quando a projeção erra, o recorte se descarta e o erro volta
  para quem projeta.

## Decisão

- **Oclusão nas placas** (`#/placas`, `#/revisao-placas`): a página recebe o recorte da placa,
  endireitado — o retângulo da placa com 0,6 da altura dela em volta, de cada lado — e a região que se
  pinta (a placa, só a parte dentro do quadro). Fora da região a imagem fica escurecida, com o
  contorno em azul, e o pincel e o laço não pintam: o laço pode passar do contorno. Pinta-se tudo o
  que esconde a placa de quem assiste — gente (seja quem for), bola, trave e travessão, outra placa
  mais perto, câmera, bandeira, o grafismo da emissora — e não o próprio anúncio (mesmo uma pessoa
  desenhada nele), sombra, reflexo nem o que deixa ver a placa através (a rede). O contorno não se
  ajusta: se ele não está na placa (fora do lugar por mais que um quarto da altura dela, ou outra
  coisa), descarta-se com o motivo "o recorte não está na placa"; uns poucos pixels de folga não
  contam. Sem nada na frente, salva-se sem pintar.
- **Os recortes vêm em lotes** (`recortes.lote/1`, em `partidas/<partida>/recortes/<lote>.json`, com
  `<recorte>.jpg` ao lado), feitos fora das páginas e trazidos por `anotacao recortes` ou por um .zip.
  O id do recorte é `<quadro>_<placa>`. O lote traz os cantos da placa no recorte e no quadro, para
  levar a máscara de volta ao quadro, e a dupla às cegas e o "sem previsão" (~10% cada, sorteados por
  `montar_lote`). A fila das placas são os recortes de todos os lotes da partida; a dos pontos segue
  sendo a dos quadros sorteados.
- **A região em pixels** é a mesma nas páginas e no Python: vale o centro do pixel, com a regra
  par-ímpar (`nucleo/regiao.js` e `mascara.rasterizar`, conferidos com os mesmos polígonos em
  `tests/fixtures/regioes.json`). A página não grava pintura fora da região, e o `validar` e o
  `unificar` recusam uma máscara que tenha.
- **Formatos novos:** `rotulo.placas/1` (com `recorte` no lugar de `quadro` e a máscara ao lado),
  `revisao.placas/1` (motivos `faltou_pintar`, `contorno_impreciso`, `pintou_o_que_nao_cobre`,
  `descarte_errado` e `outro`) e `gabarito.placas/1` (o recorte, a região e a resposta: `pintar`, com
  a máscara verdadeira de 1 a N, ou `descartar`, sem máscara). Motivos de descarte das placas:
  `placa_fora_do_lugar`, `transicao`, `borrao` e `outro` — o grafismo da emissora se pinta. Manual
  `placas-0.1` e revisão `revisao-0.4`. O `unificar` gera `placas.parquet` (manifesto `conjuntos/5`),
  com a cobertura de cada placa.
- **Gabarito:** como na 0.9, mas dentro da região: 1 px de folga na borda do que está na frente,
  cada coisa pintada em pelo menos metade da área (as menores que 30 px do recorte não contam) e
  IoU de 80%; o item `descartar` dá certo só descartado como "o recorte não está na placa". Libera com
  4 certos dos últimos 5, **depois de pelo menos 12 itens** — o lote de treino inteiro (abaixo).
- **Lotes de ouro novos**, em ids novos: PL1-treino (g4001–g4012: 6 com gente na frente, 1 com a
  trave, 1 com o grafismo, 2 sem nada na frente e 2 com o recorte fora do lugar) e PL2-variado
  (g4101–g4116, dia e noite, com borrão: 8, 2, 1, 3 e 2). A verdade sai de quem o renderizador deixou
  por cima em cada pixel da tela super-amostrada, com 3 × 3 amostras por pixel do recorte; a placa
  vizinha do mesmo lado e a rede não cobrem. `scripts/lotes_de_ouro.py --demonstracao` gera também
  uma partida sintética com 21 recortes (3 fora do lugar) para experimentar a página numa pasta de
  teste.
- **Os rótulos e os lotes da 0.9 não entram em nada:** pintavam pessoas no quadro inteiro, e não há
  como levá-los para os recortes sem pintar de novo. Os endereços `#/pessoas` e `#/revisao-pessoas`
  (e os da 0.8) levam às páginas novas.

## Conferência das regras

Anotadores simulados nos lotes novos (28 itens, 4 vezes cada), com as contas da própria página
(`scripts/conferir_regras.py`); a pintura simulada também não sai da região. "Liberado" é a chance de
estar liberado ao fim do lote de treino, com os 12 itens numa ordem sorteada.

| Placas | Itens certos | IoU mediana | Liberado ao fim do treino |
| --- | --- | --- | --- |
| laço no contorno, cuidadoso, normal ou rápido (vértices a 0,7–2,5 px) | 100% | 0,99–1,00 | 100% |
| pincel vazando 1 px para fora | 100% | 0,99 | 100% |
| vazando 2 px | 89% | 0,90 | 100% |
| vazando 3 px | 64% | 0,83 | 43% |
| comendo 1 px da borda | 98% | 0,97 | 100% |
| esquecendo as coisas menores que 150 px | 93% | 1,00 | 85% |
| pintando só as pessoas (sem a trave, a bola e o grafismo) | 82% | 1,00 | 84% |
| nunca descartando o recorte fora do lugar | 86% | 1,00 | 85% |

Só com "4 certos dos últimos 5", todo perfil era liberado com 5 itens (a mediana) — quase sempre
antes de passar pela trave, pelo grafismo e pelo recorte fora do lugar, que são 4 dos 12 do treino.
Por isso o mínimo de 12: todo mundo faz o lote de treino inteiro e vê o resultado e a resposta de
cada caso. A regra, sozinha, não segura quem pinta só as pessoas ou nunca descarta (erra 2 dos 12): os
casos raros são poucos para isso. Quem segura é o resultado na hora no treino, os itens escondidos do
PL2 (5 dos 16 são trave, grafismo ou recorte fora do lugar, e errar volta a pessoa para o teste) e a
revisão às cegas ("faltou pintar", "descarte errado").

## Consequências

- Cada item é só a placa, ampliada, e a máscara é exatamente o que o cálculo da exposição precisa: a
  fração coberta de cada placa em cada quadro. Os cantos no quadro levam a máscara de volta à imagem,
  para treinar a oclusão no quadro inteiro se for preciso.
- A pintura depende de quem gera os recortes: no piloto, só o simulador. Com vídeo real, falta a
  projeção das placas (a câmera aprovada dos pontos e o cadastro das placas do estádio) — o próximo
  passo.
- Quem começa faz pelo menos 12 itens de treino nas placas, em vez de 5.
