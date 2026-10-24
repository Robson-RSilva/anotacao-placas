// Convenções compartilhadas com o laboratório (ADR-0001) — espelho de src/anotacao/convencoes.py.
// tests/js/convencoes.test.js confere contra tests/fixtures/convencoes.json, gerado pelo Python.
//
// 1. Mundo: origem no centro do gramado; x ao longo do comprimento; y ao longo da largura; z para
//    cima; metros. Lado "cab" (cabines, câmera principal) = y < 0; "opo" = y > 0; "esq" = x < 0.
// 2. Câmera: x ~ K R (X - C), pixel quadrado, ponto principal no centro, distorção radial k1.
// 3. Tempo: sempre pelo PTS do vídeo; o ID do quadro é o PTS em milissegundos.
// 4. Métricas em pixels na referência 960 x 540.

/** Versão da ferramenta, gravada em cada arquivo (igual a `anotacao.__version__`). */
export const VERSAO = "0.7.0";

export const REF_W = 960;
export const REF_H = 540;

/** Versão do Manual de anotação que esta versão da ferramenta segue, por tarefa. */
export const MANUAL = Object.freeze({ camera: "camera-0.1", revisao: "revisao-0.1", oclusao: "oclusao-0.1" });

export const RE_ESTADIO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RE_VERSAO_PACOTE = /^\d+\.\d+$/;
export const RE_PARTIDA = /^\d{4}-\d{2}-\d{2}_[a-z0-9]+(?:-[a-z0-9]+)*_[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RE_QUADRO = /^t\d{10}$/;
export const RE_GABARITO = /^g\d{4}$/;
export const RE_PESSOA = /^[A-Z][A-Z0-9]{1,9}$/;
export const RE_PACOTE_REF = /^[a-z0-9]+(?:-[a-z0-9]+)*\/pacote-\d+\.\d+$/;
/** Navegador de um computador (um identificador aleatório, guardado no próprio navegador). */
export const RE_DISPOSITIVO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const RE_ARQUIVO = /^(t\d{10}|g\d{4})__([A-Z][A-Z0-9]{1,9})__v(\d+)\.json$/;
/** A máscara da oclusão, ao lado do rótulo: o mesmo nome, com .png. */
export const RE_MASCARA = /^(t\d{10}|g\d{4})__([A-Z][A-Z0-9]{1,9})__v(\d+)\.png$/;

/** Nome da "partida" que guarda os itens do gabarito (nunca entra nos conjuntos de treino). */
export const PARTIDA_GABARITO = "gabarito";

/** Pacote do campo genérico (105 x 68 m, sem placas), para anotar sem o levantamento do estádio. */
export const REF_PACOTE_GENERICO = "generico/pacote-1.0";

/** Tarefas com rótulos por arquivo. */
export const TAREFAS = Object.freeze(["camera", "oclusao"]);

/** Arredonda como o `round` do Python: meio vai para o par. */
export function arredondarPar(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Texto livre -> identificador em minúsculas, sem acentos, com hífens. */
export function slug(texto) {
  const ascii = String(texto)
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase();
  const t = ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return t.replace(/-{2,}/g, "-") || "sem-nome";
}

/** ID estável do quadro: o PTS em milissegundos, com 10 dígitos (t0001234567). */
export function idQuadro(ptsMs) {
  const v = arredondarPar(Number(ptsMs));
  if (!Number.isFinite(v) || v < 0 || v > 9_999_999_999) throw new RangeError(`PTS fora do intervalo: ${ptsMs}`);
  return `t${String(v).padStart(10, "0")}`;
}

/** ID da partida: data, estádio e jogo (2026-11-02_<estadio>_<mandante>-<visitante>). */
export function idPartida(dataIso, estadio, mandante, visitante) {
  const data = String(dataIso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error(`data inválida: ${dataIso}`);
  return `${data}_${slug(estadio)}_${slug(mandante)}-${slug(visitante)}`;
}

export function refPacote(estadio, versao) {
  return `${estadio}/pacote-${versao}`;
}

/** "arena-x/pacote-1.0" -> ["arena-x", "1.0"]. */
export function partesPacote(ref) {
  if (!RE_PACOTE_REF.test(ref)) throw new Error(`referência de pacote inválida: ${ref}`);
  const i = ref.indexOf("/pacote-");
  return [ref.slice(0, i), ref.slice(i + "/pacote-".length)];
}

/**
 * Texto digitado -> código da pessoa nos nomes de arquivo: maiúsculas, sem acento nem espaço, até 10
 * caracteres, começando por letra ("Ana Clara" -> "ANACLARA", "rs" -> "RS"). null quando não dá.
 */
export function codigoPessoa(texto) {
  const c = String(texto ?? "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  return RE_PESSOA.test(c) ? c : null;
}

/** Nome do arquivo de rótulo ou revisão: um por pessoa e por versão. */
export function nomeArquivo(quadro, pessoa, versao) {
  if (!(RE_QUADRO.test(quadro) || RE_GABARITO.test(quadro))) throw new Error(`quadro inválido: ${quadro}`);
  if (!RE_PESSOA.test(pessoa)) throw new Error(`código de pessoa inválido: ${pessoa}`);
  if (!(Number.isInteger(versao) && versao >= 1)) throw new Error("versão começa em 1");
  return `${quadro}__${pessoa}__v${versao}.json`;
}

/** Nome de arquivo -> {quadro, pessoa, versao}, ou null se não for um rótulo/revisão. */
export function lerNome(nome) {
  const m = RE_ARQUIVO.exec(nome);
  return m ? { quadro: m[1], pessoa: m[2], versao: Number(m[3]) } : null;
}

/** Nome da máscara da oclusão -> {quadro, pessoa, versao}, ou null. */
export function lerNomeMascara(nome) {
  const m = RE_MASCARA.exec(nome);
  return m ? { quadro: m[1], pessoa: m[2], versao: Number(m[3]) } : null;
}

/** A máscara que acompanha um rótulo da oclusão: o mesmo nome, com .png. */
export function mascaraDe(nomeRotulo) {
  return nomeRotulo.replace(/\.json$/, ".png");
}

/** "2026-11-02T16:00" (hora local do formulário) -> "2026-11-02T16:00:00-03:00", sem trocar o dia. */
export function isoComFuso(dataHoraLocal, data = new Date(dataHoraLocal)) {
  const base = dataHoraLocal.length === 16 ? `${dataHoraLocal}:00` : dataHoraLocal;
  const minutos = -data.getTimezoneOffset();
  const sinal = minutos >= 0 ? "+" : "-";
  const a = Math.abs(minutos);
  const dois = (n) => String(n).padStart(2, "0");
  return `${base}${sinal}${dois(Math.floor(a / 60))}:${dois(a % 60)}`;
}
