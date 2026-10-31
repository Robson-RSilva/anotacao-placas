# Formatos dos arquivos

Todo arquivo diz o próprio formato e versão no campo `formato`. Os modelos estão em
`src/anotacao/formatos.py`; os JSON Schemas gerados deles ficam em `web/esquemas/`, e as páginas
validam por eles (mais as regras entre campos, em `web/js/nucleo/formatos.js`) antes de gravar.
`python scripts/gerar_arquivos_web.py` atualiza os esquemas, e um teste falha se ficarem
desatualizados.

Convenções (ADR-0001, em `convencoes.py`):

- **Campo:** origem no centro do gramado, x ao longo do comprimento, y ao longo da largura, z para
  cima, metros. O lado `cab` (das cabines, da câmera principal) é y < 0; `opo`, y > 0; os fundos
  `esq` (x < 0) e `dir` (x > 0), vistos da câmera principal. Os nomes dos pontos seguem esses lados.
- **Imagem:** px do quadro na resolução do vídeo (ou do recorte da placa), origem no canto de cima à
  esquerda — o primeiro pixel vai de 0 a 1 (o centro dele é 0,5) —, x para a direita e y para baixo.
  Um polígono (a região da placa no recorte) contém o pixel cujo centro cai dentro dele (regra
  par-ímpar), a mesma conta nas páginas e no Python.
- **Tempo:** o ID do quadro é o PTS em milissegundos.
- **Medidas** (erros, tolerâncias, áreas) em px na referência de 960 de largura: px da imagem ×
  960 / largura.

## IDs

| ID | Forma | Exemplo |
| --- | --- | --- |
| partida | `AAAA-MM-DD_<estadio>_<mandante>-<visitante>` | `2026-11-02_arena-x_time-a-time-b` |
| quadro | `t` + PTS em ms com 10 dígitos | `t0001234567` |
| recorte | `<quadro>_<placa>`: o quadro e a placa (letras minúsculas, dígitos e hífens) | `t0001234567_opo-05` |
| lote de recortes | letra minúscula + letras minúsculas, dígitos e hífens (até 40) | `r1`, `projecao-2026-11` |
| item do gabarito | `g` + 4 dígitos | `g1001` |
| pessoa | o código que a pessoa digita: letra maiúscula + 1 a 9 letras maiúsculas ou dígitos | `RS`, `A03`, `ANACLARA` |

O PTS é o do contêiner, com a lista de edição aplicada e contado a partir do primeiro quadro exibido
(o mesmo que o FFmpeg e o OpenCV mostram). Extrair de novo o mesmo vídeo dá os mesmos IDs de quadro;
se o contêiner não tem relógio confiável, vale índice / fps e o manifesto registra `pts: "indice"`.

## Os pontos do campo

São os 43 pontos-chave do laboratório menos os quatro que não ficam num cruzamento nem numa marca
(`circ_esq`, `circ_dir`, `ml_esq_topo`, `ml_dir_topo`): 39 que se marcam, na ordem do laboratório.

| Pontos | Onde |
| --- | --- |
| `canto_<esq\|dir>_<cab\|opo>` | os quatro cantos do campo |
| `meio_cab`, `meio_opo` | a linha do meio na lateral |
| `ga_<lado>_fundo_<cab\|opo>`, `ga_<lado>_frente_<cab\|opo>` | a grande área: na linha de fundo e na frente |
| `pa_<lado>_fundo_<cab\|opo>`, `pa_<lado>_frente_<cab\|opo>` | a pequena área, do mesmo jeito |
| `circ_meio_cab`, `circ_meio_opo` | o círculo central na linha do meio |
| `centro`, `penalti_esq`, `penalti_dir` | as marcas |
| `ml_<lado>_cab`, `ml_<lado>_opo` | a meia-lua na frente da grande área |
| `gol_<lado>_pe_<cab\|opo>`, `gol_<lado>_topo_<cab\|opo>` | o pé e o topo de cada trave |

O ponto é o centro do cruzamento das linhas (o meio da faixa branca), o centro da marca ou o eixo
da trave. A rotação de 180° em torno do centro do campo leva cada ponto noutro (`canto_esq_cab` ↔
`canto_dir_opo`, por exemplo): uma marcação feita como se a câmera estivesse do outro lado do campo
desenha o mesmo campo, e o gabarito e a concordância aceitam as duas leituras.

