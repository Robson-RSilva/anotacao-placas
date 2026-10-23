"""Molde do campo — a mesma definição do laboratório: 26 elementos e 43 pontos-chave.

* 26 elementos: 17 retas no gramado, 3 arcos e 6 segmentos dos gols (traves e travessões).
* 43 pontos-chave: cruzamentos de linhas, pontos de círculo, marcas e pés e topos das traves.
* Dimensões do pacote do estádio (nem todo campo tem 105 x 68 m); medidas internas pela regra.
* A permutação dos nomes sob a rotação de 180 graus sai da geometria, não de uma tabela à mão.

Os nomes são os do Manual de anotação (ex.: `lateral_cab`, `grande_area_esq_frente`).
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
    elementos: list[Elemento] = field(default_factory=list)
    pontos: dict[str, tuple[np.ndarray, str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.elementos:
            self._construir()

    def _construir(self) -> None:
        hl, hw = self.L / 2, self.W / 2
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
        for tag, depth, half in (
            ("grande_area", self.penalty_depth, self.penalty_half),
            ("pequena_area", self.goal_area_depth, self.goal_area_half),
        ):
            for s, lado in ((-1, "esq"), (1, "dir")):
                x0, x1 = s * hl, s * (hl - depth)
                reta(f"{tag}_{lado}_cab", tag, (x0, -half, 0), (x1, -half, 0))
                reta(f"{tag}_{lado}_opo", tag, (x0, half, 0), (x1, half, 0))
                reta(f"{tag}_{lado}_frente", tag, (x1, -half, 0), (x1, half, 0))
        arco("circulo_central", "circulo", (0, 0), self.circle_r, -np.pi, np.pi)
        a = np.arccos((self.penalty_depth - self.spot_dist) / self.circle_r)
        arco("meia_lua_esq", "meia_lua", (-hl + self.spot_dist, 0), self.circle_r, -a, a)
        arco("meia_lua_dir", "meia_lua", (hl - self.spot_dist, 0), self.circle_r, np.pi - a, np.pi + a)
        g, gh = self.goal_half, self.goal_height
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
        for curto, depth, half in (
            ("ga", self.penalty_depth, self.penalty_half),
            ("pa", self.goal_area_depth, self.goal_area_half),
        ):
            for sx, lado in ((-1, "esq"), (1, "dir")):
                ponto(f"{curto}_{lado}_fundo_cab", (sx * hl, -half, 0), "linha")
                ponto(f"{curto}_{lado}_fundo_opo", (sx * hl, half, 0), "linha")
                ponto(f"{curto}_{lado}_frente_cab", (sx * (hl - depth), -half, 0), "linha")
                ponto(f"{curto}_{lado}_frente_opo", (sx * (hl - depth), half, 0), "linha")
        r = self.circle_r
        ponto("circ_meio_cab", (0, -r, 0), "circulo")
        ponto("circ_meio_opo", (0, r, 0), "circulo")
        ponto("circ_esq", (-r, 0, 0), "circulo")
        ponto("circ_dir", (r, 0, 0), "circulo")
        ponto("centro", (0, 0, 0), "marca")
        for sx, lado in ((-1, "esq"), (1, "dir")):
            ponto(f"penalti_{lado}", (sx * (hl - self.spot_dist), 0, 0), "marca")
        yy = np.sqrt(r**2 - (self.penalty_depth - self.spot_dist) ** 2)
        for sx, lado in ((-1, "esq"), (1, "dir")):
            ponto(f"ml_{lado}_cab", (sx * (hl - self.penalty_depth), -yy, 0), "circulo")
            ponto(f"ml_{lado}_opo", (sx * (hl - self.penalty_depth), yy, 0), "circulo")
            ponto(f"ml_{lado}_topo", (sx * (hl - self.spot_dist - r), 0, 0), "circulo")
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


def campo_do_pacote(comprimento: float, largura: float) -> Campo:
    return Campo(L=float(comprimento), W=float(largura))
