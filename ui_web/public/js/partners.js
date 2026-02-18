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

function safeText(value, fallback = "-") {
  const txt = normalizeText(value);
  return txt || fallback;
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

function shortId(value) {
  const txt = normalizeText(value);
  if (!txt) return "-";
  return txt.length <= 8 ? txt : `${txt.slice(0, 8)}...`;
}

function normalizeObject(value, fallbackKey = "valor") {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;

  const txt = normalizeText(value);
  if (!txt) return {};

  if ((txt.startsWith("{") && txt.endsWith("}")) || (txt.startsWith("[") && txt.endsWith("]"))) {
    try {
      const parsed = JSON.parse(txt);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (_err) {
      // fallback to plain key/value
    }
  }

  return { [fallbackKey]: txt };
}

function labelizeKey(key) {
  const txt = normalizeText(key).replaceAll("_", " ").toLowerCase();
  return txt || "campo";
}

function isUrl(value) {
  const txt = normalizeText(value);
  if (!txt) return false;
  try {
    const u = new URL(txt);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (_err) {
    return false;
  }
}

function isEmail(value) {
  const txt = normalizeText(value);
  if (!txt) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt);
}

function segmentLabel(rawSegment) {
  const seg = normalizeText(rawSegment).toUpperCase();
  if (seg === "CAVALOS") return "Cavalos";
  if (seg === "SERVICOS") return "Servicos";
  if (seg === "EVENTOS") return "Eventos";
  if (seg === "EQUIPAMENTOS") return "Equipamentos";
  return safeText(rawSegment, "-");
}

function formatPartnerDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return normalizeText(value);
}

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
  const nomeFantasia = normalizeText(p.nome_fantasia) || buildFantasyName(p);
  const razaoSocial = normalizeText(p.razao_social) || buildCorporateName(nomeFantasia, p);
  const segmentoRaw = normalizeText(p.segmento || p.segment);
  const fallbackId = [
    normalizeText(p.cnpj),
    normalizeText(nomeFantasia),
    normalizeText(p.uf),
    normalizeText(p.municipio_nome || p.municipio || p.cidade),
  ]
    .filter(Boolean)
    .join("|");

  return {
    id: normalizeText(p.id) || fallbackId,
    cnpj: safeText(p.cnpj, "-"),
    nome_fantasia: safeText(nomeFantasia, "-"),
    razao_social: safeText(razaoSocial, "-"),
    uf: safeText(normalizeText(p.uf).toUpperCase(), "-"),
    municipio: safeText(p.municipio_nome || p.municipio || p.cidade || p.municipio_cod, "-"),
    segmento_raw: safeText(segmentoRaw, "-"),
    segmento: segmentLabel(segmentoRaw),
    prioridade: p.prioridade ?? "-",
    cnae: safeText(p.cnae_principal || p.cnae, "-"),
    data_inicio_atividade: safeText(formatPartnerDate(p.data_inicio_atividade), "-"),
    situacao_cadastral: safeText(p.situacao_cadastral, "-"),
    contato: normalizeObject(p.contato, "contato"),
    endereco: normalizeObject(p.endereco, "endereco"),
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

const TABLE_COLUMNS = [
  { key: "__row_num", label: "Ordem" },
  { key: "cnpj", label: "CNPJ" },
  { key: "nome_fantasia", label: "Nome fantasia" },
  { key: "uf", label: "UF" },
  { key: "municipio", label: "Municipio" },
  { key: "segmento", label: "Segmento" },
  { key: "prioridade", label: "Prioridade" },
  { key: "id", label: "ID" },
];

const PATH = "/partners";
const PARTNERS_WINDOW_ROWS = 20;
const PARTNERS_WINDOW_MIN_HEIGHT = 220;
const PARTNERS_WINDOW_MAX_HEIGHT = 920;

const $table = document.getElementById("partnersTable");
const $search = document.getElementById("partnerSearch");
const $reload = document.getElementById("btnReload");
const $partnerSelect = document.getElementById("partnerDetailSelect");
const $partnerOrderSearch = document.getElementById("partnerOrderSearch");
const $btnPartnerOrderSearch = document.getElementById("btnPartnerOrderSearch");
const $btnPartnerOrderClear = document.getElementById("btnPartnerOrderClear");
const $partnerOrderSearchNotice = document.getElementById("partnerOrderSearchNotice");
const $infoWrap = document.getElementById("partnerInfoWrap");
const $contactWrap = document.getElementById("partnerContactWrap");
const $addressWrap = document.getElementById("partnerAddressWrap");

const state = {
  allRows: [],
  filteredRows: [],
  selectedId: null,
  keepSelectionEmpty: false,
};

function setOrderSearchNotice(message, isError = false) {
  if (!$partnerOrderSearchNotice) return;

  const msg = normalizeText(message);
  if (!msg) {
    $partnerOrderSearchNotice.style.display = "none";
    $partnerOrderSearchNotice.textContent = "";
    return;
  }

  $partnerOrderSearchNotice.style.display = "block";
  $partnerOrderSearchNotice.textContent = msg;
  $partnerOrderSearchNotice.style.borderColor = isError
    ? "rgba(255,107,129,0.5)"
    : "rgba(55,214,122,0.45)";
  $partnerOrderSearchNotice.style.color = isError ? "#ff9db0" : "#a5f7c7";
}

function resetPartnersTableWindow() {
  if (!$table) return;
  $table.classList.remove("partners-table-window");
  $table.style.maxHeight = "";
}

function applyPartnersTableWindow() {
  if (!$table) return;

  const tableEl = $table.querySelector("table");
  const headerRow = tableEl?.querySelector("thead tr");
  const bodyRows = tableEl?.querySelectorAll("tbody tr[data-partner-id]");

  if (!tableEl || !headerRow || !bodyRows?.length) {
    resetPartnersTableWindow();
    return;
  }

  const visibleRows = Math.min(PARTNERS_WINDOW_ROWS, bodyRows.length);
  let bodyHeight = 0;
  for (let i = 0; i < visibleRows; i += 1) {
    bodyHeight += bodyRows[i].getBoundingClientRect().height;
  }

  const headerHeight = headerRow.getBoundingClientRect().height;
  const rawHeight = Math.round(headerHeight + bodyHeight + 2);
  const clampedHeight = Math.min(
    PARTNERS_WINDOW_MAX_HEIGHT,
    Math.max(PARTNERS_WINDOW_MIN_HEIGHT, rawHeight)
  );

  $table.style.maxHeight = `${clampedHeight}px`;
  $table.classList.add("partners-table-window");
}

function renderTable(container, cols, rows) {
  if (!container) return;

  const thead = cols.map((c) => `<th class="col-${escapeHtml(c.key)}">${escapeHtml(c.label)}</th>`).join("");
  const tbody = rows.length
    ? rows
        .map((r) => {
          const rowId = normalizeText(r.id);
          const selected = state.selectedId && rowId === state.selectedId ? "is-selected" : "";
          const tds = cols
            .map((c) => `<td class="col-${escapeHtml(c.key)}">${escapeHtml(r[c.key] ?? "-")}</td>`)
            .join("");
          return `<tr data-partner-id="${escapeHtml(rowId)}" class="${selected}">${tds}</tr>`;
        })
        .join("")
    : `<tr><td class="partner-table-empty" colspan="${cols.length}">Nenhum parceiro encontrado com os filtros atuais.</td></tr>`;

  container.innerHTML = `
    <table>
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>
  `;

  applyPartnersTableWindow();
}

function syncOrderSearchControls() {
  const total = state.filteredRows.length;
  const hasRows = total > 0;

  if ($partnerOrderSearch) {
    $partnerOrderSearch.disabled = !hasRows;
    $partnerOrderSearch.max = hasRows ? String(total) : "";
    if (!hasRows) $partnerOrderSearch.value = "";
  }
  if ($btnPartnerOrderSearch) $btnPartnerOrderSearch.disabled = !hasRows;
}

function syncOrderInputFromSelection() {
  if (!$partnerOrderSearch || $partnerOrderSearch.disabled) return;
  const selected = findPartnerById(state.selectedId);
  const order = Number(selected?.__row_num);
  if (Number.isInteger(order) && order > 0) {
    $partnerOrderSearch.value = String(order);
  }
}

function scrollToSelectedPartnerRow() {
  if (!$table || !state.selectedId) return;

  const rows = $table.querySelectorAll("tbody tr[data-partner-id]");
  if (!rows.length) return;

  let selectedRow = null;
  for (const row of rows) {
    if (normalizeText(row.getAttribute("data-partner-id")) === normalizeText(state.selectedId)) {
      selectedRow = row;
      break;
    }
  }
  if (!selectedRow) return;

  const rowTop = selectedRow.offsetTop;
  const rowBottom = rowTop + selectedRow.offsetHeight;
  const viewTop = $table.scrollTop;
  const viewBottom = viewTop + $table.clientHeight;
  const pad = 8;

  if (rowTop < viewTop) {
    $table.scrollTop = Math.max(0, rowTop - pad);
    return;
  }
  if (rowBottom > viewBottom) {
    $table.scrollTop = Math.max(0, rowBottom - $table.clientHeight + pad);
  }
}

function renderCurrentSelectionUi(scrollToSelectedRow = false) {
  renderTable($table, TABLE_COLUMNS, state.filteredRows);
  renderPartnerSelect(state.filteredRows);
  renderPartnerDetails();
  syncOrderSearchControls();
  syncOrderInputFromSelection();
  if (scrollToSelectedRow) scrollToSelectedPartnerRow();
}

function findPartnerById(partnerId) {
  const id = normalizeText(partnerId);
  if (!id) return null;

  for (const item of state.filteredRows) {
    if (normalizeText(item.id) === id) return item;
  }
  for (const item of state.allRows) {
    if (normalizeText(item.id) === id) return item;
  }
  return null;
}

function ensureSelectedPartner(rows) {
  if (!rows.length) {
    state.selectedId = null;
    return;
  }
  if (state.keepSelectionEmpty) {
    state.selectedId = null;
    return;
  }

  const hasSelected = rows.some((row) => normalizeText(row.id) === normalizeText(state.selectedId));
  if (!hasSelected) state.selectedId = normalizeText(rows[0].id);
}

function partnerOptionLabel(partner, index = 0) {
  const cityUf = `${partner.municipio}/${partner.uf}`;
  const ordem = Number(partner.__row_num) || index + 1;
  return `${ordem} | ${partner.cnpj} | ${partner.nome_fantasia} - ${cityUf} | ${partner.segmento} | id=${shortId(partner.id)}`;
}

function findPartnerByOrder(order) {
  const n = Number(order);
  if (!Number.isInteger(n) || n <= 0) return null;
  return state.filteredRows.find((row) => Number(row.__row_num) === n) || null;
}

function renderPartnerSelect(rows) {
  if (!$partnerSelect) return;

  if (!rows.length) {
    $partnerSelect.innerHTML = `<option value="">Nenhum parceiro disponivel</option>`;
    $partnerSelect.disabled = true;
    return;
  }

  const options = [
    `<option value="" ${normalizeText(state.selectedId) ? "" : "selected"}>- selecione -</option>`,
  ];

  options.push(...rows.map((partner, index) => {
    const partnerId = normalizeText(partner.id);
    const selected = normalizeText(state.selectedId) === partnerId ? "selected" : "";
    return `<option value="${escapeHtml(partnerId)}" ${selected}>${escapeHtml(partnerOptionLabel(partner, index))}</option>`;
  }));

  $partnerSelect.innerHTML = options.join("");
  $partnerSelect.disabled = false;
  $partnerSelect.value = normalizeText(state.selectedId) || "";
}

function renderInfoTable(partner) {
  if (!$infoWrap) return;

  const infoRows = [
    { label: "CNPJ", value: partner.cnpj },
    { label: "Nome fantasia", value: partner.nome_fantasia },
    { label: "Razao social", value: partner.razao_social },
    { label: "UF", value: partner.uf },
    { label: "Municipio", value: partner.municipio },
    { label: "Segmento", value: partner.segmento },
    { label: "Prioridade", value: partner.prioridade },
    { label: "CNAE principal", value: partner.cnae },
    { label: "Inicio da atividade", value: partner.data_inicio_atividade },
    { label: "Situacao cadastral", value: partner.situacao_cadastral },
  ];

  const tbody = infoRows
    .map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(safeText(row.value, "-"))}</td></tr>`)
    .join("");

  $infoWrap.innerHTML = `
    <table class="partner-kv-table">
      <thead>
        <tr>
          <th>Campo</th>
          <th>Valor</th>
        </tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>
  `;
}

function partnerBulletValueHtml(value) {
  const txt = safeText(value, "-");
  if (isUrl(txt)) {
    return `<a href="${escapeHtml(txt)}" target="_blank" rel="noopener noreferrer">${escapeHtml(txt)}</a>`;
  }
  if (isEmail(txt)) {
    return `<a href="mailto:${escapeHtml(txt)}">${escapeHtml(txt)}</a>`;
  }
  return escapeHtml(txt);
}

function renderPartnerBullets(container, data, emptyMessage) {
  if (!container) return;

  const entries = Object.entries(data || {})
    .map(([key, value]) => [labelizeKey(key), safeText(value, "")])
    .filter(([, value]) => Boolean(normalizeText(value)));

  if (!entries.length) {
    container.innerHTML = `<div class="partner-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  const items = entries
    .map(([key, value]) => `<li><b>${escapeHtml(`${key}:`)}</b> ${partnerBulletValueHtml(value)}</li>`)
    .join("");

  container.innerHTML = `<ul class="partner-bullet-list">${items}</ul>`;
}

function renderEmptyDetails() {
  if ($infoWrap) {
    $infoWrap.innerHTML = `<div class="partner-empty">Selecione um parceiro para visualizar os detalhes.</div>`;
  }
  if ($contactWrap) {
    $contactWrap.innerHTML = `<div class="partner-empty">Sem dados de contato disponiveis.</div>`;
  }
  if ($addressWrap) {
    $addressWrap.innerHTML = `<div class="partner-empty">Sem dados de endereco disponiveis.</div>`;
  }
}

function renderPartnerDetails() {
  const partner = findPartnerById(state.selectedId);
  if (!partner) {
    renderEmptyDetails();
    return;
  }

  renderInfoTable(partner);
  renderPartnerBullets($contactWrap, partner.contato, "Sem dados de contato disponiveis.");
  renderPartnerBullets($addressWrap, partner.endereco, "Sem dados de endereco disponiveis.");
}

function refreshUi() {
  setOrderSearchNotice("");

  const query = normalizeText($search?.value).toLowerCase();
  const filteredRows = query
    ? state.allRows.filter((row) => JSON.stringify(row).toLowerCase().includes(query))
    : [...state.allRows];

  state.filteredRows = filteredRows.map((row, index) => ({
    ...row,
    __row_num: index + 1,
  }));

  ensureSelectedPartner(state.filteredRows);
  renderCurrentSelectionUi(false);
}

function handlePartnerOrderSearch() {
  const total = state.filteredRows.length;
  if (!total) {
    setOrderSearchNotice("Nenhum parceiro disponivel para busca por ordem.", true);
    return;
  }

  const raw = normalizeText($partnerOrderSearch?.value);
  if (!raw) {
    setOrderSearchNotice("Informe um numero de ordem para procurar.", true);
    return;
  }
  if (!/^\d+$/.test(raw)) {
    setOrderSearchNotice("Digite apenas numeros inteiros na busca por ordem.", true);
    return;
  }

  const order = Number(raw);
  if (!Number.isInteger(order) || order <= 0) {
    setOrderSearchNotice("A ordem deve ser um numero inteiro maior que zero.", true);
    return;
  }
  if (order > total) {
    setOrderSearchNotice(`Ordem fora do intervalo atual. Use um valor entre 1 e ${total}.`, true);
    return;
  }

  const partner = findPartnerByOrder(order);
  if (!partner) {
    setOrderSearchNotice(`Nenhum parceiro encontrado na ordem ${order}.`, true);
    return;
  }

  state.keepSelectionEmpty = false;
  state.selectedId = normalizeText(partner.id) || null;
  renderCurrentSelectionUi(true);
  setOrderSearchNotice(`Parceiro da ordem ${order} selecionado.`);
}

function handlePartnerClearSelection() {
  state.keepSelectionEmpty = true;
  state.selectedId = null;
  if ($partnerOrderSearch) $partnerOrderSearch.value = "";
  setOrderSearchNotice("");
  renderCurrentSelectionUi(false);
}

async function load() {
  try {
    const resp = await fetch(`/api${PATH}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const rows = Array.isArray(data) ? data : [];
    state.allRows = sortPartners(rows.map(mapPartner));
  } catch (_err) {
    state.allRows = [
      {
        id: "demo-partner-1",
        cnpj: "00123456000199",
        nome_fantasia: "Laboratorio Santa Helena",
        razao_social: "Laboratorio Santa Helena Servicos Equestres LTDA",
        uf: "GO",
        municipio: "Goiania",
        segmento_raw: "SERVICOS",
        segmento: "Servicos",
        prioridade: 2,
        cnae: "9313-1/00",
        data_inicio_atividade: "2025-12-09T00:00:00.000Z",
        situacao_cadastral: "-",
        contato: {
          site: "https://exemplo.com/p/425",
          email: "contato425@exemplo.com",
          telefone: "+55 11 910000425",
          instagram: "@parceiro_demo_425",
        },
        endereco: {
          bairro: "Centro",
          numero: "425",
          logradouro: "Rua Demo",
        },
      },
    ];
  }

  refreshUi();
}

$search?.addEventListener("input", refreshUi);
$reload?.addEventListener("click", load);

$partnerSelect?.addEventListener("change", (event) => {
  setOrderSearchNotice("");
  const nextId = normalizeText(event?.target?.value);
  state.keepSelectionEmpty = !nextId;
  state.selectedId = nextId || null;
  renderCurrentSelectionUi(true);
});

$table?.addEventListener("click", (event) => {
  const target = event?.target;
  if (!(target instanceof Element)) return;

  const rowEl = target.closest("tr[data-partner-id]");
  if (!rowEl) return;

  const nextId = normalizeText(rowEl.getAttribute("data-partner-id"));
  if (!nextId) return;

  setOrderSearchNotice("");
  state.keepSelectionEmpty = false;
  state.selectedId = nextId;
  renderCurrentSelectionUi(false);
});

$btnPartnerOrderSearch?.addEventListener("click", handlePartnerOrderSearch);
$btnPartnerOrderClear?.addEventListener("click", handlePartnerClearSelection);
$partnerOrderSearch?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  handlePartnerOrderSearch();
});

window.addEventListener("resize", applyPartnersTableWindow);

load();