## O que vale nas duas tarefas

Rótulo: `partidas/<partida>/rotulos/<tarefa>/<item>__<anotador>__v<n>.json` (no gabarito,
`gabarito/rotulos/<tarefa>/<gNNNN>__<anotador>__v<n>.json`). Revisão:
`partidas/<partida>/revisoes/<tarefa>/<item>__<revisor>__v<n>.json`. A tarefa é `pontos` (o item é o
quadro, no campo `quadro`) ou `placas` (o item é o recorte da placa, no campo `recorte`). O conteúdo
precisa bater com o nome (partida, item, pessoa e versão); um arquivo que não bate conta como
inválido.

- `situacao`: `ok` (anotada; sem pontos, ou sem nada na frente da placa, também é `ok`) ou
  `descartada`, com `motivo_descarte`. Nos pontos: `transicao` (fusão, corte no meio), `borrao`
  (borrada ou fora de foco demais), `grafismo` (grafismo da emissora cobre a imagem) ou `outro` (exige
  `comentario`). Nas placas: `placa_fora_do_lugar` (o recorte não está na placa: fora do lugar, outra
  coisa), `transicao`, `borrao` ou `outro` — o grafismo da emissora por cima da placa se pinta, não se
  descarta.
- `partiu_de.fonte`: `nenhuma`, `modelo` (a previsão da pasta), `rotulo_anterior` (a versão devolvida
  na revisão, que volta para a mesma pessoa como versão nova) ou `rotulo_revisado` (a correção feita
  na revisão, com `corrige` apontando o rótulo corrigido).
- `largura` e `altura`: o tamanho da imagem anotada, em px.
- `ferramenta` e `manual`: as versões da ferramenta e do Manual de anotação da tarefa
  (`pontos-0.1`, `placas-0.1`; as revisões, `revisao-0.4`).
- `segundos_ativos`: o tempo ativo na imagem (ou na revisão), em segundos — a página só conta enquanto
  está visível e houve uso nos últimos 20 s. Uma correção feita na revisão leva, no rótulo novo e na
  revisão, o tempo da revisão.
- Revisão — `decisao`: `aprovar`, `corrigir` (exige `nova_versao`, o arquivo da correção) ou
  `devolver` (exige `motivo`, da lista da tarefa; `outro` exige comentário).

## `rotulo.pontos/1` — os pontos do campo

```json
{
  "formato": "rotulo.pontos/1",
  "partida": "2026-11-02_arena-x_time-a-time-b",
  "quadro": "t0001234567",
  "anotador": "A03",
  "versao": 1,
  "ferramenta": "0.10.0",
  "manual": "pontos-0.1",
  "criado_em": "2026-11-03T14:05:11Z",
  "segundos_ativos": 41.0,
  "largura": 1280,
  "altura": 720,
  "partiu_de": {"fonte": "nenhuma", "versao": null, "referencia": null},
  "situacao": "ok",
  "motivo_descarte": null,
  "comentario": "",
  "corrige": null,
  "pontos": [
    {"ponto": "ga_dir_frente_cab", "x": 512.3, "y": 288.1},
    {"ponto": "pa_dir_fundo_cab", "x": 861.0, "y": 240.6},
    {"ponto": "penalti_dir", "x": 702.4, "y": 251.9}
  ]
}
```

- `pontos`: os pontos que aparecem, cada um uma vez, em px da imagem (dentro dela: de 0 à largura e
  de 0 à altura). Lista vazia com `situacao: "ok"`: nenhum ponto à vista (um close, a torcida). Imagem
  descartada não leva pontos.
- Ponto coberto (alguém na frente) só se marca quando dá para saber exatamente onde ele está.

`revisao.pontos/1` — os motivos de devolver: `ponto_fora_do_lugar` (mais de 2 px), `nome_trocado`,
`faltou_ponto`, `ponto_que_nao_se_ve`, `descarte_errado` ou `outro`.

## `rotulo.placas/1` — o que está na frente da placa

