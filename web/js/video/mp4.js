// Leitor de MP4/MOV (ISO BMFF) só com o que a importação precisa: a faixa de vídeo, o codec e a
// tabela de amostras (posição no arquivo, tamanho, tempos e quadros-chave). Os dados das amostras
// vão para o decodificador do navegador (WebCodecs).
//
// Suporta o MP4 comum (índice no começo ou no fim) e o fragmentado (moof), com H.264 (avc1/avc3),
// H.265 (hvc1/hev1), VP9 (vp09) e AV1 (av01). MKV, TS e MPEG-4 Parte 2 precisam ser convertidos.

export class ErroVideo extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "ErroVideo";
  }
}

/** Leitor de um File/Blob: {tamanho, ler(pos, n) -> Uint8Array}. */
export function leitorDeArquivo(arquivo) {
  return {
    tamanho: arquivo.size,
    ler: async (pos, n) => new Uint8Array(await arquivo.slice(pos, pos + n).arrayBuffer()),
  };
}

const u8 = (b, o) => b[o];
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u24 = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
const u32 = (b, o) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const s32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const u64 = (b, o) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const s64 = (b, o) => s32(b, o) * 2 ** 32 + u32(b, o + 4);
const tipo4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const hex2 = (v) => v.toString(16).padStart(2, "0").toUpperCase();
const dec2 = (v) => String(v).padStart(2, "0");

/** Caixas filhas em b[inicio:fim]: [{tipo, ini (conteúdo), fim}]. */
function filhos(b, inicio, fim) {
  const out = [];
  let p = inicio;
  while (p + 8 <= fim) {
    let tam = u32(b, p);
    const tipo = tipo4(b, p + 4);
    let cab = 8;
    if (tam === 1) {
      tam = u64(b, p + 8);
      cab = 16;
    } else if (tam === 0) {
      tam = fim - p;
    }
    if (tam < cab || p + tam > fim) break;
    out.push({ tipo, ini: p + cab, fim: p + tam, caixa: p });
    p += tam;
  }
  return out;
}

const achar = (lista, tipo) => lista.find((c) => c.tipo === tipo) || null;

function caminho(b, caixa, tipos) {
  let atual = caixa;
  for (const t of tipos) {
    if (!atual) return null;
    atual = achar(filhos(b, atual.ini, atual.fim), t);
  }
  return atual;
}

/** O comentário do arquivo (moov/udta/meta/ilst/©cmt/data), ou null: o `anotacao baixar` guarda nele a origem. */
function comentarioDoMoov(b, cmoov) {
  const udta = achar(cmoov, "udta");
  const meta = udta && achar(filhos(b, udta.ini, udta.fim), "meta");
  if (!meta || meta.fim - meta.ini < 12) return null;
  // no MP4 a caixa "meta" tem versão e flags antes das filhas; no QuickTime, não
  const ini = tipo4(b, meta.ini + 4) === "hdlr" ? meta.ini : meta.ini + 4;
  const ilst = achar(filhos(b, ini, meta.fim), "ilst");
  const cmt = ilst && achar(filhos(b, ilst.ini, ilst.fim), "\u00a9cmt");
  const data = cmt && achar(filhos(b, cmt.ini, cmt.fim), "data");
  if (!data || data.fim - data.ini < 8) return null;
  return new TextDecoder().decode(b.subarray(data.ini + 8, data.fim)); // tipo e idioma vêm antes do texto
}

/** Caixas do nível de cima do arquivo, lendo só os cabeçalhos. */
async function caixasDoTopo(leitor) {
  const out = [];
  let pos = 0;
  while (pos + 8 <= leitor.tamanho) {
    const cab = await leitor.ler(pos, Math.min(16, leitor.tamanho - pos));
    let tam = u32(cab, 0);
    const tipo = tipo4(cab, 4);
    let tamCab = 8;
    if (tam === 1) {
      tam = u64(cab, 8);
      tamCab = 16;
    } else if (tam === 0) {
      tam = leitor.tamanho - pos;
    }
    if (tam < tamCab) throw new ErroVideo("arquivo MP4 danificado (caixa com tamanho inválido)");
    out.push({ tipo, inicio: pos, tamanho: tam, cabecalho: tamCab });
    pos += tam;
  }
  return out;
}

