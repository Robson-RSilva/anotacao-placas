# Anotação de dados para treino

Páginas de anotação que geram os dados de **treino e teste** do detector de marcações do projeto de
exposição de placas. Rodam inteiras no navegador, publicadas no GitHub Pages, e gravam na pasta de
trabalho de cada pessoa. Só entra aqui o que treina modelo:

| Página | O que grava | Para o treino |
| --- | --- | --- |
| Central e importação | cadastro da partida (estádio, emissora, competição, data e hora, iluminação, chuva) e os quadros sorteados | separar treino e teste por jogo e equilibrar a amostra |
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
3. Escolha o seu código em **Você é** e comece a anotar.

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

1. **Equipe e estádio** (página Coordenação). A equipe diz quem anota e quem revisa; o pacote do
   estádio traz as medidas do campo, as placas e a posição das câmeras. Para experimentar, a página
   central cria uma pasta de exemplo (estádio sintético, equipe A01 e A02).
2. **Importar a partida.** O vídeo (MP4 ou MOV em H.264, H.265, VP9 ou AV1) é lido no navegador com o
   decodificador do próprio navegador (WebCodecs): hash, relógio de cada quadro (PTS), cortes e
   transições (regras do laboratório, só para organizar o sorteio), agrupamento das tomadas, sorteio de
   1 ou 2 quadros por tomada e distribuição na equipe. Só os quadros sorteados vão para a pasta, em
   JPEG. MKV e TS: converta antes para MP4 (no OBS, Arquivo → Remuxar gravações). A leitura passa
   por todos os quadros e leva tempo: num teste com 2 núcleos e sem decodificação pela placa de vídeo,
   2 minutos de vídeo em 1080p levaram 1 minuto. Deixe a aba aberta até terminar; dá para voltar à
   central enquanto isso.
3. **Anotar a câmera.** O molde do campo abre pela melhor câmera disponível (versão devolvida,
   previsão do modelo, um quadro já anotado da mesma tomada ou o registro do estádio). Arrastar um
   ponto move o molde inteiro, porque o que se ajusta por trás é a câmera; cada ponto solto fica
   travado. Linhas longas também se arrastam. As placas aparecem com o nome, para conferir o lado.
4. **Revisão cruzada.** Cada rótulo vai para outra pessoa, sem o nome de quem anotou: aprovar,
   corrigir (vira versão nova, com a autoria de quem revisou) ou devolver com um motivo da lista.
5. **Unificar** (Python, por quem treina). `anotacao unificar` lê tudo, valida de novo e gera
   `conjuntos/<data-hora>/camera.parquet` com manifesto, respeitando a divisão por partida: quadros de
   um jogo nunca se misturam entre treino e teste.

Quem começa é treinado e liberado pelo **gabarito** (quadros com a câmera exata, do simulador ou de
rótulos arbitrados): a mediana dos últimos 10 itens precisa ficar em até 2 px. Depois, a cada 15
rótulos, um item do gabarito entra escondido na fila. Em ~10% dos quadros duas pessoas anotam do
zero, às cegas, para medir a concordância; em outros ~10% a página começa sem previsão, para medir o
viés de ancoragem.

## Pasta de trabalho

```text
trabalho/                                   a pasta da equipe, sincronizada com o Drive
  equipe.json, divisao.json, projeto.json
  estadios/<estadio>/pacote-<versão>/pacote.json
  partidas/<partida>/
    manifesto.json, tomadas.json, fila.json
    quadros/<quadro>.jpg                      só os sorteados
    previsoes/<quadro>.json                   quando há previsor (anotacao prever)
    rotulos/camera/<quadro>__<anotador>__v<n>.json
    revisoes/camera/<quadro>__<revisor>__v<n>.json
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

anotacao exemplo trabalho                   # pasta de exemplo: estádio sintético e equipe A01/A02
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

- Página de oclusão nas placas (máscara por classe, a fração livre calculada dela).
- Previsor com o detector do laboratório (`anotacao prever --previsor pacote.modulo:objeto`).
- Indicador ao vivo da distância entre o molde e as linhas que a rede encontrou.

## Dados e privacidade

O código é público; os dados não. Vídeos, quadros e rótulos nunca vão para o Git nem para o site:
ficam no computador de cada pessoa e na pasta da equipe no Drive, compartilhada só com a equipe e sem
links públicos. O acordo de uso das transmissões precisa cobrir essa cópia.

Todos os direitos reservados.
