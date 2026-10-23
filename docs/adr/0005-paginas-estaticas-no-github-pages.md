# ADR-0005 — Páginas estáticas no GitHub Pages; o trabalho roda no navegador de cada pessoa

**Situação:** aceita (23/10/2026). Substitui a [ADR-0004](0004-servidor-local.md).

## Contexto

A ideia é cada pessoa anotar no próprio computador. Com o servidor local da 0.1, cada uma precisava
instalar Python e rodar `anotacao abrir`, e o servidor de cada máquina escrevia o cache do placar na
pasta compartilhada (conflito no Drive). O repositório é público, então o GitHub Pages hospeda o site
sem custo. Os navegadores atuais já fazem o que pedia o servidor: gravam numa pasta escolhida (File
System Access API), decodificam vídeo (WebCodecs) e rodam o ajuste da câmera.

## Decisão

- O site é `web/`: HTML, CSS e JavaScript (módulos ES), sem etapa de build e sem dependências de
  front-end, publicado no GitHub Pages pelo CI a cada push em `main` que passa nos testes.
- Tudo roda no navegador: filas, gabarito, placar, molde, rótulos, revisões e a importação do vídeo
  (num worker). Nenhum dado passa pelo GitHub; a CSP não deixa a página falar com outro endereço.
- Os dados ficam na pasta escolhida pela pessoa (a da equipe, sincronizada pelo Drive) ou, sem ela,
  no armazenamento do navegador (OPFS), com entrada e saída por .zip. A alça da pasta fica no
  IndexedDB.
- Um aplicativo de uma página só (vistas por `#/rota`): a permissão da pasta vale para a aba aberta.
- O Python fica para quem coordena e treina: formatos e esquemas (fonte da verdade), `validar`,
  `unificar`, `gabarito`, `prever` e `exemplo`. A lógica que só a página usa (filas, placar, sorteio,
  cortes) existe só em JavaScript; o que os dois lados usam (câmera, molde, convenções, formatos) é
  testado contra a mesma referência.
- Service worker com rede primeiro: com internet, sempre a versão nova; sem, a cópia guardada.

## Consequências

Ninguém instala nada para anotar: basta Chrome ou Edge e a pasta sincronizada. Firefox e Safari
funcionam só com o armazenamento do navegador. O Chromium do Playwright não decodifica H.264, então
o teste de ponta a ponta usa vídeo AV1 ou VP9; o H.264 é coberto pelo leitor de MP4 (comparado com o
ffprobe) e pelo decodificador do Chrome. Esconder o gabarito e o autor na revisão é um combinado de
interface: os arquivos estão na pasta de cada um.
