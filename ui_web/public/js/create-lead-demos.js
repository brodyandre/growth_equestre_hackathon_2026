function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeCityKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStatus(statusRaw) {
  const status = normKey(statusRaw);
  if (status === "AQUECENDO") return "AQUECENDO";
  if (status === "QUALIFICADO") return "QUALIFICADO";
  if (status === "ENVIADO") return "ENVIADO";
  return "CURIOSO";
}

function statusRank(statusRaw) {
  const key = normalizeStatus(statusRaw);
  if (key === "AQUECENDO") return 1;
  if (key === "QUALIFICADO") return 2;
  if (key === "ENVIADO") return 3;
  return 0;
}

function segmentLabel(segmentRaw) {
  const seg = normKey(segmentRaw);
  if (seg === "CAVALOS") return "Cavalos";
  if (seg === "SERVICOS") return "Servicos";
  if (seg === "EVENTOS") return "Eventos";
  if (seg === "EQUIPAMENTOS") return "Equipamentos";
  return String(segmentRaw || "-");
}

function statusBadge(statusRaw) {
  return normalizeStatus(statusRaw);
}

function statusSuggestion(statusRaw) {
  const status = normalizeStatus(statusRaw);
  if (status === "QUALIFICADO") return "Priorizar atendimento";
  if (status === "ENVIADO") return "Concluir handoff";
  return "Nutrir interesse";
}

function formatImpact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return n >= 0 ? `+${n}` : String(n);
}