O rótulo, com a máscara `<recorte>__<anotador>__v<n>.png` ao lado (o mesmo nome, com .png):

```json
{
  "formato": "rotulo.placas/1",
  "partida": "2026-11-02_arena-x_time-a-time-b",
  "recorte": "t0001234567_opo-05",
  "anotador": "A03",
  "versao": 1,
  "ferramenta": "0.10.0",
  "manual": "placas-0.1",
  "criado_em": "2026-11-03T14:12:40Z",
  "segundos_ativos": 38.0,
  "largura": 410,
  "altura": 103,
  "partiu_de": {"fonte": "nenhuma", "versao": null, "referencia": null},
  "situacao": "ok",
  "motivo_descarte": null,
  "comentario": "",
  "corrige": null,
  "mascara": "t0001234567_opo-05__A03__v1.png",
  "pixels": 2214
}
```

- **A máscara** é um PNG de 8 bits com paleta, do tamanho do recorte: 1 onde algo na frente cobre a
  placa, 0 no resto e em tudo fora da região da placa (a página não pinta fora dela). Pinta-se tudo o
  que esconde a placa de quem assiste — gente (jogador, árbitro, gandula, fotógrafo, quem for), bola,
  trave e travessão, outra placa mais perto, câmera, bandeira, o grafismo da emissora —, e não o
  próprio anúncio (mesmo uma pessoa desenhada nele), sombra, reflexo nem o que deixa ver a placa
  através (a rede do gol). Sem nada na frente, a máscara é toda 0 (`pixels: 0`). `pixels` é quantos
  pixels valem 1, e o `validar` confere com a máscara.
- Recorte descartado não leva máscara (`mascara: null`, `pixels: 0`). O rótulo é gravado depois da
  máscara; um rótulo cuja máscara ainda não chegou pelo Drive fica esperando nas páginas, e o
  `validar` e o `unificar` o apontam.

`revisao.placas/1` (com `recorte` no lugar de `quadro`) — os motivos de devolver: `faltou_pintar`
(alguém ou algo na frente da placa ficou sem pintar: a trave e o grafismo também), `contorno_impreciso`
(mais de 1 px), `pintou_o_que_nao_cobre` (o anúncio, uma sombra, a rede), `descarte_errado` ou
`outro`.

## Por partida

| Arquivo | Formato | O que tem |
| --- | --- | --- |
| `manifesto.json` | `manifesto.partida/1` | cadastro (estádio, emissora, competição, data e hora com fuso, mandante, visitante, iluminação, chuva), vídeo (nome, sha256 do arquivo inteiro, duração, fps, resolução, quadros) e parâmetros da importação (sorteio, origem do PTS, codec, decodificador, cortes, quadros perdidos, quadros sem chave no início, quadros não extraídos, amostras além do fim de um arquivo cortado e, quando a importação foi só de uns trechos, `trechos` em segundos — `"300-3000;3900-6600"` — e `quadros_nos_trechos`). Gravado por último: a partida só existe quando o manifesto existe — e um manifesto vazio (escrita interrompida) não conta. `pacote` e `cadastro.pacote_versao` são das versões até a 0.7 e são ignorados. |
| `tomadas.json` | `tomadas.partida/1` | cortes, transições e tomadas (índices, PTS, zoom e grupo aproximados — só para o sorteio). `replay` fica `null`: replays são conferidos na solução assistida. Com trechos, o começo e o fim de cada trecho também são cortes, e os quadros de fora não são sorteados. |
| `fila.json` | `fila.partida/1` | os quadros sorteados para os pontos e as marcas de dupla às cegas e de "sem previsão". A fila é aberta (`equipe` e `atribuido_a` vazios): um quadro precisa de um rótulo, ou de duas pessoas diferentes na dupla. |
| `quadros/<quadro>.jpg` | JPEG | os quadros sorteados, na resolução original do vídeo. |
| `previsoes/pontos/<quadro>.json` | `previsao.pontos/1` | os pontos de um modelo (`fonte`, `versao` e a lista de pontos, como no rótulo), gravados por `anotacao prever --tarefa pontos` (nunca nos quadros "sem previsão"). A página começa com eles. |
| `recortes/<lote>.json` | `recortes.lote/1` | um lote de recortes das placas (abaixo). A fila das placas são os recortes de todos os lotes da partida, com a dupla e o "sem previsão" de cada um. |
| `recortes/<recorte>.jpg` | JPEG | a placa endireitada, com um pouco em volta. |
| `previsoes/placas/<recorte>.png` | PNG de 8 bits | a pré-pintura de um modelo (diferente de 0: algo na frente; só dentro da região da placa), gravada por `anotacao prever --tarefa placas`. A página começa com ela. |
| `importando.json` | — | só durante a importação: quem está importando a partida (some no fim; não vai para o .zip). Uma marca sem renovação há 10 minutos é de uma importação que parou. |

