# Anotação de dados para treino

Páginas locais de anotação que geram os dados de **treino e teste** do detector de marcações do
projeto de exposição de placas. Só entra aqui o que treina modelo:

| Página | O que grava | Para o treino |
| --- | --- | --- |
| Central | cadastro da partida (estádio, emissora, competição, data e hora, iluminação, chuva) | separar treino e teste por jogo e equilibrar a amostra |
| Câmera do quadro | a câmera que faz o molde do campo coincidir com as marcações | alvos de pontos-chave e linhas do detector |
| Revisão cruzada | aprovar, corrigir ou devolver o rótulo de outra pessoa, às cegas | só entra no treino o que foi aprovado |
| Oclusão nas placas (0.2) | máscara por classe dentro de cada placa | alvo da máscara de pessoas do detector |

Cortes, replays, grafismos, lado do estádio e artes das placas são resolvidos por regras e pelo
cadastro do estádio, sem treino, e são conferidos na **solução assistida** — outro projeto, com
ferramenta e documento próprios (ver [ADR-0003](docs/adr/0003-anotacao-separada-da-solucao-assistida.md)).

## Começar

Precisa de Python 3.11 ou mais novo.

```bash
python -m venv .venv
source .venv/bin/activate            # no Windows: .venv\Scripts\activate
pip install -e .

anotacao exemplo trabalho            # pasta de exemplo: estádio sintético e equipe A01/A02
anotacao abrir --pasta trabalho      # abre http://127.0.0.1:8765 no navegador
```

No uso real, `trabalho` é a pasta compartilhada no Google Drive (sincronizada pelo Google Drive
para computador). Cada pessoa roda a ferramenta na própria máquina apontando para essa pasta:

```bash
anotacao abrir --pasta "G:/Meu Drive/anotacao/trabalho" --manual "<link do Manual de anotação>"
```

Os vídeos enviados pela página central ficam na máquina (por padrão em `~/.local/share/anotacao/videos`;
mude com `--videos`), nunca na pasta sincronizada. A cópia de segurança do vídeo bruto vai uma vez
para uma pasta própria no Drive.

## O fluxo

1. **Equipe e estádio.** `equipe.json` lista quem anota e quem revisa; o pacote do estádio
   (`estadios/<estadio>/pacote-<versão>/pacote.json`) traz as medidas do campo, as placas e a posição
   das câmeras.
2. **Importar a partida** na página central. O vídeo é processado nesta máquina: hash, relógio de cada
   quadro (PTS), cortes e replays (regras do laboratório, só para organizar o sorteio), agrupamento
   das tomadas, sorteio de 1 ou 2 quadros por tomada e distribuição na equipe. Só os quadros sorteados
   vão para a pasta.
3. **Anotar a câmera.** O molde do campo abre pela melhor câmera disponível (previsão do modelo, um
   quadro já anotado da mesma tomada ou o registro do estádio). Arrastar um ponto move o molde
   inteiro, porque o que se ajusta por trás é a câmera; cada ponto solto fica travado. Linhas longas
   também se arrastam. As placas aparecem com o nome, para conferir o lado.
4. **Revisão cruzada.** Cada rótulo vai para outra pessoa, sem o nome de quem anotou: aprovar,
   corrigir (vira versão nova, com a autoria de quem revisou) ou devolver com um motivo da lista.
5. **Unificar.** `anotacao unificar` (ou o botão da página central) lê tudo, valida de novo e gera
   `conjuntos/<data-hora>/camera.parquet` com manifesto, respeitando `divisao.json`: quadros de uma
   partida nunca se misturam entre treino e teste.

Quem começa é treinado e liberado pelo **gabarito** (quadros com a câmera exata, do simulador ou de
rótulos arbitrados): a mediana dos últimos 10 itens precisa ficar em até 2 px. Depois, a cada 15
rótulos, um item do gabarito entra escondido na fila. Em ~10% dos quadros duas pessoas anotam do
zero, às cegas, para medir a concordância; em outros ~10% a página começa sem previsão, para medir o
viés de ancoragem.

## Pasta de trabalho

```text
trabalho/                                   sincronizada com o Drive
  equipe.json, divisao.json
  estadios/<estadio>/pacote-<versão>/pacote.json
  emissoras/<emissora>/vinheta.png            opcional: detecta replays dessa emissora
  partidas/<partida>/
    manifesto.json, tomadas.json, fila.json
    quadros/<quadro>.jpg                      só os sorteados
    previsoes/<quadro>.json                   quando há previsor
    rotulos/camera/<quadro>__<anotador>__v<n>.json
    revisoes/camera/<quadro>__<revisor>__v<n>.json
  gabarito/itens/, gabarito/rotulos/          nunca entram no treino
  conjuntos/<data-hora>/                      saída do unificar
  metricas/                                   cache do placar; pode ser apagado
```

Um arquivo por pessoa e por versão: ninguém edita o arquivo de outra pessoa, então o Drive nunca
entra em conflito. A escrita é atômica e nenhum arquivo existente é sobrescrito. Os formatos estão
em [docs/formatos.md](docs/formatos.md), com os JSON Schemas em `src/anotacao/esquemas/`.

## Linha de comando

```text
anotacao exemplo DESTINO                 cria uma pasta de trabalho de exemplo
anotacao abrir --pasta P                 abre a página central (só em 127.0.0.1)
anotacao importar VIDEO --pasta P ...    importa sem passar pelo navegador
anotacao gabarito ORIGEM --pasta P       importa itens do gabarito
anotacao validar --pasta P               confere todos os arquivos
anotacao unificar --pasta P              gera os conjuntos de treino
anotacao esquemas DESTINO                exporta os JSON Schemas
```

Para experimentar com dados do laboratório: `scripts/gabarito_do_laboratorio.py` gera itens do
gabarito com o simulador, e `scripts/video_demo_do_laboratorio.py` monta um vídeo de demonstração a
partir de uma transmissão sintética.

## Desenvolvimento

```bash
pip install -e ".[dev]"
ruff check . && ruff format --check .
pytest                                    # Python
node --test tests/js/*.test.js            # JavaScript das páginas (Node 20+)

pip install -e ".[e2e]" && playwright install chromium
pytest -m e2e                             # ponta a ponta no navegador
```

O modelo de câmera e o molde do campo existem em Python e em JavaScript e são testados contra o
laboratório (`tests/fixtures/camera_laboratorio.json`, gerado por
`scripts/fixture_do_laboratorio.py`). Detalhes em [CONTRIBUTING.md](CONTRIBUTING.md), arquitetura
em [docs/arquitetura.md](docs/arquitetura.md) e decisões em [docs/adr/](docs/adr/).

## Próximos passos

- 0.2 — página de oclusão nas placas (máscara por classe, a fração livre calculada dela).
- Previsor com o detector do laboratório (`--previsor pacote.modulo:objeto`, ver `previsores.py`).
- Indicador ao vivo da distância entre o molde e as linhas que a rede encontrou.

## Dados e privacidade

O servidor só atende a própria máquina (127.0.0.1) e recusa pedidos de outros sites. Vídeos, quadros
e rótulos nunca vão para o Git: ficam na pasta da equipe no Drive, compartilhada só com a equipe e
sem links públicos. O acordo de uso das transmissões precisa cobrir essa cópia.

Uso interno; todos os direitos reservados.