function formatProbability(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function modelLabel(modelRaw) {
  const key = normKey(modelRaw);
  if (key === "BESTMODEL") return "Modelo vencedor (best_model)";
  if (key === "RUNNERUPMODEL") return "Runner-up model";
  if (key === "LOGITFINE") return "Regressao Logistica (fine tuning)";
  if (key === "RFFINE") return "Random Forest (fine tuning)";
  if (key === "LOGITBASE") return "Regressao Logistica (base)";
  if (key === "RFBASE") return "Random Forest (base)";
  return String(modelRaw || "-");
}

function scoreEngineLabel(engineRaw) {
  const key = normKey(engineRaw);
  if (key === "ML") return "ML";
  if (key === "RULES" || key === "REGRAS") return "Regras";
  return String(engineRaw || "-");
}

const CITY_DDD_MAP = {
  "SAO PAULO": "11",
  "GUARULHOS": "11",
  "OSASCO": "11",
  "SANTO ANDRE": "11",
  "SAO BERNARDO DO CAMPO": "11",
  "CAMPINAS": "19",
  "RIBEIRAO PRETO": "16",
  "SOROCABA": "15",
  "SAO JOSE DOS CAMPOS": "12",
  "BELO HORIZONTE": "31",
  "CONTAGEM": "31",
  "UBERLANDIA": "34",
  "JUIZ DE FORA": "32",
  "MONTES CLAROS": "38",
  "GOIANIA": "62",
  "APARECIDA DE GOIANIA": "62",
  "ANAPOLIS": "62",
  "RIO VERDE": "64",
  "JATAI": "64",
  "RIO DE JANEIRO": "21",
  "NITEROI": "21",
  "PETROPOLIS": "24",
  "VOLTA REDONDA": "24",
  "CAMPOS DOS GOYTACAZES": "22",
  "CURITIBA": "41",
  "PONTA GROSSA": "42",
  "LONDRINA": "43",
  "MARINGA": "44",
  "CASCAVEL": "45",
  "FLORIANOPOLIS": "48",
  "CRICIUMA": "48",
  "JOINVILLE": "47",
  "BLUMENAU": "47",
  "CHAPECO": "49",
  "PORTO ALEGRE": "51",
  "CAXIAS DO SUL": "54",
  "PELOTAS": "53",
  "SANTA MARIA": "55",
  "PASSO FUNDO": "54",
  "SALVADOR": "71",
  "LAURO DE FREITAS": "71",
  "FEIRA DE SANTANA": "75",
  "ILHEUS": "73",
  "VITORIA DA CONQUISTA": "77",
  "BRASILIA": "61",
  "TAGUATINGA": "61",
  "CEILANDIA": "61",
  "SAMAMBAIA": "61",
  "GAMA": "61",
};

const UF_DEFAULT_DDD_MAP = {
  AC: "68",
  AL: "82",
  AP: "96",
  AM: "92",
  BA: "71",
  CE: "85",
  DF: "61",
  ES: "27",
  GO: "62",
  MA: "98",
  MT: "65",
  MS: "67",
  MG: "31",
  PA: "91",
  PB: "83",
  PR: "41",
  PE: "81",
  PI: "86",
  RJ: "21",
  RN: "84",
  RS: "51",
  RO: "69",
  RR: "95",
  SC: "48",
  SP: "11",
  SE: "79",
  TO: "63",
};

function resolvePreferredDddFrom(ufRaw, cityRaw) {
  const cityKey = normalizeCityKey(cityRaw);
  if (cityKey && CITY_DDD_MAP[cityKey]) return CITY_DDD_MAP[cityKey];

  const uf = String(ufRaw || "").trim().toUpperCase();
  return UF_DEFAULT_DDD_MAP[uf] || "";
}

function resolvePreferredDdd() {
  return resolvePreferredDddFrom($uf?.value, $cidade?.value);
}

function whatsappPlaceholder(dddRaw) {
  const ddd = String(dddRaw || "").replace(/\D+/g, "").slice(0, 2) || "11";
  return `Somente numero: 91234-5678 (DDD ${ddd} auto)`;
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function formatLocalPhoneNumber(value) {
  const n = normalizePhoneDigits(value).slice(0, 9);
  if (!n) return "";
  if (n.length <= 4) return n;
  if (n.length <= 8) return `${n.slice(0, 4)}-${n.slice(4)}`;
  return `${n.slice(0, 5)}-${n.slice(5)}`;
}

function extractLocalDigitsFromAnyPhone(value) {
  let digits = normalizePhoneDigits(value);
  if (!digits) return "";

  if (digits.startsWith("55")) digits = digits.slice(2);
  // Remove DDD quando vier com numero nacional completo (10/11).
  if (digits.length >= 10) digits = digits.slice(2);
  return digits.slice(0, 9);
}

function composeWhatsappPayloadValue(localRaw, ufRaw, cityRaw) {
  const localDigits = normalizePhoneDigits(localRaw).slice(0, 9);
  if (!localDigits) return null;
  const ddd = resolvePreferredDddFrom(ufRaw, cityRaw);
  if (!ddd) return localDigits;
  // Payload salvo no backend: 55 + DDD + numero local (somente digitos).
  return `55${ddd}${localDigits}`;
}

function applyWhatsappMaskInput() {
  if (!$whatsapp) return;

  const applyMask = () => {
    $whatsapp.value = formatLocalPhoneNumber($whatsapp.value);
  };
  const applyPlaceholder = () => {
    $whatsapp.setAttribute("placeholder", whatsappPlaceholder(resolvePreferredDdd()));
  };

  $whatsapp.setAttribute("inputmode", "numeric");
  $whatsapp.setAttribute("maxlength", "10");
  applyPlaceholder();

  $whatsapp.addEventListener("input", applyMask);
  $whatsapp.addEventListener("blur", applyMask);
  $uf?.addEventListener("change", applyPlaceholder);
  $cidade?.addEventListener("input", applyPlaceholder);
  $cidade?.addEventListener("change", applyPlaceholder);
  applyMask();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let body = null;

  try {
    body = await response.json();
  } catch (_err) {
    body = null;
  }

  if (!response.ok) {
    const msg = body?.error || body?.message || body?.details || `HTTP ${response.status}`;
    throw new Error(String(msg));
  }

  return body;
}

const $form = document.getElementById("createLeadDemoForm");
const $submitBtn = document.getElementById("clSubmitBtn");
const $resetBtn = document.getElementById("clResetBtn");

const $quickCurioso = document.getElementById("clQuickCurioso");
const $quickAquecendo = document.getElementById("clQuickAquecendo");
const $quickQualificado = document.getElementById("clQuickQualificado");

const $nome = document.getElementById("clNome");
const $whatsapp = document.getElementById("clWhatsapp");
const $email = document.getElementById("clEmail");
const $uf = document.getElementById("clUf");
const $cidade = document.getElementById("clCidade");
const $segmento = document.getElementById("clSegmento");
const $orcamento = document.getElementById("clOrcamento");
const $prazo = document.getElementById("clPrazo");

const $evPageView = document.getElementById("clEvPageView");
const $evHook = document.getElementById("clEvHook");
const $evCta = document.getElementById("clEvCta");

const $notice = document.getElementById("clNotice");
const $resultCard = document.getElementById("clResultCard");
const $leadSummary = document.getElementById("clLeadSummary");
const $scoreNotice = document.getElementById("clScoreNotice");
const $mlDiag = document.getElementById("clMlDiag");
const $scoreKpis = document.getElementById("clScoreKpis");
const $reasonsList = document.getElementById("clReasonsList");

const $bulkN = document.getElementById("clBulkN");
const $bulkReplace = document.getElementById("clBulkReplace");
const $bulkSeedBtn = document.getElementById("clBulkSeedBtn");
const $bulkResetBtn = document.getElementById("clBulkResetBtn");
const $bulkNotice = document.getElementById("clBulkNotice");
const $bulkSummary = document.getElementById("clBulkSummary");
const $pitchScenarioBtn = document.getElementById("clPitchScenarioBtn");
const $pitchNotice = document.getElementById("clPitchNotice");
const $pitchSummary = document.getElementById("clPitchSummary");

const QUICK_PRESET_VARIANTS = {
  CURIOSO: [
    {
      label: "Baixa intencao (topo do funil)",
      uf: "GO",
      cidade: "Goiania",
      segmento_interesse: "EVENTOS",
      orcamento_faixa: "0-5k",
      prazo_compra: "90d",
      events: { pageViewCount: 1, hookCount: 0, ctaCount: 0 },
    },
    {
      label: "Baixo orcamento e baixa urgencia",
      uf: "MG",
      cidade: "Montes Claros",
      segmento_interesse: "SERVICOS",
      orcamento_faixa: "5k-20k",
      prazo_compra: "90d",
      events: { pageViewCount: 1, hookCount: 0, ctaCount: 1 },
    },
    {
      label: "Sem sinal forte de intencao",
      uf: "SP",
      cidade: "Sao Paulo",
      segmento_interesse: "EQUIPAMENTOS",
      orcamento_faixa: "0-5k",
      prazo_compra: "90d",
      events: { pageViewCount: 0, hookCount: 0, ctaCount: 0 },
    },
  ],
  AQUECENDO: [
    {
      label: "Interesse medio com hook",
      uf: "SP",
      cidade: "Sao Paulo",
      segmento_interesse: "SERVICOS",
      orcamento_faixa: "20k-60k",
      prazo_compra: "30d",
      events: { pageViewCount: 1, hookCount: 0, ctaCount: 2 },
    },
    {
      label: "Interesse crescente",
      uf: "MG",
      cidade: "Belo Horizonte",
      segmento_interesse: "EVENTOS",
      orcamento_faixa: "5k-20k",
      prazo_compra: "30d",
      events: { pageViewCount: 4, hookCount: 0, ctaCount: 1 },
    },
    {
      label: "Engajamento moderado",
      uf: "GO",
      cidade: "Goiania",
      segmento_interesse: "CAVALOS",
      orcamento_faixa: "20k-60k",
      prazo_compra: "90d",
      events: { pageViewCount: 2, hookCount: 1, ctaCount: 2 },
    },
  ],
  QUALIFICADO: [
    {
      label: "Alta intencao completa",
      uf: "MG",
      cidade: "Belo Horizonte",
      segmento_interesse: "CAVALOS",
      orcamento_faixa: "60k+",
      prazo_compra: "7d",
      events: { pageViewCount: 1, hookCount: 1, ctaCount: 4 },
    },
    {
      label: "Forte intencao comercial",
      uf: "SP",
      cidade: "Sao Paulo",
      segmento_interesse: "EQUIPAMENTOS",
      orcamento_faixa: "60k+",
      prazo_compra: "30d",
      events: { pageViewCount: 1, hookCount: 0, ctaCount: 4 },
    },
    {
      label: "Proximo de conversao",
      uf: "GO",
      cidade: "Goiania",
      segmento_interesse: "EVENTOS",
      orcamento_faixa: "20k-60k",
      prazo_compra: "7d",
      events: { pageViewCount: 2, hookCount: 1, ctaCount: 4 },
    },
  ],
};

function setNotice(el, message, isError = false) {
  if (!el) return;
  const text = String(message || "").trim();
  if (!text) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = text;
  el.style.borderColor = isError ? "rgba(255,107,129,0.5)" : "rgba(55,214,122,0.45)";
  el.style.color = isError ? "#ff9db0" : "#a5f7c7";
}

function clearResult() {
  if ($resultCard) $resultCard.style.display = "none";
  if ($leadSummary) $leadSummary.textContent = "";
  if ($scoreKpis) $scoreKpis.innerHTML = "";
  if ($reasonsList) $reasonsList.innerHTML = "";
  setNotice($scoreNotice, "");
  setNotice($mlDiag, "");
}

function renderKpis(scoreValue, statusRaw) {
  if (!$scoreKpis) return;
  const scoreTxt = scoreValue === null || scoreValue === undefined || scoreValue === "" ? "-" : String(scoreValue);
  const statusTxt = statusBadge(statusRaw || "CURIOSO");
  const suggestionTxt = statusSuggestion(statusRaw || "CURIOSO");

  $scoreKpis.innerHTML = `
    <article class="kpi-box">
      <div class="kpi-label">Score</div>
      <div class="kpi-value">${escapeHtml(scoreTxt)}</div>
    </article>
    <article class="kpi-box">
      <div class="kpi-label">Status</div>
      <div class="kpi-value">${escapeHtml(statusTxt)}</div>
    </article>
    <article class="kpi-box">
      <div class="kpi-label">Proxima acao</div>
      <div class="kpi-value">${escapeHtml(suggestionTxt)}</div>
    </article>
  `;
}

function renderReasons(motivosRaw) {
  if (!$reasonsList) return;
  const motivos = Array.isArray(motivosRaw) ? motivosRaw : [];
  if (!motivos.length) {
    $reasonsList.innerHTML = "<li>Sem motivos detalhados disponiveis.</li>";
    return;
  }

  const items = [];
  for (const motivo of motivos) {
    if (!motivo || typeof motivo !== "object") continue;
    const fator = String(motivo.fator || "Fator").trim();
    const impacto = formatImpact(motivo.impacto ?? 0);
    const detalhe = String(motivo.detalhe || "").trim();
    if (detalhe) {
      items.push(`<li><b>${escapeHtml(`${fator} (${impacto})`)}</b> - ${escapeHtml(detalhe)}</li>`);
    } else {
      items.push(`<li><b>${escapeHtml(`${fator} (${impacto})`)}</b></li>`);
    }
  }

  $reasonsList.innerHTML = items.length ? items.join("") : "<li>Sem motivos detalhados disponiveis.</li>";
}

function renderModelDiagnostics(scored, options = {}) {
  if (!$mlDiag) return;
  if (!scored || typeof scored !== "object") {
    setNotice($mlDiag, "Diagnostico de ML indisponivel para este calculo.", true);
    return;
  }

  const meta = scored.meta && typeof scored.meta === "object" ? scored.meta : {};
  const predicted = normalizeStatus(scored.status);
  const engine = scoreEngineLabel(meta.engine);
  const model = modelLabel(meta.model_name);
  const probability = formatProbability(meta.probability_qualified);

  const targetStatus = normalizeStatus(options.targetStatus || "");
  const hasTarget = Boolean(options.targetStatus);
  const statusMatch = !hasTarget || predicted === targetStatus;

  const parts = [
    `Motor: ${engine}`,
    `Modelo: ${model}`,
    `Prob. qualificado: ${probability}`,
    `Status previsto: ${predicted}`,
  ];

  if (hasTarget) {
    parts.push(`Status alvo: ${targetStatus}`);
    parts.push(`Tentativa: ${options.attemptIndex || 1}/${options.totalAttempts || 1}`);
  }
  if (options.profileLabel) {
    parts.push(`Perfil usado: ${options.profileLabel}`);
  }

  setNotice($mlDiag, parts.join(" | "), !statusMatch);
}

function getPayload() {
  const nome = String($nome?.value || "").trim();
  const email = String($email?.value || "").trim();
  const uf = String($uf?.value || "").trim().toUpperCase();
  const cidade = String($cidade?.value || "").trim();
  const whatsappLocal = String($whatsapp?.value || "").trim();
  const whatsapp = composeWhatsappPayloadValue(whatsappLocal, uf, cidade);
  const segmento = String($segmento?.value || "").trim().toUpperCase();
  const orcamento = String($orcamento?.value || "").trim();
  const prazo = String($prazo?.value || "").trim();

  return {
    nome,
    whatsapp: whatsapp || null,
    email: email || null,
    uf: uf || null,
    cidade: cidade || null,
    segmento_interesse: segmento || null,
    orcamento_faixa: orcamento || null,
    prazo_compra: prazo || null,
  };
}

function getEventFlags() {
  return {
    pageViewCount: $evPageView?.checked ? 1 : 0,
    hookCount: $evHook?.checked ? 1 : 0,
    ctaCount: $evCta?.checked ? 1 : 0,
  };
}

function normalizeEventPlan(eventFlags) {
  const raw = eventFlags && typeof eventFlags === "object" ? eventFlags : {};
  const parseCount = (countKey, boolKeys = []) => {
    const direct = Number(raw[countKey]);
    if (Number.isFinite(direct)) return Math.max(0, Math.trunc(direct));
    for (const key of boolKeys) {
      if (raw[key]) return 1;
    }
    return 0;
  };

  return {
    pageViewCount: parseCount("pageViewCount", ["pageView"]),
    hookCount: parseCount("hookCount", ["hook"]),
    ctaCount: parseCount("ctaCount", ["cta"]),
  };
}

function validatePayload(payload) {
  if (!payload.nome) return "Informe o nome do lead.";
  if (!payload.segmento_interesse) return "Informe o segmento de interesse.";
  if (!payload.uf) return "Informe a UF.";
  return "";
}

function setBusy(isBusy) {
  const busy = Boolean(isBusy);
  if ($submitBtn) $submitBtn.disabled = busy;
  if ($bulkSeedBtn) $bulkSeedBtn.disabled = busy;
  if ($bulkResetBtn) $bulkResetBtn.disabled = busy;
  if ($pitchScenarioBtn) $pitchScenarioBtn.disabled = busy;
  if ($quickCurioso) $quickCurioso.disabled = busy;
  if ($quickAquecendo) $quickAquecendo.disabled = busy;
  if ($quickQualificado) $quickQualificado.disabled = busy;
}

function renderBulkSummary(data) {
  if (!$bulkSummary) return;
  const byStatus = data?.by_status || {};
  const c = Number(byStatus.CURIOSO || 0);
  const a = Number(byStatus.AQUECENDO || 0);
  const q = Number(byStatus.QUALIFICADO || 0);
  const e = Number(byStatus.ENVIADO || 0);
  const events = Number(data?.events_inserted || 0);
  const total = Number(data?.total_leads || 0);

  $bulkSummary.textContent =
    `Gerados: ${c + a + q + e} | CURIOSO: ${c} | AQUECENDO: ${a} | QUALIFICADO: ${q} | ENVIADO: ${e} | Eventos: ${events} | Total atual: ${total}`;
}

async function seedBulkLeads() {
  setNotice($bulkNotice, "");
  if ($bulkSummary) $bulkSummary.textContent = "";

  const n = Number($bulkN?.value || 450);
  const replace = Boolean($bulkReplace?.checked);
  if (!Number.isFinite(n) || n < 1) {
    setNotice($bulkNotice, "Informe uma quantidade valida (minimo 1).", true);
    return;
  }

  const confirmMsg = replace
    ? `Confirma gerar ${n} leads sinteticos e limpar os leads atuais?`
    : `Confirma gerar ${n} leads sinteticos adicionais?`;
  if (!window.confirm(confirmMsg)) return;

  setBusy(true);
  setNotice($bulkNotice, "Gerando massa de leads sinteticos para treino...");

  try {
    const data = await requestJson("/api/demo/seed-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n, replace }),
    });

    setNotice($bulkNotice, data?.message || "Massa de leads gerada com sucesso.");
    renderBulkSummary(data || {});
  } catch (err) {
    setNotice($bulkNotice, `Falha ao gerar massa de leads. ${err.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function resetSeededLeads() {
  setNotice($bulkNotice, "");
  if ($bulkSummary) $bulkSummary.textContent = "";

  if (!window.confirm("Confirma remover somente os leads sinteticos gerados para treino?")) return;

  setBusy(true);
  setNotice($bulkNotice, "Removendo leads sinteticos...");

  try {
    const data = await requestJson("/api/demo/reset-seeded-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: false }),
    });

    const deleted = data?.deleted || {};
    const total = Number(data?.total_leads || 0);
    setNotice($bulkNotice, data?.message || "Leads sinteticos removidos com sucesso.");
    if ($bulkSummary) {
      $bulkSummary.textContent =
        `Removidos -> Leads: ${Number(deleted.leads || 0)}, Eventos: ${Number(deleted.events || 0)}, ` +
        `Notas: ${Number(deleted.lead_notes || 0)}, CRM Notas: ${Number(deleted.crm_lead_notes || 0)}, ` +
        `CRM Estado: ${Number(deleted.crm_lead_state || 0)} | Total atual: ${total}`;
    }
  } catch (err) {
    setNotice($bulkNotice, `Falha ao resetar leads sinteticos. ${err.message}`, true);
  } finally {
    setBusy(false);
  }
}

function applyPresetToForm(payload, events) {
  const plan = normalizeEventPlan(events);
  if ($nome) $nome.value = String(payload?.nome || "");
  if ($whatsapp) {
    const localDigits = extractLocalDigitsFromAnyPhone(payload?.whatsapp || "");
    $whatsapp.value = formatLocalPhoneNumber(localDigits);
    $whatsapp.setAttribute("placeholder", whatsappPlaceholder(resolvePreferredDddFrom(payload?.uf, payload?.cidade)));
  }
  if ($email) $email.value = String(payload?.email || "");
  if ($uf) $uf.value = String(payload?.uf || "MG");
  if ($cidade) $cidade.value = String(payload?.cidade || "");
  if ($segmento) $segmento.value = String(payload?.segmento_interesse || "CAVALOS");
  if ($orcamento) $orcamento.value = String(payload?.orcamento_faixa || "");
  if ($prazo) $prazo.value = String(payload?.prazo_compra || "");

  if ($evPageView) $evPageView.checked = plan.pageViewCount > 0;
  if ($evHook) $evHook.checked = plan.hookCount > 0;
  if ($evCta) $evCta.checked = plan.ctaCount > 0;
}

function buildAutoLeadName(targetStatus, attemptIndex) {
  const status = normalizeStatus(targetStatus);
  const stamp = new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
  return `Lead Demo ${status} ${stamp}-${attemptIndex}`;
}

function buildQuickPayload(targetStatus, preset, attemptIndex) {
  const serial = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  return {
    nome: buildAutoLeadName(targetStatus, attemptIndex),
    whatsapp: null,
    email: `lead.demo.${normalizeStatus(targetStatus).toLowerCase()}.${serial}@exemplo.com`,
    uf: preset.uf || "MG",
    cidade: preset.cidade || null,
    segmento_interesse: preset.segmento_interesse || "CAVALOS",
    orcamento_faixa: preset.orcamento_faixa || null,
    prazo_compra: preset.prazo_compra || null,
  };
}

async function createLeadFlow(options = {}) {
  const payload = options.payloadOverride || getPayload();
  const eventFlags = normalizeEventPlan(options.eventsOverride || getEventFlags());
  const targetStatus = options.targetStatus ? normalizeStatus(options.targetStatus) : "";
  const profileLabel = String(options.profileLabel || "").trim();
  const attemptIndex = Number(options.attemptIndex || 1);
  const totalAttempts = Number(options.totalAttempts || 1);
  const externalBusyControl = Boolean(options.externalBusyControl);
  const skipClearResult = Boolean(options.skipClearResult);
  const quiet = Boolean(options.quiet);

  if (!skipClearResult && !quiet) clearResult();
  if (!quiet) {
    setNotice($notice, "");
    setNotice($scoreNotice, "");
  }

  const validationError = validatePayload(payload);
  if (validationError) {
    if (!quiet) setNotice($notice, validationError, true);
    return { ok: false, error: validationError };
  }

  if (!externalBusyControl) setBusy(true);

  const startMessage = targetStatus
    ? `Gerando lead alvo ${targetStatus} (${attemptIndex}/${totalAttempts})...`
    : "Criando lead e simulando funil...";
  if (!quiet) setNotice($notice, startMessage);

  let lead = null;
  try {
    lead = await requestJson("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (!quiet) setNotice($notice, `Nao foi possivel criar o lead agora. ${err.message}`, true);
    if (!externalBusyControl) setBusy(false);
    return { ok: false, error: err.message };
  }

  const leadId = String(lead?.id || "").trim();
  const deduplicated = Boolean(lead?.deduplicated);
  const segmentTxt = segmentLabel(lead?.segmento_interesse || payload.segmento_interesse);
  const ufTxt = String(lead?.uf || payload.uf || "-");

  if (!quiet) {
    if ($resultCard) $resultCard.style.display = "block";
    if ($leadSummary) {
      $leadSummary.innerHTML = `Nome: <b>${escapeHtml(lead?.nome || payload.nome)}</b> | Segmento: <b>${escapeHtml(segmentTxt)}</b> | UF: <b>${escapeHtml(ufTxt)}</b>`;
    }
  }

  if (!leadId) {
    if (!quiet) setNotice($notice, "Lead criado, mas sem ID retornado para continuar o fluxo.", true);
    if (!externalBusyControl) setBusy(false);
    return { ok: false, error: "lead_without_id", lead };
  }

  if (!deduplicated) {
    const eventTasks = [];
    for (let i = 0; i < eventFlags.pageViewCount; i += 1) {
      eventTasks.push(
        requestJson("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: leadId, event_type: "page_view" }),
        }).catch(() => null)
      );
    }
    for (let i = 0; i < eventFlags.hookCount; i += 1) {
      eventTasks.push(
        requestJson("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: leadId, event_type: "hook_complete" }),
        }).catch(() => null)
      );
    }
    for (let i = 0; i < eventFlags.ctaCount; i += 1) {
      eventTasks.push(
        requestJson("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: leadId, event_type: "cta_click" }),
        }).catch(() => null)
      );
    }
    await Promise.all(eventTasks);
  }

  try {
    const scored = await requestJson(`/api/leads/${encodeURIComponent(leadId)}/score`, {
      method: "POST",
    });

    const predictedStatus = normalizeStatus(scored?.status);
    if (!quiet) {
      renderKpis(scored?.score, predictedStatus);
      renderReasons(scored?.motivos || []);
      renderModelDiagnostics(scored, {
        targetStatus,
        attemptIndex,
        totalAttempts,
        profileLabel,
      });

      if (targetStatus) {
        const matched = predictedStatus === targetStatus;
        const prefix = profileLabel ? `Perfil: ${profileLabel}. ` : "";
        if (matched) {
          setNotice(
            $scoreNotice,
            `${prefix}Status alvo ${targetStatus} atingido na tentativa ${attemptIndex}/${totalAttempts}.`
          );
        } else {
          setNotice(
            $scoreNotice,
            `${prefix}Status previsto ${predictedStatus} (alvo ${targetStatus}) na tentativa ${attemptIndex}/${totalAttempts}.`,
            true
          );
        }
      } else if (deduplicated) {
        setNotice($scoreNotice, "Lead existente reaproveitado. Score atualizado sem duplicar eventos.");
        setNotice($notice, "Lead existente reutilizado com sucesso (sem duplicidade).");
      } else {
        setNotice($scoreNotice, "Score calculado automaticamente com sucesso.");
        setNotice($notice, "Lead criado com sucesso.");
      }
    }

    return { ok: true, lead, scored, deduplicated, predictedStatus };
  } catch (err) {
    if (!quiet) {
      renderKpis("-", "CURIOSO");
      renderReasons([]);
      renderModelDiagnostics(null);

      setNotice($scoreNotice, `Lead salvo, mas nao foi possivel calcular o score. ${err.message}`, true);
      if (deduplicated) {
        setNotice($notice, "Lead existente reutilizado (sem duplicidade).");
      } else {
        setNotice($notice, "Lead criado com sucesso.");
      }
    }
    return { ok: false, error: err.message, lead, deduplicated };
  } finally {
    if (!externalBusyControl) setBusy(false);
  }
}

async function runQuickPreset(targetStatusRaw, options = {}) {
  const targetStatus = normalizeStatus(targetStatusRaw);
  const manageBusy = options.manageBusy !== false;
  const showMessages = options.showMessages !== false;
  const variants = QUICK_PRESET_VARIANTS[targetStatus] || [];
  if (!variants.length) {
    if (showMessages) setNotice($notice, `Nao ha presets configurados para ${targetStatus}.`, true);
    return { targetStatus, matched: false, outcome: null, attemptUsed: 0, profileLabel: "" };
  }

  if (showMessages) {
    clearResult();
    setNotice($notice, `Iniciando criacao inteligente para ${targetStatus} (ML)...`);
  }
  if (manageBusy) setBusy(true);

  let lastOutcome = null;
  let matched = false;
  let attemptUsed = 0;
  let profileLabel = "";
  const totalAttempts = variants.length;

  try {
    for (let i = 0; i < variants.length; i += 1) {
      const preset = variants[i];
      const payload = buildQuickPayload(targetStatus, preset, i + 1);
      const events = preset.events || { pageViewCount: 1, hookCount: 1, ctaCount: 1 };
      applyPresetToForm(payload, events);

      const outcome = await createLeadFlow({
        payloadOverride: payload,
        eventsOverride: events,
        targetStatus,
        profileLabel: preset.label,
        attemptIndex: i + 1,
        totalAttempts,
        externalBusyControl: true,
        skipClearResult: true,
        quiet: !showMessages,
      });

      if (outcome?.ok) {
        lastOutcome = outcome;
        attemptUsed = i + 1;
        profileLabel = String(preset.label || "").trim();
        const predicted = normalizeStatus(outcome.predictedStatus);
        const distance = Math.abs(statusRank(predicted) - statusRank(targetStatus));
        if (predicted === targetStatus || distance === 0) {
          matched = true;
          break;
        }
      }
    }
  } finally {
    if (manageBusy) setBusy(false);
  }

  if (!lastOutcome) {
    if (showMessages) setNotice($notice, `Nao foi possivel gerar lead ${targetStatus} agora.`, true);
    return { targetStatus, matched: false, outcome: null, attemptUsed: 0, profileLabel: "" };
  }

  const predicted = normalizeStatus(lastOutcome.predictedStatus);
  if (showMessages) {
    if (matched) {
      setNotice($notice, `Lead ${targetStatus} criado com sucesso usando atalho inteligente.`);
    } else {
      setNotice(
        $notice,
        `Lead criado com status ${predicted}. Ajuste manual disponivel para aproximar de ${targetStatus}.`,
        true
      );
    }
  }

  return { targetStatus, matched, outcome: lastOutcome, attemptUsed, profileLabel };
}

function renderPitchSummary(rows) {
  if (!$pitchSummary) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    $pitchSummary.style.display = "none";
    $pitchSummary.innerHTML = "";
    return;
  }

  const body = list
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.target)}</td>
        <td>${escapeHtml(row.predicted)}</td>
        <td>${escapeHtml(row.score)}</td>
        <td>${escapeHtml(row.model)}</td>
        <td>${escapeHtml(row.probability)}</td>
        <td>${escapeHtml(row.attempt)}</td>
        <td>${escapeHtml(row.leadName)}</td>
      </tr>`
    )
    .join("");

  $pitchSummary.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Alvo</th>
          <th>Previsto</th>
          <th>Score</th>
          <th>Modelo</th>
          <th>Prob. qualificado</th>
          <th>Tentativa</th>
          <th>Lead</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
  $pitchSummary.style.display = "block";
}

async function runPitchScenario() {
  if ($pitchSummary) {
    $pitchSummary.style.display = "none";
    $pitchSummary.innerHTML = "";
  }
  setNotice($pitchNotice, "");

  const targets = ["QUALIFICADO", "AQUECENDO", "CURIOSO"];
  setBusy(true);
  setNotice($pitchNotice, "Gerando cenario completo de pitch com 3 leads...");

  const summaryRows = [];
  let hits = 0;
  try {
    for (const target of targets) {
      const result = await runQuickPreset(target, {
        manageBusy: false,
        showMessages: false,
      });

      if (!result?.outcome) {
        summaryRows.push({
          target,
          predicted: "ERRO",
          score: "-",
          model: "-",
          probability: "-",
          attempt: "-",
          leadName: "-",
        });
        continue;
      }

      const predicted = normalizeStatus(result.outcome?.predictedStatus);
      const scoreValue = result.outcome?.scored?.score;
      const meta =
        result.outcome?.scored?.meta && typeof result.outcome?.scored?.meta === "object"
          ? result.outcome.scored.meta
          : {};

      if (result.matched) hits += 1;
      summaryRows.push({
        target,
        predicted,
        score: scoreValue === null || scoreValue === undefined ? "-" : String(scoreValue),
        model: modelLabel(meta.model_name),
        probability: formatProbability(meta.probability_qualified),
        attempt: result.attemptUsed ? `${result.attemptUsed}/${(QUICK_PRESET_VARIANTS[target] || []).length}` : "-",
        leadName: String(result.outcome?.lead?.nome || "-"),
      });
    }
  } finally {
    setBusy(false);
  }

  renderPitchSummary(summaryRows);
  if (hits === targets.length) {
    setNotice($pitchNotice, "Cenario de pitch criado com todos os alvos atingidos.");
  } else {
    setNotice(
      $pitchNotice,
      `Cenario criado com ${hits}/${targets.length} alvos atingidos. Utilize a tabela para explicar variacoes reais do ML.`,
      true
    );
  }
}

function resetForm() {
  if ($nome) $nome.value = "Visitante Demo";
  if ($whatsapp) $whatsapp.value = "";
  if ($email) $email.value = "";
  if ($uf) $uf.value = "MG";
  if ($cidade) $cidade.value = "";
  if ($segmento) $segmento.value = "CAVALOS";
  if ($orcamento) $orcamento.value = "";
  if ($prazo) $prazo.value = "";
  if ($evPageView) $evPageView.checked = true;
  if ($evHook) $evHook.checked = true;
  if ($evCta) $evCta.checked = true;

  if ($whatsapp) {
    $whatsapp.setAttribute("placeholder", whatsappPlaceholder(resolvePreferredDddFrom("MG", "")));
    $whatsapp.value = "";
  }
  setNotice($notice, "");
  clearResult();
}

applyWhatsappMaskInput();

$form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await createLeadFlow();
});

$resetBtn?.addEventListener("click", resetForm);
$quickCurioso?.addEventListener("click", async () => runQuickPreset("CURIOSO"));
$quickAquecendo?.addEventListener("click", async () => runQuickPreset("AQUECENDO"));
$quickQualificado?.addEventListener("click", async () => runQuickPreset("QUALIFICADO"));
$pitchScenarioBtn?.addEventListener("click", runPitchScenario);
$bulkSeedBtn?.addEventListener("click", seedBulkLeads);
$bulkResetBtn?.addEventListener("click", resetSeededLeads);
