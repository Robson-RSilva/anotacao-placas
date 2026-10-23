// Página central: quem está anotando, filas, partidas, importação, placar e conjuntos.

import { api, el, enviarArquivo, formatarTempo, numero } from "./api.js";

let estado = null;

function celula(texto, classe = "") {
  const td = document.createElement("td");
  td.textContent = texto;
  if (classe) td.className = classe;
  return td;
}

function porcento(a, b) {
  return b ? `${a} (${Math.round((100 * a) / b)}%)` : String(a);
}

async function carregarEstado() {
  estado = await api.get("/api/estado");
  el("versao").textContent = `v${estado.versao}`;
  el("pasta").textContent = `Pasta: ${estado.pasta}` + (estado.previsor ? ` · previsor ${estado.previsor}` : " · sem previsor");
  if (estado.manual_url) {
    el("manual").href = estado.manual_url;
    el("manual").hidden = false;
  }
  const sel = el("pessoa");
  sel.replaceChildren(new Option("escolha…", ""), ...estado.equipe.map((m) => new Option(`${m.codigo} · ${m.nome}`, m.codigo)));
  sel.value = estado.anotador || "";
  const temPessoa = Boolean(estado.anotador);
  el("ir-camera").classList.toggle("desligado", !temPessoa);
  el("ir-revisao").classList.toggle("desligado", !temPessoa || !estado.papeis.includes("revisor"));
  if (!estado.equipe.length) {
    el("st-camera").textContent = "A equipe está vazia: preencha equipe.json na pasta de trabalho.";
  } else if (!temPessoa) {
    el("st-camera").textContent = "Escolha o seu código no alto da página.";
  } else {
    const s = estado.situacao;
    el("st-camera").textContent = s.liberado
      ? (estado.gabarito_itens ? `Liberado (gabarito: ${numero(s.mediana_px, 1)} px).` : "Liberado (sem gabarito importado).")
      : `Em treino: ${s.motivo}.`;
  }
  el("st-revisao").textContent = !temPessoa ? "—"
    : estado.papeis.includes("revisor") ? `${estado.pendentes_revisao} rótulo(s) esperando você.` : "Você não é revisor.";
  const fp = document.querySelector("#form-importar select[name=pacote]");
  fp.replaceChildren(...estado.pacotes.map((p) => new Option(p, p)));
}

async function carregarPartidas() {
  const lista = await api.get("/api/partidas");
  const tbody = el("partidas").querySelector("tbody");
  tbody.replaceChildren();
  if (!lista.length) {
    const tr = document.createElement("tr");
    const td = celula("Nenhuma partida importada ainda.", "sutil");
    td.colSpan = 7;
    tr.append(td);
    tbody.append(tr);
  }
  for (const p of lista) {
    const c = p.cadastro;
    const g = p.progresso || {};
    const tr = document.createElement("tr");
    tr.append(
      celula(p.partida),
      celula(c.emissora),
      celula(`${c.iluminacao}${c.chuva ? ", chuva" : ""}`),
      celula(String(g.sorteados ?? "—")),
      celula(porcento(g.anotados ?? 0, g.sorteados ?? 0)),
      celula(porcento(g.aprovados ?? 0, g.sorteados ?? 0)),
      celula(String(g.pendentes_revisao ?? 0)),
    );
    tbody.append(tr);
  }
}

async function carregarPlacar() {
  const pl = await api.get("/api/placar");
  const tbody = el("placar").querySelector("tbody");
  tbody.replaceChildren();
  for (const p of pl.pessoas) {
    const tr = document.createElement("tr");
    const gab = p.gabarito_n ? `${numero(p.gabarito_mediana_px, 1)} px (${p.gabarito_n})` : "—";
    tr.append(
      celula(`${p.pessoa}${p.nome ? ` · ${p.nome}` : ""}`),
      celula(String(p.aprovados_semana), "num"),
      celula(String(p.aprovados), "num"),
      celula(p.taxa_aprovacao === null ? "—" : `${Math.round(100 * p.taxa_aprovacao)}%`, "num"),
      celula(p.tempo_mediano_s === null ? "—" : formatarTempo(p.tempo_mediano_s), "num"),
      celula(p.concordancia_px === null ? "—" : `${numero(p.concordancia_px, 1)} px`, "num"),
      celula(gab + (p.liberado ? "" : " · em treino")),
      celula(String(p.dias_seguidos), "num"),
      celula(p.marcos.join(", ") || "—"),
    );
    tbody.append(tr);
  }
}

