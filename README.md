# Anotação de dados para treino

Páginas de anotação que geram os dados de **treino e teste** do detector de marcações do projeto de
exposição de placas. Rodam inteiras no navegador, publicadas no GitHub Pages, e gravam na pasta de
trabalho de cada pessoa. Só entra aqui o que treina modelo:

| Página | O que grava | Para o treino |
| --- | --- | --- |
| Central e importação | cadastro da partida (estádio, emissora, competição, data e hora, iluminação, chuva) e os quadros sorteados, do vídeo inteiro ou só dos trechos escolhidos | separar treino e teste por jogo e equilibrar a amostra |
| Câmera do quadro | a câmera que faz o molde do campo coincidir com as marcações | alvos de pontos-chave e linhas do detector |
| Revisão cruzada | aprovar, corrigir ou devolver o rótulo de outra pessoa, às cegas | só entra no treino o que foi aprovado |
| Oclusão nas placas | o que cobre cada placa (pessoa, bola, rede, grafismo, objeto), pintado por cima do contorno das placas, e a fração livre de cada uma | alvo da máscara de pessoas do detector |
| Revisão da oclusão | aprovar, corrigir ou devolver a pintura de outra pessoa, às cegas | só entra no treino o que foi aprovado |

Cortes, replays, grafismos, lado do estádio e artes das placas são resolvidos por regras e pelo
cadastro do estádio, sem treino, e são conferidos na **solução assistida** — outro projeto, com
ferramenta e documento próprios (ver [ADR-0003](docs/adr/0003-anotacao-separada-da-solucao-assistida.md)).

## Usar

1. Abra **<https://robson-rsilva.github.io/anotacao-placas/>** no Chrome ou no Edge, no computador.
2. Clique em **Escolher a pasta de trabalho** e escolha a pasta da equipe no Google Drive (sincronizada
   pelo Google Drive para computador). O navegador pede permissão para ler e gravar nela; da próxima
   vez, um clique em "Continuar nessa pasta" basta.
3. Digite o seu código em **Seu código**, no alto da página central — as suas iniciais, por
   exemplo (de 2 a 10 letras e números) — e comece a anotar. Não há cadastro de equipe: o código só
   separa os arquivos de cada pessoa e conta os pontos do placar.

Nada é instalado e nada vai para a internet: o site são arquivos estáticos (HTML, CSS e JavaScript) e
todo o processamento — inclusive ler o vídeo — acontece no navegador de cada pessoa. Os vídeos,
quadros e rótulos ficam no computador e na pasta sincronizada. A política de segurança da página
(CSP) não deixa ela falar com nenhum outro endereço. Depois da primeira visita, o site abre também
sem internet.

**Sem pasta sincronizada ou em outro navegador:** "Guardar neste navegador" usa o armazenamento do
próprio navegador. Os arquivos entram por "Trazer arquivos de um .zip" e saem por "Baixar os meus
arquivos (.zip)", na página central, para quem coordena juntar na pasta da equipe. O Firefox e o
Safari só funcionam assim.

## Cada pessoa no seu computador

Quem anota e quem revisa trabalham cada um no próprio computador, e nada passa pelo site: o que
liga os dois é a pasta de trabalho.

- **Com a pasta da equipe no Google Drive** (o jeito normal): cada pessoa instala o Google Drive para
  computador, abre o site e escolhe a **mesma pasta** da equipe. Cada um digita o **seu** código. O
  rótulo de uma pessoa é um arquivo dela, que o Drive leva para o computador da outra; a revisão
  volta do mesmo jeito. As páginas paradas sem nada a fazer — a revisão sem rótulos, a câmera sem
  quadros, a central — conferem sozinhas a cada 15 segundos (e quando você volta para a aba) e
  mostram o que chegou, sem recarregar. Uma partida importada por uma pessoa aparece para as outras
  assim que o Drive termina de sincronizar os quadros.