### `recortes.lote/1` — os recortes das placas

O que a pintura das placas recebe, pronto, de fora das páginas: hoje, do simulador do laboratório;
depois, da projeção das placas com a câmera de cada quadro. Cada recorte é uma placa num quadro,
endireitada — o retângulo da placa com 0,6 da altura dela em volta, de cada lado — e é considerado
certo: quem pinta não ajusta o contorno; se ele não está na placa, descarta.

```json
{
  "formato": "recortes.lote/1",
  "partida": "2026-11-02_arena-x_time-a-time-b",
  "lote": "r1",
  "criado_em": "2026-11-03T12:00:00Z",
  "origem": "simulador",
  "gerador": "scripts/lotes_de_ouro.py (anotacao 0.10.0)",
  "itens": [
    {
      "recorte": "t0000235720_opo-12",
      "largura": 410,
      "altura": 103,
      "regiao": [[28.0, 28.0], [382.0, 28.0], [382.0, 75.0], [28.0, 75.0]],
      "placa": [[28.0, 28.0], [382.0, 28.0], [382.0, 75.0], [28.0, 75.0]],
      "no_quadro": [[533.93, 414.86], [886.09, 383.19], [886.01, 428.43], [534.61, 461.58]],
      "dupla": false,
      "sem_previsao": true
    }
  ]
}
```

- `regiao`: o que se pinta — a placa, só a parte dentro do quadro (polígono de 3 a 64 vértices, px do
  recorte). A placa que sai pelo lado do quadro tem a região cortada ali; fora do quadro, o recorte é
  cinza.
- `placa` e `no_quadro`: os quatro cantos da placa (em cima à esquerda, em cima à direita, embaixo à
  direita, embaixo à esquerda) no recorte e no quadro, para levar a máscara de volta ao quadro.
- `origem`: `simulador` ou `modelo`; `gerador`: o que gerou os recortes, com a versão.
- `dupla` e `sem_previsao`: como na fila dos pontos; `montar_lote` (`anotacao.recortes`) sorteia ~10% de
  cada.