el("pessoa").onchange = async (e) => {
  if (!e.target.value) return;
  await api.post("/api/anotador", { codigo: e.target.value });
  await atualizar();
};

for (const id of ["ir-camera", "ir-revisao"]) {
  el(id).addEventListener("click", (e) => {
    if (e.currentTarget.classList.contains("desligado")) e.preventDefault();
  });
}

el("abrir-importar").onclick = () => {
  el("importar").hidden = false;
  el("importar").scrollIntoView({ behavior: "smooth" });
};
el("cancelar-importar").onclick = () => {
  el("importar").hidden = true;
};

function mostrarProgresso(etapa, frac) {
  el("progresso").hidden = false;
  el("barra").style.width = `${Math.round(100 * frac)}%`;
  el("etapa").textContent = `${etapa} ${Math.round(100 * frac)}%`;
}

el("form-importar").onsubmit = async (e) => {
  e.preventDefault();
  el("erro-importar").textContent = "";
  const f = new FormData(e.target);
  const [estadio, versao] = String(f.get("pacote")).split("/pacote-");
  const arquivo = f.get("video");
  const botao = e.target.querySelector("button[type=submit]");
  botao.disabled = true;
  try {
    const cadastro = {
      estadio,
      pacote_versao: versao,
      emissora: f.get("emissora"),
      competicao: f.get("competicao"),
      data_hora: new Date(f.get("data_hora")).toISOString(),
      mandante: f.get("mandante"),
      visitante: f.get("visitante"),
      iluminacao: f.get("iluminacao"),
      chuva: f.get("chuva") === "on",
      observacoes: f.get("observacoes") || "",
    };
    mostrarProgresso("enviando o vídeo", 0);
    const env = await enviarArquivo(`/api/videos?nome=${encodeURIComponent(arquivo.name)}`, arquivo,
      (fr) => mostrarProgresso("enviando o vídeo", fr));
    const { tarefa } = await api.post("/api/partidas", {
      cadastro, video_sha256: env.video_sha256, nome_original: env.nome_original, alvo: Number(f.get("alvo") || 100),
    });
    for (;;) {
      await new Promise((r) => setTimeout(r, 800));
      const t = await api.get(`/api/tarefas/${tarefa}`);
      mostrarProgresso(t.etapa || "na fila", t.progresso || 0);
      if (t.estado === "ok") {
        mostrarProgresso(`pronto: ${t.resultado.partida}, ${t.resultado.n_sorteados} quadros sorteados`, 1);
        break;
      }
      if (t.estado === "erro") throw new Error(t.erro);
    }
    e.target.reset();
    await atualizar();
  } catch (err) {
    el("erro-importar").textContent = err.message;
  } finally {
    botao.disabled = false;
  }
};

el("unificar").onclick = async () => {
  el("res-unificar").textContent = "unificando…";
  try {
    const r = await api.post("/api/unificar");
    const partes = Object.entries(r.por_conjunto).map(([k, v]) => `${k}: ${v}`).join(", ");
    el("res-unificar").textContent = `${r.quadros} quadros em ${r.destino}${partes ? ` (${partes})` : ""}`;
  } catch (err) {
    el("res-unificar").textContent = err.message;
  }
};

async function atualizar() {
  await carregarEstado();
  await Promise.all([carregarPartidas(), carregarPlacar()]);
}

atualizar().catch((e) => {
  document.body.prepend(Object.assign(document.createElement("p"), { className: "erro", textContent: e.message }));
});
