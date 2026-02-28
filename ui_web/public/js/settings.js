function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toInt(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
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
    const msg = body?.error || body?.message || body?.details || body?.detail || `HTTP ${resp.status}`;
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

const $mlExpectedLeads = document.getElementById("mlExpectedLeads");
const $mlRandomSeed = document.getElementById("mlRandomSeed");
const $mlSearchMode = document.getElementById("mlSearchMode");
const $mlIgnoreExpectedMismatch = document.getElementById("mlIgnoreExpectedMismatch");
const $mlConfirmRun = document.getElementById("mlRetrainConfirmRun");
const $mlRunBtn = document.getElementById("btnMlRetrainRun");
const $mlNotice = document.getElementById("mlRetrainNotice");
const $mlResult = document.getElementById("mlRetrainResult");

const state = {
  dedupBusy: false,
  mlBusy: false,
};

function setNotice(targetEl, message, isError = false) {
  if (!targetEl) return;
  const msg = String(message || "").trim();
  if (!msg) {
    targetEl.style.display = "none";
    targetEl.textContent = "";
    return;
  }
  targetEl.style.display = "block";
  targetEl.textContent = msg;
  targetEl.style.borderColor = isError ? "rgba(255,107,129,0.5)" : "rgba(55,214,122,0.45)";
  targetEl.style.color = isError ? "#ff9db0" : "#a5f7c7";
}

function renderKvTable(containerEl, rows) {
  if (!containerEl) return;
  if (!Array.isArray(rows) || !rows.length) {
    containerEl.style.display = "none";
    containerEl.innerHTML = "";
    return;
  }

  const htmlRows = rows
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value ?? "-")}</td></tr>`)
    .join("");

  containerEl.style.display = "block";
  containerEl.innerHTML = `
    <table class="lead-kv-table">
      <thead>
        <tr><th>Indicador</th><th>Valor</th></tr>
      </thead>
      <tbody>${htmlRows}</tbody>
    </table>
  `;
}

function renderDedupResult(payload) {
  if (!$result || !payload || typeof payload !== "object") {
    renderKvTable($result, []);
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
  renderKvTable($result, rows);
}

function renderMlRetrainResult(payload) {
  if (!$mlResult || !payload || typeof payload !== "object") {
    renderKvTable($mlResult, []);
    return;
  }

  const classBalance =
    payload.class_balance && typeof payload.class_balance === "object" ? payload.class_balance : {};
  const selectionReasons = Array.isArray(payload.selection_reasons)
    ? payload.selection_reasons.filter(Boolean).join(" | ")
    : "-";
  const elapsedSeconds = Number.isFinite(Number(payload.elapsed_ms))
    ? `${(Number(payload.elapsed_ms) / 1000).toFixed(1)} s`
    : "-";

  const rows = [
    ["Mensagem", payload.message || "-"],
    ["Leads usados no treino", payload.dataset_rows],
    ["Leads esperados", payload.expected_leads ?? "-"],
    ["Modo de treino", payload.search_mode || "-"],
    ["CV folds", payload.cv_folds ?? "-"],
    ["Modelo vencedor", payload.winner_label || payload.winner || "-"],
    ["Runner-up", payload.runner_up_label || payload.runner_up || "-"],
    ["Classe QUALIFICADO+ENVIADO", classBalance.qualified_count ?? "-"],
    ["Classe CURIOSO+AQUECENDO", classBalance.non_qualified_count ?? "-"],
    ["Razao qualificados", classBalance.qualified_ratio ?? "-"],
    ["Afeta leads existentes", payload.affects_existing_scores ? "sim" : "nao"],
    ["Aplicacao", payload.applies_to || "novos scores apos o treino"],
    ["Tempo total", elapsedSeconds],
    ["Razoes de selecao", selectionReasons],
    ["Relatorio salvo em", payload.report_path || "-"],
  ];
  renderKvTable($mlResult, rows);
}

function syncButtons() {
  const anyBusy = state.dedupBusy || state.mlBusy;

  if ($btnDryRun) $btnDryRun.disabled = anyBusy;
  if ($btnRun) {
    const confirmed = Boolean($confirmRun?.checked);
    $btnRun.disabled = anyBusy || !confirmed;
  }

  if ($mlRunBtn) {
    const confirmed = Boolean($mlConfirmRun?.checked);
    $mlRunBtn.disabled = anyBusy || !confirmed;
  }
}

function setDedupBusy(busy) {
  state.dedupBusy = Boolean(busy);
  syncButtons();
}

function setMlBusy(busy) {
  state.mlBusy = Boolean(busy);
  syncButtons();
}

async function runDedup(dryRun) {
  const windowMinutes = toInt($windowMinutes?.value, 60, 1, 1440);
  setDedupBusy(true);
  setNotice($notice, dryRun ? "Executando dry-run de deduplicacao..." : "Executando limpeza de duplicados...");

  try {
    const payload = await requestJson("/api/admin/dedup-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry_run: Boolean(dryRun),
        window_minutes: windowMinutes,
      }),
    });
    renderDedupResult(payload);

    if (dryRun) {
      setNotice($notice, `Dry-run concluido. Duplicados detectados: ${payload.rows_to_delete || 0}.`);
    } else {
      setNotice($notice, `Limpeza concluida. Leads removidos: ${payload.deleted_leads || 0}.`);
    }
  } catch (err) {
    setNotice($notice, `Falha ao executar deduplicacao. ${err.message}`, true);
  } finally {
    setDedupBusy(false);
  }
}

async function runModelRetrain() {
  const expectedLeads = toInt($mlExpectedLeads?.value, 0, 0, 500000);
  const randomSeed = toInt($mlRandomSeed?.value, 42, 1, 2147483647);
  const searchMode = ($mlSearchMode?.value || "quick") === "full" ? "full" : "quick";
  const ignoreExpectedMismatch = Boolean($mlIgnoreExpectedMismatch?.checked);

  const payload = {
    expected_leads: expectedLeads > 0 ? expectedLeads : null,
    ignore_expected_mismatch: ignoreExpectedMismatch,
    random_state: randomSeed,
    min_rows: 200,
    search_mode: searchMode,
    affect_existing_scores: false,
  };

  setMlBusy(true);
  setNotice(
    $mlNotice,
    "Retreinando modelo com base atual. Isso pode levar alguns minutos, sem alterar os leads existentes."
  );

  try {
    const response = await requestJson("/api/admin/ml/retrain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    renderMlRetrainResult(response);
    setNotice(
      $mlNotice,
      `Treino concluido. Vencedor: ${response.winner_label || response.winner || "-"}. ` +
        "O novo modelo passa a valer para novos scores."
    );
  } catch (err) {
    renderMlRetrainResult(null);
    setNotice($mlNotice, `Falha ao retreinar modelo. ${err.message}`, true);
  } finally {
    setMlBusy(false);
  }
}

$confirmRun?.addEventListener("change", syncButtons);
$btnDryRun?.addEventListener("click", () => runDedup(true));
$btnRun?.addEventListener("click", () => runDedup(false));

$mlConfirmRun?.addEventListener("change", syncButtons);
$mlRunBtn?.addEventListener("click", runModelRetrain);

syncButtons();
