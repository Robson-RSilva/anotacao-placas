# ADR-0002 — Um arquivo por pessoa e por versão, numa pasta sincronizada com o Drive

**Situação:** aceita (23/10/2026)

## Contexto

Os dados ficam inicialmente num Google Drive compartilhado pela equipe, e cada pessoa anota na
própria máquina. Dois computadores editando o mesmo arquivo geram conflito de sincronização.

## Decisão

- Cada rótulo e cada revisão é um arquivo próprio: `<quadro>__<pessoa>__v<n>.json`. Ninguém edita o
  arquivo de outra pessoa; versão nova é arquivo novo.
- A escrita é atômica (temporário na mesma pasta + troca de nome) e nunca sobrescreve um arquivo
  existente.
- Filas, placar e conjuntos são recalculados dos arquivos — não há banco de dados nem estado que
  precise ser sincronizado.
- Vídeos ficam fora da pasta; só os quadros sorteados entram nela.

## Consequências

O Drive nunca precisa resolver conflito. Quando os dados forem para um bucket, as pastas vão iguais.
O custo é ler muitos arquivos pequenos; o índice com cache por data de modificação resolve isso na
escala do piloto.
