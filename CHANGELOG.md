# Changelog

Formato de [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões em
[SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.8.0] - 2026-10-30

Marcar e pintar direto na imagem: sai o molde do campo que se esticava e arrastava (a câmera do
quadro) e sai a oclusão nas placas; entram os pontos do campo, clicados um a um com o mapa do campo,
e a pintura de todos os jogadores da imagem. Mais: descartar imagem, a página do gabarito e a revisão
com passo a passo (ADR-0010).

### Adicionado

- Página "Pontos do campo" (`#/pontos`): a imagem sem nada por cima e, ao lado, o mapa do campo com
  os 39 pontos que se marcam. Escolher o ponto no mapa e clicar na imagem (ou o contrário), arrastar
  para ajustar, botão direito (ou `Delete`) para apagar, desfazer e refazer, zoom pela roda do mouse
  com a lupa do pixel, girar o mapa de 90 em 90 graus (`R`) e os nomes na imagem (`L`). A mesma
  marcação vista do outro lado do campo (girada 180°) vale.
- Página "Jogadores" (`#/jogadores`): pintar todos os jogadores da imagem, goleiros inclusive (não
  árbitros, gandulas, fotógrafos, comissão técnica, torcida nem a sombra), com pincel, laço (à mão ou
  clique a clique) e borracha; a máscara (1 onde há jogador) vai num PNG ao lado do rótulo.
- Descartar imagem (`D`) nas duas tarefas, com o motivo: transição, borrão, grafismo da emissora ou
  outro (com comentário). O descarte vai para a revisão como qualquer rótulo. Imagem sem nenhum
  ponto, ou sem jogador, é salva vazia (a página confirma) e entra no treino.
- Revisão às cegas de cada tarefa (`#/revisao-pontos`, `#/revisao-jogadores`), com o passo a passo
  "Como revisar", a correção ali mesmo e "Descartar em vez disso".
- Página do gabarito (`#/gabarito`): como funciona o teste, o andamento de cada tarefa com "Fazer o
  teste", os seus resultados item a item (com o motivo de cada erro e "Ver": a sua resposta e a
  certa) e os lotes de ouro da pasta, com "Importar lote de ouro (.zip)". A central troca "Marcar
  pontos" e "Pintar jogadores" por "Fazer o teste" enquanto a pessoa não foi liberada.
- No teste, o resultado na hora: nos pontos, cada ponto no lugar, perto, errado ou que faltou, na
  imagem e no mapa; nos jogadores, o que acertou, o que faltou e o que pintou a mais. "Ver a resposta"
  (`V`) e "Próximo" (`N`).
- Formatos `rotulo.pontos/1`, `revisao.pontos/1`, `gabarito.pontos/1`, `previsao.pontos/1`,
  `rotulo.jogadores/1`, `revisao.jogadores/1` e `gabarito.jogadores/1` (a máscara verdadeira com um
  número por pessoa: os jogadores de 1 a N, as outras pessoas de 255 para baixo).
- Lotes de ouro novos, em `scripts/lotes_de_ouro.py`: P1-treino (g1001–g1030), P2-variado
  (g1101–g1140) e P3-noite (g1201–g1220) nos pontos; J1-treino (g2001–g2012) e J2-variado
  (g2101–g2116) nos jogadores. A resposta sai do renderizador do laboratório (os pontos onde ele os
  desenhou; cada pessoa à vista, separada das outras), e as regras foram conferidas com anotadores
  simulados nesses lotes — `scripts/conferir_regras.py` refaz a conferência com as contas da própria
  página.
- `anotacao unificar`: `pontos.parquet`, `pontos_lista.parquet` (um ponto por linha) e
  `jogadores.parquet`, com o manifesto `conjuntos/3` e os descartes por motivo.
  `anotacao prever --tarefa pontos|jogadores`.

### Mudado

- Os campos de número (quadros a sortear, na importação) viram campos de texto conferidos ao
  processar: no Chrome, um clique perto da borda do campo (nas setinhas) ou a roda do mouse por cima
  mudavam o número sem querer.
- O gabarito, por tarefa. Pontos: um item dá certo sem ponto errado (a mais de 8 px ou com o nome
  trocado), com 80% dos pontos que aparecem marcados e o erro mediano até 2 px (ref. 960); libera com
  8 certos dos últimos 10. Jogadores: com 1 px de tolerância na borda, cada jogador pintado pelo menos
  na metade, ninguém que não é jogador pintado e a sobreposição (IoU) de 80%; libera com 4 dos
  últimos 5. Os itens escondidos continuam a cada 15 rótulos, e quem cai volta para o teste.
