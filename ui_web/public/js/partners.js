function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(v) {
  return String(v ?? "").trim();
}

function hashSeed(seed) {
  const text = normalizeText(seed);
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h * 31) + text.charCodeAt(i)) >>> 0;
  }
  return h;
}

function pickSeeded(options, seed) {
  if (!Array.isArray(options) || options.length === 0) return "";
  const idx = hashSeed(seed) % options.length;
  return options[idx];
}

function renderTable(container, cols, rows) {
  if (!container) return;

  const thead = cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
  const tbody = rows
    .map((r) => {
      const tds = cols.map((c) => `<td>${escapeHtml(r[c.key] ?? "-")}</td>`).join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");

  container.innerHTML = `
    <table>
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>
  `;
}

const $table = document.getElementById("partnersTable");
const $search = document.getElementById("partnerSearch");
const $reload = document.getElementById("btnReload");

const PATH = "/partners";
let cache = [];

const BRAND_CORES = [
  "Aurora",
  "Vale Verde",
  "Boa Vista",
  "Monte Real",
  "Estrela do Campo",
  "Pampa Nobre",
  "Serra Azul",
  "Alvorada",
  "Santa Helena",
  "Rio Dourado",
  "Campo Forte",
  "Nova Esperanca",
  "Portal do Hipismo",
  "Sol do Cerrado",
  "Lagoa Clara",
  "Imperio Equestre",
  "Bela Vista",
  "Vila Hipica",
  "Rota dos Cavalos",
  "Santo Trote",
];

const STYLE_BY_SEGMENT = {
  CAVALOS: ["Haras", "Centro Equestre", "Hipica", "Rancho", "Estancia"],
  SERVICOS: ["Clinica Veterinaria", "Consultoria", "Centro de Treinamento", "Gestao Equestre", "Laboratorio"],
  EVENTOS: ["Arena", "Circuito", "Expo", "Festival", "Grand Prix"],
  EQUIPAMENTOS: ["Selaria", "Equipamentos", "Suprimentos", "Ferragens", "Sela e Cia"],
  DEFAULT: ["Grupo Equestre", "Parceiro Equestre", "Operadora Equestre"],
};

const ACTIVITY_BY_SEGMENT = {
  CAVALOS: "Criacao e Manejo de Equinos",
  SERVICOS: "Servicos Equestres",
  EVENTOS: "Eventos e Producoes Equestres",
  EQUIPAMENTOS: "Comercio de Artigos Equestres",
  DEFAULT: "Negocios Equestres",
};

const LEGAL_TYPES = ["LTDA", "S.A.", "EIRELI", "ME", "EPP"];

function partnerSeed(p) {
  return [
    normalizeText(p?.id),
    normalizeText(p?.cnpj),
    normalizeText(p?.uf),
    normalizeText(p?.municipio_nome || p?.municipio),
    normalizeText(p?.segmento),
  ].join("|");
}

function buildFantasyName(p) {
  const segment = normalizeText(p?.segmento).toUpperCase();
  const seed = partnerSeed(p);
  const styles = STYLE_BY_SEGMENT[segment] || STYLE_BY_SEGMENT.DEFAULT;
  const style = pickSeeded(styles, `${seed}:style`);
  const core = pickSeeded(BRAND_CORES, `${seed}:core`);
  return `${style} ${core}`.replace(/\s+/g, " ").trim();
}

function buildCorporateName(fantasyName, p) {
  const segment = normalizeText(p?.segmento).toUpperCase();
  const seed = partnerSeed(p);
  const legalType = pickSeeded(LEGAL_TYPES, `${seed}:legal`);
  const activity = ACTIVITY_BY_SEGMENT[segment] || ACTIVITY_BY_SEGMENT.DEFAULT;
  return `${fantasyName} ${activity} ${legalType}`.replace(/\s+/g, " ").trim();
}

function mapPartner(p) {
  const nomeFantasia = buildFantasyName(p);
  const razaoSocial = buildCorporateName(nomeFantasia, p);

  return {
    id: p.id || "",
    cnpj: p.cnpj || "-",
    nome_fantasia: nomeFantasia || "-",
    razao_social: razaoSocial || "-",
    uf: p.uf || "-",
    municipio: p.municipio_nome || p.municipio || "-",
    segmento: p.segmento || "-",
    prioridade: p.prioridade ?? "-",
    cnae: p.cnae_principal || "-",
  };
}

function partnerSortKey(row) {
  const id = normalizeText(row?.id).toLowerCase();
  const cnpj = normalizeText(row?.cnpj).toLowerCase();
  const nome = normalizeText(row?.nome_fantasia).toLowerCase();
  return `${id}|${cnpj}|${nome}`;
}

function sortPartners(rows) {
  return [...(rows || [])].sort((a, b) => partnerSortKey(a).localeCompare(partnerSortKey(b)));
}

function applyFilter(query) {
  const q = String(query || "").trim().toLowerCase();
  const rows = q
    ? cache.filter((x) => JSON.stringify(x).toLowerCase().includes(q))
    : cache;

  renderTable(
    $table,
    [
      { key: "cnpj", label: "CNPJ" },
      { key: "nome_fantasia", label: "Nome fantasia" },
      { key: "razao_social", label: "Razao social" },
      { key: "uf", label: "UF" },
      { key: "municipio", label: "Municipio" },
      { key: "segmento", label: "Segmento" },
      { key: "prioridade", label: "Prioridade" },
      { key: "cnae", label: "CNAE principal" },
      { key: "id", label: "ID" },
    ],
    rows
  );
}

async function load() {
  try {
    const resp = await fetch(`/api${PATH}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const rows = Array.isArray(data) ? data : [];
    cache = sortPartners(rows.map(mapPartner));
  } catch (err) {
    cache = [
      {
        id: "demo-partner-1",
        cnpj: "00.000.000/0001-00",
        nome_fantasia: "Selaria Vale Verde",
        razao_social: "Selaria Vale Verde Comercio de Artigos Equestres LTDA",
        uf: "SP",
        municipio: "Sao Paulo",
        segmento: "EQUIPAMENTOS",
        prioridade: 2,
        cnae: "4647-8/01",
      },
    ];
  }

  applyFilter($search?.value);
}

$search?.addEventListener("input", (e) => applyFilter(e.target.value));
$reload?.addEventListener("click", load);

load();
