# ADR-0001 — Convenções compartilhadas com o laboratório

**Situação:** aceita (23/10/2026)

## Contexto

Os rótulos de câmera viram alvos de treino do detector do laboratório. Qualquer diferença de
convenção (eixo z, ordem da projeção, ID do quadro, resolução das métricas) vira erro silencioso no
treino.

## Decisão

- Mundo: origem no centro do gramado, x ao longo do comprimento, y ao longo da largura, z para cima,
  metros. Lado `cab` (cabines) em y < 0; `esq` em x < 0.
- Câmera: `x ~ K R (X − C)`, pixel quadrado, ponto principal no centro, distorção radial `k1`.
  Ângulos pan, tilt e roll como no laboratório.
- Tempo pelo PTS do vídeo; o ID do quadro é o PTS em milissegundos.
- Métricas em pixels na referência 960 × 540.
- O modelo de câmera e o molde do campo têm cópias em Python e em JavaScript, testadas contra uma
  fixture gerada pelo próprio laboratório (`scripts/fixture_do_laboratorio.py`).

## Consequências

Mudou o modelo no laboratório, regenera-se a fixture e os testes mostram onde as cópias divergem.