function inverterBits32(v) {
  let r = 0;
  for (let i = 0; i < 32; i++) r = r * 2 + ((v >>> i) & 1);
  return r >>> 0;
}

/** Codec (texto do WebCodecs) e descrição (para H.264/H.265) a partir da entrada do stsd. */
function codecDaEntrada(b, entrada) {
  const formato = entrada.tipo;
  const largura = u16(b, entrada.ini + 24);
  const altura = u16(b, entrada.ini + 26);
  const caixas = filhos(b, entrada.ini + 78, entrada.fim);
  const conteudo = (t) => {
    const c = achar(caixas, t);
    return c ? b.slice(c.ini, c.fim) : null;
  };
  if (formato === "avc1" || formato === "avc3") {
    const avcC = conteudo("avcC");
    if (!avcC) throw new ErroVideo("H.264 sem a configuração avcC");
    return { codec: `${formato}.${hex2(avcC[1])}${hex2(avcC[2])}${hex2(avcC[3])}`, descricao: avcC, largura, altura };
  }
  if (formato === "hvc1" || formato === "hev1") {
    const h = conteudo("hvcC");
    if (!h) throw new ErroVideo("H.265 sem a configuração hvcC");
    const espaco = ["", "A", "B", "C"][h[1] >> 6];
    const camada = h[1] & 0x20 ? "H" : "L";
    const perfil = h[1] & 0x1f;
    const compat = inverterBits32(u32(h, 2)).toString(16).toUpperCase();
    const restricoes = Array.from(h.slice(6, 12));
    while (restricoes.length && restricoes[restricoes.length - 1] === 0) restricoes.pop();
    const partes = [`${formato}`, `${espaco}${perfil}`, compat, `${camada}${h[12]}`, ...restricoes.map((v) => hex2(v))];
    return { codec: partes.join("."), descricao: h, largura, altura };
  }
  if (formato === "vp09") {
    const v = conteudo("vpcC");
    if (!v) throw new ErroVideo("VP9 sem a configuração vpcC");
    return { codec: `vp09.${dec2(v[4])}.${dec2(v[5])}.${dec2(v[6] >> 4)}`, descricao: null, largura, altura };
  }
  if (formato === "av01") {
    const a = conteudo("av1C");
    if (!a) throw new ErroVideo("AV1 sem a configuração av1C");
    const perfil = a[1] >> 5;
    const nivel = a[1] & 0x1f;
    const camada = a[2] & 0x80 ? "H" : "M";
    const bits = a[2] & 0x40 ? (perfil === 2 && a[2] & 0x20 ? 12 : 10) : 8;
    return { codec: `av01.${perfil}.${dec2(nivel)}${camada}.${dec2(bits)}`, descricao: null, largura, altura };
  }
  const nomes = { mp4v: "MPEG-4 Parte 2", encv: "vídeo criptografado", mjpa: "Motion JPEG", jpeg: "Motion JPEG", apcn: "ProRes", apch: "ProRes" };
  throw new ErroVideo(`codec de vídeo não suportado: ${formato}${nomes[formato] ? ` (${nomes[formato]})` : ""}; converta para H.264`);
}

