"""Pacote do estádio: medidas do campo, placas (polígonos 3D) e posição das câmeras.

É o que a página de câmera usa para desenhar o molde com as medidas certas e as placas com o
nome, para o anotador conferir o lado. Vem do levantamento no estádio; aqui só se lê e valida.
"""

from __future__ import annotations

import numpy as np

from .camera import Camera
from .campo import Campo
from .formatos import CameraRegistro, CampoPacote, PacoteEstadio, PlacaPacote


def campo_do_pacote(p: PacoteEstadio) -> Campo:
    return Campo(L=p.campo.comprimento, W=p.campo.largura)


def validar_geometria(p: PacoteEstadio) -> list[str]:
    """Placas retangulares, vértices BL, BR, TR, TL vistos de frente e normal apontando para o campo."""
    erros = []
    for placa in p.placas:
        V = np.asarray(placa.vertices, float)
        e1, e2 = V[1] - V[0], V[3] - V[0]
        if np.linalg.norm(e1) < 0.1 or np.linalg.norm(e2) < 0.1:
            erros.append(f"{placa.id}: placa degenerada")
            continue
        if abs(e1 @ e2) > 1e-3 * np.linalg.norm(e1) * np.linalg.norm(e2):
            erros.append(f"{placa.id}: arestas não ortogonais")
        if np.linalg.norm(V[2] - (V[1] + e2)) > 1e-3:
            erros.append(f"{placa.id}: não é um retângulo")
        n = np.cross(e1, e2)
        n = n / np.linalg.norm(n)
        para_o_campo = -V.mean(0)
        para_o_campo[2] = 0.0
        if n @ para_o_campo <= 0:
            erros.append(f"{placa.id}: vértices fora de ordem (a frente da placa não olha para o campo)")
    return erros


def amostras_placas(p: PacoteEstadio, passo: float = 0.5) -> np.ndarray:
    """Pontos 3D ao longo do contorno de todas as placas (para comparar duas câmeras)."""
    pts = []
    for placa in p.placas:
        V = np.asarray(placa.vertices, float)
        for a, b in zip(V, np.roll(V, -1, axis=0), strict=True):
            n = max(int(np.ceil(np.linalg.norm(b - a) / passo)), 1)
            t = np.linspace(0, 1, n, endpoint=False)[:, None]
            pts.append(a + t * (b - a))
    return np.vstack(pts) if pts else np.zeros((0, 3))


def camera_padrao(p: PacoteEstadio, w: int, h: int, nome: str | None = None) -> Camera:
    """Câmera inicial quando não há previsão nem quadro anotado: a do registro olhando o centro."""
    regs = {c.nome: c for c in p.cameras}
    escolha = regs.get(nome) if nome else None
    if escolha is None:
        escolha = next((c for c in p.cameras if c.tipo == "principal"), p.cameras[0])
    T = np.asarray(escolha.T, float)
    alvo = (
        np.array([0.0, 0.0, 0.0])
        if escolha.tipo != "fundo"
        else np.array([np.sign(T[0]) * p.campo.comprimento / 3, 0, 0])
    )
    return Camera.look_at(T, alvo, 40.0, w, h)


def _placa(
    pid: str, tipo: str, base_xy, normal_xy, largura: float, altura: float, lado: str, patrocinador: str | None
) -> PlacaPacote:
    n = np.array([normal_xy[0], normal_xy[1], 0.0], float)
    n /= np.linalg.norm(n)
    cima = np.array([0.0, 0.0, 1.0])
    direita = np.cross(-n, cima)
    b = np.array([base_xy[0], base_xy[1], 0.0])
    BL, BR = b - largura / 2 * direita, b + largura / 2 * direita
    V = [BL, BR, BR + altura * cima, BL + altura * cima]
    return PlacaPacote(
        id=pid, tipo=tipo, lado=lado, vertices=[[float(x) for x in v] for v in V], patrocinador=patrocinador
    )


def pacote_sintetico(
    estadio: str = "estadio-sintetico", versao: str = "1.0", L: float = 105.0, W: float = 68.0
) -> PacoteEstadio:
    """O estádio sintético do laboratório (mesmo layout de placas e câmeras), para testes e exemplo."""
    hl, hw = L / 2, W / 2
    gap_lado, gap_fundo, modulo = 4.0, 5.0, 8.0
    n_mod = int(np.floor((L - 5.0) / modulo))
    xs = (np.arange(n_mod) - (n_mod - 1) / 2) * modulo
    placas = []
    marca = iter(f"Marca {chr(65 + i)}" for i in range(26))
    for lado, y, normal in (("opo", hw + gap_lado, (0, -1)), ("cab", -hw - gap_lado, (0, 1))):
        for i, x in enumerate(xs):
            tipo = "led" if i % 2 == 0 else "estatica"
            placas.append(
                _placa(
                    f"{lado.upper()}_{i + 1:02d}",
                    tipo,
                    (x, y),
                    normal,
                    modulo,
                    0.98,
                    lado,
                    next(marca, None) if tipo == "estatica" else None,
                )
            )
    for i, y in enumerate((-26.0, -18.0, -10.0, 10.0, 18.0, 26.0)):
        placas.append(_placa(f"ESQ_{i + 1:02d}", "led", (-hl - gap_fundo, y), (1, 0), modulo, 0.98, "esq", None))
        placas.append(_placa(f"DIR_{i + 1:02d}", "led", (hl + gap_fundo, y), (-1, 0), modulo, 0.98, "dir", None))
    cameras = [
        CameraRegistro(nome="principal", tipo="principal", T=[0.0, -hw - 24.0, 14.0]),
        CameraRegistro(nome="16m_esq", tipo="16m", T=[-36.0, -hw - 23.0, 13.0]),
        CameraRegistro(nome="16m_dir", tipo="16m", T=[36.0, -hw - 23.0, 13.0]),
        CameraRegistro(nome="fundo_esq_alta", tipo="fundo", T=[-hl - 14.0, 0.0, 16.0]),
        CameraRegistro(nome="fundo_dir_alta", tipo="fundo", T=[hl + 14.0, 0.0, 16.0]),
        CameraRegistro(nome="reversa", tipo="reversa", T=[0.0, hw + 20.0, 9.0]),
    ]
    return PacoteEstadio(
        estadio=estadio,
        versao=versao,
        nome="Estádio Sintético A",
        campo=CampoPacote(comprimento=L, largura=W),
        placas=placas,
        cameras=cameras,
    )