- O placar tem uma aba por tarefa, com os descartes, a concordância dos quadros em dupla (a distância
  mediana dos pontos; a sobreposição das máscaras) e os acertos no gabarito.
- O manifesto da partida não leva mais o pacote do estádio (`pacote` fica opcional e é ignorado): as
  partidas importadas antes continuam valendo.
- `tests/fixtures/campo_laboratorio.json` (era `camera_laboratorio.json`) guarda só o campo do
  laboratório, que é o que a ferramenta ainda copia.

### Removido

- O molde do campo arrastável, a câmera do quadro, as medidas do campo, o campo genérico e os
  pacotes de estádio; a oclusão nas placas e a revisão dela; "Criar pasta de exemplo" na central; os
  formatos `rotulo`, `revisao` e `gabarito` `.camera` e `.oclusao`, `pacote.estadio/1` e
  `previsao.camera/1`; `scripts/gabarito_do_laboratorio.py`.
- Os rótulos, as revisões e os itens do gabarito das versões até a 0.7 ficam na pasta, mas não entram
  em nada: nem no placar, nem no `unificar`, nem nos .zip (um .zip com um item antigo do gabarito é
  recusado com o motivo).

## [0.7.0] - 2026-10-24

A segunda tarefa do Manual: pintar o que cobre as placas — com revisão cruzada, gabarito próprio,
lotes de ouro de máscaras e o conjunto da oclusão no `unificar` (ADR-0009).

### Adicionado

- Página "Oclusão nas placas" (`#/oclusao`): os quadros com a câmera aprovada, com o contorno das
  placas desenhado pela câmera, para pintar o que está na frente — pessoa, bola, rede, grafismo,
  objeto e, nas faixas, "não é placa". Pincel e laço (à mão, fechando ao soltar, ou clique a
  clique), só dentro das placas; desfazer e refazer; "Ir às placas"; esconder a pintura, os contornos
  ou mostrar as linhas do campo. A pintura aparece listrada, para se ver mesmo em cima de uma camisa
  da cor da classe. Placa mais baixa que 10 px (ref. 960) fica de fora; "Câmera errada" quando o
  contorno não fecha.
- Faixas de placas no campo genérico: distância da linha, altura, comprimento e vão no meio, as
  laterais juntas e os fundos juntos, ajustados no primeiro quadro da partida e herdados pelos
  seguintes. Com um pacote que tem as placas do levantamento, valem as placas do pacote.
- Revisão da oclusão (`#/revisao-oclusao`), às cegas: aprovar, corrigir (a pintura e as faixas) ou
  devolver com motivo, com "Ir às placas" (`Z`) e `H` para ver a imagem sem a pintura. O devolvido
  volta com a pintura anterior.
- `rotulo.oclusao/1` com a máscara PNG (8 bits, paleta, uma classe por pixel) ao lado, de mesmo nome,
  e o que ela diz de cada placa; `revisao.oclusao/1`; `gabarito.oclusao/1` com as placas exatas e a
  máscara verdadeira. Pré-pintura de um modelo em `previsoes/oclusao/<quadro>.png`, por
  `anotacao prever --tarefa oclusao`.
- Gabarito da oclusão com liberação própria (mediana dos últimos 5 até 5% de cada placa diferente da
  resposta, com 1 px de tolerância na borda), resultado e resposta na hora no treino, e um item
  escondido a cada 15 pinturas.
- Lotes de ouro L5 (oclusão de dia, 20 itens, g0401–g0420) e L6 (à noite, 10 itens, g0501–g0510),
  com a verdade tirada do renderizador do laboratório, em `scripts/lotes_de_ouro.py`.
- Placar da oclusão (botões "Câmera" e "Oclusão") e a coluna "Oclusão" nas partidas: pinturas
  aprovadas dos quadros com a câmera aprovada, e quantos voltaram com "câmera errada".
- `anotacao unificar`: `oclusao.parquet` (um quadro por linha, com a máscara) e
  `oclusao_placas.parquet` (uma placa por linha, com o retângulo para recortar); o manifesto passa a
  `conjuntos/2`, com a seção `oclusao`. `anotacao validar` confere as máscaras e as contas de cada
  pintura; `anotacao gabarito` importa os itens da oclusão com a máscara.

### Corrigido

- Uma leitura da pasta que terminava depois de a pessoa trocar de página mexia na página seguinte (e
  podia mostrar um erro nela): cada página fica agora no seu próprio invólucro.

## [0.6.0] - 2026-10-24

Lotes de ouro prontos e um gabarito que mede o que se faz hoje no campo genérico: esticar o molde
e ajustar a câmera (ADR-0008).

