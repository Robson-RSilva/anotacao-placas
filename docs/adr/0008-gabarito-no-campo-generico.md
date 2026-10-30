# ADR-0008 — Gabarito no campo genérico: medidas verdadeiras no item e comparação sem o lado

**Situação:** substituída pela ADR-0010 (30/10/2026): sem molde nem câmera, o item dos pontos traz
os pontos verdadeiros, e o gabarito compara ponto a ponto (aceitando a leitura do outro lado do
campo, como aqui). Fica o registro.

## Contexto

Desde a ADR-0006 os quadros reais abrem no campo genérico (105 × 68 m, sem placas), e quem anota
estica o molde até as medidas do campo de cada estádio. O gabarito não acompanhou essa mudança de
dois jeitos:

- **As medidas.** O item do gabarito só dizia o pacote, e o campo verdadeiro era o do pacote. Para
  um item de um campo de 100 × 64 m, o pacote precisava ter essas medidas — e o item abria com elas,
  dando a resposta. O gabarito não treinava nem media o ajuste das medidas.
- **O lado.** As marcações do campo são simétricas pela rotação de 180°: a câmera certa e a
  espelhada desenham o mesmo campo. Com o pacote de um estádio, as placas decidem o lado (e a página
  pede para conferir numa placa estática). No campo genérico nada decide, e o rótulo pode ficar de
  qualquer um dos lados, mas a distância entre câmeras comparava as marcações de mesmo nome: uma
  câmera reversa anotada do lado espelhado dava dezenas de pixels de "erro" no gabarito e na
  concordância dos quadros em dupla, sem erro nenhum de quem anotou.

## Decisão

- O item do gabarito (`gabarito.camera/1`) ganha `campo` opcional: as medidas verdadeiras do campo,
  quando não são as do pacote. O item abre no molde do pacote — o campo genérico, nos lotes de ouro
  — e a comparação usa `campo` como o campo verdadeiro. Medidas fora do que a página aceita (90 a
  120 por 45 a 90 m, mais comprido que largo) são recusadas, porque ninguém conseguiria acertá-las.
- Sem placas no molde, a distância entre duas câmeras é a menor entre a câmera e a espelhada dela.
  Vale para o gabarito e para a concordância dos rótulos cegos. Com placas no molde, nada muda: o
  lado espelhado continua sendo erro.
- Os lotes de ouro saem de `scripts/lotes_de_ouro.py`, com o simulador do laboratório: itens no
  campo genérico, faixas de id separadas por lote, um filtro de quadro justo e a câmera conferida
  pelo modelo do próprio `anotacao`.

## Consequências

O gabarito mede o que quem anota faz hoje: esticar o molde genérico e ajustar a câmera. O rótulo
continua gravando o lado escolhido (`lado`); o treino do detector usa o lado canônico, e o lado do
estádio é resolvido na solução assistida (ADR-0003), pelas placas. Itens antigos, sem `campo`,
continuam valendo com as medidas do pacote. Uma página de versão anterior recusa um item com `campo`
como inválido; como o site é um só e se atualiza sozinho, isso só acontece numa aba aberta antes da
atualização.