/** Amostras do stbl (MP4 não fragmentado), em ordem de decodificação. */
function amostrasDoStbl(b, stbl) {
  const c = filhos(b, stbl.ini, stbl.fim);
  const stsz = achar(c, "stsz");
  const stz2 = achar(c, "stz2");
  const stco = achar(c, "stco");
  const co64 = achar(c, "co64");
  const stsc = achar(c, "stsc");
  const stts = achar(c, "stts");
  if (!(stsz || stz2) || !(stco || co64) || !stsc || !stts) return [];
  // tamanhos
  const tamanhos = [];
  if (stsz) {
    const fixo = u32(b, stsz.ini + 4);
    const n = u32(b, stsz.ini + 8);
    for (let i = 0; i < n; i++) tamanhos.push(fixo || u32(b, stsz.ini + 12 + 4 * i));
  } else {
    const campo = u8(b, stz2.ini + 7);
    const n = u32(b, stz2.ini + 8);
    for (let i = 0; i < n; i++) {
      if (campo === 16) tamanhos.push(u16(b, stz2.ini + 12 + 2 * i));
      else if (campo === 8) tamanhos.push(u8(b, stz2.ini + 12 + i));
      else tamanhos.push((u8(b, stz2.ini + 12 + (i >> 1)) >> (i % 2 ? 0 : 4)) & 15);
    }
  }
  const n = tamanhos.length;
  // posições: pedaços (chunks) e amostras por pedaço
  const pedacos = [];
  if (stco) {
    const m = u32(b, stco.ini + 4);
    for (let i = 0; i < m; i++) pedacos.push(u32(b, stco.ini + 8 + 4 * i));
  } else {
    const m = u32(b, co64.ini + 4);
    for (let i = 0; i < m; i++) pedacos.push(u64(b, co64.ini + 8 + 8 * i));
  }
  const regras = [];
  const nr = u32(b, stsc.ini + 4);
  for (let i = 0; i < nr; i++) regras.push([u32(b, stsc.ini + 8 + 12 * i), u32(b, stsc.ini + 12 + 12 * i)]);
  const offsets = new Array(n);
  let s = 0;
  for (let r = 0; r < regras.length && s < n; r++) {
    const primeiro = regras[r][0];
    const ultimo = r + 1 < regras.length ? regras[r + 1][0] - 1 : pedacos.length;
    for (let ch = primeiro; ch <= ultimo && s < n; ch++) {
      let pos = pedacos[ch - 1];
      for (let k = 0; k < regras[r][1] && s < n; k++) {
        offsets[s] = pos;
        pos += tamanhos[s];
        s += 1;
      }
    }
  }
  if (s < n) throw new ErroVideo("tabela de amostras incompleta (stsc/stco)");
  // tempos de decodificação
  const dts = new Array(n);
  let t = 0;
  let i = 0;
  const ne = u32(b, stts.ini + 4);
  for (let e = 0; e < ne && i < n; e++) {
    const cont = u32(b, stts.ini + 8 + 8 * e);
    const delta = u32(b, stts.ini + 12 + 8 * e);
    for (let k = 0; k < cont && i < n; k++) {
      dts[i++] = t;
      t += delta;
    }
  }
  while (i < n) dts[i++] = t;
  // deslocamento de composição
  const cts = dts.slice();
  const ctts = achar(c, "ctts");
  if (ctts) {
    const nc = u32(b, ctts.ini + 4);
    let j = 0;
    for (let e = 0; e < nc && j < n; e++) {
      const cont = u32(b, ctts.ini + 8 + 8 * e);
      const off = s32(b, ctts.ini + 12 + 8 * e);
      for (let k = 0; k < cont && j < n; k++) cts[j] = dts[j++] + off;
    }
  }
  // quadros-chave
  const stss = achar(c, "stss");
  let sync = null;
  if (stss) {
    sync = new Set();
    const ns = u32(b, stss.ini + 4);
    for (let k = 0; k < ns; k++) sync.add(u32(b, stss.ini + 8 + 4 * k) - 1);
  }
  const out = new Array(n);
  for (let k = 0; k < n; k++) out[k] = { offset: offsets[k], tamanho: tamanhos[k], dts: dts[k], cts: cts[k], sync: sync ? sync.has(k) : true };
  return out;
}

const SEM_PADROES = Object.freeze({ duracao: 0, tamanho: 0, flags: 0 });

/**
 * Amostras de um moof (MP4 fragmentado) para a faixa `id`. Todas as faixas do moof são percorridas:
 * sem endereço base declarado, os dados de uma faixa começam onde terminam os da faixa anterior.
 * `padroes`: Map id da faixa → valores padrão do trex.
 */
