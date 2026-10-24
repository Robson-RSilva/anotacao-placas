# ADR-0007 — Baixar do YouTube por um comando no computador, não pela página

**Situação:** revogada (24/10/2026), no mesmo dia: o download saiu na 0.5.0 e os vídeos voltaram a ser
importados do computador, como antes. Fica o registro de por que a página não baixa do YouTube.

## Contexto

Os vídeos das partidas vêm de links do YouTube, e baixar o jogo inteiro para importar só uns trechos
toma tempo e disco. A ideia era baixar pela própria página. Uma página não consegue: o navegador não
deixa um site ler o vídeo de outro (os servidores de vídeo do YouTube não liberam isso para outras
origens), o YouTube exige resolver desafios em JavaScript a cada vídeo, e a política de segurança da
nossa página (`connect-src 'self'`) não deixa ela falar com outro endereço — de propósito, para nenhum
dado sair dela.

## Decisão

- `anotacao baixar LINK [--trechos ...]`, no Python, com o extra `baixar`: o yt-dlp (com os scripts
  dos desafios), o Deno que roda esses scripts e um ffmpeg, todos pelo pip.
- Só a imagem, em MP4 com H.264 até 1080p (AV1 quando não houver): o que o Chrome e o Edge
  decodificam, de preferência pela placa de vídeo.
- Com trechos, cada um é baixado pelo ffmpeg do quadro-chave antes do início até o fim, sem
  recodificar, começando com tempo zero; os pedaços se juntam com a duração exibida de cada um
  (medida pelos pacotes), para os tempos seguirem em ordem mesmo quando o corte do fim deixa de fora
  quadros B.
- O arquivo guarda a origem no comentário do MP4 (`anotacao/1 {json}`). A página registra a origem no
  manifesto e recusa trechos diferentes dos que o arquivo já tem.
- A página monta o comando a partir do link e dos trechos, para copiar e rodar num terminal.

## Consequências

Quem importa precisa do Python uma vez; quem só anota, não. Os trechos chegam com alguns segundos
a mais no começo (o quadro-chave) e, no fim, podem ficar sem os últimos quadros B — nada que o sorteio
use, porque o começo e o fim de cada trecho são cortes. O caminho do YouTube em si (extrator e
desafios) é do yt-dlp e muda com frequência: os testes rodam sem internet, com um servidor local, e
atualizar o yt-dlp é a correção usual quando o YouTube muda.
