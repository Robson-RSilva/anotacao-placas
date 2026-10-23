# ADR-0003 — A anotação só gera dados de treino; a solução assistida é outro projeto

**Situação:** aceita (23/10/2026)

## Contexto

Há duas frentes: as páginas de anotação, que geram os dados para treinar e testar os modelos, e a
solução assistida, que é o entregável final (o sistema mede, uma pessoa revisa) e a régua para
comparar os resultados automáticos. Misturar as duas confundia o que é rótulo de treino e o que é
correção de entrega.

## Decisão

- Este repositório só tem tarefas cujos dados treinam ou testam um modelo. Hoje o único modelo
  treinado é o detector (rede própria com três saídas: pontos-chave, linhas e pessoas), então as
  tarefas são **câmera do quadro** e, na 0.2, **oclusão nas placas**, mais a **revisão cruzada** que
  garante a qualidade delas.
- Cortes, replays, grafismos, tipo de plano, lado do estádio e artes das placas são resolvidos por
  regras, geometria e o cadastro do estádio, sem treino. Não têm página aqui: são conferidos na
  solução assistida.
- As correções da solução assistida não entram nos conjuntos de treino.

## Consequências

Se um dia uma dessas etapas virar uma rede treinada (por exemplo, um detector de cortes aprendido),
ela ganha uma tarefa de anotação aqui.
