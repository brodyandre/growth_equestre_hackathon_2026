function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value ?? "-");
}

const CRM_STAGE_ORDER = ["INBOX", "AQUECENDO", "QUALIFICADO", "ENVIADO"];
const CRM_STATUS_ORDER = ["CURIOSO", "AQUECENDO", "QUALIFICADO", "ENVIADO"];

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function segmentLabel(segment) {
  const key = String(segment || "").toUpperCase();
  if (key === "CAVALOS") return "🐴 Cavalos";
  if (key === "SERVICOS") return "🧰 Servicos";
  if (key === "EVENTOS") return "🎪 Eventos";
  if (key === "EQUIPAMENTOS") return "🧲 Equipamentos";
  return key || "—";
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function formatMlModelLabel(modelId) {
  const key = String(modelId || "").trim().toLowerCase();
  if (!key) return "-";
  if (key === "logit_fine") return "Regressao Logistica (fine tuning)";
  if (key === "rf_fine") return "Random Forest (fine tuning)";
  if (key === "logit_base") return "Regressao Logistica (base)";
  if (key === "rf_base") return "Random Forest (base)";
  if (key === "best_model") return "Best model";
  if (key === "runner_up_model") return "Runner-up model";
  return String(modelId);
}

function formatFineTuningSummary(bestParams) {
  const params = ensureObject(bestParams);
  const keys = Object.keys(params);
  if (!keys.length) return "-";
  return keys
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const shortKey = key.replace(/^model__/, "");
      const raw = params[key];
      const value = raw === null ? "null" : String(raw);
      return `${shortKey}=${value}`;
    })
    .join(", ");
}

async function loadMlModelInfo() {
  const infoPath = window.__GE__?.paths?.mlModelInfo || "/ml/model-info";
  try {
    const response = await fetch(`/api${infoPath}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = ensureObject(await response.json());
    if (!payload.available) {
      setText("mlWinnerLabel", "Modelo vencedor: indisponivel");
      setText("mlFineTuneLabel", "Fine tuning: sem dados");
      setText("mlMetaLabel", "Treine os modelos para gerar model_selection_report.json.");
      return;
    }

    const winner = ensureObject(payload.winner);
    const runnerUp = ensureObject(payload.runner_up);
    const fineTuning = ensureObject(payload.fine_tuning);

    const winnerLabel =
      String(winner.label || "").trim() || formatMlModelLabel(String(winner.id || "").trim());
    const fineSummary =
      String(fineTuning.summary || "").trim() ||
      formatFineTuningSummary(fineTuning.best_params);
    const runnerUpLabel =
      String(runnerUp.label || "").trim() || formatMlModelLabel(String(runnerUp.id || "").trim());

    setText("mlWinnerLabel", `Modelo vencedor: ${winnerLabel || "-"}`);
    setText("mlFineTuneLabel", `Fine tuning: ${fineSummary || "-"}`);
    setText("mlMetaLabel", runnerUpLabel && runnerUpLabel !== "-" ? `Runner-up: ${runnerUpLabel}` : "");
  } catch (err) {
    setText("mlWinnerLabel", "Modelo vencedor: indisponivel");
    setText("mlFineTuneLabel", "Fine tuning: falha ao carregar");
    setText("mlMetaLabel", "");
  }
}

function normalizeCrmStage(stageValue, statusValue) {
  const stage = String(stageValue || "").trim().toUpperCase();
  if (CRM_STAGE_ORDER.includes(stage)) return stage;

  const status = String(statusValue || "").trim().toUpperCase();
  if (status === "AQUECENDO" || status === "QUALIFICADO" || status === "ENVIADO") return status;
  return "INBOX";
}

function stageToStatusLabel(stageValue) {
  const stage = String(stageValue || "").trim().toUpperCase();
  if (stage === "INBOX") return "CURIOSO";
  if (stage === "AQUECENDO") return "AQUECENDO";
  if (stage === "QUALIFICADO") return "QUALIFICADO";
  if (stage === "ENVIADO") return "ENVIADO";
  return "CURIOSO";
}

function normalizeCommercialStatus(statusValue, stageValue) {
  const status = String(statusValue || "").trim().toUpperCase();
  if (status === "CURIOSO" || status === "AQUECENDO" || status === "QUALIFICADO" || status === "ENVIADO") {
    return status;
  }
  const stage = normalizeCrmStage(stageValue, statusValue);
  return stageToStatusLabel(stage);
}

function emptyStatusCounts() {
  return {
    CURIOSO: 0,
    AQUECENDO: 0,
    QUALIFICADO: 0,
    ENVIADO: 0,
  };
}

function extractBoardItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.items)) return payload.items;
  return [];
}

function buildStatusCountsFromBoard(items) {
  const counts = emptyStatusCounts();
  for (const item of Array.isArray(items) ? items : []) {
    const stage = normalizeCrmStage(item?.crm_stage || item?.stage, item?.status);
    const status = stageToStatusLabel(stage);
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function normalizePartnerSummary(payload) {
  return Array.isArray(payload)
    ? payload
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          segmento: String(item.segmento || "").toUpperCase(),
          total: Number(item.total || 0),
        }))
    : [];
}

function renderStatusTable(rows) {
  const root = document.getElementById("dashboardTable");
  if (!root) return;

  const htmlRows = rows
    .map((r) => `<tr><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.total)}</td></tr>`)
    .join("");

  root.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>${htmlRows}</tbody>
    </table>
  `;
}