- **Sem pasta sincronizada**, pelo armazenamento do navegador e arquivos .zip: quem importou a
  partida e anotou manda **Baixar cópia da pasta (.zip)**; a outra pessoa, com o armazenamento
  vazio, usa **Trazer a cópia de um .zip**, digita o código dela e revisa; depois manda de volta
  **Baixar os meus arquivos (.zip)** (só as revisões e correções dela), e quem anotou traz com
  **Trazer arquivos de um .zip**. O placar dos dois fica igual.

**Cada pessoa com um código diferente.** Com o mesmo código, duas pessoas gravariam os mesmos nomes
de arquivo (o Drive guardaria um só) e uma não revisaria a outra. A página guarda em que computador
cada código é usado (`pessoas/<código>/`) e avisa quando o código digitado já é usado em outro; se for
você mesmo em outro computador, é só confirmar uma vez ("Sou eu, em outro computador") — e não anotar
nos dois ao mesmo tempo.

## O fluxo

Não é preciso cadastrar equipe nem levantar o estádio antes: basta importar a partida e anotar.

1. **Importar a partida.** Escreva o nome do estádio e os dados do jogo e escolha o vídeo (MP4 ou MOV
   em H.264, H.265, VP9 ou AV1). Em **Trechos do vídeo** dá para escolher só as partes que interessam
   — por exemplo `0:05:00-0:50:00, 1:05:00-1:50:00` para os dois tempos sem o intervalo; vazio, vale o
   vídeo inteiro. O vídeo é lido no navegador com o decodificador do próprio navegador (WebCodecs):
   hash, relógio de cada quadro (PTS), cortes e transições (regras do laboratório, só para organizar o
   sorteio), agrupamento das tomadas e sorteio de 1 ou 2 quadros por tomada. Fora dos trechos, nada é
   decodificado, o que poupa a maior parte do tempo. Só os quadros sorteados vão para a pasta, em
   JPEG, numa **fila aberta**: quem anota pega o próximo, e cada pessoa começa num ponto diferente da
   fila para duas pessoas não pegarem o mesmo quadro. MKV e TS: converta antes para MP4 (no OBS,
   Arquivo → Remuxar gravações). A leitura leva tempo: num teste com 2 núcleos e sem decodificação
   pela placa de vídeo, 2 minutos de vídeo em 1080p levaram 1 minuto. Deixe a aba aberta até terminar;
   dá para voltar à central enquanto isso.
2. **Anotar a câmera.** O molde é o **campo genérico**: as marcações da regra (áreas, círculo, marcas
   do pênalti, gols) num campo de 105 × 68 m. Como o tamanho do campo muda de um estádio para outro,
   o comprimento e a largura se ajustam em cada quadro, em **Medidas do campo**: o molde estica e o
   que está travado continua no lugar; os quadros seguintes da mesma partida já abrem com as últimas
   medidas usadas nela. O molde abre pela melhor câmera disponível (versão devolvida, previsão do modelo, um
   quadro já anotado da mesma tomada ou uma posição típica de câmera). Arrastar um ponto move o
   molde inteiro, porque o que se ajusta por trás é a câmera; cada ponto solto fica travado. Linhas
   longas também se arrastam.
3. **Revisão cruzada.** Cada rótulo vai para qualquer outra pessoa (nunca para quem anotou), sem o
   nome de quem anotou: aprovar, corrigir (vira versão nova, com a autoria de quem revisou) ou devolver
   com um motivo da lista. Nos quadros em dupla às cegas, a revisão só abre depois que as duas
   pessoas anotaram.