### Adicionado

- `scripts/lotes_de_ouro.py`: os lotes de ouro do gabarito, gerados com o simulador do laboratório
  e prontos para "Trazer arquivos de um .zip" — L1 (treino e liberação, 30 itens), L2 (medidas do
  campo, 20), L3 (controle de dia, 60) e L4 (controle à noite, 30), com faixas de id separadas, um
  filtro de quadro justo e a câmera de cada item conferida pelo modelo do `anotacao`. Sementes
  fixas: o mesmo comando dá os mesmos lotes.
- `campo` no item do gabarito (opcional): as medidas verdadeiras do campo quando não são as do
  pacote. O item abre no molde do pacote (o campo genérico) e só fecha com as medidas certas.

### Corrigido

- Sem placas no molde (o campo genérico), o gabarito e a concordância dos rótulos cegos comparavam
  as marcações de mesmo nome e davam como erro grande a câmera do lado espelhado, que desenha o mesmo
  campo. Agora vale a menor distância entre a câmera e a espelhada dela. Com o pacote de um estádio,
  o lado espelhado continua sendo erro.

## [0.5.0] - 2026-10-24

Cada pessoa no seu computador: quem anota e quem revisa trabalham em computadores diferentes, ligados
pela pasta sincronizada (ou por .zip). Sai o download do YouTube.

### Removido

- `anotacao baixar`, o extra `baixar` e o "Vídeo do YouTube" da importação (ADR-0007 revogada): os
  vídeos voltam a ser importados do computador, como na 0.3.0, com os trechos escolhidos na página.

### Adicionado

- As páginas paradas sem nada a fazer — a revisão sem rótulos, a câmera sem quadros, a central —
  conferem a pasta a cada 15 segundos e quando a pessoa volta para a aba, e mostram o que chegou de
  outro computador sem recarregar. Uma pasta que ainda está sincronizando vira pasta de trabalho
  sozinha quando os arquivos chegam.
