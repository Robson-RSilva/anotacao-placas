# Anotação de dados para treino

Páginas de anotação que geram os dados de **treino e teste** do detector de marcações do projeto de
exposição de placas. Rodam inteiras no navegador, publicadas no GitHub Pages, e gravam na pasta de
trabalho de cada pessoa. Só entra aqui o que treina modelo:

| Página | O que grava | Para o treino |
| --- | --- | --- |
| Central e importação | cadastro da partida (estádio, emissora, competição, data e hora, iluminação, chuva) e os quadros sorteados, do vídeo inteiro ou só dos trechos escolhidos | separar treino e teste por jogo e equilibrar a amostra |
| Câmera do quadro | a câmera que faz o molde do campo coincidir com as marcações | alvos de pontos-chave e linhas do detector |
| Revisão cruzada | aprovar, corrigir ou devolver o rótulo de outra pessoa, às cegas | só entra no treino o que foi aprovado |
| Oclusão nas placas (próxima versão) | máscara por classe dentro de cada placa | alvo da máscara de pessoas do detector |

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

## O fluxo

Não é preciso cadastrar equipe nem levantar o estádio antes: basta importar a partida e anotar.

1. **Importar a partida.** Escreva o nome do estádio e os dados do jogo e escolha o vídeo (MP4 ou MOV
   em H.264, H.265, VP9 ou AV1; do YouTube, veja [abaixo](#vídeos-do-youtube)). Em **Trechos do vídeo** dá para escolher só as partes que interessam
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
4. **Unificar** (Python, por quem treina). `anotacao unificar` lê tudo, valida de novo e gera
   `conjuntos/<data-hora>/camera.parquet` com manifesto, respeitando a divisão por partida: quadros de
   um jogo nunca se misturam entre treino e teste. Cada linha leva as medidas do campo usadas no
   molde daquele rótulo.

Para experimentar, a página central cria uma pasta de exemplo (o estádio sintético do laboratório).

A página **Coordenação** é opcional: nomes para o placar mostrar ao lado de cada código, link do
Manual, divisão das partidas entre treino e teste, itens do gabarito e pacotes de estádios
levantados. Um pacote de estádio (medidas do campo, placas e posição das câmeras) entra como molde
na importação, no lugar do campo genérico, e mostra as placas com o nome, para conferir o lado do
estádio.

Quando a pasta tem **gabarito** (quadros com a câmera exata, do simulador ou de rótulos arbitrados),
quem começa é treinado e liberado por ele: a mediana dos últimos 10 itens precisa ficar em até 2 px.
Depois, a cada 15 rótulos, um item do gabarito entra escondido na fila. Sem gabarito, todo mundo
anota direto. Em ~10% dos quadros duas pessoas anotam do
zero, às cegas, para medir a concordância; em outros ~10% a página começa sem previsão, para medir o
viés de ancoragem.

## Vídeos do YouTube

A página não consegue baixar do YouTube (o navegador não deixa uma página ler o vídeo de outro site),
então quem importa baixa com um comando, no próprio computador, e escolhe o arquivo na página. Na
primeira vez, com o Python 3.11 ou mais novo:

```bash
pip install "anotacao-placas[baixar] @ git+https://github.com/Robson-RSilva/anotacao-placas"
```

Isso traz o [yt-dlp](https://github.com/yt-dlp/yt-dlp), o Deno (que o yt-dlp usa nos desafios do
YouTube) e um ffmpeg — nada para instalar à parte. Depois, para cada jogo:

```bash
anotacao baixar "https://www.youtube.com/watch?v=..."                                       # o vídeo inteiro
anotacao baixar "https://www.youtube.com/watch?v=..." --trechos "0:05:00-0:50:00, 1:05:00-1:50:00"
```

Em **Importar partida → Vídeo do YouTube**, a página monta esse comando a partir do link e dos
trechos, para copiar. O arquivo vai para a pasta em que o terminal está (ou `--pasta`), com o nome
`<título> [<id>].mp4`, e tem só a imagem, sem som, em MP4 com H.264 até 1080p (`--altura-max` muda),
que o Chrome e o Edge decodificam pela placa de vídeo.

- **Com trechos**, baixa só eles: cada um do quadro-chave antes do início (alguns segundos antes)
  até o fim, sem recodificar, e junta tudo num arquivo só. O arquivo guarda no comentário do MP4 de
  onde veio e quais trechos tem: na página, deixe o campo Trechos vazio (ou com os mesmos trechos) —
  outros trechos são recusados, porque contariam o tempo do arquivo como se fosse o do vídeo
  original. O manifesto da partida registra a origem (`origem`, `origem_url`, `origem_trechos`).
- **Sem trechos**, baixa o vídeo inteiro, e os trechos podem ser escolhidos na página.
- Se o YouTube pedir para confirmar que não é um robô, rode de novo com
  `--cookies-do-navegador firefox` (ou o navegador em que você está logado no YouTube).
- O YouTube muda com frequência; quando o download parar de funcionar, `pip install -U yt-dlp`
  costuma resolver.

O download por trechos é feito pelo ffmpeg, e o vídeo inteiro pelo próprio yt-dlp. Se os trechos
vierem lentos, baixe o vídeo inteiro e escolha os trechos na página. O direito de uso das transmissões
vale também para essa cópia (veja [Dados e privacidade](#dados-e-privacidade)).

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
    rotulos/camera/<quadro>__<código>__v<n>.json
    revisoes/camera/<quadro>__<código>__v<n>.json
  gabarito/itens/, gabarito/rotulos/          nunca entram no treino
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
anotacao baixar LINK [--trechos T]          # baixa do YouTube para importar (extra [baixar], acima)
anotacao gabarito ORIGEM --pasta P          # importa itens do gabarito (<id>.json + JPEG)
anotacao prever --pasta P --previsor pacote.modulo:objeto   # câmera prevista para o molde abrir perto
anotacao validar --pasta P                  # confere todos os arquivos
anotacao unificar --pasta P                 # gera os conjuntos de treino
anotacao esquemas DESTINO                   # exporta os JSON Schemas
```

Para experimentar com dados do laboratório: `scripts/gabarito_do_laboratorio.py` gera itens do
gabarito com o simulador, e `scripts/video_demo_do_laboratorio.py` monta um vídeo MP4 de demonstração
a partir de uma transmissão sintética.

## Publicação

Cada push em `main` roda o CI (Python, JavaScript e o teste de ponta a ponta no navegador) e, se
passar, publica `web/` no GitHub Pages ([.github/workflows/ci.yml](.github/workflows/ci.yml)). Uma
vez só, no repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Desenvolvimento

```bash
pip install -e ".[dev,baixar]"
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

- Página de oclusão nas placas (máscara por classe, a fração livre calculada dela).
- Previsor com o detector do laboratório (`anotacao prever --previsor pacote.modulo:objeto`).
- Indicador ao vivo da distância entre o molde e as linhas que a rede encontrou.

## Dados e privacidade

O código é público; os dados não. Vídeos, quadros e rótulos nunca vão para o Git nem para o site:
ficam no computador de cada pessoa e na pasta da equipe no Drive, compartilhada só com a equipe e sem
links públicos. O acordo de uso das transmissões precisa cobrir essa cópia.

Todos os direitos reservados.
