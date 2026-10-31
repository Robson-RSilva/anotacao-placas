# Anotação de dados para treino

Páginas de anotação que geram os dados de **treino e teste** do projeto de exposição de placas.
Rodam inteiras no navegador, publicadas no GitHub Pages, e gravam na pasta de trabalho de cada
pessoa. Duas tarefas, cada uma feita direto na imagem:

| Página | O que se faz | Para o treino |
| --- | --- | --- |
| Central e importação | cadastro da partida (estádio, emissora, competição, data e hora, iluminação, chuva) e os quadros sorteados, do vídeo inteiro ou só dos trechos escolhidos | separar treino e teste por jogo e equilibrar a amostra |
| Pontos do campo | clicar em cada ponto do campo que aparece (cruzamentos de linhas, marcas, traves), dando o nome de cada um pelo mapa do campo | alvo dos pontos-chave do detector |
| Oclusão nas placas | no recorte de cada placa (a placa já endireitada, com o contorno pronto), pintar o que está na frente dela — gente, bola, trave, outra placa, o grafismo da emissora | alvo da máscara de oclusão: quanto de cada placa quem assiste vê |
| Revisão às cegas | aprovar, corrigir ou devolver o trabalho de outra pessoa, sem saber de quem é | só entra no treino o que foi aprovado |
| Gabarito | o teste de quem começa, com o resultado na hora, e os itens que medem cada pessoa depois | medir a qualidade de cada um |

Em qualquer das duas tarefas, a imagem que não dá para anotar (transição, borrão; nos pontos, o
grafismo da emissora por cima; nas placas, o recorte que não está na placa) é **descartada** com um
motivo — e o descarte também passa pela revisão. Imagem sem nenhum ponto (um close) ou placa sem nada
na frente é salva vazia: é um exemplo de treino como os outros.

Cortes, replays, grafismos, lado do estádio e artes das placas são resolvidos por regras e pelo
cadastro do estádio, sem treino, e são conferidos na **solução assistida** — outro projeto, com
ferramenta e documento próprios (ver [ADR-0003](docs/adr/0003-anotacao-separada-da-solucao-assistida.md)).

## Usar

1. Abra **<https://robson-rsilva.github.io/anotacao-placas/>** no Chrome ou no Edge, no computador.
2. Clique em **Escolher a pasta de trabalho** e escolha a pasta da equipe no Google Drive (sincronizada
   pelo Google Drive para computador). O navegador pede permissão para ler e gravar nela; da próxima
   vez, um clique em "Continuar nessa pasta" basta.
3. Digite o seu código em **Seu código**, no alto da página central — as suas iniciais, por
   exemplo (de 2 a 10 letras e números) — e comece. Não há cadastro de equipe: o código só separa os
   arquivos de cada pessoa e conta os pontos do placar.

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
  volta do mesmo jeito. As páginas paradas sem nada a fazer — a revisão sem rótulos, os pontos ou as
  placas sem imagens, a central — conferem sozinhas a cada 15 segundos (e quando você volta para
  a aba) e mostram o que chegou, sem recarregar. Uma partida importada por uma pessoa aparece para as
  outras assim que o Drive termina de sincronizar os quadros.
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
2. **Marcar os pontos do campo.** A imagem abre sem molde por cima (só com os pontos de um modelo,
   quando há previsão, para corrigir). Ao lado fica o **mapa do campo** com os 39 pontos que se
   marcam (cruzamentos das linhas, marcas do pênalti e do centro, pés e topos das traves). Escolha o
   ponto no mapa e clique no lugar dele na imagem — ou ao contrário: clique na imagem e depois no
   mapa. Marque todo ponto que aparece, no centro exato do cruzamento; a roda do mouse aproxima e a
   lupa mostra o pixel. Arrastar ajusta, o botão direito apaga. O mapa gira de 90 em 90 graus (`R`)
   até ficar como a imagem — o lado de baixo é o mais perto da câmera. Os nomes dos lados são os do
   campo ("cab", o lado das cabines), e a mesma marcação vista do outro lado do campo (girada 180°)
   também vale.
