// Trechos do vídeo escolhidos na importação, como a pessoa escreve: "0:05:00-0:50:00, 1:05:00-1:50:00".
// Só os quadros dentro deles são lidos e sorteados (o resto do vídeo nem é decodificado). O início
// entra e o fim não: "0:30-1:00" são os 30 segundos a partir de 0:30.

/** "1:05:00" | "65:00" | "3900" | "3900.5" -> segundos; NaN quando não dá para ler. */
export function lerTempo(texto) {
  const t = String(texto).trim();
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(t)) return NaN;
  const [inteiro, frac] = t.split(".");
  const partes = inteiro.split(":").map(Number);
  if (partes.slice(1).some((v) => v >= 60)) return NaN;
  let s = 0;
  for (const v of partes) s = s * 60 + v;
  return frac ? s + Number(`0.${frac}`) : s;
}

/** Segundos -> "1:05:00" (ou "5:00" abaixo de uma hora). */
export function formatarTempo(s) {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export class ErroTrechos extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "ErroTrechos";
  }
}

/**
 * Texto -> [[início, fim], ...] em segundos, em ordem e sem sobreposição (trechos que se tocam
 * viram um). Vazio -> null (o vídeo inteiro). Separa os trechos por vírgula, ponto e vírgula ou
 * linha; o início e o fim por hífen, travessão, " a " ou " até ".
 */
export function lerTrechos(texto) {
  const partes = String(texto ?? "")
    .normalize("NFC")
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!partes.length) return null;
  const lidos = [];
  for (const p of partes) {
    // "\b" não serve para "até" (o "é" não é letra para o \b): "a" e "até" vão entre espaços
    const m = /^([\d:.]+)\s*(?:-|–|—|\s(?:a|até)\s)\s*([\d:.]+)$/i.exec(p);
    const ini = m ? lerTempo(m[1]) : NaN;
    const fim = m ? lerTempo(m[2]) : NaN;
    if (!Number.isFinite(ini) || !Number.isFinite(fim)) {
      throw new ErroTrechos(`não entendi o trecho “${p}”: escreva como 0:05:00-0:50:00`);
    }
    if (fim <= ini) throw new ErroTrechos(`o trecho “${p}” termina antes de começar`);
    lidos.push([ini, fim]);
  }
  lidos.sort((a, b) => a[0] - b[0]);
  const out = [lidos[0]];
  for (const [ini, fim] of lidos.slice(1)) {
    const ultimo = out[out.length - 1];
    if (ini <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], fim);
    else out.push([ini, fim]);
  }
  return out;
}

/** [[300, 3000], [3900, 6600]] -> "5:00–50:00, 1:05:00–1:50:00" (para mostrar, em segundos inteiros). */
export function formatarTrechos(trechos) {
  return (trechos ?? []).map(([a, b]) => `${formatarTempo(a)}–${formatarTempo(b)}`).join(", ");
}

/** Segundos -> "1:05:00", "5:00" ou, com fração, "0:02.2" — sem perder nada (o mesmo do Python). */
export function tempoExato(s) {
  const ms = Math.floor(s * 1000 + 0.5);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const seg = Math.floor((ms % 60_000) / 1000);
  const mil = ms % 1000;
  const texto = String(seg).padStart(2, "0") + (mil ? `.${String(mil).padStart(3, "0")}`.replace(/0+$/, "") : "");
  return h ? `${h}:${String(m).padStart(2, "0")}:${texto}` : `${m}:${texto}`;
}

/** Os trechos como `lerTrechos` (e o `anotacao baixar`) leem de volta: "5:00-50:00, 1:05:00-1:50:00". */
export function trechosParaTexto(trechos) {
  return (trechos ?? []).map(([a, b]) => `${tempoExato(a)}-${tempoExato(b)}`).join(", ");
}

/** Os mesmos trechos (a menos de um milissegundo)? */
export function mesmosTrechos(a, b) {
  return a.length === b.length && a.every(([x0, x1], k) => Math.abs(x0 - b[k][0]) < 1e-3 && Math.abs(x1 - b[k][1]) < 1e-3);
}
