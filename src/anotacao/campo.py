"""O campo — a mesma definição do laboratório: 26 elementos e 43 pontos-chave.

* 26 elementos: 17 retas no gramado, 3 arcos e 6 segmentos dos gols (traves e travessões).
* 43 pontos-chave: cruzamentos de linhas, pontos de círculo, marcas e pés e topos das traves. Na
  tarefa de pontos se marcam 39: os quatro que não ficam num cruzamento nem numa marca
  (`PONTOS_SEM_MARCA`) não têm o que clicar na imagem.
* Medidas internas pela regra; o comprimento e a largura mudam de um estádio para outro.
* Os pontos ficam **no meio das linhas** (ADR-0016): a regra mede as áreas até a borda de fora da linha (a linha
  pertence à área que ela fecha), e o anotador clica no meio do cruzamento — e, no gol, no meio do tubo. Com
  linhas de `largura_linha` (12 cm, o máximo da regra), cada linha anda meia largura para dentro da área que
  ela fecha: a pequena área tem 5,38 m de fundo entre os meios das linhas, o topo da trave fica a 2,50 m. Com
  `largura_linha=0`, a geometria é a da regra ao pé da letra (a do laboratório antigo).
* A permutação dos nomes sob a rotação de 180 graus sai da geometria, não de uma tabela à mão.

Os nomes são os do Manual de anotação (ex.: `canto_esq_cab`, `ga_dir_frente_opo`). O espelho em
JavaScript (`web/js/nucleo/campo.js`) desenha o mapa da página de pontos.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Elemento:
    id: int
    nome: str
    tipo: str  # "line" | "arc" (os mesmos valores do laboratório)
    grupo: str
    A: np.ndarray | None = None
    B: np.ndarray | None = None
    centro: np.ndarray | None = None
    raio: float = 0.0
    a0: float = 0.0
    a1: float = 0.0

    @property
    def comprimento(self) -> float:
        if self.tipo == "line":
            return float(np.linalg.norm(self.B - self.A))
        return float(self.raio * abs(self.a1 - self.a0))

    def amostrar(self, passo: float = 0.25) -> np.ndarray:
        """Pontos 3D ao longo do elemento, com espaçamento aproximado `passo` (m)."""
        n = max(int(np.ceil(self.comprimento / passo)), 1) + 1
        t = np.linspace(0.0, 1.0, n)
        if self.tipo == "line":
            return self.A[None] + t[:, None] * (self.B - self.A)[None]
        a = self.a0 + t * (self.a1 - self.a0)
        return np.c_[self.centro[0] + self.raio * np.cos(a), self.centro[1] + self.raio * np.sin(a), np.zeros_like(a)]

    def distancia(self, P: np.ndarray) -> np.ndarray:
        """Distância euclidiana 3D de pontos P (N, 3) ao elemento (exata, sem amostrar)."""
        P = np.atleast_2d(np.asarray(P, float))
        if self.tipo == "line":
            AB = self.B - self.A
            t = np.clip(((P - self.A) @ AB) / max(AB @ AB, 1e-15), 0.0, 1.0)
            return np.linalg.norm(P - (self.A + t[:, None] * AB), axis=1)
        d = P[:, :2] - self.centro[:2]
        ang = np.arctan2(d[:, 1], d[:, 0])
        span = self.a1 - self.a0
        rel = np.mod(ang - self.a0, 2 * np.pi)
        dentro = (rel <= span + 1e-12) | (span >= 2 * np.pi - 1e-9)
        rho = np.linalg.norm(d, axis=1)
        d_arco = np.hypot(rho - self.raio, P[:, 2])
        pontas = np.array(
            [
                [self.centro[0] + self.raio * np.cos(a), self.centro[1] + self.raio * np.sin(a), 0.0]
                for a in (self.a0, self.a1)
            ]
        )
        d_ponta = np.min(np.linalg.norm(P[:, None] - pontas[None], axis=2), axis=1)
        return np.where(dentro, d_arco, d_ponta)


@dataclass
class Campo:
    L: float = 105.0
    W: float = 68.0
    penalty_depth: float = 16.5
    penalty_half: float = 20.16
    goal_area_depth: float = 5.5
    goal_area_half: float = 9.16
    circle_r: float = 9.15
    spot_dist: float = 11.0
    goal_half: float = 3.66
    goal_height: float = 2.44
    largura_linha: float = 0.12
    elementos: list[Elemento] = field(default_factory=list)
    pontos: dict[str, tuple[np.ndarray, str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.elementos:
            self._construir()

    def _construir(self) -> None:
        # as medidas da regra vão até a borda de fora das linhas; os pontos ficam no meio delas (ADR-0016)
        m = self.largura_linha / 2
        hl, hw = self.L / 2 - m, self.W / 2 - m
        areas = (
            (self.penalty_depth - 2 * m, self.penalty_half - m),
            (self.goal_area_depth - 2 * m, self.goal_area_half - m),
        )
        raio, marca = self.circle_r - m, self.spot_dist - m
        E: list[Elemento] = []

        def reta(nome, grupo, a, b):
            E.append(Elemento(len(E), nome, "line", grupo, np.array(a, float), np.array(b, float)))

        def arco(nome, grupo, c, r, a0, a1):
            E.append(Elemento(len(E), nome, "arc", grupo, centro=np.array([c[0], c[1], 0.0]), raio=r, a0=a0, a1=a1))

        reta("lateral_cab", "lateral", (-hl, -hw, 0), (hl, -hw, 0))
        reta("lateral_opo", "lateral", (-hl, hw, 0), (hl, hw, 0))
        reta("fundo_esq", "fundo", (-hl, -hw, 0), (-hl, hw, 0))
        reta("fundo_dir", "fundo", (hl, -hw, 0), (hl, hw, 0))
        reta("meio", "meio", (0, -hw, 0), (0, hw, 0))
        for tag, (depth, half) in zip(("grande_area", "pequena_area"), areas, strict=True):
            for s, lado in ((-1, "esq"), (1, "dir")):
                x0, x1 = s * hl, s * (hl - depth)
                reta(f"{tag}_{lado}_cab", tag, (x0, -half, 0), (x1, -half, 0))
                reta(f"{tag}_{lado}_opo", tag, (x0, half, 0), (x1, half, 0))
                reta(f"{tag}_{lado}_frente", tag, (x1, -half, 0), (x1, half, 0))
        arco("circulo_central", "circulo", (0, 0), raio, -np.pi, np.pi)
        a = np.arccos((areas[0][0] - marca) / raio)
        arco("meia_lua_esq", "meia_lua", (-hl + marca, 0), raio, -a, a)
        arco("meia_lua_dir", "meia_lua", (hl - marca, 0), raio, np.pi - a, np.pi + a)
        g, gh = self.goal_half + m, self.goal_height + m
        for s, lado in ((-1, "esq"), (1, "dir")):
            x = s * hl
            reta(f"gol_{lado}_trave_cab", "gol", (x, -g, 0), (x, -g, gh))
            reta(f"gol_{lado}_trave_opo", "gol", (x, g, 0), (x, g, gh))
            reta(f"gol_{lado}_travessao", "gol", (x, -g, gh), (x, g, gh))
        self.elementos = E

        K: dict[str, tuple[np.ndarray, str]] = {}

        def ponto(nome, p, tipo):
            K[nome] = (np.array(p, float), tipo)

        for sx, lado in ((-1, "esq"), (1, "dir")):
            ponto(f"canto_{lado}_cab", (sx * hl, -hw, 0), "linha")
            ponto(f"canto_{lado}_opo", (sx * hl, hw, 0), "linha")
        ponto("meio_cab", (0, -hw, 0), "linha")
        ponto("meio_opo", (0, hw, 0), "linha")
        for curto, (depth, half) in zip(("ga", "pa"), areas, strict=True):
            for sx, lado in ((-1, "esq"), (1, "dir")):
                ponto(f"{curto}_{lado}_fundo_cab", (sx * hl, -half, 0), "linha")
                ponto(f"{curto}_{lado}_fundo_opo", (sx * hl, half, 0), "linha")
                ponto(f"{curto}_{lado}_frente_cab", (sx * (hl - depth), -half, 0), "linha")
                ponto(f"{curto}_{lado}_frente_opo", (sx * (hl - depth), half, 0), "linha")
        r = raio
        ponto("circ_meio_cab", (0, -r, 0), "circulo")
        ponto("circ_meio_opo", (0, r, 0), "circulo")
        ponto("circ_esq", (-r, 0, 0), "circulo")
        ponto("circ_dir", (r, 0, 0), "circulo")
        ponto("centro", (0, 0, 0), "marca")
        for sx, lado in ((-1, "esq"), (1, "dir")):
            ponto(f"penalti_{lado}", (sx * (hl - marca), 0, 0), "marca")
        yy = np.sqrt(r**2 - (areas[0][0] - marca) ** 2)
        for sx, lado in ((-1, "esq"), (1, "dir")):
            ponto(f"ml_{lado}_cab", (sx * (hl - areas[0][0]), -yy, 0), "circulo")
            ponto(f"ml_{lado}_opo", (sx * (hl - areas[0][0]), yy, 0), "circulo")
            ponto(f"ml_{lado}_topo", (sx * (hl - marca - r), 0, 0), "circulo")
        for sx, lado in ((-1, "esq"), (1, "dir")):
            ponto(f"gol_{lado}_pe_cab", (sx * hl, -g, 0), "gol")
            ponto(f"gol_{lado}_pe_opo", (sx * hl, g, 0), "gol")
            ponto(f"gol_{lado}_topo_cab", (sx * hl, -g, gh), "gol")
            ponto(f"gol_{lado}_topo_opo", (sx * hl, g, gh), "gol")
        self.pontos = K

    # ------------------------------------------------------------------ acessores
    @property
    def nomes_elementos(self) -> list[str]:
        return [e.nome for e in self.elementos]

    @property
    def nomes_pontos(self) -> list[str]:
        return list(self.pontos)

    @property
    def KP(self) -> np.ndarray:
        """Coordenadas 3D dos pontos-chave, na ordem de `nomes_pontos` (N, 3)."""
        return np.array([v[0] for v in self.pontos.values()])

    def elemento(self, nome: str) -> Elemento:
        return self.elementos[self.nomes_elementos.index(nome)]

    def ponto(self, nome: str) -> np.ndarray:
        return self.pontos[nome][0]

    # ------------------------------------------------------------------ simetria de 180 graus
    def perm180(self) -> tuple[list[int], list[int]]:
        """(elementos, pontos): o índice i vai em p[i] sob a rotação de 180 graus em torno de z."""
        M = np.array([-1.0, -1.0, 1.0])
        X = self.KP
        d = np.linalg.norm((X * M)[:, None] - X[None], axis=2)
        pk = d.argmin(1)
        if not np.all(d[np.arange(len(X)), pk] < 1e-9):
            raise AssertionError("ponto-chave sem imagem sob a simetria")
        pe = []
        for e in self.elementos:
            P = e.amostrar(0.5) * M
            melhor, melhor_d = -1, np.inf
            for f in self.elementos:
                if abs(f.comprimento - e.comprimento) > 1e-6:
                    continue
                dd = float(np.max(f.distancia(P)))
                if dd < melhor_d:
                    melhor, melhor_d = f.id, dd
            if melhor_d > 1e-6:
                raise AssertionError(f"elemento {e.nome} sem imagem sob a simetria")
            pe.append(int(melhor))
        return pe, [int(v) for v in pk]

    def para_web(self) -> dict:
        """Geometria para as páginas (o JavaScript amostra e projeta)."""
        pe, pk = self.perm180()
        elementos = []
        for e in self.elementos:
            d = {"nome": e.nome, "tipo": "reta" if e.tipo == "line" else "arco", "grupo": e.grupo}
            if e.tipo == "line":
                d.update(A=[float(v) for v in e.A], B=[float(v) for v in e.B])
            else:
                d.update(centro=[float(v) for v in e.centro], raio=e.raio, a0=e.a0, a1=e.a1)
            elementos.append(d)
        pontos = [{"nome": n, "X": [float(v) for v in X], "tipo": t} for n, (X, t) in self.pontos.items()]
        return {
            "L": self.L,
            "W": self.W,
            "elementos": elementos,
            "pontos": pontos,
            "perm180": {"elementos": pe, "pontos": pk},
        }


#: Pontos que não se marcam à mão: o mais à esquerda e o mais à direita do círculo central e o topo
#: de cada meia-lua não ficam num cruzamento de linhas nem numa marca — na imagem não há o que clicar.
PONTOS_SEM_MARCA = ("circ_esq", "circ_dir", "ml_esq_topo", "ml_dir_topo")


def pontos_marcaveis() -> list[str]:
    """Os 39 pontos da tarefa de pontos, na ordem do laboratório."""
    return [n for n in Campo().nomes_pontos if n not in PONTOS_SEM_MARCA]


def perm180_dos_nomes() -> dict[str, str]:
    """Nome de cada ponto -> o nome dele visto do outro lado do campo (rotação de 180 graus)."""
    campo = Campo()
    _, pk = campo.perm180()
    nomes = campo.nomes_pontos
    return {nomes[i]: nomes[j] for i, j in enumerate(pk)}
