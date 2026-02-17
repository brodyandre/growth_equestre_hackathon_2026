function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderTable(container, cols, rows) {
  if (!container) return;

  const thead = cols
    .map((c) => {
      if (c.headerHtml) return `<th class="col-${escapeHtml(c.key)}">${c.headerHtml}</th>`;
      return `<th class="col-${escapeHtml(c.key)}">${escapeHtml(c.label)}</th>`;
    })
    .join("");
  const tbody = rows
    .map((r) => {
      const tds = cols
        .map((c) => {
          const value = r[c.key] ?? "-";
          if (c.html) return `<td class="col-${escapeHtml(c.key)}">${String(value)}</td>`;
          return `<td class="col-${escapeHtml(c.key)}">${escapeHtml(value)}</td>`;
        })
        .join("");
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

const TABLE_COLUMNS = [
  { key: "__select", label: "Sel", html: true },
  { key: "row_num", label: "N" },
  { key: "nome", label: "Nome" },
  { key: "uf", label: "UF" },
  { key: "cidade", label: "Cidade" },
  { key: "segmento", label: "Segmento" },
  { key: "orcamento", label: "Or\u00e7amento" },
  { key: "prazo", label: "Prazo" },
  { key: "score", label: "Score" },
  { key: "status", label: "Status" },
  { key: "motivos_resumo", label: "Motivos (resumo)" },
  { key: "id", label: "ID" },
];

const PATH = "/leads";

const $table = document.getElementById("leadsTable");
const $search = document.getElementById("leadSearch");
const $reload = document.getElementById("btnReload");
const $btnDeleteSelected = document.getElementById("btnDeleteSelected");
const $btnDeleteLead = document.getElementById("btnDeleteLead");
const $deleteConfirm = document.getElementById("leadDeleteConfirm");
const $deleteSelectionInfo = document.getElementById("leadDeleteSelectionInfo");
const $leadActionSelect = document.getElementById("leadActionSelect");
const $detailWrap = document.getElementById("leadDetailWrap");
const $scoreWhy = document.getElementById("leadScoreWhy");
const $btnCalcScore = document.getElementById("btnCalcScore");
const $btnHandoff = document.getElementById("btnHandoff");
const $btnEditLead = document.getElementById("btnEditLead");
const $btnSaveLeadEdit = document.getElementById("btnSaveLeadEdit");
const $btnCancelLeadEdit = document.getElementById("btnCancelLeadEdit");
const $actionNotice = document.getElementById("leadActionNotice");
const $actionKpis = document.getElementById("leadActionKpis");
const $editPanel = document.getElementById("leadEditPanel");
const $editNome = document.getElementById("editLeadNome");
const $editWhatsapp = document.getElementById("editLeadWhatsapp");
const $editEmail = document.getElementById("editLeadEmail");
const $editUf = document.getElementById("editLeadUf");
const $editCidade = document.getElementById("editLeadCidade");
const $editSegmento = document.getElementById("editLeadSegmento");
const $editOrcamento = document.getElementById("editLeadOrcamento");
const $editPrazo = document.getElementById("editLeadPrazo");

const state = {
  rawLeads: [],
  viewRows: [],
  filteredRows: [],
  deleteSelectedIds: new Set(),
  selectedId: null,
  actionBusy: false,
  editOpen: false,
};

const CITIES_BY_UF = {
  SP: ["Sao Paulo", "Campinas", "Ribeirao Preto", "Sorocaba", "Sao Jose dos Campos"],
  MG: ["Belo Horizonte", "Uberlandia", "Juiz de Fora", "Contagem", "Montes Claros"],
  GO: ["Goiania", "Aparecida de Goiania", "Anapolis", "Rio Verde", "Jatai"],
  RJ: ["Rio de Janeiro", "Niteroi", "Petropolis", "Campos dos Goytacazes", "Volta Redonda"],
  PR: ["Curitiba", "Londrina", "Maringa", "Cascavel", "Ponta Grossa"],
  SC: ["Florianopolis", "Joinville", "Blumenau", "Chapeco", "Criciuma"],
  RS: ["Porto Alegre", "Caxias do Sul", "Pelotas", "Santa Maria", "Passo Fundo"],
  BA: ["Salvador", "Feira de Santana", "Vitoria da Conquista", "Ilheus", "Lauro de Freitas"],
  DF: ["Brasilia", "Taguatinga", "Ceilandia", "Samambaia", "Gama"],
};

const REALISTIC_NAMES = [
  "Lucas Almeida",
  "Mariana Costa",
  "Rafael Nogueira",
  "Camila Fernandes",
  "Bruno Carvalho",
  "Juliana Ribeiro",
  "Thiago Martins",
  "Patricia Azevedo",
  "Diego Santana",
  "Renata Moraes",
  "Felipe Barros",
  "Aline Duarte",
  "Gustavo Leite",
  "Vanessa Rocha",
  "Eduardo Freitas",
  "Larissa Gomes",
  "Rodrigo Pires",
  "Bianca Melo",
  "Andre Teixeira",
  "Carla Mendes",
];

function normText(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normKey(v) {
  return normText(v).replace(/[^a-z0-9]/g, "").toUpperCase();
}

function hashString(value) {
  const s = String(value || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickBySeed(list, seed) {
  if (!Array.isArray(list) || list.length === 0) return "";
  const idx = hashString(seed) % list.length;
  return list[idx];
}

function normalizeUF(ufRaw) {
  const uf = String(ufRaw || "").trim().toUpperCase();
  return uf || "-";
}

function cityBelongsToUF(cityRaw, uf) {
  const city = normText(cityRaw);
  if (!city || city === "-") return false;

  const knownCities = CITIES_BY_UF[uf] || [];
  if (!knownCities.length) return true;

  return knownCities.some((c) => normText(c) === city);
}

function guessUFByCity(cityRaw) {
  const city = normText(cityRaw);
  if (!city || city === "-") return "";

  for (const [uf, cities] of Object.entries(CITIES_BY_UF)) {
    if (cities.some((c) => normText(c) === city)) return uf;
  }
  return "";
}

function isGenericName(nameRaw) {
  const name = normText(nameRaw);
  if (!name) return true;
  if (name === "-" || name === "n/a" || name === "na") return true;

  return (
    name.startsWith("lead demo") ||
    name.startsWith("lead ") ||
    name === "teste" ||
    name.startsWith("teste ") ||
    name.startsWith("test ")
  );
}

function isGenericCity(cityRaw) {
  const city = normText(cityRaw);
  if (!city) return true;
  return (
    city === "-" ||
    city === "cidade" ||
    city === "city" ||
    city === "n/a" ||
    city === "na" ||
    city === "nao definido" ||
    city === "nao informada" ||
    city === "teste"
  );
}

function segmentLabel(segmentRaw) {
  const seg = normKey(segmentRaw);
  if (seg === "CAVALOS") return "\u{1F434} Cavalos";
  if (seg === "SERVICOS") return "\u{1F9F0} Servicos";
  if (seg === "EVENTOS") return "\u{1F3AA} Eventos";
  if (seg === "EQUIPAMENTOS") return "\u{1F9F2} Equipamentos";
  return String(segmentRaw || "-");
}

function statusBadge(statusRaw) {
  const status = normKey(statusRaw);
  if (status === "QUALIFICADO") return "\u2705 QUALIFICADO";
  if (status === "AQUECENDO") return "\u{1F525} AQUECENDO";
  if (status === "ENVIADO") return "\u{1F4E4} ENVIADO";
  return "\u{1F440} CURIOSO";
}

function parseMotivos(rawValue) {
  if (Array.isArray(rawValue)) return rawValue;
  if (rawValue && typeof rawValue === "object") return [rawValue];

  const txt = String(rawValue || "").trim();
  if (!txt) return [];
  if (!txt.startsWith("[") && !txt.startsWith("{")) return [];

  try {
    const parsed = JSON.parse(txt);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
    return [];
  } catch (_err) {
    return [];
  }
}

function parseScoreMeta(rawValue) {
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) return rawValue;

  const txt = String(rawValue || "").trim();
  if (!txt || (!txt.startsWith("{") && !txt.startsWith("["))) return {};
  try {
    const parsed = JSON.parse(txt);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return {};
  } catch (_err) {
    return {};
  }
}

function formatImpact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return n >= 0 ? `+${n}` : String(n);
}

function formatScoreEngine(engineRaw) {
  const e = normKey(engineRaw);
  if (e === "ML") return "ML";
  if (e === "RULES" || e === "REGRAS") return "Regras";
  return String(engineRaw || "-");
}

function formatProbabilityPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function formatDateTime(value) {
  const txt = String(value || "").trim();
  if (!txt) return "-";
  try {
    const dt = new Date(txt);
    if (Number.isNaN(dt.getTime())) return txt;
    return dt.toLocaleString();
  } catch (_err) {
    return txt;
  }
}

function formatMotivos(motivosRaw) {
  const motivos = parseMotivos(motivosRaw);
  if (!motivos.length) return "-";

  const parts = [];
  for (const m of motivos) {
    if (!m || typeof m !== "object") continue;

    const fator = String(m.fator || "Fator").trim();
    const impacto = formatImpact(m.impacto ?? 0);
    const detalhe = String(m.detalhe || "").trim();

    if (detalhe && detalhe.toLowerCase() !== "none" && detalhe.toLowerCase() !== "null") {
      parts.push(`${fator} ${impacto} - ${detalhe}`);
    } else {
      parts.push(`${fator} ${impacto}`);
    }

    if (parts.length >= 6) break;
  }

  return parts.length ? parts.join(" | ") : "-";
}

function normalizeTextValue(value, fallback = "-") {
  const txt = String(value ?? "").trim();
  return txt || fallback;
}

function formatScoreValue(score) {
  if (score === null || score === undefined || score === "") return "-";
  const n = Number(score);
  return Number.isFinite(n) ? String(n) : String(score);
}

function shortId(idValue) {
  const txt = String(idValue || "").trim();
  if (!txt) return "-";
  return txt.length <= 8 ? txt : `${txt.slice(0, 8)}...`;
}

function leadOptionLabel(lead) {
  const cityUf = `${lead.cidade}/${lead.uf}`;
  const score = formatScoreValue(lead.score);
  return `${lead.nome} • ${lead.segmento} • ${cityUf} • ${lead.status} • score=${score} • ${shortId(lead.id)}...`;
}

function enrichLeadForDisplay(lead, index) {
  let uf = normalizeUF(lead.uf);
  let nome = String(lead.nome || "").trim();
  let cidade = String(lead.cidade || "").trim();

  if (uf === "-" && cidade) {
    const guessedUf = guessUFByCity(cidade);
    if (guessedUf) uf = guessedUf;
  }

  // Preserve original lead identity from backend to avoid UI-only renaming.
  // This guarantees that the name shown in "Criar lead (demos)" is the same
  // name shown later in the "Leads" table.
  if (!nome) nome = "-";
  if (!cidade) cidade = "-";

  const segmentoRaw = lead.segmento_interesse || lead.segmento || "-";
  const statusRaw = lead.status || "CURIOSO";
  const motivos = parseMotivos(lead.score_motivos || lead.motivos || lead.motivos_resumo);
  const motivosResumo = formatMotivos(motivos);
  const scoreMeta = parseScoreMeta(lead.score_meta || lead.meta);
  const scoreEngine = lead.score_engine || scoreMeta.engine || null;
  const scoreModelName = lead.score_model_name || scoreMeta.model_name || null;
  const scoreProbability =
    lead.score_probability ?? scoreMeta.probability_qualified ?? null;
  const scoreScoredAt = lead.score_scored_at || scoreMeta.scored_at || lead.updated_at || null;

  return {
    id: normalizeTextValue(lead.id, "-"),
    nome: normalizeTextValue(nome, "-"),
    whatsapp: normalizeTextValue(lead.whatsapp, "-"),
    email: normalizeTextValue(lead.email, "-"),
    uf: normalizeTextValue(uf, "-"),
    cidade: normalizeTextValue(cidade, "-"),
    segmento_raw: normalizeTextValue(segmentoRaw, "-"),
    segmento: segmentLabel(segmentoRaw),
    orcamento: normalizeTextValue(lead.orcamento_faixa || lead.orcamento, "-"),
    prazo: normalizeTextValue(lead.prazo_compra || lead.prazo, "-"),
    score: lead.score ?? "-",
    status_raw: normalizeTextValue(statusRaw, "CURIOSO"),
    status: statusBadge(statusRaw),
    motivos,
    motivos_resumo: motivosResumo,
    score_engine: scoreEngine,
    score_model_name: scoreModelName,
    score_probability: scoreProbability,
    score_scored_at: scoreScoredAt,
    score_meta: scoreMeta,
  };
}

function rebuildViewRows() {
  state.viewRows = state.rawLeads.map((lead, idx) => enrichLeadForDisplay(lead, idx));
}

function getFilteredRows(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [...state.viewRows];
  return state.viewRows.filter((x) => JSON.stringify(x).toLowerCase().includes(q));
}

function findLeadById(leadId) {
  const id = String(leadId || "").trim();
  if (!id) return null;

  for (const item of state.filteredRows) {
    if (String(item.id) === id) return item;
  }
  for (const item of state.viewRows) {
    if (String(item.id) === id) return item;
  }
  return null;
}

function findRawLeadById(leadId) {
  const id = String(leadId || "").trim();
  if (!id) return null;
  return state.rawLeads.find((item) => String(item.id) === id) || null;
}

function toEmpty(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return "";
  return text;
}

function setEditPanelVisible(visible) {
  state.editOpen = Boolean(visible);
  if ($editPanel) $editPanel.style.display = state.editOpen ? "block" : "none";
}

function populateEditForm(leadId) {
  const raw = findRawLeadById(leadId) || {};

  if ($editNome) $editNome.value = toEmpty(raw.nome);
  if ($editWhatsapp) $editWhatsapp.value = toEmpty(raw.whatsapp);
  if ($editEmail) $editEmail.value = toEmpty(raw.email);
  if ($editUf) $editUf.value = toEmpty(raw.uf).toUpperCase();
  if ($editCidade) $editCidade.value = toEmpty(raw.cidade);
  if ($editSegmento) $editSegmento.value = toEmpty(raw.segmento_interesse).toUpperCase() || "CAVALOS";
  if ($editOrcamento) $editOrcamento.value = toEmpty(raw.orcamento_faixa);
  if ($editPrazo) $editPrazo.value = toEmpty(raw.prazo_compra);
}

function buildEditPayload() {
  return {
    nome: String($editNome?.value || "").trim(),
    whatsapp: toEmpty($editWhatsapp?.value) || null,
    email: toEmpty($editEmail?.value) || null,
    uf: toEmpty($editUf?.value).toUpperCase() || null,
    cidade: toEmpty($editCidade?.value) || null,
    segmento_interesse: toEmpty($editSegmento?.value).toUpperCase() || null,
    orcamento_faixa: toEmpty($editOrcamento?.value) || null,
    prazo_compra: toEmpty($editPrazo?.value) || null,
  };
}

function renderLeadsTable(rows) {
  renderTable($table, TABLE_COLUMNS, rows);
}

function renderLeadActionSelect(rows) {
  if (!$leadActionSelect) return;

  if (!rows.length) {
    $leadActionSelect.innerHTML = `<option value="">Nenhum lead disponivel</option>`;
    $leadActionSelect.disabled = true;
    return;
  }

  const options = [`<option value="">- selecione -</option>`];
  for (const lead of rows) {
    const selected = state.selectedId === lead.id ? "selected" : "";
    options.push(
      `<option value="${escapeHtml(lead.id)}" ${selected}>${escapeHtml(leadOptionLabel(lead))}</option>`
    );
  }

  $leadActionSelect.innerHTML = options.join("");
  $leadActionSelect.disabled = false;
  $leadActionSelect.value = state.selectedId || "";
}

function pruneDeleteSelection() {
  const validIds = new Set(state.viewRows.map((x) => String(x.id || "")));
  for (const id of [...state.deleteSelectedIds]) {
    if (!validIds.has(String(id))) state.deleteSelectedIds.delete(String(id));
  }
}

function selectedDeleteIds() {
  return [...state.deleteSelectedIds].map((id) => String(id));
}

function updateDeleteSelectionInfo() {
  const selectedCount = selectedDeleteIds().length;
  if ($deleteSelectionInfo) {
    $deleteSelectionInfo.textContent = `${selectedCount} selecionado(s)`;
  }
  if ($btnDeleteSelected) {
    $btnDeleteSelected.disabled =
      state.actionBusy || selectedCount === 0 || !Boolean($deleteConfirm?.checked);
  }
}

function clearActionKpis() {
  if (!$actionKpis) return;
  $actionKpis.innerHTML = "";
}

function renderActionKpis(score, statusRaw) {
  if (!$actionKpis) return;

  const scoreTxt = formatScoreValue(score);
  const statusTxt = statusBadge(statusRaw || "CURIOSO");
  const suggestion = normKey(statusRaw || "") === "QUALIFICADO" ? "Priorizar" : "Nutrir";

  $actionKpis.innerHTML = `
    <article class="lead-action-kpi">
      <div class="lead-action-kpi-label">Score</div>
      <div class="lead-action-kpi-value">${escapeHtml(scoreTxt)}</div>
    </article>
    <article class="lead-action-kpi">
      <div class="lead-action-kpi-label">Status</div>
      <div class="lead-action-kpi-value">${escapeHtml(statusTxt)}</div>
    </article>
    <article class="lead-action-kpi">
      <div class="lead-action-kpi-label">Sugestao</div>
      <div class="lead-action-kpi-value">${escapeHtml(suggestion)}</div>
    </article>
  `;
}

function setNotice(message, isError = false) {
  if (!$actionNotice) return;

  const msg = String(message || "").trim();
  if (!msg) {
    $actionNotice.style.display = "none";
    $actionNotice.textContent = "";
    return;
  }

  $actionNotice.style.display = "block";
  $actionNotice.textContent = msg;
  $actionNotice.style.borderColor = isError ? "rgba(255,107,129,0.5)" : "rgba(55,214,122,0.45)";
  $actionNotice.style.color = isError ? "#ff9db0" : "#a5f7c7";
}

function renderEmptyDetails(message) {
  if ($detailWrap) {
    $detailWrap.innerHTML = `<div class="lead-empty">${escapeHtml(message || "Selecione um lead para continuar.")}</div>`;
  }
  if ($scoreWhy) {
    $scoreWhy.innerHTML = `
      <div class="lead-empty">
        Ainda nao ha explicacao salva para este lead. Clique em "Calcular/Atualizar score".
      </div>
    `;
  }
}

function renderDetailsTable(lead) {
  if (!$detailWrap) return;

  const details = [
    { k: "Nome", v: lead.nome },
    { k: "WhatsApp", v: lead.whatsapp || "-" },
    { k: "E-mail", v: lead.email || "-" },
    { k: "UF", v: lead.uf || "-" },
    { k: "Cidade", v: lead.cidade || "-" },
    { k: "Segmento", v: lead.segmento || "-" },
    { k: "Orcamento", v: lead.orcamento || "-" },
    { k: "Prazo", v: lead.prazo || "-" },
    { k: "Score", v: formatScoreValue(lead.score) },
    { k: "Status", v: lead.status || "-" },
    { k: "Motor de score", v: formatScoreEngine(lead.score_engine) },
    { k: "Modelo", v: normalizeTextValue(lead.score_model_name, "-") },
    { k: "Prob. qualificado", v: formatProbabilityPct(lead.score_probability) },
    { k: "Score calculado em", v: formatDateTime(lead.score_scored_at) },
  ];

  const rows = details
    .map((item) => `<tr><th>${escapeHtml(item.k)}</th><td>${escapeHtml(item.v)}</td></tr>`)
    .join("");

  $detailWrap.innerHTML = `
    <table class="lead-kv-table">
      <thead>
        <tr>
          <th>Campo</th>
          <th>Valor</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderScoreWhy(lead) {
  if (!$scoreWhy) return;
  const motivos = Array.isArray(lead?.motivos) ? lead.motivos : [];
  const diagnosticsHtml = `
    <div class="lead-empty" style="margin-bottom:8px;">
      Diagnostico do scoring: motor=<b>${escapeHtml(formatScoreEngine(lead?.score_engine))}</b> |
      modelo=<b>${escapeHtml(normalizeTextValue(lead?.score_model_name, "-"))}</b> |
      prob=<b>${escapeHtml(formatProbabilityPct(lead?.score_probability))}</b>
    </div>
  `;

  if (!motivos.length) {
    $scoreWhy.innerHTML = `
      ${diagnosticsHtml}
      <div class="lead-empty">
        Ainda nao ha explicacao salva para este lead. Clique em "Calcular/Atualizar score".
      </div>
    `;
    return;
  }

  const items = [];
  for (const m of motivos) {
    if (!m || typeof m !== "object") continue;
    const fator = String(m.fator || "Fator").trim();
    const impacto = formatImpact(m.impacto ?? 0);
    const detalhe = String(m.detalhe || "").trim();
    const suffix = detalhe ? ` - ${detalhe}` : "";
    items.push(`<li><b>${escapeHtml(`${fator} (${impacto})`)}</b>${escapeHtml(suffix)}</li>`);
  }

  if (!items.length) {
    $scoreWhy.innerHTML = `
      <div class="lead-empty">
        Ainda nao ha explicacao salva para este lead. Clique em "Calcular/Atualizar score".
      </div>
    `;
    return;
  }

  $scoreWhy.innerHTML = `${diagnosticsHtml}<ul class="lead-score-list">${items.join("")}</ul>`;
}

function syncActionButtons(hasSelectedLead) {
  const actionDisabled = !hasSelectedLead || state.actionBusy;
  const hasBatchSelection = selectedDeleteIds().length > 0;
  if ($btnCalcScore) $btnCalcScore.disabled = actionDisabled;
  if ($btnHandoff) $btnHandoff.disabled = actionDisabled;
  if ($btnEditLead) $btnEditLead.disabled = actionDisabled;
  if ($btnDeleteLead) {
    // "Excluir lead selecionado" now supports both:
    // 1) checked rows in column "Sel" (priority)
    // 2) single lead selected in action dropdown (fallback)
    $btnDeleteLead.disabled = state.actionBusy || (!hasBatchSelection && !hasSelectedLead);
  }
  if ($btnSaveLeadEdit) $btnSaveLeadEdit.disabled = actionDisabled;
  updateDeleteSelectionInfo();
}

function renderLeadDetails() {
  const lead = findLeadById(state.selectedId);
  if (!lead) {
    setEditPanelVisible(false);
    renderEmptyDetails("Selecione um lead para visualizar detalhes e executar acoes.");
    syncActionButtons(false);
    return;
  }

  renderDetailsTable(lead);
  renderScoreWhy(lead);
  if (state.editOpen) populateEditForm(lead.id);
  syncActionButtons(true);
}

function refreshUi() {
  pruneDeleteSelection();
  state.filteredRows = getFilteredRows($search?.value).map((item, index) => {
    const leadId = String(item.id || "");
    const checkedAttr = state.deleteSelectedIds.has(leadId) ? "checked" : "";
    return {
      ...item,
      __select: `<input type="checkbox" class="lead-row-select" data-lead-id="${escapeHtml(leadId)}" ${checkedAttr} />`,
      row_num: index + 1,
    };
  });

  if (state.selectedId && !state.filteredRows.some((item) => item.id === state.selectedId)) {
    state.selectedId = null;
    setEditPanelVisible(false);
    setNotice("");
    clearActionKpis();
  }

  renderLeadsTable(state.filteredRows);
  renderLeadActionSelect(state.filteredRows);
  renderLeadDetails();
  updateDeleteSelectionInfo();
}

function setActionBusy(isBusy) {
  state.actionBusy = Boolean(isBusy);
  syncActionButtons(Boolean(findLeadById(state.selectedId)));
}

async function requestJson(url, options = {}) {
  const timeoutMs = Number(options?.timeoutMs ?? 25000);
  const fetchOptions = { ...(options || {}) };
  delete fetchOptions.timeoutMs;

  let timeoutId = null;
  if (!fetchOptions.signal && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    const controller = new AbortController();
    fetchOptions.signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const resp = await fetch(url, fetchOptions);
    let body = null;
    try {
      body = await resp.json();
    } catch (_err) {
      body = null;
    }

    if (!resp.ok) {
      const msg =
        body?.error ||
        body?.message ||
        body?.details ||
        `HTTP ${resp.status}`;
      throw new Error(String(msg));
    }

    return body;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Tempo limite excedido ao aguardar resposta da API.");
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function refreshScoreDiagnostics(leadId) {
  const id = String(leadId || "").trim();
  if (!id) return;

  try {
    const data = await requestJson(`/api/leads/${encodeURIComponent(id)}/score-diagnostics`, {
      cache: "no-store",
    });
    const diagnostics =
      data?.diagnostics && typeof data.diagnostics === "object" ? data.diagnostics : {};
    const meta = diagnostics?.meta && typeof diagnostics.meta === "object" ? diagnostics.meta : {};

    patchRawLead(id, {
      score: data?.score ?? undefined,
      status: data?.status ?? undefined,
      score_engine: diagnostics.engine ?? undefined,
      score_model_name: diagnostics.model_name ?? undefined,
      score_probability: diagnostics.probability_qualified ?? undefined,
      score_scored_at: diagnostics.scored_at ?? undefined,
      score_meta: Object.keys(meta).length ? meta : undefined,
    });

    rebuildViewRows();
    renderLeadDetails();
  } catch (_err) {
    // Diagnóstico é complementar: não bloqueia UX principal.
  }
}

function patchRawLead(leadId, patch) {
  const id = String(leadId || "");
  const idx = state.rawLeads.findIndex((x) => String(x.id) === id);
  if (idx < 0) return;

  const current = state.rawLeads[idx] || {};
  const next = { ...current };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value !== undefined) next[key] = value;
  }
  state.rawLeads[idx] = next;
}

async function handleCalcScore() {
  const lead = findLeadById(state.selectedId);
  if (!lead) {
    setNotice("Selecione um lead para acoes.", true);
    return;
  }

  setActionBusy(true);
  setNotice("Calculando score...");

  try {
    const data = await requestJson(`/api/leads/${encodeURIComponent(lead.id)}/score`, {
      method: "POST",
    });
    const diagnostics =
      data?.diagnostics && typeof data.diagnostics === "object" ? data.diagnostics : {};
    const meta = data?.meta && typeof data.meta === "object" ? data.meta : {};

    patchRawLead(lead.id, {
      score: data?.score,
      status: data?.status,
      score_motivos: Array.isArray(data?.motivos) ? data.motivos : undefined,
      score_engine: diagnostics.engine ?? meta.engine ?? undefined,
      score_model_name: diagnostics.model_name ?? meta.model_name ?? undefined,
      score_probability:
        diagnostics.probability_qualified ?? meta.probability_qualified ?? undefined,
      score_scored_at: diagnostics.scored_at ?? new Date().toISOString(),
      score_meta: Object.keys(meta).length ? meta : undefined,
      updated_at: new Date().toISOString(),
    });

    rebuildViewRows();
    refreshUi();
    await refreshScoreDiagnostics(lead.id);

    const updatedLead = findLeadById(lead.id);
    renderActionKpis(updatedLead?.score ?? data?.score, updatedLead?.status_raw ?? data?.status);
    setNotice("Score atualizado com sucesso.");
  } catch (err) {
    setNotice(`Nao foi possivel calcular o score agora. ${err.message}`, true);
  } finally {
    setActionBusy(false);
    renderLeadDetails();
  }
}

async function handleHandoff() {
  const lead = findLeadById(state.selectedId);
  if (!lead) {
    setNotice("Selecione um lead para acoes.", true);
    return;
  }

  setActionBusy(true);
  setNotice("Executando handoff...");

  try {
    await requestJson("/api/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: lead.id, channel: "admin" }),
    });

    patchRawLead(lead.id, {
      status: "ENVIADO",
      crm_stage: "ENVIADO",
      updated_at: new Date().toISOString(),
    });

    rebuildViewRows();
    refreshUi();
    clearActionKpis();
    setNotice("Lead marcado como ENVIADO.");
  } catch (err) {
    setNotice(`Nao foi possivel concluir o handoff agora. ${err.message}`, true);
  } finally {
    setActionBusy(false);
    renderLeadDetails();
  }
}

async function handleSaveLeadEdit() {
  const lead = findLeadById(state.selectedId);
  if (!lead) {
    setNotice("Selecione um lead para editar.", true);
    return;
  }

  const payload = buildEditPayload();
  if (!payload.nome) {
    setNotice("Informe o nome do lead.", true);
    return;
  }
  if (!payload.segmento_interesse) {
    setNotice("Informe o segmento do lead.", true);
    return;
  }

  setActionBusy(true);
  setNotice("Salvando edicao do lead...");

  try {
    const data = await requestJson(`/api/leads/${encodeURIComponent(lead.id)}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const updated = data?.lead || {};
    patchRawLead(lead.id, {
      nome: updated.nome ?? payload.nome,
      whatsapp: updated.whatsapp ?? payload.whatsapp,
      email: updated.email ?? payload.email,
      uf: updated.uf ?? payload.uf,
      cidade: updated.cidade ?? payload.cidade,
      segmento_interesse: updated.segmento_interesse ?? payload.segmento_interesse,
      orcamento_faixa: updated.orcamento_faixa ?? payload.orcamento_faixa,
      prazo_compra: updated.prazo_compra ?? payload.prazo_compra,
      updated_at: updated.updated_at ?? new Date().toISOString(),
    });

    rebuildViewRows();
    refreshUi();
    setEditPanelVisible(false);
    setNotice("Lead atualizado com sucesso.");
  } catch (err) {
    setNotice(`Nao foi possivel atualizar o lead agora. ${err.message}`, true);
  } finally {
    setActionBusy(false);
    renderLeadDetails();
  }
}

async function handleDeleteLead() {
  // Priority path: if rows are checked in "Sel", delete that batch.
  const checkedIds = selectedDeleteIds();
  if (checkedIds.length) {
    if (!window.confirm(`Confirma excluir ${checkedIds.length} lead(s) marcado(s) na coluna Sel?`)) return;

    setActionBusy(true);
    setNotice(`Excluindo ${checkedIds.length} lead(s) marcado(s)...`);

    try {
      const data = await requestJson("/api/leads/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: checkedIds }),
      });

      const deletedIds = Array.isArray(data?.deleted_ids) ? data.deleted_ids.map(String) : [];
      const deletedSet = new Set(deletedIds);
      state.rawLeads = state.rawLeads.filter((item) => !deletedSet.has(String(item.id)));

      for (const id of deletedSet) state.deleteSelectedIds.delete(id);
      if (state.selectedId && deletedSet.has(String(state.selectedId))) {
        state.selectedId = null;
        setEditPanelVisible(false);
        clearActionKpis();
      }

      rebuildViewRows();
      refreshUi();

      const deletedCount = Number(data?.deleted || deletedSet.size || 0);
      const notFound = Array.isArray(data?.not_found_ids) ? data.not_found_ids.length : 0;
      const invalid = Array.isArray(data?.invalid_ids) ? data.invalid_ids.length : 0;
      setNotice(
        `Exclusao concluida. Removidos: ${deletedCount}. Nao encontrados: ${notFound}. Invalidos: ${invalid}.`
      );
    } catch (err) {
      setNotice(`Nao foi possivel excluir os leads marcados. ${err.message}`, true);
    } finally {
      setActionBusy(false);
      renderLeadDetails();
    }
    return;
  }

  // Fallback path: delete single lead selected in action dropdown.
  const lead = findLeadById(state.selectedId);
  if (!lead) {
    setNotice("Marque ao menos um lead na coluna Sel ou selecione um lead para excluir.", true);
    return;
  }

  if (!window.confirm(`Confirma excluir o lead "${lead.nome}"?`)) return;

  setActionBusy(true);
  setNotice("Excluindo lead selecionado...");

  try {
    const data = await requestJson(`/api/leads/${encodeURIComponent(lead.id)}`, {
      method: "DELETE",
    });

    const deletedIds = Array.isArray(data?.deleted_ids) ? data.deleted_ids.map(String) : [];
    const deletedSet = new Set(deletedIds.length ? deletedIds : [String(lead.id)]);
    state.rawLeads = state.rawLeads.filter((item) => !deletedSet.has(String(item.id)));

    for (const id of deletedSet) state.deleteSelectedIds.delete(id);
    if (deletedSet.has(String(state.selectedId))) {
      state.selectedId = null;
      setEditPanelVisible(false);
      clearActionKpis();
    }

    rebuildViewRows();
    refreshUi();
    const deletedCount = Number(data?.deleted || deletedSet.size || 0);
    setNotice(`Lead excluido com sucesso. (${deletedCount} removido)`);
  } catch (err) {
    setNotice(`Nao foi possivel excluir o lead agora. ${err.message}`, true);
  } finally {
    setActionBusy(false);
    renderLeadDetails();
  }
}

async function handleDeleteSelected() {
  const ids = selectedDeleteIds();
  if (!ids.length) {
    setNotice("Selecione ao menos um lead na tabela para excluir.", true);
    return;
  }
  if (!$deleteConfirm?.checked) {
    setNotice("Marque 'Confirmar exclusao' antes de excluir em lote.", true);
    return;
  }
  if (!window.confirm(`Confirma excluir ${ids.length} lead(s) selecionado(s)?`)) return;

  setActionBusy(true);
  setNotice(`Excluindo ${ids.length} lead(s) selecionado(s)...`);

  try {
    const data = await requestJson("/api/leads/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });

    const deletedIds = Array.isArray(data?.deleted_ids) ? data.deleted_ids.map(String) : [];
    const deletedSet = new Set(deletedIds);
    state.rawLeads = state.rawLeads.filter((item) => !deletedSet.has(String(item.id)));

    for (const id of deletedSet) state.deleteSelectedIds.delete(id);
    if (state.selectedId && deletedSet.has(String(state.selectedId))) {
      state.selectedId = null;
      setEditPanelVisible(false);
      clearActionKpis();
    }

    rebuildViewRows();
    refreshUi();

    const deletedCount = Number(data?.deleted || deletedSet.size || 0);
    const notFound = Array.isArray(data?.not_found_ids) ? data.not_found_ids.length : 0;
    const invalid = Array.isArray(data?.invalid_ids) ? data.invalid_ids.length : 0;
    setNotice(
      `Exclusao em lote concluida. Removidos: ${deletedCount}. Nao encontrados: ${notFound}. Invalidos: ${invalid}.`
    );
  } catch (err) {
    setNotice(`Nao foi possivel excluir os leads selecionados. ${err.message}`, true);
  } finally {
    setActionBusy(false);
    renderLeadDetails();
  }
}

function fallbackRows() {
  return [
    {
      id: "lead-demo-1",
      nome: "Lucas Almeida",
      whatsapp: "11998765432",
      email: "lucas.almeida@exemplo.com",
      cidade: "Sao Paulo",
      uf: "SP",
      segmento_interesse: "EQUIPAMENTOS",
      orcamento_faixa: "60k+",
      prazo_compra: "7d",
      score: 90,
      status: "ENVIADO",
      score_motivos: [
        { fator: "Orcamento", impacto: 30, detalhe: "60k+" },
        { fator: "Prazo", impacto: 20, detalhe: "7d" },
      ],
    },
    {
      id: "lead-demo-2",
      nome: "Mariana Costa",
      whatsapp: "31998765432",
      email: "mariana.costa@exemplo.com",
      cidade: "Belo Horizonte",
      uf: "MG",
      segmento_interesse: "SERVICOS",
      orcamento_faixa: "20k-60k",
      prazo_compra: "30d",
      score: 62,
      status: "AQUECENDO",
      score_motivos: [
        { fator: "Orcamento", impacto: 30, detalhe: "20k-60k" },
        { fator: "Prazo", impacto: 12, detalhe: "30d" },
      ],
    },
    {
      id: "lead-demo-3",
      nome: "Rafael Nogueira",
      whatsapp: "62998765432",
      email: "rafael.nogueira@exemplo.com",
      cidade: "Goiania",
      uf: "GO",
      segmento_interesse: "EVENTOS",
      orcamento_faixa: "0-5k",
      prazo_compra: "90d",
      score: 21,
      status: "CURIOSO",
      score_motivos: [
        { fator: "Orcamento", impacto: 10, detalhe: "0-5k" },
        { fator: "Prazo", impacto: 6, detalhe: "90d" },
      ],
    },
  ];
}

async function load() {
  const selectedBefore = state.selectedId;
  try {
    const resp = await fetch(`/api${PATH}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    state.rawLeads = Array.isArray(data) ? data : [];
    state.selectedId = selectedBefore;
    rebuildViewRows();
    refreshUi();

    if (!state.rawLeads.length) {
      setNotice("Nenhum lead encontrado para os filtros atuais.");
    } else if (state.selectedId) {
      setNotice("");
    }
  } catch (_err) {
    state.rawLeads = fallbackRows();
    state.selectedId = selectedBefore;
    rebuildViewRows();
    refreshUi();
    setNotice("Modo demo: backend indisponivel para leads. Exibindo dados locais.", true);
  }
}

$search?.addEventListener("input", () => refreshUi());
$reload?.addEventListener("click", load);
$deleteConfirm?.addEventListener("change", () => updateDeleteSelectionInfo());

$table?.addEventListener("change", (event) => {
  const target = event?.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!target.classList.contains("lead-row-select")) return;

  const leadId = String(target.dataset.leadId || "").trim();
  if (!leadId) return;

  if (target.checked) state.deleteSelectedIds.add(leadId);
  else state.deleteSelectedIds.delete(leadId);
  syncActionButtons(Boolean(findLeadById(state.selectedId)));
});

$leadActionSelect?.addEventListener("change", (e) => {
  const leadId = String(e?.target?.value || "").trim();
  state.selectedId = leadId || null;
  setEditPanelVisible(false);
  setNotice("");
  clearActionKpis();
  renderLeadDetails();
  if (state.selectedId) refreshScoreDiagnostics(state.selectedId);
});

$btnEditLead?.addEventListener("click", () => {
  const lead = findLeadById(state.selectedId);
  if (!lead) {
    setNotice("Selecione um lead para editar.", true);
    return;
  }

  if (state.editOpen) {
    setEditPanelVisible(false);
    return;
  }

  populateEditForm(lead.id);
  setEditPanelVisible(true);
  setNotice("");
});

$btnSaveLeadEdit?.addEventListener("click", handleSaveLeadEdit);

$btnCancelLeadEdit?.addEventListener("click", () => {
  setEditPanelVisible(false);
});

$btnCalcScore?.addEventListener("click", handleCalcScore);
$btnHandoff?.addEventListener("click", handleHandoff);
$btnDeleteLead?.addEventListener("click", handleDeleteLead);
$btnDeleteSelected?.addEventListener("click", handleDeleteSelected);

load();
