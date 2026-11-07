// O ajudante de cruzamento dos pontos: o ponto de um cruzamento coberto (por um jogador, a trave, um
// grafismo) sai das duas linhas retas que se cruzam nele — dois cliques em cada linha, onde ela aparece,
// e o ponto é onde as duas retas se encontram. As contas, em px da imagem.

/** Retas que se cruzam num ângulo menor que este (graus) são quase paralelas: o ponto ficaria incerto demais. */
export const ANGULO_MINIMO = 3;
/** Abaixo deste ângulo (graus), um erro pequeno num clique muda muito o ponto: a página pede para conferir. */
export const ANGULO_PEQUENO = 10;
/** Os dois cliques de uma linha precisam estar pelo menos a esta distância (px da imagem). */
export const DISTANCIA_MINIMA = 3;

/**
 * Onde a reta por `a` e `b` cruza a reta por `c` e `d`: {ponto: [x, y], angulo (graus, de 0 a 90)}, ou null
 * quando os dois cliques de uma linha estão perto demais, ou as retas são quase paralelas.
 */
export function cruzarRetas(a, b, c, d) {
  const [ux, uy] = [b[0] - a[0], b[1] - a[1]];
  const [vx, vy] = [d[0] - c[0], d[1] - c[1]];
  const nu = Math.hypot(ux, uy);
  const nv = Math.hypot(vx, vy);
  if (nu < DISTANCIA_MINIMA || nv < DISTANCIA_MINIMA) return null;
  const vetorial = ux * vy - uy * vx;
  const angulo = (Math.asin(Math.min(1, Math.abs(vetorial) / (nu * nv))) * 180) / Math.PI;
  if (angulo < ANGULO_MINIMO) return null;
  const t = ((c[0] - a[0]) * vy - (c[1] - a[1]) * vx) / vetorial;
  return { ponto: [a[0] + t * ux, a[1] + t * uy], angulo };
}

/**
 * O pedaço da reta por `a` e `b` que fica dentro da imagem ([0, largura] x [0, altura]): [[x, y], [x, y]],
 * ou null quando a reta não passa pela imagem (ou os dois pontos coincidem).
 */
export function retaNaImagem(a, b, largura, altura) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  if (!dx && !dy) return null;
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [p, q] of [[-dx, a[0]], [dx, largura - a[0]], [-dy, a[1]], [dy, altura - a[1]]]) {
    if (p === 0) {
      if (q < 0) return null; // paralela a esta borda, e do lado de fora
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
  }
  if (t0 > t1) return null;
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}