function amostrasDoMoof(b, inicioMoof, moof, id, padroesPorFaixa, dtsAnterior) {
  const out = [];
  let dtsFim = dtsAnterior;
  let fimDaAnterior = null; // fim dos dados da faixa anterior neste moof
  for (const traf of filhos(b, moof.ini, moof.fim).filter((x) => x.tipo === "traf")) {
    const cs = filhos(b, traf.ini, traf.fim);
    const tfhd = achar(cs, "tfhd");
    if (!tfhd) continue;
    const idFaixa = u32(b, tfhd.ini + 4);
    const minha = idFaixa === id;
    const padroes = padroesPorFaixa.get(idFaixa) || SEM_PADROES;
    const fl = u24(b, tfhd.ini + 1);
    let p = tfhd.ini + 8;
    // base explícita; senão o começo do moof (default-base-is-moof, ou a primeira faixa); senão o
    // fim dos dados da faixa anterior
    let base = fimDaAnterior === null || fl & 0x20000 ? inicioMoof : fimDaAnterior;
    if (fl & 0x1) {
      base = u64(b, p);
      p += 8;
    }
    if (fl & 0x2) p += 4;
    let duracaoPadrao = padroes.duracao;
    let tamanhoPadrao = padroes.tamanho;
    let flagsPadrao = padroes.flags;
    if (fl & 0x8) {
      duracaoPadrao = u32(b, p);
      p += 4;
    }
    if (fl & 0x10) {
      tamanhoPadrao = u32(b, p);
      p += 4;
    }
    if (fl & 0x20) flagsPadrao = u32(b, p);
    const tfdt = achar(cs, "tfdt");
    let dts = dtsFim;
    if (tfdt) dts = b[tfdt.ini] === 1 ? u64(b, tfdt.ini + 4) : u32(b, tfdt.ini + 4);
    let fimDados = base;
    for (const trun of cs.filter((x) => x.tipo === "trun")) {
      const ft = u24(b, trun.ini + 1);
      const n = u32(b, trun.ini + 4);
      let q = trun.ini + 8;
      let pos = fimDados;
      if (ft & 0x1) {
        pos = base + s32(b, q);
        q += 4;
      }
      let primeiraFlags = null;
      if (ft & 0x4) {
        primeiraFlags = u32(b, q);
        q += 4;
      }
      for (let k = 0; k < n; k++) {
        let duracao = duracaoPadrao;
        let tamanho = tamanhoPadrao;
        let flags = k === 0 && primeiraFlags !== null ? primeiraFlags : flagsPadrao;
        let comp = 0;
        if (ft & 0x100) {
          duracao = u32(b, q);
          q += 4;
        }
        if (ft & 0x200) {
          tamanho = u32(b, q);
          q += 4;
        }
        if (ft & 0x400) {
          flags = u32(b, q);
          q += 4;
        }
        if (ft & 0x800) {
          comp = s32(b, q); // versão 0 é "sem sinal", mas há gravadores que põem negativos
          q += 4;
        }
        if (minha) out.push({ offset: pos, tamanho, dts, cts: dts + comp, sync: !((flags >>> 16) & 1) });
        pos += tamanho;
        dts += duracao;
      }
      fimDados = pos;
    }
    fimDaAnterior = fimDados;
    if (minha) dtsFim = dts;
  }
  return { amostras: out, dtsFim };
}

/**
 * Abre um MP4/MOV e devolve a faixa de vídeo: {codec, descricao, largura, altura, timescale,
 * inicioMidia, amostras: [{offset, tamanho, dts, cts, sync}], cortadas, fragmentado, comentario}.
 */