4. **Pintar a oclusão nas placas.** Depois que a câmera de um quadro é aprovada, ele entra na fila da
   oclusão. A câmera desenha o contorno das placas — as do estádio levantado ou, no campo genérico,
   uma **faixa de placas** em cada lado do campo, com a distância da linha, a altura, o comprimento e
   um vão no meio, ajustados no primeiro quadro da partida (os seguintes já abrem certos). Pinta-se só
   dentro dos contornos o que está na frente da placa: pessoa, bola, rede, grafismo ou objeto, com o
   pincel ou o laço. Placas mais baixas que 10 px (ref. 960) ficam de fora. A máscara vai num PNG ao
   lado do rótulo, e o rótulo traz a fração livre de cada placa. Outra pessoa revisa às cegas, como
   na câmera ([ADR-0009](docs/adr/0009-oclusao-nas-placas.md)).
5. **Unificar** (Python, por quem treina). `anotacao unificar` lê tudo, valida de novo e gera
   `conjuntos/<data-hora>/camera.parquet`, `oclusao.parquet` e `oclusao_placas.parquet` com
   manifesto, respeitando a divisão por partida: quadros de um jogo nunca se misturam entre treino e
   teste. Cada linha da câmera leva as medidas do campo usadas no molde daquele rótulo; cada placa da
   oclusão, as contas refeitas da máscara e o retângulo para recortar.

Para experimentar, a página central cria uma pasta de exemplo (o estádio sintético do laboratório).

A página **Coordenação** é opcional: nomes para o placar mostrar ao lado de cada código, link do
Manual, divisão das partidas entre treino e teste, itens do gabarito e pacotes de estádios
levantados. Um pacote de estádio (medidas do campo, placas e posição das câmeras) entra como molde
na importação, no lugar do campo genérico, e mostra as placas com o nome, para conferir o lado do
estádio.

Quando a pasta tem **gabarito** (quadros com a câmera exata, do simulador ou de rótulos arbitrados),
quem começa é treinado e liberado por ele: a mediana dos últimos 10 itens precisa ficar em até 2 px.
Depois, a cada 15 rótulos, um item do gabarito entra escondido na fila. Sem gabarito, todo mundo
anota direto. Os **lotes de ouro** (`scripts/lotes_de_ouro.py`) são gabaritos prontos, do
simulador: L1 para treino e liberação, L2 para as medidas do campo, L3 e L4 para controle de dia e à
noite, cada um num .zip que entra por "Trazer arquivos de um .zip". Os itens abrem no campo
genérico; os de um campo de outro tamanho só fecham com as medidas certas. Sem placas no molde, nada
decide o lado do campo, e o gabarito aceita a câmera do lado espelhado ([ADR-0008](docs/adr/0008-gabarito-no-campo-generico.md)).
A oclusão tem gabarito próprio: os lotes L5 (de dia) e L6 (à noite), com as placas exatas e a
máscara verdadeira de cada quadro. A pintura se compara com a verdade placa a placa, com 1 px de
tolerância na borda; a liberação pede a mediana dos últimos 5 itens em até 5% de cada placa.
Em ~10% dos quadros duas pessoas anotam (e pintam) do zero, às cegas, para medir a concordância; em
outros ~10% a página começa sem previsão, para medir o viés de ancoragem.

## Pasta de trabalho

```text
trabalho/                                   a pasta da equipe, sincronizada com o Drive
  equipe.json, divisao.json, projeto.json     nomes (opcionais), divisão e projeto
  estadios/generico/pacote-1.0/pacote.json   o campo genérico (a página grava ao criar a pasta)
  estadios/<estadio>/pacote-<versão>/pacote.json   estádios levantados (opcional)
  partidas/<partida>/
    manifesto.json, tomadas.json, fila.json
    quadros/<quadro>.jpg                      só os sorteados
    previsoes/<quadro>.json                   quando há previsor (anotacao prever)
    previsoes/oclusao/<quadro>.png            pré-pintura de um modelo (anotacao prever --tarefa oclusao)
    rotulos/camera/<quadro>__<código>__v<n>.json
    rotulos/oclusao/<quadro>__<código>__v<n>.json + .png   a pintura e a máscara ao lado
    revisoes/camera/…, revisoes/oclusao/…
  gabarito/itens/, gabarito/rotulos/          nunca entram no treino
  pessoas/<código>/<navegador>.json           em que computadores cada código é usado
  conjuntos/<data-hora>/                      saída do unificar
```