- Aviso quando o código digitado já é usado em outro computador (`pessoas/<código>/<navegador>.json`,
  um arquivo por computador): duas pessoas com o mesmo código gravariam os mesmos arquivos e uma não
  revisaria a outra. A mesma pessoa em dois computadores confirma uma vez ("Sou eu, em outro
  computador"). O `anotacao validar` confere esses registros.
- "Trazer a cópia de um .zip" com o armazenamento ainda vazio: quem recebe a pasta de outra pessoa
  começa direto por ela, sem conflitos com uma pasta recém-criada.
- Testes de ponta a ponta com duas pessoas em dois navegadores separados: pela pasta sincronizada (o
  rótulo vai, a devolução volta, o placar fica igual) e por .zip.
- No CI, cada teste do Python que falha vira uma anotação do trabalho.

## [0.4.0] - 2026-10-24

Vídeos do YouTube: baixar o jogo inteiro ou só os trechos que interessam, e importar na página
(ADR-0007).

### Adicionado

- `anotacao baixar LINK [--trechos ...]` (extra `baixar`: yt-dlp, Deno e ffmpeg pelo pip). Baixa só a
  imagem, em MP4 com H.264 até 1080p; com trechos, baixa só eles (cada um do quadro-chave antes do
  início até o fim, sem recodificar) e junta num arquivo só, em ordem. O arquivo guarda a origem no
  comentário do MP4. Opções `--pasta`, `--altura-max` e `--cookies-do-navegador` (quando o YouTube
  pede para confirmar que não é um robô).
- Importar partida → Vídeo do YouTube: a página monta o comando a partir do link e dos trechos, para
  copiar.
- A importação lê a origem do arquivo baixado e registra no manifesto (`origem`, `origem_url`,
  `origem_trechos`); num arquivo que já veio só com uns trechos, outros trechos são recusados antes de
  ler o vídeo, e os mesmos não são aplicados de novo.
- O mesmo leitor de trechos no Python e na página, testado com os mesmos casos.

## [0.3.0] - 2026-10-23

Anotar sem cadastrar equipe nem levantar o estádio antes (ADR-0006), e importar só os trechos do
vídeo que interessam.

### Adicionado

- Campo genérico (`generico/pacote-1.0`): 105 × 68 m, sem placas, com posições típicas de câmera. É o
  molde padrão da importação; a página grava o pacote ao criar a pasta, e a página e o Python o têm
  embutido para pastas mais antigas.
- Medidas do campo na página da câmera: o comprimento e a largura do molde se ajustam em cada quadro
  (as marcações continuam na medida da regra), o que está travado continua no lugar e "Desfazer"
  volta as medidas. O rótulo grava as medidas usadas (`campo`), os próximos quadros da partida abrem
  com as últimas medidas usadas nela, e a revisão e a correção usam as do rótulo.
- Trechos do vídeo na importação (`0:05:00-0:50:00, 1:05:00-1:50:00`; também `a` e `até` entre o
  início e o fim): só eles são decodificados e sorteados, o começo e o fim de cada um viram cortes, e
  o manifesto registra os trechos e quantos quadros caíram neles. Trecho ilegível ou fora do vídeo
  avisa antes de ler o vídeo.
- `unificar`: colunas `campo_comprimento` e `campo_largura`; rótulo cujo pacote não dá para ler fica
  pendente e o pacote aparece nos problemas, em vez de parar tudo.
- Concordância da dupla e acerto no gabarito comparam o que cada rótulo desenha, com as medidas do
  campo que ele usou (no campo genérico, sem placas, pelas marcações).
- ADR-0006.

### Mudado

- Quem anota digita o próprio código no alto da página central (2 a 10 letras e números, começando
  por letra), em vez de escolher numa lista da equipe. `equipe.json` só dá nomes aos códigos.
- Filas abertas: a importação não distribui mais os quadros. Quem chega pega o próximo, cada código
  começando num ponto próprio da fila; um quadro sai da fila com um rótulo, ou com duas pessoas nos
  quadros em dupla às cegas. Filas da 0.2 com quadros atribuídos continuam como foram atribuídas.
- Revisão aberta: qualquer pessoa menos o autor revisa, cada rótulo uma vez. Nos quadros em dupla, a
  revisão só abre depois que as duas pessoas anotaram.
- Importação: o estádio é só um nome (entra no ID da partida); o pacote de um estádio levantado,
  quando a pasta tem algum, aparece como outro molde. Sem gabarito na pasta, todo mundo anota direto
  ("Pode anotar").
- Coordenação é opcional: nomes, link do Manual, divisão, gabarito e pacotes de estádio.

## [0.2.1] - 2026-10-23

Correções de uma revisão independente do código e de testes com vídeos maiores.

### Corrigido

- Câmera e revisão: depois de salvar, se o próximo quadro não abria (imagem ainda sincronizando), o
  editor anterior ficava na tela e salvar de novo gravava a câmera do quadro anterior no próximo — ou
  aprovava um rótulo que ninguém viu. Agora nada fica salvável até o próximo abrir inteiro.
- O rótulo e a revisão saem em nome de quem abriu o item; se a pessoa escolhida muda em outra aba, a
  página recarrega a fila certa em vez de gravar no nome errado.
- Uma partida incompleta (a fila ainda sincronizando) ou com arquivo inválido não trava mais as filas,
  o placar e a importação dos outros: fica de fora e aparece na lista de partidas com o motivo. O
  `anotacao unificar` também a deixa de fora e avisa, e o `anotacao validar` a lista em vez de parar
  com erro.
- Arquivo vazio (escrita interrompida, ou que o Drive ainda está sincronizando) conta como ausente: não
  bloqueia mais reimportar a partida e pode ser regravado.
- Dupla às cegas: quem também anota o quadro não é sorteado para revisar o rótulo do outro (só quando
  não há mais ninguém, e depois de fazer o próprio), e o revisor sorteado não muda quando o outro
  termina; uma correção feita na revisão não tira o quadro da fila da pessoa, nem esconde o rótulo
  dela da revisão, e a concordância compara só os rótulos cegos.
- Revisão: se o rótulo sai da fila enquanto está aberto (outra pessoa revisou), a página passa para o
  próximo em vez de falhar a cada tentativa.
- Os itens escondidos do gabarito contam a partir da liberação: rótulos reais de antes de importar o
  gabarito não viram uma rajada de itens escondidos.
- Importação: o MP4 que marca como quadro-chave um quadro que não é (quadros I de H.264 que não são
  IDR, comuns em gravações de TV) era recusado pelo navegador e a importação parava; agora a leitura
  começa no primeiro quadro-chave aceito e a extração volta até um começo aceito. Quadros que não deu
  para decodificar nunca são sorteados, e um vídeo que não começa num quadro-chave é aceito.
- Importação: vídeo cortado (cópia ou download interrompido) é lido até onde vai, em vez de falhar no
  fim; MP4 fragmentado com o som antes do vídeo sem endereço base agora acha os quadros certos.
- Importação: duas pessoas não importam a mesma partida ao mesmo tempo — uma marca `importando.json`
  na pasta da partida, renovada a cada minuto, segura a segunda (e deixa de valer 10 minutos depois
  de uma importação que parou); antes de gravar, confere de novo se a partida já existe, e nunca
  troca as imagens de uma partida que já existe.
- Trazer um .zip mostra os conflitos: um arquivo com o mesmo nome e outro conteúdo (a mesma pessoa
  anotando o quadro em dois computadores) era contado como "já existia" sem aviso.

### Adicionado

- Tempo que falta na importação, pelo ritmo até ali.
- Testes: vídeo com quadros marcados como chave sem ser, CSP ligada no navegador, MP4 cortado e
  fragmentado com som, filas com partidas incompletas, dupla às cegas e gabarito depois de rótulos
  reais.

## [0.2.0] - 2026-10-23

Tudo roda no navegador de cada pessoa, publicado no GitHub Pages: ninguém precisa instalar nada para
anotar (ADR-0005).

### Adicionado

- Aplicativo de uma página (central, câmera, revisão, importar e coordenação) em `web/`, publicado
  pelo CI no GitHub Pages; funciona sem internet depois da primeira visita.
- Pasta de trabalho escolhida no computador (File System Access API, Chrome e Edge), lembrada entre
  visitas, ou guardada no próprio navegador, com entrada e saída por .zip.
- Importação de partida no navegador: leitor de MP4/MOV (comum e fragmentado; H.264, H.265, VP9 e
  AV1), decodificação com WebCodecs num worker, SHA-256 por partes, os mesmos descritores, cortes,
  agrupamento e sorteio da 0.1, e extração dos quadros sorteados em JPEG.
- Página de coordenação: equipe, projeto (link do Manual), pacotes de estádio, gabarito e divisão por
  partida.
- `projeto.json` (formato `projeto/1`, opcional): nome e link do Manual mostrados nas páginas.
- `anotacao prever`: grava as previsões do modelo para os quadros sorteados (antes era na importação).
- Validação no navegador pelos mesmos JSON Schemas do Python, mais as regras entre campos.
- Testes: lógica das páginas no Node (filas, gabarito, placar, formatos, pasta, .zip, leitor de MP4
  comparado com o ffprobe, descritores e cortes comparados com a 0.1) e ponta a ponta no navegador
  (importar, anotar, revisar e unificar em Python o que a página gravou).

### Mudado

- O Python fica para quem coordena e treina: `exemplo`, `gabarito`, `prever`, `validar`, `unificar`
  e `esquemas`. Os esquemas passam para `web/esquemas/` (`scripts/gerar_arquivos_web.py`).
- A data e a hora da partida guardam o fuso local (antes iam em UTC e uma partida à noite podia ganhar
  o dia seguinte no ID).
- O placar é calculado em cada navegador e não grava mais `metricas/placar.json` (um arquivo escrito
  por várias máquinas dava conflito no Drive).
- O gabarito escondido conta a partir da liberação de verdade, não dos 10 primeiros itens.
- Rótulo ou revisão cujo conteúdo não bate com o nome do arquivo conta como inválido.
- O gabarito só aceita imagens JPEG.
- O revisor de cada rótulo é sorteado pelo SHA-256 do nome do arquivo (antes SHA-1): rótulos da 0.1
  ainda sem revisão podem mudar de revisor.

### Removido

- O servidor local (`anotacao abrir`, FastAPI) e a importação pela linha de comando
  (`anotacao importar`): a importação é feita nas páginas.
- A detecção de replays pela vinheta da emissora (replays são conferidos na solução assistida).

## [0.1.0] - 2026-10-23

### Adicionado

- Servidor local (só 127.0.0.1) e linha de comando `anotacao` (`exemplo`, `abrir`, `importar`,
  `gabarito`, `validar`, `unificar`, `esquemas`).
- Página central: escolha de quem anota, importação de partida com progresso, partidas, placar e
  unificar.
- Pré-processamento local: hash, PTS, cortes e replays (regras do laboratório), agrupamento das
  tomadas, sorteio de 1 ou 2 quadros por tomada, dupla às cegas (~10%), quadros sem previsão (~10%) e
  distribuição na equipe.
- Página de câmera do quadro: molde do campo arrastável com ajuste da câmera no navegador, pontos e
  linhas travados, virar o lado, placas com o nome, situações e tempo ativo.
- Revisão cruzada às cegas: aprovar, corrigir (versão nova do revisor) ou devolver com motivo.
- Gabarito: treino com resultado na hora, liberação (mediana ≤ 2 px nos últimos 10) e itens escondidos
  na fila.
- Placar com cache local; unificar em Parquet com manifesto e divisão por partida.
- Formatos versionados com JSON Schemas; modelo de câmera e molde testados contra o laboratório em
  Python e em JavaScript; teste de ponta a ponta no navegador.
