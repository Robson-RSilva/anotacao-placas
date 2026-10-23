# ADR-0004 — Servidor local com páginas sem build

**Situação:** substituída pela [ADR-0005](0005-paginas-estaticas-no-github-pages.md) (23/10/2026)

## Contexto

O pré-processamento do vídeo precisa de OpenCV e grava numa pasta; uma página estática sozinha não
faz isso. A ferramenta precisa ser fácil de instalar nas máquinas dos anotadores.

## Decisão

- Um servidor FastAPI que só escuta em 127.0.0.1, aberto por `anotacao abrir`.
- Páginas em HTML, CSS e JavaScript (módulos ES) servidos pelo próprio pacote, sem etapa de build e
  sem dependências de front-end.
- O ajuste da câmera roda no navegador (milissegundos por movimento do mouse), com a mesma
  matemática do Python.

## Consequências

Instalar é `pip install`. O JavaScript é testado com `node --test`, sem `npm install`.