function renderOverviewPartnerKpis(summaryList) {
  const root = document.getElementById("overviewPartnersKpis");
  if (!root) return;

  if (!summaryList.length) {
    root.innerHTML = `
      <article class="kpi-box">
        <div class="kpi-label">Total de parceiros</div>
        <div class="kpi-value">0</div>
      </article>
    `;
    return;
  }

  const ordered = [...summaryList].sort((a, b) => b.total - a.total);
  const totalPartners = ordered.reduce((acc, row) => acc + Number(row.total || 0), 0);
  const cards = [
    { label: "Total de parceiros", total: totalPartners },
    ...ordered.slice(0, 3).map((row) => ({ label: segmentLabel(row.segmento), total: row.total })),
  ];

  root.innerHTML = cards
    .map(
      (card) => `
        <article class="kpi-box">
          <div class="kpi-label">${escapeHtml(card.label)}</div>
          <div class="kpi-value">${escapeHtml(card.total)}</div>
        </article>
      `
    )
    .join("");
}

function renderOverviewPartnerTable(summaryList) {
  const root = document.getElementById("overviewPartnersTable");
  if (!root) return;

  if (!summaryList.length) {
    root.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Segmento</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Sem dados</td>
            <td>-</td>
          </tr>
        </tbody>
      </table>
    `;
    return;
  }

  const rows = [...summaryList].sort((a, b) => b.total - a.total);
  const htmlRows = rows
    .map((row) => `<tr><td>${escapeHtml(segmentLabel(row.segmento))}</td><td>${escapeHtml(row.total)}</td></tr>`)
    .join("");

  root.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Segmento</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>${htmlRows}</tbody>
    </table>
  `;
}

async function loadOverviewPartnerSummary() {
  const ufSelect = document.getElementById("overviewUf");
  const uf = String(ufSelect?.value || "").trim().toUpperCase();
  const query = uf ? `?uf=${encodeURIComponent(uf)}` : "";

  try {
    const response = await fetch(`/api/partners/summary${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const summaryList = normalizePartnerSummary(payload);
    renderOverviewPartnerKpis(summaryList);
    renderOverviewPartnerTable(summaryList);
  } catch (err) {
    renderOverviewPartnerKpis([]);
    renderOverviewPartnerTable([]);
  }
}

async function loadDashboard() {
  try {
    const boardPath = window.__GE__?.paths?.kanban || "/crm/board";
    const [boardResp, summaryResp] = await Promise.all([
      fetch(`/api${boardPath}`, { cache: "no-store" }),
      fetch("/api/partners/summary", { cache: "no-store" }),
    ]);

    const boardPayload = boardResp.ok ? await boardResp.json() : [];
    const boardItems = extractBoardItems(boardPayload);
    const partnerSummary = summaryResp.ok ? await summaryResp.json() : [];
    const summaryList = normalizePartnerSummary(partnerSummary);

    // Mantem os numeros sincronizados com o CRM Kanban:
    // ambos passam a usar exatamente a mesma fonte (/crm/board).
    const statusCounts = buildStatusCountsFromBoard(boardItems);
    const totalLeads = CRM_STATUS_ORDER.reduce((acc, status) => acc + Number(statusCounts[status] || 0), 0);
    const curious = Number(statusCounts.CURIOSO || 0);
    const warm = Number(statusCounts.AQUECENDO || 0);
    const qualified = Number(statusCounts.QUALIFICADO || 0);
    const sent = Number(statusCounts.ENVIADO || 0);
    const conversion = totalLeads ? (qualified / totalLeads) * 100 : 0;

    const rows = CRM_STATUS_ORDER.map((status) => ({
      status,
      total: Number(statusCounts[status] || 0),
    }));

    setText("kpiLeads", totalLeads);
    setText("kpiCurious", curious);
    setText("kpiWarm", warm);
    setText("kpiQualified", qualified);
    setText("kpiSent", sent);
    setText("kpiConversion", `${conversion.toFixed(1)}%`);
    renderStatusTable(rows);
  } catch (err) {
    setText("kpiLeads", "-");
    setText("kpiCurious", "-");
    setText("kpiWarm", "-");
    setText("kpiQualified", "-");
    setText("kpiSent", "-");
    setText("kpiConversion", "-");
    renderStatusTable([{ status: "SEM DADOS", total: "-" }]);
  }
}

document.getElementById("overviewUf")?.addEventListener("change", loadOverviewPartnerSummary);
document.getElementById("btnOverviewPartnersReload")?.addEventListener("click", loadOverviewPartnerSummary);

loadDashboard();
loadOverviewPartnerSummary();
loadMlModelInfo();
