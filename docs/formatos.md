# Formatos dos arquivos

Todo arquivo diz o próprio formato e versão no campo `formato`. Os modelos estão em
`src/anotacao/formatos.py`; os JSON Schemas gerados deles ficam em `src/anotacao/esquemas/`
(`anotacao esquemas src/anotacao/esquemas` atualiza, e um teste falha se ficarem desatualizados).

Convenções (ADR-0001): mundo com origem no centro do gramado, z para cima, metros; a câmera é
`x ~ K R (X − C)` com distorção radial `k1`; o ID do quadro é o PTS em milissegundos; métricas em
pixels na referência 960 × 540.

## IDs

| ID | Forma | Exemplo |
| --- | --- | --- |
| partida | `AAAA-MM-DD_<estadio>_<mandante>-<visitante>` | `2026-11-02_arena-x_time-a-time-b` |
| quadro | `t` + PTS em ms com 10 dígitos | `t0001234567` |
| item do gabarito | `g` + 4 dígitos | `g0007` |
| pessoa | letra maiúscula + 2 dígitos | `A03` |
| pacote | `<estadio>/pacote-<versão>` | `arena-x/pacote-1.0` |

Extrair de novo o mesmo vídeo dá os mesmos IDs de quadro.

## `rotulo.camera/1` — o rótulo de câmera

`partidas/<partida>/rotulos/camera/<quadro>__<anotador>__v<n>.json`

```json
{
  "formato": "rotulo.camera/1",
  "partida": "2026-11-02_arena-x_time-a-time-b",
  "pacote": "arena-x/pacote-1.0",
  "quadro": "t0001234567",
  "anotador": "A03",
  "versao": 1,
  "ferramenta": "0.1.0",
  "manual": "camera-0.1",
  "criado_em": "2026-11-03T14:05:11Z",
  "segundos_ativos": 41.0,
  "partiu_de": {"fonte": "modelo", "versao": "detector_A@3f9c", "referencia": null},
  "camera": {"hfov_graus": 31.8, "pan": 24.1, "tilt": 12.7, "roll": 0.1, "C": [0.0, -58.0, 18.0], "k1": -0.02},
  "lado": "canonico",
  "pontos_travados": [{"ponto": "ga_dir_frente_cab", "x": 512.3, "y": 288.1}],
  "linhas_travadas": [{"elemento": "lateral_opo", "x": 1210.0, "y": 140.5}],
  "situacao": "ok",
  "comentario": "",
  "residuo_mediano_px": 0.8,
  "corrige": null
}
```

- **A câmera é o rótulo**: pontos-chave e linhas para o treino se recalculam dela, com o molde do
  pacote do estádio. `hfov_graus` é relativo à largura da imagem, então o rótulo não depende da
  resolução em que o quadro foi extraído.
- `pontos_travados` e `linhas_travadas` estão em pixels do quadro original; ficam para auditoria e
  para o `residuo_mediano_px` (distância, em px na referência 960, dos travados até o molde).
- `lado` é calculado da câmera (semiespaço canônico da simetria de 180°, o mesmo do laboratório).
- `situacao`: `ok`, `sem_marcacoes`, `impossivel_transicao`, `impossivel_borrao` ou `duvida`. Só
  `ok` e `duvida` levam câmera; `duvida` exige comentário.
- `partiu_de.fonte`: `modelo`, `quadro_anotado`, `registro`, `rotulo_anterior`, `rotulo_revisado`.
- `corrige`: preenchido quando a versão é a correção feita na revisão cruzada (aponta o rótulo
  corrigido).

## `revisao.camera/1` — a revisão cruzada

`partidas/<partida>/revisoes/camera/<quadro>__<revisor>__v<n>.json`

```json
{
  "formato": "revisao.camera/1",
  "partida": "2026-11-02_arena-x_time-a-time-b",
  "quadro": "t0001234567",
  "rotulo": "t0001234567__A03__v1.json",
  "revisor": "A05",
  "versao": 1,
  "decisao": "devolver",
  "motivo": "lado_trocado",
  "comentario": "",
  "nova_versao": null,
  "ferramenta": "0.1.0",
  "manual": "revisao-0.1",
  "criado_em": "2026-11-03T15:20:00Z",
  "segundos_ativos": 9.0
}
```

`decisao`: `aprovar`, `corrigir` (exige `nova_versao`, o arquivo da correção) ou `devolver` (exige
`motivo`: `lado_trocado`, `molde_fora_da_tolerancia`, `ponto_em_marca_coberta`,
`deveria_ser_sem_marcacoes` ou `outro`, este com comentário).

## Por partida

| Arquivo | Formato | O que tem |
| --- | --- | --- |
| `manifesto.json` | `manifesto.partida/1` | cadastro (estádio, emissora, competição, data e hora, mandante, visitante, iluminação, chuva), vídeo (nome, sha256, duração, fps, resolução, quadros) e parâmetros do pré-processamento. A partida só existe quando o manifesto existe. |
| `tomadas.json` | `tomadas.partida/1` | cortes, transições e tomadas (índices, PTS, replay, zoom e grupo aproximados — só para o sorteio). |
| `fila.json` | `fila.partida/1` | quadros sorteados, a quem cada um foi atribuído, e as marcas de dupla às cegas e de "sem previsão". |
| `previsoes/<quadro>.json` | `previsao.camera/1` | câmera prevista e confiança, quando há previsor. |

## Da pasta

| Arquivo | Formato | O que tem |
| --- | --- | --- |
| `equipe.json` | `equipe/1` | código, nome e papéis (`anotador`, `revisor`) de cada pessoa. |
| `divisao.json` | `divisao/1` | partidas de validação, teste congelado e teste externo; o resto é treino. |
| `estadios/<estadio>/pacote-<v>/pacote.json` | `pacote.estadio/1` | medidas do campo, placas (vértices BL, BR, TR, TL vistos de frente; tipo; lado; patrocinador) e câmeras do registro (posição do tripé). |
| `gabarito/itens/<id>.json` | `gabarito.camera/1` | imagem, tamanho, pacote e a câmera verdadeira; origem `simulador` ou `arbitrado`. |

## Saída do unificar

`conjuntos/<data-hora>/camera.parquet` — um quadro por linha: conjunto (`treino`, `validacao`,
`teste_congelado`, `teste_externo`), partida, quadro, caminho da imagem, resolução, PTS, tomada,
câmera (`hfov_graus`, `pan`, `tilt`, `roll`, `Cx`, `Cy`, `Cz`, `k1`), lado, resíduo, anotador,
versão, revisor, decisão, versões do manual e da ferramenta, pacote e as condições do jogo.
`manifesto.json` traz as contagens por conjunto e o hash do conteúdo; `problemas.json`, os arquivos
inválidos e os quadros ainda sem rótulo aprovado.
