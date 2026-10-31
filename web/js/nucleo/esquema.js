// Validação por JSON Schema — só as palavras que os esquemas gerados pelo pydantic usam
// (web/esquemas/*.json). Preenche os valores padrão que faltam, como o pydantic faz ao ler.

const RE_DATA_HORA = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|z|[+-]\d{2}:?\d{2})?$/;

function tipoDe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function confereTipo(tipo, v) {
  const t = tipoDe(v);
  if (tipo === "number") return (t === "number" || t === "integer") && Number.isFinite(v);
  if (tipo === "integer") return t === "integer";
  return t === tipo;
}

const copiar = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function caminhoTexto(caminho) {
  return caminho.length ? caminho.join(".") : "(raiz)";
}

/**
 * Valida `valor` contra `esquema` (com `$defs` na raiz). Devolve a lista de erros (vazia se ok).
 * Os valores padrão (`default`) ausentes são preenchidos em `valor`, no lugar.
 */
export function validarEsquema(esquema, valor) {
  const erros = [];
  const raiz = esquema;

  function resolver(s) {
    let atual = s;
    for (let i = 0; i < 20 && atual && atual.$ref; i++) {
      const ref = atual.$ref;
      if (!ref.startsWith("#/$defs/")) throw new Error(`$ref não suportada: ${ref}`);
      atual = raiz.$defs[ref.slice("#/$defs/".length)];
      if (!atual) throw new Error(`$ref sem definição: ${ref}`);
    }
    return atual;
  }

  function checar(s0, v, caminho, saida) {
    const s = resolver(s0);
    if (s === true || s === undefined) return;
    if (s === false) {
      saida.push(`${caminhoTexto(caminho)}: não é permitido`);
      return;
    }
    if (s.anyOf) {
      const doTipo = [];
      for (const alt of s.anyOf) {
        const tentativa = [];
        checar(alt, v, caminho, tentativa);
        if (!tentativa.length) return;
        const r = resolver(alt);
        const tipos = r.type ? (Array.isArray(r.type) ? r.type : [r.type]) : null;
        if (!tipos || tipos.some((t) => confereTipo(t, v))) doTipo.push(tentativa);
      }
      if (doTipo.length === 1) {
        saida.push(...doTipo[0]); // só uma alternativa é do tipo certo: os erros são dela
        return;
      }
      const tipos = s.anyOf.map((a) => resolver(a).type || resolver(a).title || "?").join(" ou ");
      saida.push(`${caminhoTexto(caminho)}: esperado ${tipos}`);
      return;
    }
    if (s.type) {
      const tipos = Array.isArray(s.type) ? s.type : [s.type];
      if (!tipos.some((t) => confereTipo(t, v))) {
        saida.push(`${caminhoTexto(caminho)}: esperado ${tipos.join(" ou ")}, veio ${tipoDe(v)}`);
        return;
      }
    }
    if ("const" in s && v !== s.const) saida.push(`${caminhoTexto(caminho)}: deveria ser ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) {
      saida.push(`${caminhoTexto(caminho)}: valor ${JSON.stringify(v)} fora de ${s.enum.join(", ")}`);
    }
    if (typeof v === "number") {
      if (s.minimum !== undefined && !(v >= s.minimum)) saida.push(`${caminhoTexto(caminho)}: deve ser ≥ ${s.minimum}`);
      if (s.maximum !== undefined && !(v <= s.maximum)) saida.push(`${caminhoTexto(caminho)}: deve ser ≤ ${s.maximum}`);
      if (s.exclusiveMinimum !== undefined && !(v > s.exclusiveMinimum)) {
        saida.push(`${caminhoTexto(caminho)}: deve ser > ${s.exclusiveMinimum}`);
      }
      if (s.exclusiveMaximum !== undefined && !(v < s.exclusiveMaximum)) {
        saida.push(`${caminhoTexto(caminho)}: deve ser < ${s.exclusiveMaximum}`);
      }
    }
    if (typeof v === "string") {
      if (s.minLength !== undefined && v.length < s.minLength) saida.push(`${caminhoTexto(caminho)}: não pode ser vazio`);
      if (s.maxLength !== undefined && v.length > s.maxLength) saida.push(`${caminhoTexto(caminho)}: no máximo ${s.maxLength} caracteres`);
      if (s.pattern && !new RegExp(s.pattern, "u").test(v)) {
        saida.push(`${caminhoTexto(caminho)}: ${JSON.stringify(v)} fora do padrão`);
      }
      if (s.format === "date-time" && !(RE_DATA_HORA.test(v) && !Number.isNaN(Date.parse(v)))) {
        saida.push(`${caminhoTexto(caminho)}: data e hora inválida`);
      }
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) saida.push(`${caminhoTexto(caminho)}: no mínimo ${s.minItems} itens`);
      if (s.maxItems !== undefined && v.length > s.maxItems) saida.push(`${caminhoTexto(caminho)}: no máximo ${s.maxItems} itens`);
      const prefixo = s.prefixItems || [];
      v.forEach((item, i) => {
        if (i < prefixo.length) checar(prefixo[i], item, [...caminho, i], saida);
        else if (s.items !== undefined) checar(s.items, item, [...caminho, i], saida);
      });
    }
    if (tipoDe(v) === "object") {
      const props = s.properties || {};
      for (const [nome, sub] of Object.entries(props)) {
        if (!(nome in v)) {
          const r = resolver(sub);
          const padrao = "default" in sub ? sub.default : r && "default" in r ? r.default : undefined;
          if (padrao !== undefined && !(s.required || []).includes(nome)) v[nome] = copiar(padrao);
        }
      }
      for (const nome of s.required || []) {
        if (!(nome in v)) saida.push(`${caminhoTexto([...caminho, nome])}: obrigatório`);
      }
      for (const [nome, item] of Object.entries(v)) {
        if (nome in props) checar(props[nome], item, [...caminho, nome], saida);
        else if (s.additionalProperties === false) saida.push(`${caminhoTexto([...caminho, nome])}: campo desconhecido`);
        else if (s.additionalProperties && typeof s.additionalProperties === "object") {
          checar(s.additionalProperties, item, [...caminho, nome], saida);
        }
      }
    }
  }

  checar(esquema, valor, [], erros);
  return erros;
}