Os lotes entram por `anotacao recortes LOTE.json --pasta P` (com os `<recorte>.jpg` ao lado; a
partida precisa estar na pasta) ou por um .zip com `partidas/<partida>/recortes/…` ("Trazer arquivos
de um .zip"). As imagens vão antes e o lote por último; um recorte que já veio em outro lote da
partida é recusado, e nada é sobrescrito.

## Da pasta

| Arquivo | Formato | O que tem |
| --- | --- | --- |
| `equipe.json` | `equipe/1` | opcional: o nome de cada código, para o placar e as sugestões da página central (os `papeis` ficam por compatibilidade; ninguém precisa estar aqui para anotar ou revisar). |
| `pessoas/<codigo>/<dispositivo>.json` | `pessoa.dispositivo/1` | que o código é usado num navegador (um identificador aleatório, guardado nele) e desde quando; um arquivo por computador, gravado uma vez. A página avisa quando o código digitado já é usado em outro computador. |
| `projeto.json` | `projeto/1` | opcional: nome do projeto e link (https) do Manual de anotação, mostrados nas páginas. |
| `divisao.json` | `divisao/1` | partidas de validação, teste congelado e teste externo; o resto é treino. |
| `gabarito/itens/<id>.json` + `.jpg` | `gabarito.pontos/1` | um item dos pontos (abaixo). |
| `gabarito/itens/<id>.json` + `.jpg` (+ `.png`) | `gabarito.placas/1` | um item das placas (abaixo); o recorte para descartar não leva a máscara. O formato dentro do arquivo diz a tarefa do item. |

## O gabarito

Itens com a resposta verdadeira — do simulador (`origem: "simulador"`, os lotes de ouro) ou de
rótulos reais já aprovados na revisão (`"arbitrado"`, os lotes de `anotacao ouro`). `lote` diz de que
lote o item veio: o teste de quem começa usa primeiro os lotes com "treino" no nome, e os itens
escondidos na fila, primeiro os outros. `fora_de` (opcional, vazio por padrão) lista quem não recebe
o item — num item arbitrado, quem anotou, revisou ou corrigiu a imagem de onde ele veio; para essa
pessoa, é como se o item não existisse. Os rótulos do gabarito ficam em `gabarito/rotulos/<tarefa>/` e
nunca entram no treino.

**O gabarito arbitrado** (`anotacao ouro`, ADR-0013): cada item aprovado na revisão (a regra do
`unificar`) e assentado — todo rótulo dele já revisado e, na dupla às cegas, as duas pessoas já
anotaram — vira um item. Nos pontos, os pontos do rótulo aprovado, os rentes à borda (a menos de 3 px,
ref. 960) como opcionais; nas placas, a máscara aprovada com cada pedaço pintado como uma coisa na
frente da placa (de 1 a N, da esquerda para a direita), ou `resposta: "descartar"` quando o recorte
foi descartado (e aprovado) como `placa_fora_do_lugar`. Os outros descartes não viram gabarito. Os ids
vêm de faixas próprias — pontos em g5001 a g5999, placas em g6001 a g6999 — e o registro
`conjuntos/ouro-reais.json` guarda o que já foi para algum lote (`<partida>/<item>` → id) e cada
rodada: uma rodada nova leva só o que é novo, em lotes novos (`PR<n>-treino` e `PR<n>-controle`;
`PLR<n>-treino` e `PLR<n>-controle`), um em cada três itens no treino por um sorteio fixo pelo item.
Não apague o registro: sem ele, os ids recomeçam e os itens novos colidem com os já importados.

### `gabarito.pontos/1`

```json
{
  "formato": "gabarito.pontos/1",
  "id": "g1001",
  "lote": "P1-treino",
  "imagem": "g1001.jpg",
  "largura": 1280,
  "altura": 720,
  "pontos": [
    {"ponto": "canto_esq_opo", "x": 214.36, "y": 102.77, "visivel": true},
    {"ponto": "ga_esq_fundo_opo", "x": 385.02, "y": 131.58, "visivel": true},
    {"ponto": "pa_esq_fundo_opo", "x": 452.19, "y": 143.4, "visivel": false}
  ],
  "origem": "simulador",
  "observacao": "simulador do laboratório, domínio A, semente 81003"
}
```

`pontos`: cada ponto que cai dentro da imagem. `visivel: false` quando marcar é opcional — algo na
frente (gente, placa, grafismo, ou a trave na frente de um ponto do gramado), rente à borda (a menos
de 3 px, ref. 960) ou num cruzamento de linhas quase paralelas na imagem (menos de 15°).

Um item dá **certo** quando nenhum ponto marcado está errado (com um nome que o item não tem, ou a
mais de 8 px do lugar certo), pelo menos 80% dos pontos visíveis foram marcados e o erro mediano dos
visíveis é de até 2 px (ref. 960). Um ponto opcional marcado não conta no erro, mas também não pode
estar errado. Vale a leitura do mesmo lado do campo ou do outro (a rotação de 180°), a que acha mais
pontos. Libera com 8 certos dos últimos 10 (depois de pelo menos 10 itens).

### `gabarito.placas/1`

```json
{
  "formato": "gabarito.placas/1",
  "id": "g4003",
  "lote": "PL1-treino",
  "imagem": "g4003.jpg",
  "mascara": "g4003.png",
  "largura": 791,
  "altura": 326,
  "regiao": [[89.0, 89.0], [702.0, 89.0], [702.0, 237.0], [89.0, 237.0]],
  "oclusores": 3,
  "resposta": "pintar",
  "origem": "simulador",
  "observacao": "simulador do laboratório, domínio A, semente 91010, placa opo-06"
}
```

O recorte da placa, como num lote de recortes (`regiao`), e a resposta: `pintar`, com a máscara
verdadeira (`mascara`, o PNG ao lado) — um número por coisa na frente da placa, de 1 a `oclusores`
(N), e 0 no resto e fora da região —, ou `descartar` (o recorte não está na placa), sem máscara e com
`oclusores: 0`. A importação confere o tamanho da máscara, que não há outro número e que nada fica
fora da região.

A pintura dá **certo** quando, dentro da região e sem contar a borda de 1 px do que está na frente
(os pixels com um vizinho do outro lado do contorno), cada coisa na frente está pintada em pelo menos
metade da área e a sobreposição com a resposta (IoU) é de pelo menos 80% — o que se pinta a mais (o
anúncio, uma sombra, um contorno largo) derruba a sobreposição. Coisa com menos de 30 px de área (px
do recorte) não precisa ser pintada. Uma placa sem nada na frente dá certo sem nada pintado; um item
`descartar` dá certo só descartado como `placa_fora_do_lugar`. Libera com 4 certos dos últimos 5,
depois de pelo menos 12 itens — o lote de treino inteiro (ADR-0012).

Nas duas tarefas, descartar um item que tem resposta conta como erro: uma imagem sem pontos ou uma
placa sem nada na frente se salva vazia — só o recorte fora do lugar se descarta.

## Saída do unificar

Em `conjuntos/<data-hora>/`, só os rótulos aprovados na revisão (ou a correção de quem revisou); num
item em dupla, o aprovado primeiro. Imagens descartadas ficam de fora; imagem sem pontos ou placa sem
nada na frente entra.

- `pontos.parquet` — um quadro por linha: conjunto (`treino`, `validacao`, `teste_congelado`,
  `teste_externo`), partida, quadro, caminho da imagem, largura, altura, PTS, tomada, `n_pontos`,
  anotador, versão, revisor, decisão, versões do manual e da ferramenta e as condições do jogo
  (estádio, emissora, competição, data e hora, iluminação, chuva).
- `pontos_lista.parquet` — um ponto por linha: conjunto, partida, quadro, `ponto`, `x`, `y` (px da
  imagem).
- `placas.parquet` — um recorte por linha: conjunto, partida, quadro, `recorte`, `placa`, `lote`, o
  caminho da imagem, largura, altura, `regiao`, `placa_no_recorte` e `placa_no_quadro` (em JSON, px),
  o caminho da máscara, `pixels` (quantos valem 1), `pixels_regiao` (quantos a região tem) e
  `cobertura` (a fração da placa coberta), com a autoria e as condições do jogo como nos pontos.
- `manifesto.json` (`conjuntos/5`) — por tarefa, as contagens por conjunto, quantos sem pontos
  (`sem_pontos`) ou sem nada na frente da placa (`sem_nada_na_frente`) e o hash do conteúdo; os
  descartes por tarefa e motivo; as partidas de cada conjunto e a divisão usada.
- `problemas.json` — os arquivos inválidos (lotes de recortes também) e os itens ainda sem rótulo
  aprovado em cada tarefa.

## Das versões anteriores

Até a 0.7: `rotulo.camera/1`, `revisao.camera/1`, `gabarito.camera/1`, `rotulo.oclusao/1`,
`revisao.oclusao/1`, `gabarito.oclusao/1`, `previsao.camera/1` e `pacote.estadio/1` (com a pasta
`estadios/`) (ADR-0010). Da 0.8: `rotulo.jogadores/1`, `revisao.jogadores/1` e `gabarito.jogadores/1`
(com as pastas `rotulos/jogadores`, `revisoes/jogadores` e `previsoes/jogadores`), que pintavam só os
jogadores (ADR-0011). Da 0.9: `rotulo.pessoas/1`, `revisao.pessoas/1` e `gabarito.pessoas/1` (com as
pastas `rotulos/pessoas`, `revisoes/pessoas` e `previsoes/pessoas`), que pintavam todas as pessoas no
quadro inteiro (ADR-0012). Ficam onde estão, mas nenhuma página nem o `unificar` os lê, e os .zip não
os levam.
