function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toInt(value, fallback = 60, min = 1, max = 1440) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function requestJson(url, options = {}) {
  const resp = await fetch(url, options);
  let body = null;
  try {
    body = await resp.json();
  } catch (_err) {
    body = null;
  }

  if (!resp.ok) {
    const msg = body?.error || body?.message || body?.details || `HTTP ${resp.status}`;
    throw new Error(String(msg));
  }

  return body;
}

const $windowMinutes = document.getElementById("dedupWindowMinutes");
const $confirmRun = document.getElementById("dedupConfirmRun");
const $btnDryRun = document.getElementById("btnDedupDryRun");
const $btnRun = document.getElementById("btnDedupRun");
const $notice = document.getElementById("dedupNotice");
const $result = document.getElementById("dedupResult");

const state = {
  busy: false,
};

function setNotice(message, isError = false) {
  if (!$notice) return;
  const msg = String(message || "").trim();
  if (!msg) {
    $notice.style.display = "none";
    $notice.textContent = "";
    return;
  }
  $notice.style.display = "block";
  $notice.textContent = msg;
  $notice.style.borderColor = isError ? "rgba(255,107,129,0.5)" : "rgba(55,214,122,0.45)";
  $notice.style.color = isError ? "#ff9db0" : "#a5f7c7";
}

function renderResult(payload) {
  if (!$result) return;
  if (!payload || typeof payload !== "object") {
    $result.style.display = "none";
    $result.innerHTML = "";
    return;
  }

  const migrated = payload.migrated && typeof payload.migrated === "object" ? payload.migrated : {};
  const rows = [
    ["Modo", payload.dry_run ? "dry-run" : "limpeza real"],
    ["Janela (min)", payload.window_minutes],
    ["Leads antes", payload.before_leads],
    ["Leads apos", payload.after_leads],
    ["Grupos duplicados", payload.duplicate_groups],
    ["Linhas duplicadas", payload.duplicated_rows],
    ["Linhas para excluir", payload.rows_to_delete],
    ["Leads removidos", payload.deleted_leads],
    ["Eventos migrados", migrated.events ?? 0],
    ["Notas (lead_notes) migradas", migrated.lead_notes ?? 0],
    ["Notas (crm_lead_notes) migradas", migrated.crm_lead_notes ?? 0],
    ["Estado CRM promovido", migrated.crm_lead_state_promoted ?? 0],
    ["Estado CRM removido", migrated.crm_lead_state_removed ?? 0],
    ["Executado em", payload.executed_at || "-"],
  ];

  const htmlRows = rows
    .map(
      ([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value ?? "-")}</td></tr>`
    )
    .join("");

  $result.style.display = "block";
  $result.innerHTML = `
    <table class="lead-kv-table">
      <thead>
        <tr><th>Indicador</th><th>Valor</th></tr>
      </thead>
      <tbody>${htmlRows}</tbody>
    </table>
  `;
}

function syncButtons() {
  if ($btnDryRun) $btnDryRun.disabled = state.busy;
  if ($btnRun) {
    const confirmed = Boolean($confirmRun?.checked);
    $btnRun.disabled = state.busy || !confirmed;
  }
}

function setBusy(busy) {
  state.busy = Boolean(busy);
  syncButtons();
}

async function runDedup(dryRun) {
  const windowMinutes = toInt($windowMinutes?.value, 60, 1, 1440);
  setBusy(true);
  setNotice(dryRun ? "Executando dry-run de deduplicacao..." : "Executando limpeza de duplicados...");

  try {
    const payload = await requestJson("/api/admin/dedup-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry_run: Boolean(dryRun),
        window_minutes: windowMinutes,
      }),
    });
    renderResult(payload);

    if (dryRun) {
      setNotice(
        `Dry-run concluido. Duplicados detectados: ${payload.rows_to_delete || 0}.`
      );
    } else {
      setNotice(
        `Limpeza concluida. Leads removidos: ${payload.deleted_leads || 0}.`
      );
    }
  } catch (err) {
    setNotice(`Falha ao executar deduplicacao. ${err.message}`, true);
  } finally {
    setBusy(false);
  }
}

$confirmRun?.addEventListener("change", syncButtons);
$btnDryRun?.addEventListener("click", () => runDedup(true));
$btnRun?.addEventListener("click", () => runDedup(false));

syncButtons();