export async function abrirMp4(leitor) {
  const topo = await caixasDoTopo(leitor);
  const moovTopo = topo.find((x) => x.tipo === "moov");
  if (!moovTopo) {
    const primeira = topo[0]?.tipo ?? "";
    if (!topo.length || !["ftyp", "mdat", "free", "skip", "wide", "moof", "styp"].includes(primeira)) {
      throw new ErroVideo("não parece um arquivo MP4 ou MOV (MKV e TS precisam ser convertidos para MP4)");
    }
    throw new ErroVideo("o arquivo MP4 está incompleto: falta o índice (moov)");
  }
  if (moovTopo.tamanho > 512 * 2 ** 20) throw new ErroVideo("índice do MP4 grande demais");
  const b = await leitor.ler(moovTopo.inicio, moovTopo.tamanho);
  const moov = { ini: moovTopo.cabecalho, fim: moovTopo.tamanho };
  const cmoov = filhos(b, moov.ini, moov.fim);
  const mvhd = achar(cmoov, "mvhd");
  const escalaFilme = mvhd ? u32(b, mvhd.ini + (b[mvhd.ini] === 1 ? 20 : 12)) : 1000;
  let faixa = null;
  for (const trak of cmoov.filter((x) => x.tipo === "trak")) {
    const hdlr = caminho(b, trak, ["mdia", "hdlr"]);
    if (hdlr && tipo4(b, hdlr.ini + 8) === "vide") {
      faixa = trak;
      break;
    }
  }
  if (!faixa) throw new ErroVideo("o arquivo não tem faixa de vídeo");
  const tkhd = caminho(b, faixa, ["tkhd"]);
  const id = tkhd ? u32(b, tkhd.ini + (b[tkhd.ini] === 1 ? 20 : 12)) : 1;
  const mdhd = caminho(b, faixa, ["mdia", "mdhd"]);
  const timescale = u32(b, mdhd.ini + (b[mdhd.ini] === 1 ? 20 : 12));
  const stbl = caminho(b, faixa, ["mdia", "minf", "stbl"]);
  const stsd = achar(filhos(b, stbl.ini, stbl.fim), "stsd");
  const entrada = filhos(b, stsd.ini + 8, stsd.fim)[0];
  if (!entrada) throw new ErroVideo("faixa de vídeo sem descrição do codec");
  const { codec, descricao, largura, altura } = codecDaEntrada(b, entrada);

  // lista de edição: onde começa a mídia apresentada (o resto é pré-rolagem)
  let inicioMidia = 0;
  const elst = caminho(b, faixa, ["edts", "elst"]);
  if (elst) {
    const v = b[elst.ini];
    const n = u32(b, elst.ini + 4);
    let p = elst.ini + 8;
    for (let k = 0; k < n; k++) {
      const mediaTime = v === 1 ? s64(b, p + 8) : s32(b, p + 4);
      p += v === 1 ? 20 : 12;
      if (mediaTime !== -1) {
        inicioMidia = mediaTime;
        break;
      }
    }
  }

  let amostras = amostrasDoStbl(b, stbl);
  const mvex = achar(cmoov, "mvex");
  const moofs = topo.filter((x) => x.tipo === "moof");
  if (mvex && moofs.length) {
    const padroes = new Map();
    for (const trex of filhos(b, mvex.ini, mvex.fim).filter((x) => x.tipo === "trex")) {
      padroes.set(u32(b, trex.ini + 4), { duracao: u32(b, trex.ini + 12), tamanho: u32(b, trex.ini + 16), flags: u32(b, trex.ini + 20) });
    }
    let dts = amostras.length ? amostras[amostras.length - 1].dts + 1 : 0;
    for (const m of moofs) {
      const bm = await leitor.ler(m.inicio, m.tamanho);
      const r = amostrasDoMoof(bm, m.inicio, { ini: m.cabecalho, fim: m.tamanho }, id, padroes, dts);
      amostras = amostras.concat(r.amostras);
      dts = r.dtsFim;
    }
  }
  // arquivo cortado (download ou cópia interrompida): as amostras que passam do fim ficam de fora
  const declaradas = amostras.length;
  amostras = amostras.filter((a) => a.offset + a.tamanho <= leitor.tamanho);
  const cortadas = declaradas - amostras.length;
  if (!amostras.length) throw new ErroVideo(cortadas ? "o arquivo está cortado antes do primeiro quadro" : "a faixa de vídeo não tem quadros");
  if (!amostras.some((a) => a.sync)) throw new ErroVideo("o vídeo não tem nenhum quadro-chave");
  // se não começar num quadro-chave (gravação cortada no meio), a leitura pula até o primeiro
  return {
    codec,
    descricao,
    largura,
    altura,
    timescale,
    escalaFilme,
    inicioMidia,
    amostras,
    cortadas,
    fragmentado: Boolean(mvex && moofs.length),
    comentario: comentarioDoMoov(b, cmoov),
  };
}

/**
 * Ordem de apresentação: os quadros exibidos (sem a pré-rolagem), cada um com o índice da amostra e
 * o tempo em microssegundos (para o WebCodecs) e em milissegundos contados do primeiro quadro.
 */
export function apresentacao(faixa) {
  const { amostras, timescale, inicioMidia } = faixa;
  const idx = [];
  for (let i = 0; i < amostras.length; i++) if (amostras[i].cts >= inicioMidia) idx.push(i);
  idx.sort((a, b) => amostras[a].cts - amostras[b].cts);
  const t0 = idx.length ? amostras[idx[0]].cts : 0;
  const tsUs = new Float64Array(amostras.length);
  for (let i = 0; i < amostras.length; i++) tsUs[i] = Math.round(((amostras[i].cts - t0) * 1e6) / timescale);
  const ptsMs = new Float64Array(idx.length);
  idx.forEach((i, k) => {
    ptsMs[k] = ((amostras[i].cts - t0) * 1000) / timescale;
  });
  return { ordem: idx, tsUs, ptsMs };
}
