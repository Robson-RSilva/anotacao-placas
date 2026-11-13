# ADR-0017 — O detector de pontos na importação

**Situação:** aceita (13/11/2026). Vem com a 0.7.0 do laboratório de treino (exposicao-treino), que exporta o
detector em ONNX (ADR-0011 de lá).

## Contexto

- **A anotação é o gargalo**: uma partida nova leva dias. Por quadro, quem anota marca uns 6 pontos, e cada um
  pede o clique na imagem e a escolha do nome no mapa.
- **A página já sabe começar um quadro dos pontos de um modelo** (`previsoes/pontos/<quadro>.json`), com o
  rótulo guardando de onde partiu (`partiu_de`) e o tempo ativo. Até aqui, as previsões só chegavam pelo
  `anotacao prever`, em Python, com um previsor escrito à parte.
- **O detector-v1** (88% de acerto da câmera na validação cruzada) deixa, com escore 0,5 ou mais, uns 4 pontos
  por quadro, 97% deles certos (a até 5 px do clique, na referência de 960 px) e 87% dos certos a até 2 px —
  medido no laboratório, cada partida com o modelo que não a viu no treino.
- **A previsão tem de sair sem ninguém passar pelo laboratório**: na importação da partida, no computador de
  quem importa, que é quem já está com o vídeo aberto na página.

## Decisão

- **O detector roda no navegador, na importação.** A página traz junto o ONNX Runtime Web (o motor em
  WebAssembly, na CPU, `web/vendor/onnxruntime-web/`, MIT, trazido do npm pelo `scripts/onnxruntime_web.py`
  com a conferência da integridade) — é um motor de inferência genérico, como o PyTorch e o OpenCV no
  laboratório, e nada de outra origem é buscado. Roda no worker da importação, sem travar a página, com uma
  thread só (o GitHub Pages não manda o isolamento entre origens que as threads pedem).
- **O modelo vem da pasta da equipe**: `modelos/<nome>/` é a pasta que o laboratório exporta (o `cartao.json`
  e o `detector.onnx`; o resto não é usado), copiada por quem treina — uma vez por modelo. Vale o mais novo
  (pelo `criado_em` do cartão) que a página consegue usar; o sha256 do ONNX é conferido contra o cartão. O
  modelo nunca vai para o repositório da página, que é público.
- **A conta é a do laboratório.** A redução da imagem é a do `modelo.py` (a janela de 16:9, a INTER_AREA e, em
  outra proporção, o warpAffine do OpenCV), portada para o JavaScript e conferida byte a byte contra o OpenCV
  em casos gerados pelo próprio laboratório (`scripts/casos_do_detector.py`: uma rede pequena de pesos
  sorteados e imagens de vários tamanhos); a decodificação é a do `modelo.py` (o pico de cada canal, a
  supressão, só os 39 que se marcam), conferida com a rede rodando no ONNX Runtime Web. A imagem que a rede vê
  é o JPEG gravado na pasta, decodificado pelo navegador — o mesmo arquivo que o laboratório lê no treino (o
  teste no navegador confere que dá o mesmo que o OpenCV, a no máximo um nível de cinza).
- **O que vai para a imagem**: os pontos de escore 0,5 ou mais, dentro da imagem. O corte é fixo.
- **Ficam do zero** os quadros "sem previsão" (a comparação do tempo e das correções) e os da dupla às cegas (a
  concordância entre duas pessoas que anotaram do zero é a régua para saber se os pré-preenchidos chegam perto
  demais do detector). A fila também ignora a previsão desses quadros, venha de onde vier.
- **Na importação, duas escolhas lado a lado**: o conjunto da partida (treino, validação, teste congelado,
  teste externo — a página grava a divisão no fim) e "usar a detecção". A detecção vem ligada, menos no teste,
  em que a recomendação é anotar do zero: a revisão pega o que parece errado, mas a ancoragem produz rótulos
  que parecem certos — pontos a 1 ou 2 px de onde a pessoa clicaria —, e no teste essa é a margem que decide
  se uma câmera conta como certa. Quem importa decide.
- **Se a detecção falhar** (sem o motor, o modelo quebrado, a rede caindo nos primeiros quadros), a importação
  segue sem ela e o resumo diz por quê. A página da partida tem o botão "Gerar previsões": roda o modelo em uso
  nos quadros que ainda não têm rótulo (a previsão que já é desse modelo fica; a de outro é refeita).
- **As previsões não são trabalho de ninguém**: uma partida só com previsões pode ser importada de novo (elas
  saem com o resto e se refazem).
- **O registro**: a previsão grava `fonte` (o nome do modelo) e `versao` (os 12 primeiros caracteres do sha256
  do ONNX); o rótulo que parte dela guarda `partiu_de.versao = "<nome>@<versão>"`; o manifesto grava o
  `previsor` e, nos parâmetros, `deteccao`, `deteccao_quadros`, `deteccao_segundos` (e `deteccao_erro`).

## Consequências

- Na CPU, a rede de 896 × 504 leva perto de 1 s por quadro numa máquina comum: uma importação de 100 a 200
  quadros ganha um a três minutos. O motor (14,8 MB) fica guardado pelo service worker: a detecção roda sem
  internet depois da primeira visita.
- A cada detector novo, a pasta exportada vai para `modelos/` da pasta da equipe; o botão da página da partida
  atualiza as previsões dos quadros que ninguém anotou.
- A medida do pré-preenchimento sai do laboratório (`dados preparar`, a partir da 0.7.0 dele: de onde partiu
  cada rótulo e o tempo ativo, ao lado dos "sem previsão"). Se a ancoragem aparecer, sobe o corte ou muda a
  forma como a página mostra os pontos sugeridos.
- Fica para depois: a GPU (WebGPU, com a CPU de reserva quando o computador ou o navegador não tiverem), para a
  detecção ficar bem mais rápida.
- Os vídeos em outra proporção (4:3, 1366 × 768) passam pelo warpAffine: a página segue o do OpenCV 5 (o que o
  laboratório instala hoje); com o OpenCV 4, a entrada do laboratório fica a um ou dois níveis de cinza da da
  página, sem efeito nos pontos.
