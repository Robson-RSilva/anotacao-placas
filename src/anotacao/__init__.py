"""Ferramentas da pasta de trabalho da anotação de dados de treino: os pontos do campo, marcados direto no
quadro, e o que está na frente de cada placa, pintado no recorte dela.

As páginas de anotação rodam no navegador (`web/`, publicadas no GitHub Pages); este pacote define os
formatos dos arquivos (fonte dos JSON Schemas que as páginas usam) e traz o que quem coordena e quem
treina fazem fora delas: trazer os recortes das placas, validar, unificar em conjuntos de treino,
importar o gabarito e gravar previsões do modelo. Cortes, replays e artes das placas são conferidos
na solução assistida, que é outro projeto.
"""

__version__ = "0.12.0"
