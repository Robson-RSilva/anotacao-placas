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
- **Imagem:** px do quadro na resolução do vídeo, origem no canto de cima à esquerda — o primeiro
  pixel vai de 0 a 1 (o centro dele é 0,5) —, x para a direita e y para baixo.
- **Tempo:** o ID do quadro é o PTS em milissegundos.
- **Medidas** (erros, tolerâncias, áreas) em px na referência de 960 de largura: px da imagem ×
  960 / largura.

## IDs

| ID | Forma | Exemplo |
| --- | --- | --- |
| partida | `AAAA-MM-DD_<estadio>_<mandante>-<visitante>` | `2026-11-02_arena-x_time-a-time-b` |
| quadro | `t` + PTS em ms com 10 dígitos | `t0001234567` |
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

Rótulo: `partidas/<partida>/rotulos/<tarefa>/<quadro>__<anotador>__v<n>.json` (no gabarito,
`gabarito/rotulos/<tarefa>/<gNNNN>__<anotador>__v<n>.json`). Revisão:
`partidas/<partida>/revisoes/<tarefa>/<quadro>__<revisor>__v<n>.json`. A tarefa é `pontos` ou
`jogadores`. O conteúdo precisa bater com o nome (partida, quadro, pessoa e versão); um arquivo que
não bate conta como inválido.

- `situacao`: `ok` (anotada; sem pontos, ou sem jogador, também é `ok`) ou `descartada`, com
  `motivo_descarte`: `transicao` (fusão, corte no meio), `borrao` (borrada ou fora de foco demais),
  `grafismo` (grafismo da emissora cobre a imagem) ou `outro` (exige `comentario`).
- `partiu_de.fonte`: `nenhuma`, `modelo` (a previsão da pasta), `rotulo_anterior` (a versão devolvida
  na revisão, que volta para a mesma pessoa como versão nova) ou `rotulo_revisado` (a correção feita
  na revisão, com `corrige` apontando o rótulo corrigido).
- `largura` e `altura`: o tamanho da imagem anotada, em px.
- `ferramenta` e `manual`: as versões da ferramenta e do Manual de anotação da tarefa
  (`pontos-0.1`, `jogadores-0.1`; as revisões, `revisao-0.2`).
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
  "ferramenta": "0.8.0",
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
- Ponto coberto (um jogador na frente) só se marca quando dá para saber exatamente onde ele está.

`revisao.pontos/1` — os motivos de devolver: `ponto_fora_do_lugar` (mais de 2 px), `nome_trocado`,
`faltou_ponto`, `ponto_que_nao_se_ve`, `descarte_errado` ou `outro`.

## `rotulo.jogadores/1` — a máscara dos jogadores

O rótulo, com a máscara `<quadro>__<anotador>__v<n>.png` ao lado (o mesmo nome, com .png):

```json
{
  "formato": "rotulo.jogadores/1",
  "partida": "2026-11-02_arena-x_time-a-time-b",
  "quadro": "t0001234567",
  "anotador": "A03",
  "versao": 1,
  "ferramenta": "0.8.0",
  "manual": "jogadores-0.1",
  "criado_em": "2026-11-03T14:12:40Z",
  "segundos_ativos": 95.0,
  "largura": 1280,
  "altura": 720,
  "partiu_de": {"fonte": "nenhuma", "versao": null, "referencia": null},
  "situacao": "ok",
  "motivo_descarte": null,
  "comentario": "",
  "corrige": null,
  "mascara": "t0001234567__A03__v1.png",
  "pixels": 18342
}
```

- **A máscara** é um PNG de 8 bits com paleta, do tamanho da imagem: 1 onde há jogador (goleiros
  também), 0 no resto — árbitros, gandulas, fotógrafos, comissão técnica, torcida e sombras ficam
  em 0. Sem nenhum jogador, a máscara é toda 0 (`pixels: 0`). `pixels` é quantos pixels valem 1, e
  o `validar` confere com a máscara.
- Imagem descartada não leva máscara (`mascara: null`, `pixels: 0`). O rótulo é gravado depois da
  máscara; um rótulo cuja máscara ainda não chegou pelo Drive fica esperando nas páginas, e o
  `validar` e o `unificar` o apontam.

`revisao.jogadores/1` — os motivos de devolver: `faltou_jogador`, `contorno_impreciso` (mais de
1 px), `pintou_quem_nao_e_jogador`, `descarte_errado` ou `outro`.

## Por partida

| Arquivo | Formato | O que tem |
| --- | --- | --- |
| `manifesto.json` | `manifesto.partida/1` | cadastro (estádio, emissora, competição, data e hora com fuso, mandante, visitante, iluminação, chuva), vídeo (nome, sha256 do arquivo inteiro, duração, fps, resolução, quadros) e parâmetros da importação (sorteio, origem do PTS, codec, decodificador, cortes, quadros perdidos, quadros sem chave no início, quadros não extraídos, amostras além do fim de um arquivo cortado e, quando a importação foi só de uns trechos, `trechos` em segundos — `"300-3000;3900-6600"` — e `quadros_nos_trechos`). Gravado por último: a partida só existe quando o manifesto existe — e um manifesto vazio (escrita interrompida) não conta. `pacote` e `cadastro.pacote_versao` são das versões até a 0.7 e são ignorados. |
| `tomadas.json` | `tomadas.partida/1` | cortes, transições e tomadas (índices, PTS, zoom e grupo aproximados — só para o sorteio). `replay` fica `null`: replays são conferidos na solução assistida. Com trechos, o começo e o fim de cada trecho também são cortes, e os quadros de fora não são sorteados. |
| `fila.json` | `fila.partida/1` | quadros sorteados e as marcas de dupla às cegas e de "sem previsão". A fila é aberta (`equipe` e `atribuido_a` vazios) e vale para as duas tarefas: em cada uma, um quadro precisa de um rótulo, ou de duas pessoas diferentes na dupla. |
| `quadros/<quadro>.jpg` | JPEG | os quadros sorteados, na resolução original do vídeo. |
| `previsoes/pontos/<quadro>.json` | `previsao.pontos/1` | os pontos de um modelo (`fonte`, `versao` e a lista de pontos, como no rótulo), gravados por `anotacao prever --tarefa pontos` (nunca nos quadros "sem previsão"). A página começa com eles. |
| `previsoes/jogadores/<quadro>.png` | PNG de 8 bits | a pré-pintura de um modelo (diferente de 0: jogador), gravada por `anotacao prever --tarefa jogadores`. A página começa com ela. |
| `importando.json` | — | só durante a importação: quem está importando a partida (some no fim; não vai para o .zip). Uma marca sem renovação há 10 minutos é de uma importação que parou. |