Um arquivo por pessoa e por versão: ninguém edita o arquivo de outra pessoa, então o Drive nunca
entra em conflito. A escrita é atômica e nenhum rótulo ou revisão existente é sobrescrito. Os
formatos estão em [docs/formatos.md](docs/formatos.md), com os JSON Schemas em `web/esquemas/`.

## Para quem coordena e treina (Python)

```bash
python -m venv .venv && source .venv/bin/activate     # no Windows: .venv\Scripts\activate
pip install -e .

anotacao exemplo trabalho                   # pasta de exemplo: estádio sintético e os nomes de A01/A02
anotacao gabarito ORIGEM --pasta P          # importa itens do gabarito (<id>.json + JPEG; na oclusão, + PNG)
anotacao prever --pasta P --previsor pacote.modulo:objeto   # câmera prevista para o molde abrir perto
anotacao prever --tarefa oclusao --pasta P --previsor ...   # pré-pintura da oclusão (máscara de pessoas)
anotacao validar --pasta P                  # confere todos os arquivos
anotacao unificar --pasta P                 # gera os conjuntos de treino
anotacao esquemas DESTINO                   # exporta os JSON Schemas
```

Para experimentar com dados do laboratório: `scripts/lotes_de_ouro.py` gera os lotes de ouro
(`--laboratorio ../placas-exposicao --saida lotes`: um .zip por lote, `indice.csv` e
`indice-oclusao.csv` e um mosaico de cada lote — na oclusão, com a máscara verdadeira por cima), `scripts/gabarito_do_laboratorio.py` gera itens do gabarito no estádio sintético, com
placas, e `scripts/video_demo_do_laboratorio.py` monta um vídeo MP4 de demonstração a partir de uma
transmissão sintética.

## Publicação

Cada push em `main` roda o CI (Python, JavaScript e o teste de ponta a ponta no navegador) e, se
passar, publica `web/` no GitHub Pages ([.github/workflows/ci.yml](.github/workflows/ci.yml)). Uma
vez só, no repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Desenvolvimento

```bash
pip install -e ".[dev]"
python -m http.server 8000 --bind 127.0.0.1 --directory web   # http://127.0.0.1:8000
ruff check . && ruff format --check .
pytest                                    # Python
node --test tests/js/*.test.js            # JavaScript das páginas (Node 20+, sem npm install)

pip install -e ".[e2e]" && playwright install chromium
pytest -m e2e                             # ponta a ponta no navegador (precisa do ffmpeg)
```

O endereço local (127.0.0.1) conta como seguro para o navegador, então a escolha de pasta e o
WebCodecs funcionam como no site publicado. O modelo de câmera e o molde do campo existem em Python e
em JavaScript e são testados contra o laboratório; a leitura do vídeo e os cortes são testados contra
a implementação de referência da v0.1. Detalhes em [CONTRIBUTING.md](CONTRIBUTING.md), arquitetura
em [docs/arquitetura.md](docs/arquitetura.md) e decisões em [docs/adr/](docs/adr/).

## Próximos passos

- Baixar o vídeo pela própria página (depende de onde os vídeos vêm).
- Previsor com o detector do laboratório (`anotacao prever --previsor pacote.modulo:objeto`) e a
  máscara de pessoas como pré-pintura da oclusão (`--tarefa oclusao`).
- Decidir se a rede do gol conta como oclusão (o rótulo já guarda os pixels dela).
- Indicador ao vivo da distância entre o molde e as linhas que a rede encontrou.

## Dados e privacidade

O código é público; os dados não. Vídeos, quadros e rótulos nunca vão para o Git nem para o site:
ficam no computador de cada pessoa e na pasta da equipe no Drive, compartilhada só com a equipe e sem
links públicos. O acordo de uso das transmissões precisa cobrir essa cópia.

Todos os direitos reservados.