3. **Trazer os recortes das placas.** Os recortes chegam prontos, de fora das páginas — hoje do
   simulador do laboratório; depois, da projeção das placas com a câmera de cada quadro —, em lotes:
   `recortes/<lote>.json` com as imagens ao lado, uma por placa por quadro (a placa endireitada, com
   um pouco em volta, e a região que se pinta). Quem coordena traz o lote com `anotacao recortes` ou
   por "Trazer arquivos de um .zip"; a partida precisa já estar na pasta.
4. **Pintar o que está na frente da placa.** Fora do contorno da placa (em azul) a imagem fica
   escurecida e nada se pinta; o laço pode passar do contorno. Pinte tudo o que esconde a placa de
   quem assiste — gente (jogador, árbitro, gandula, fotógrafo, quem for), bola, trave e travessão,
   outra placa mais perto, câmera, bandeira, o grafismo da emissora — com o pincel ou o laço
   (contornar à mão ou clique a clique); a borracha (`E`) apaga. Não pinte o próprio anúncio (mesmo
   uma pessoa desenhada nele), sombra, reflexo nem o que deixa ver a placa através (a rede). Sem nada
   na frente, salve sem pintar. O contorno é considerado certo: se ele não está na placa (fora do
   lugar, ou outra coisa), descarte — "o recorte não está na placa". A máscara (1 onde algo cobre a
   placa) vai num PNG ao lado do rótulo.
5. **Descartar** (`D`), nas duas tarefas, a imagem que não dá para anotar: transição entre tomadas,
   borrada demais, outro motivo (com comentário) e, nos pontos, grafismo da emissora cobrindo a imagem
   ou, nas placas, o recorte que não está na placa. O descarte é um rótulo como os outros e vai para a
   revisão.
6. **Revisão às cegas.** Cada rótulo vai para qualquer outra pessoa (nunca para quem anotou), sem o
   nome de quem anotou: aprovar, corrigir (vira versão nova, com a autoria de quem revisou) ou devolver
   com um motivo da lista. A página de revisão traz o passo a passo ("Como revisar"): nos pontos,
   conferir o lugar (até 2 px) e o nome de cada ponto e procurar o que faltou; nas placas, conferir o
   contorno, o que faltou pintar (a trave e o grafismo também) e se o anúncio, uma sombra ou a rede
   foram pintados; num descarte, se dava mesmo para anotar (e se o recorte estava mesmo fora da
   placa). Nos itens em dupla às cegas, a revisão só abre depois que as duas pessoas anotaram.
7. **Unificar** (Python, por quem treina). `anotacao unificar` lê tudo, valida de novo e gera
   `conjuntos/<data-hora>/pontos.parquet`, `pontos_lista.parquet` e `placas.parquet` (com a fração
   coberta de cada placa) com manifesto, respeitando a divisão por partida: imagens de um jogo nunca se
   misturam entre treino e teste. Imagens descartadas ficam de fora (o manifesto conta por motivo).

Em ~10% dos quadros e dos recortes duas pessoas anotam (e pintam) do zero, às cegas, para medir a
concordância; em outros ~10% a página começa sem previsão, para medir o viés de ancoragem.

## O gabarito e os lotes de ouro

A página **Gabarito** (pela central) é o teste de quem começa. São imagens com a resposta certa:
você anota como sempre e, ao salvar, vê o resultado — o que acertou, o que ficou longe, o que faltou
— e pode ver a resposta. Cada tarefa tem o seu teste e a sua meta:

- **Pontos:** um item dá certo sem nenhum ponto errado (nome trocado, ou a mais de 8 px do lugar
  certo), com pelo menos 80% dos pontos que aparecem marcados e o erro mediano em até 2 px (px na
  referência de 960 de largura). Pontos cobertos são opcionais. Libera com 8 certos dos últimos 10.