## Da pasta

| Arquivo | Formato | O que tem |
| --- | --- | --- |
| `equipe.json` | `equipe/1` | opcional: o nome de cada código, para o placar e as sugestões da página central (os `papeis` ficam por compatibilidade; ninguém precisa estar aqui para anotar ou revisar). |
| `pessoas/<codigo>/<dispositivo>.json` | `pessoa.dispositivo/1` | que o código é usado num navegador (um identificador aleatório, guardado nele) e desde quando; um arquivo por computador, gravado uma vez. A página avisa quando o código digitado já é usado em outro computador. |
| `projeto.json` | `projeto/1` | opcional: nome do projeto e link (https) do Manual de anotação, mostrados nas páginas. |
| `divisao.json` | `divisao/1` | partidas de validação, teste congelado e teste externo; o resto é treino. |
| `gabarito/itens/<id>.json` + `.jpg` | `gabarito.pontos/1` | um item dos pontos (abaixo). |
| `gabarito/itens/<id>.json` + `.jpg` + `.png` | `gabarito.jogadores/1` | um item dos jogadores (abaixo). O formato dentro do arquivo diz a tarefa do item. |

## O gabarito

Itens com a resposta verdadeira — do simulador (`origem: "simulador"`, os lotes de ouro) ou de
rótulos reais já arbitrados (`"arbitrado"`). `lote` diz de que lote o item veio: o teste de quem
começa usa primeiro os lotes com "treino" no nome, e os itens escondidos na fila, primeiro os outros.
Os rótulos do gabarito ficam em `gabarito/rotulos/<tarefa>/` e nunca entram no treino.

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
pontos. Libera com 8 certos dos últimos 10.

### `gabarito.jogadores/1`

```json
{
  "formato": "gabarito.jogadores/1",
  "id": "g2001",
  "lote": "J1-treino",
  "imagem": "g2001.jpg",
  "mascara": "g2001.png",
  "largura": 1280,
  "altura": 720,
  "jogadores": 5,
  "outras_pessoas": 1,
  "origem": "simulador",
  "observacao": "simulador do laboratório, domínio A, semente 84031"
}
```

A máscara verdadeira (`mascara`, o PNG ao lado) tem um número por pessoa: os jogadores de 1 a
`jogadores` (N), as outras pessoas (árbitro, gandula, fotógrafo…) de 255 para baixo (255, 254… —
`outras_pessoas` delas) e 0 no resto. A importação confere que não há outro número.

A pintura dá **certo** quando, sem contar a borda de 1 px dos jogadores (os pixels com um vizinho do
outro lado do contorno), cada jogador está pintado em pelo menos metade da área, nenhuma outra pessoa
está pintada em 25% ou mais e a sobreposição com a resposta (IoU) é de pelo menos 80%. Jogador com
menos de 30 px de área (ref. 960) não precisa ser pintado. Libera com 4 certos dos últimos 5.

Descartar um item do gabarito conta como erro: todo item tem resposta (uma imagem sem pontos ou sem
jogador se salva vazia).

## Saída do unificar

Em `conjuntos/<data-hora>/`, só os rótulos aprovados na revisão (ou a correção de quem revisou); num
quadro em dupla, o aprovado primeiro. Imagens descartadas ficam de fora; imagem sem pontos ou sem
jogador entra.

- `pontos.parquet` — um quadro por linha: conjunto (`treino`, `validacao`, `teste_congelado`,
  `teste_externo`), partida, quadro, caminho da imagem, largura, altura, PTS, tomada, `n_pontos`,
  anotador, versão, revisor, decisão, versões do manual e da ferramenta e as condições do jogo
  (estádio, emissora, competição, data e hora, iluminação, chuva).
- `pontos_lista.parquet` — um ponto por linha: conjunto, partida, quadro, `ponto`, `x`, `y` (px da
  imagem).
- `jogadores.parquet` — um quadro por linha: os mesmos dados do quadro, o caminho da máscara e
  `pixels` (quantos valem 1).
- `manifesto.json` (`conjuntos/3`) — por tarefa, os quadros, as contagens por conjunto, quantos sem
  pontos ou sem jogador e o hash do conteúdo; os descartes por tarefa e motivo; as partidas de cada
  conjunto e a divisão usada.
- `problemas.json` — os arquivos inválidos e os quadros ainda sem rótulo aprovado em cada tarefa.

## Das versões até a 0.7

`rotulo.camera/1`, `revisao.camera/1`, `gabarito.camera/1`, `rotulo.oclusao/1`,
`revisao.oclusao/1`, `gabarito.oclusao/1`, `previsao.camera/1` e `pacote.estadio/1` (com a pasta
`estadios/`) ficam onde estão, mas nenhuma página nem o `unificar` os lê, e os .zip não os levam
(ADR-0010).
