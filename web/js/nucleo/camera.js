// Modelo de câmera — espelho de camera.py, que é o mesmo do laboratório (ADR-0001).
// Testado contra o laboratório em tests/js/camera.test.js (fixture camera_laboratorio.json).
//
//   X_c = R (X - C);  n = (X_c, Y_c) / Z_c;  n_d = n (1 + k1 r² + k2 r⁴);  x = f n_d + c
//
// Ângulos em graus. Mundo: z para cima, metros, origem no centro do gramado.

const RAD = Math.PI / 180;

const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const prod = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

export function rotDePtr(pan, tilt, roll = 0) {
  const ph = pan * RAD;
  const th = tilt * RAD;
  const ga = roll * RAD;
  const f = [Math.sin(ph) * Math.cos(th), Math.cos(ph) * Math.cos(th), -Math.sin(th)];
  const r0 = [Math.cos(ph), -Math.sin(ph), 0];
  const d0 = cruz(f, r0);
  const r = [0, 1, 2].map((i) => Math.cos(ga) * r0[i] + Math.sin(ga) * d0[i]);
  const d = [0, 1, 2].map((i) => -Math.sin(ga) * r0[i] + Math.cos(ga) * d0[i]);
  return [r, d, f];
}

export function ptrDeRot(R) {
  const f = R[2];
  const th = Math.asin(limitar(-f[2], -1, 1));
  const ph = Math.atan2(f[0], f[1]);
  const r0 = [Math.cos(ph), -Math.sin(ph), 0];
  const d0 = cruz(f, r0);
  const ga = Math.atan2(prod(R[0], d0), prod(R[0], r0));
  return [ph / RAD, th / RAD, ga / RAD];
}

export const fDeHfov = (hfov, w) => (w / 2) / Math.tan((hfov * RAD) / 2);
export const hfovDeF = (f, w) => (2 * Math.atan((w / 2) / f)) / RAD;

const _raios = new Map();

/** Maior raio normalizado em que a distorção ainda é monotônica — a mesma grade do Python. */
export function raioValido(k1, k2 = 0) {
  const chave = `${k1}|${k2}`;
  if (_raios.has(chave)) return _raios.get(chave);
  const passo = 3 / 3000;
  let out = 3.0;
  for (let i = 0; i <= 3000; i++) {
    const r = i === 3000 ? 3 : i * passo;
    if (!(1 + 3 * k1 * r * r + 5 * k2 * r ** 4 > 0.05)) {
      out = i === 0 ? 3.0 : (i - 1) * passo;
      break;
    }
  }
  if (_raios.size > 5000) _raios.clear();
  _raios.set(chave, out);
  return out;
}

export class Camera {
  constructor({ f, R, C, w = 960, h = 540, k1 = 0, k2 = 0, cx = null, cy = null }) {
    this.f = f;
    this.R = R;
    this.C = C;
    this.w = w;
    this.h = h;
    this.k1 = k1;
    this.k2 = k2;
    this.cx = cx ?? w / 2;
    this.cy = cy ?? h / 2;
  }

  static dePtr(f, pan, tilt, roll, C, w, h, k1 = 0, k2 = 0) {
    return new Camera({ f, R: rotDePtr(pan, tilt, roll), C: [...C], w, h, k1, k2 });
  }

  static deHfov(hfov, pan, tilt, roll, C, w, h, k1 = 0) {
    return Camera.dePtr(fDeHfov(hfov, w), pan, tilt, roll, C, w, h, k1);
  }

  /** Câmera de um rótulo: {hfov_graus, pan, tilt, roll, C, k1}. */
  static deRotulo(d, w, h) {
    return Camera.deHfov(d.hfov_graus, d.pan, d.tilt, d.roll, d.C, w, h, d.k1 ?? 0);
  }

  static olharPara(C, alvo, hfov, w, h, roll = 0) {
    const d = [alvo[0] - C[0], alvo[1] - C[1], alvo[2] - C[2]];
    const n = Math.hypot(...d);
    const tilt = Math.asin(limitar(-d[2] / n, -1, 1)) / RAD;
    const pan = Math.atan2(d[0], d[1]) / RAD;
    return Camera.deHfov(hfov, pan, tilt, roll, C, w, h);
  }

  get ptr() {
    return ptrDeRot(this.R);
  }

  get hfov() {
    return hfovDeF(this.f, this.w);
  }

  paraRotulo() {
    const [pan, tilt, roll] = this.ptr;
    return { hfov_graus: this.hfov, pan, tilt, roll, C: [...this.C], k1: this.k1 };
  }

  /** Projeta um ponto 3D. Retorna [u, v] ou null (atrás da câmera ou fora do raio válido). */
  projetar(X) {
    const R = this.R;
    const dx = X[0] - this.C[0];
    const dy = X[1] - this.C[1];
    const dz = X[2] - this.C[2];
    const z = R[2][0] * dx + R[2][1] * dy + R[2][2] * dz;
    if (!(z > 1e-3)) return null;
    let nx = (R[0][0] * dx + R[0][1] * dy + R[0][2] * dz) / z;
    let ny = (R[1][0] * dx + R[1][1] * dy + R[1][2] * dz) / z;
    if (this.k1 !== 0 || this.k2 !== 0) {
      const r2 = nx * nx + ny * ny;
      if (!(Math.sqrt(r2) < raioValido(this.k1, this.k2))) return null;
      const s = 1 + this.k1 * r2 + this.k2 * r2 * r2;
      nx *= s;
      ny *= s;
    }
    return [this.f * nx + this.cx, this.f * ny + this.cy];
  }

  /** A câmera espelhada pela rotação de 180° do campo: mesmas marcações, placas do outro lado. */
  espelhada() {
    const R = this.R.map((linha) => [-linha[0], -linha[1], linha[2]]);
    return new Camera({ f: this.f, R, C: [-this.C[0], -this.C[1], this.C[2]], w: this.w, h: this.h,
      k1: this.k1, k2: this.k2, cx: this.cx, cy: this.cy });
  }
}

export function ladoCanonico(C, alfa = 45) {
  const a = alfa * RAD;
  return Math.sin(a) * C[0] - Math.cos(a) * C[1] >= 0;
}