- **Placas:** dentro do contorno da placa e com 1 px de tolerância na borda, cada coisa na frente
  pintada em pelo menos metade da área (as menores que 30 px do recorte não contam) e a sobreposição
  com a resposta (IoU) de pelo menos 80% — o que se pinta a mais (o anúncio, uma sombra, um contorno
  largo) derruba a sobreposição. O recorte que não está na placa dá certo descartado ("o recorte não
  está na placa"). Libera com 4 certos dos últimos 5, depois de pelo menos 12 itens — o lote de
  treino inteiro, para todo mundo passar pela trave, pelo grafismo e pelo recorte fora do lugar com o
  resultado na hora.

Até ser liberada, a pessoa só vê o teste na página da tarefa. Depois, uma imagem do gabarito entra
escondida a cada 15 imagens reais, sem aviso e sem resultado, e a liberação continua contando os
últimos itens: quem cai muito volta para o teste. Sem gabarito na pasta, todo mundo anota direto.

Os **lotes de ouro** são gabaritos prontos, gerados com o simulador do laboratório
(`scripts/lotes_de_ouro.py`), e entram pela página do gabarito ("Importar lote de ouro (.zip)"):

| Lote | Itens | Para quê |
| --- | --- | --- |
| P1-treino | g1001–g1030 | teste dos pontos: dia, câmeras centrais, imagem nítida |
| P2-variado | g1101–g1140 | controle dos pontos: todas as câmeras e campos de vários tamanhos, com closes sem pontos |
| P3-noite | g1201–g1220 | controle dos pontos à noite |
| PL1-treino | g4001–g4012 | teste das placas: dia, imagem nítida; 6 com gente na frente, 1 com a trave, 1 com o grafismo da emissora, 2 sem nada na frente e 2 com o recorte fora do lugar |
| PL2-variado | g4101–g4116 | controle das placas: dia e noite, todas as câmeras menos a tática, com borrão; gente, traves e grafismo na frente, 3 sem nada na frente e 2 fora do lugar |

O teste usa primeiro os lotes com "treino" no nome; os itens escondidos, primeiro os outros. As
regras foram conferidas com anotadores simulados nesses lotes ([ADR-0010](docs/adr/0010-marcar-e-pintar-direto-na-imagem.md)
e [ADR-0012](docs/adr/0012-pintar-a-oclusao-no-recorte-da-placa.md)). Os lotes da pintura da 0.8 e
da 0.9 (J1, J2, PE1 e PE2: g2xxx e g3xxx) não valem mais: a página não os usa, mesmo que estejam na
pasta.

**Lotes de ouro das imagens reais.** `anotacao ouro --pasta P` monta um lote com o que a equipe já
anotou e foi aprovado na revisão — o gabarito arbitrado ([ADR-0013](docs/adr/0013-gabarito-arbitrado-dos-rotulos-aprovados.md)):
cada rodada grava `conjuntos/ouro-reais-<n>.zip` só com os itens que ainda não foram para nenhum lote,
um em cada três no treino (`PR<n>-treino` nos pontos, `PLR<n>-treino` nas placas) e os outros nos
escondidos (`PR<n>-controle`, `PLR<n>-controle`). Ele entra pela página do gabarito como os do
simulador, quando você quiser. Cada item nunca vai para quem trabalhou nele (quem anotou, revisou ou
corrigiu a imagem), então ele serve sobretudo para medir quem chega depois.

## O placar

A central mostra, para cada tarefa, o placar da equipe (um ponto só conta depois de aprovado na
revisão às cegas): aprovados na semana e no total, a taxa de aprovação, o **tempo por imagem** e o
**tempo por revisão**, a concordância nos quadros em dupla, o gabarito e os dias seguidos. Os tempos
são medianas do tempo ativo gravado em cada arquivo — a página só conta enquanto está visível e houve
uso nos últimos 20 segundos. O tempo por imagem é o dos rótulos da própria pessoa, sem os descartes
(levam segundos e não dizem quanto custa anotar) e sem as correções que ela fez revisando, que
contam no tempo por revisão.

## Pasta de trabalho

```text
trabalho/                                   a pasta da equipe, sincronizada com o Drive
  equipe.json, divisao.json, projeto.json     nomes (opcionais), divisão e projeto
  partidas/<partida>/
    manifesto.json, tomadas.json, fila.json
    quadros/<quadro>.jpg                      só os sorteados
    previsoes/pontos/<quadro>.json            pontos de um modelo (anotacao prever --tarefa pontos)
    recortes/<lote>.json, recortes/<recorte>.jpg   os recortes das placas (<recorte> = <quadro>_<placa>)
    previsoes/placas/<recorte>.png            pré-pintura de um modelo (anotacao prever --tarefa placas)
    rotulos/pontos/<quadro>__<código>__v<n>.json
    rotulos/placas/<recorte>__<código>__v<n>.json + .png     o rótulo e a máscara ao lado
    revisoes/pontos/…, revisoes/placas/…
  gabarito/itens/, gabarito/rotulos/          nunca entram no treino
  pessoas/<código>/<navegador>.json           em que computadores cada código é usado
  conjuntos/<data-hora>/                      saída do unificar
```

Um arquivo por pessoa e por versão: ninguém edita o arquivo de outra pessoa, então o Drive nunca
entra em conflito. A escrita é atômica e nenhum rótulo ou revisão existente é sobrescrito. Os
formatos estão em [docs/formatos.md](docs/formatos.md), com os JSON Schemas em `web/esquemas/`. Os
arquivos das versões anteriores (câmera, oclusão e pacotes de estádio, até a 0.7; os jogadores, da
0.8; as pessoas, da 0.9) ficam onde estão e não entram em nada; as partidas importadas antes
continuam valendo.

## Para quem coordena e treina (Python)

```bash
python -m venv .venv && source .venv/bin/activate     # no Windows: .venv\Scripts\activate
pip install -e .

anotacao exemplo trabalho                   # pasta de exemplo, com os nomes de A01 e A02
anotacao recortes LOTE.json --pasta P       # traz um lote de recortes das placas (com os .jpg ao lado)
anotacao gabarito ORIGEM --pasta P          # importa itens do gabarito (<id>.json + JPEG; nas placas, + PNG)
anotacao prever --tarefa pontos --pasta P --previsor pacote.modulo:objeto      # pontos de um modelo
anotacao prever --tarefa placas --pasta P --previsor pacote.modulo:objeto      # pré-pintura das placas
anotacao validar --pasta P                  # confere todos os arquivos
anotacao unificar --pasta P                 # gera os conjuntos de treino
anotacao ouro --pasta P                     # um lote de ouro com os itens aprovados (gabarito arbitrado)
anotacao esquemas DESTINO                   # exporta os JSON Schemas
```

Com o laboratório ao lado: `scripts/lotes_de_ouro.py --laboratorio ../placas-exposicao --saida lotes`
gera os lotes de ouro (um .zip por lote, `indice-pontos.csv`, `indice-placas.csv`, `lotes.json` e
um mosaico de cada lote com a resposta por cima) e, com `--demonstracao`, uma partida sintética com
recortes das placas para experimentar a página numa pasta de teste (nunca na da equipe);
`scripts/conferir_regras.py` passa anotadores simulados por esses lotes, com as regras da página; e
`scripts/video_demo_do_laboratorio.py` monta um vídeo MP4 de demonstração a partir de uma
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
WebCodecs funcionam como no site publicado. O campo (nomes e lugares dos pontos, simetria de 180°)
existe em Python e em JavaScript e é testado contra o laboratório; a leitura do vídeo e os cortes são
testados contra a implementação de referência da v0.1. Detalhes em [CONTRIBUTING.md](CONTRIBUTING.md),
arquitetura em [docs/arquitetura.md](docs/arquitetura.md) e decisões em [docs/adr/](docs/adr/).

## Próximos passos

- Os recortes das placas do vídeo real: a câmera de cada quadro pelos pontos aprovados e o cadastro
  das placas do estádio dão a projeção de cada placa, e dela o lote de recortes (`origem: "modelo"`).
- Previsor com o detector do laboratório (`anotacao prever --previsor pacote.modulo:objeto`): os
  pontos já marcados e a oclusão das placas como pré-pintura, para quem anota só corrigir.
- Gabarito arbitrado mais exigente: só os itens em que as duas pessoas da dupla às cegas concordam,
  e uma terceira que decide quando divergem.
- Baixar o vídeo pela própria página (depende de onde os vídeos vêm).

## Dados e privacidade

O código é público; os dados não. Vídeos, quadros e rótulos nunca vão para o Git nem para o site:
ficam no computador de cada pessoa e na pasta da equipe no Drive, compartilhada só com a equipe e sem
links públicos. O acordo de uso das transmissões precisa cobrir essa cópia.

Todos os direitos reservados.
