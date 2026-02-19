import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "node:fs/promises";
import path from "node:path";
import { pool, query } from "./db.js";
import crmRoutes from "./crm_routes.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.resolve(process.cwd(), "..", "ui_web")));
app.use(express.static(path.resolve(process.cwd(), "ui_web"))); // fallback para se rodar da raiz

const PORT = process.env.PORT || 3000;
const SCORING_URL = process.env.SCORING_URL || "http://scoring:8000";
const ML_REPORT_PATHS = [
  process.env.ML_REPORT_PATH,
  "/app/data/ml/artifacts/model_selection_report.json",
  path.resolve(
    process.cwd(),
    "data",
    "ml",
    "artifacts",
    "model_selection_report.json",
  ),
  path.resolve(
    process.cwd(),
    "..",
    "data",
    "ml",
    "artifacts",
    "model_selection_report.json",
  ),
].filter(Boolean);

/**
 * Handler padrão para evitar crash e responder com erro consistente.
 */
function asyncHandler(fn) {
  return (req, res) =>
    Promise.resolve(fn(req, res)).catch((e) => {
      console.error(e);
      res
        .status(500)
        .json({ error: "Erro interno no servidor", details: String(e) });
    });
}

function ensurePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function formatMlModelLabel(modelId) {
  const key = String(modelId || "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  if (key === "logit_fine") return "Regressao Logistica (fine tuning)";
  if (key === "rf_fine") return "Random Forest (fine tuning)";
  if (key === "logit_base") return "Regressao Logistica (base)";
  if (key === "rf_base") return "Random Forest (base)";
  if (key === "best_model") return "Best model";
  if (key === "runner_up_model") return "Runner-up model";
  return String(modelId);
}

function formatFineTuningSummary(bestParams) {
  const params = ensurePlainObject(bestParams);
  const keys = Object.keys(params);
  if (!keys.length) return null;
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

async function readMlModelInfo() {
  const tried = [];

  for (const reportPath of ML_REPORT_PATHS) {
    if (!reportPath) continue;
    tried.push(reportPath);
    try {
      const raw = await fs.readFile(reportPath, "utf-8");
      const payload = ensurePlainObject(JSON.parse(raw));

      const winnerId = String(payload.winner || "").trim() || null;
      const runnerUpId = String(payload.runner_up || "").trim() || null;

      const allBestParams = ensurePlainObject(payload.best_params);
      const winnerBestParams = ensurePlainObject(
        winnerId ? allBestParams[winnerId] : allBestParams.winner,
      );

      let reportUpdatedAt = null;
      try {
        const stats = await fs.stat(reportPath);
        reportUpdatedAt = stats.mtime?.toISOString?.() || null;
      } catch {
        reportUpdatedAt = null;
      }

      return {
        available: true,
        winner: {
          id: winnerId,
          label: formatMlModelLabel(winnerId),
        },
        runner_up: {
          id: runnerUpId,
          label: formatMlModelLabel(runnerUpId),
        },
        fine_tuning: {
          best_params: winnerBestParams,
          summary: formatFineTuningSummary(winnerBestParams),
        },
        selection_reasons: Array.isArray(payload.selection_reasons)
          ? payload.selection_reasons.map((x) => String(x))
          : [],
        report_path: reportPath,
        report_updated_at: reportUpdatedAt,
      };
    } catch {
      // tenta o proximo caminho
    }
  }

  return {
    available: false,
    error: "Relatorio de selecao de modelos nao encontrado.",
    searched_paths: tried,
  };
}

function dateToISO(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const fromTs = raw.match(/^(\d{4}-\d{2}-\d{2})[ T]/);
  if (fromTs) return fromTs[1];
  return raw.slice(0, 10);
}

function timeToHHMM(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const hhmmss = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (hhmmss) return `${hhmmss[1]}:${hhmmss[2]}`;
  return raw;
}

function normalizeDateInput(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const isoSlash = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (isoSlash) return `${isoSlash[1]}-${isoSlash[2]}-${isoSlash[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return undefined;
}

function normalizeTimeInput(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  return undefined;
}

function serializeLead(row) {
  if (!row) return row;

  const nextActionText = row.next_action_text ?? row.proxima_acao_texto ?? null;
  const nextActionDate = dateToISO(
    row.next_action_date ?? row.proxima_acao_data,
  );
  const nextActionTime = timeToHHMM(
    row.next_action_time ?? row.proxima_acao_hora,
  );
  const nextActionAt = row.next_action_at ?? null;

  return {
    ...row,
    next_action_text: nextActionText,
    next_action_date: nextActionDate,
    next_action_time: nextActionTime,
    next_action_at: nextActionAt,
    proxima_acao_texto: nextActionText,
    proxima_acao_data: nextActionDate,
    proxima_acao_hora: nextActionTime,
    proxima_acao_at: nextActionAt,
  };
}

function toFiniteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function serializeScoreDiagnostics(row) {
  if (!row) return null;
  const meta =
    row.score_meta &&
    typeof row.score_meta === "object" &&
    !Array.isArray(row.score_meta)
      ? row.score_meta
      : {};

  const probabilityFromMeta = toFiniteNumberOrNull(meta.probability_qualified);
  const probability = toFiniteNumberOrNull(
    row.score_probability ?? probabilityFromMeta,
  );

  return {
    engine: row.score_engine || meta.engine || null,
    model_name: row.score_model_name || meta.model_name || null,
    probability_qualified: probability,
    scored_at: row.score_scored_at || row.updated_at || null,
    meta,
  };
}

function normalizeOptionalText(value, maxLen = 255) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

const LEAD_DUPLICATE_WINDOW_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.LEAD_DUPLICATE_WINDOW_MINUTES || "60", 10) || 60,
);

function normalizeIdentityToken(value, maxLen = 255) {
  const text = String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (!text) return "";
  return text.slice(0, maxLen);
}

function normalizeEmailForIdentity(value) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) return "";

  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return "";
  let local = email.slice(0, atIndex);
  let domain = email.slice(atIndex + 1);
  if (!domain) return "";

  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    const plusIndex = local.indexOf("+");
    if (plusIndex >= 0) local = local.slice(0, plusIndex);
    local = local.replace(/\./g, "");
  }

  return `${local}@${domain}`.slice(0, 180);
}

function normalizePhoneDigits(value) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  return digits ? digits.slice(-13) : "";
}

function leadTimestampMs(lead) {
  const raw = lead?.updated_at || lead?.created_at || null;
  const dt = raw ? new Date(raw) : null;
  const ms = dt instanceof Date ? dt.getTime() : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function compareLeadRecencyDesc(a, b) {
  return leadTimestampMs(b) - leadTimestampMs(a);
}

function buildLeadDedupeKey(lead = {}) {
  const nome = normalizeIdentityToken(lead.nome, 120);
  const uf = normalizeIdentityToken(lead.uf, 2);
  const cidade = normalizeIdentityToken(lead.cidade, 120);
  const segmento = normalizeIdentityToken(
    lead.segmento_interesse || lead.segmento,
    40,
  );
  const orcamento = normalizeIdentityToken(
    lead.orcamento_faixa || lead.orcamento,
    40,
  );
  const prazo = normalizeIdentityToken(lead.prazo_compra || lead.prazo, 20);
  const email = normalizeEmailForIdentity(lead.email);
  const whatsapp = normalizePhoneDigits(lead.whatsapp);

  const contactToken = email
    ? `email:${email}`
    : whatsapp
      ? `whatsapp:${whatsapp}`
      : "nocontact";
  if (contactToken !== "nocontact") {
    return [nome, uf, segmento, contactToken].join("|");
  }
  return [nome, uf, cidade, segmento, orcamento, prazo, contactToken].join("|");
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "sim", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "nao", "não", "n", "off"].includes(raw))
    return false;
  return fallback;
}

function normalizeWindowMinutesInput(
  value,
  fallback = LEAD_DUPLICATE_WINDOW_MINUTES,
) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(24 * 60, n));
}

function buildDuplicateLeadPairs(
  rows,
  windowMinutes = LEAD_DUPLICATE_WINDOW_MINUTES,
) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return [];

  const winMinutes = Math.max(
    1,
    Number.parseInt(String(windowMinutes), 10) || 1,
  );
  const windowMs = winMinutes * 60 * 1000;

  const sorted = [...list].sort(compareLeadRecencyDesc);
  const keptByKey = new Map();
  const pairs = [];

  for (const lead of sorted) {
    const key = buildLeadDedupeKey(lead);
    const ts = leadTimestampMs(lead);
    const bucket = keptByKey.get(key) || [];

    const keeper = bucket.find((item) => Math.abs(item.ts - ts) <= windowMs);
    if (keeper) {
      pairs.push({ dup_id: lead.id, keep_id: keeper.id, key });
      continue;
    }

    bucket.push({ id: lead.id, ts });
    keptByKey.set(key, bucket);
  }

  return pairs;
}

function deduplicateLeadRows(
  rows,
  windowMinutes = LEAD_DUPLICATE_WINDOW_MINUTES,
) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return [];
  const duplicatePairs = buildDuplicateLeadPairs(list, windowMinutes);
  if (!duplicatePairs.length) return [...list].sort(compareLeadRecencyDesc);
  const duplicateIds = new Set(duplicatePairs.map((x) => String(x.dup_id)));
  return list
    .filter((lead) => !duplicateIds.has(String(lead.id)))
    .sort(compareLeadRecencyDesc);
}

function parseLeadIds(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw === undefined || raw === null
      ? []
      : [raw];
  const unique = [];
  const seen = new Set();
  const invalid = [];
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (const item of list) {
    const id = String(item || "").trim();
    if (!id) continue;
    if (!uuidRe.test(id)) {
      invalid.push(id);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  return { ids: unique, invalid_ids: invalid };
}

async function deleteLeadsByIds(rawIds) {
  const { ids, invalid_ids } = parseLeadIds(rawIds);
  if (!ids.length) {
    return {
      ok: invalid_ids.length === 0,
      requested: 0,
      deleted: 0,
      deleted_ids: [],
      not_found_ids: [],
      invalid_ids,
    };
  }

  const existingR = await query(
    "SELECT id FROM leads WHERE id = ANY($1::uuid[])",
    [ids],
  );
  const existingIds = (existingR.rows || []).map((row) => String(row.id));
  const existingSet = new Set(existingIds);
  const notFoundIds = ids.filter((id) => !existingSet.has(id));

  let deletedIds = [];
  if (existingIds.length) {
    const deletedR = await query(
      "DELETE FROM leads WHERE id = ANY($1::uuid[]) RETURNING id",
      [existingIds],
    );
    deletedIds = (deletedR.rows || []).map((row) => String(row.id));
  }

  return {
    ok: invalid_ids.length === 0,
    requested: ids.length,
    deleted: deletedIds.length,
    deleted_ids: deletedIds,
    not_found_ids: notFoundIds,
    invalid_ids,
  };
}

async function tableExists(client, qualifiedTableName) {
  const r = await client.query("SELECT to_regclass($1) AS regclass", [
    qualifiedTableName,
  ]);
  return Boolean(r.rows?.[0]?.regclass);
}

async function cleanupLeadDuplicates({
  dryRun = false,
  windowMinutes = LEAD_DUPLICATE_WINDOW_MINUTES,
} = {}) {
  const normalizedWindow = normalizeWindowMinutesInput(
    windowMinutes,
    LEAD_DUPLICATE_WINDOW_MINUTES,
  );
  const leadRowsR = await query(
    `SELECT id, nome, whatsapp, email, uf, cidade, segmento_interesse,
            orcamento_faixa, prazo_compra, created_at, updated_at
       FROM leads`,
  );
  const allLeads = leadRowsR.rows || [];

  const pairs = buildDuplicateLeadPairs(allLeads, normalizedWindow);
  const byDupId = new Map();
  const groupKeys = new Set();
  for (const row of pairs) {
    if (byDupId.has(row.dup_id)) continue;
    byDupId.set(row.dup_id, {
      dup_id: row.dup_id,
      keep_id: row.keep_id,
      key: row.key,
    });
    groupKeys.add(row.key);
  }
  const uniquePairs = [...byDupId.values()];

  const summaryBase = {
    ok: true,
    dry_run: Boolean(dryRun),
    window_minutes: normalizedWindow,
    before_leads: allLeads.length,
    duplicate_groups: groupKeys.size,
    duplicated_rows: pairs.length,
    rows_to_delete: uniquePairs.length,
    deleted_leads: 0,
    after_leads: allLeads.length,
    migrated: {
      events: 0,
      lead_notes: 0,
      crm_lead_notes: 0,
      crm_lead_state_promoted: 0,
      crm_lead_state_removed: 0,
    },
    sample: uniquePairs
      .slice(0, 5)
      .map((x) => ({ dup_id: x.dup_id, keep_id: x.keep_id })),
  };

  if (dryRun || uniquePairs.length === 0) {
    return summaryBase;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      "CREATE TEMP TABLE tmp_lead_dedup_map (dup_id uuid PRIMARY KEY, keep_id uuid NOT NULL) ON COMMIT DROP",
    );

    const params = [];
    const tuples = uniquePairs
      .map((row, idx) => {
        const base = idx * 2;
        params.push(row.dup_id, row.keep_id);
        return `($${base + 1}, $${base + 2})`;
      })
      .join(",");

    await client.query(
      `INSERT INTO tmp_lead_dedup_map (dup_id, keep_id)
       VALUES ${tuples}`,
      params,
    );

    const migratedEventsR = await client.query(
      `UPDATE events e
          SET lead_id = m.keep_id
         FROM tmp_lead_dedup_map m
        WHERE e.lead_id = m.dup_id`,
    );

    let migratedLeadNotes = 0;
    if (await tableExists(client, "public.lead_notes")) {
      const r = await client.query(
        `UPDATE lead_notes n
            SET lead_id = m.keep_id
           FROM tmp_lead_dedup_map m
          WHERE n.lead_id = m.dup_id`,
      );
      migratedLeadNotes = r.rowCount || 0;
    }

    let migratedCrmLeadNotes = 0;
    if (await tableExists(client, "public.crm_lead_notes")) {
      const r = await client.query(
        `UPDATE crm_lead_notes n
            SET lead_id = m.keep_id
           FROM tmp_lead_dedup_map m
          WHERE n.lead_id = m.dup_id`,
      );
      migratedCrmLeadNotes = r.rowCount || 0;
    }

    let promotedCrmState = 0;
    let removedCrmState = 0;
    if (await tableExists(client, "public.crm_lead_state")) {
      const promoteR = await client.query(
        `INSERT INTO crm_lead_state (lead_id, stage, position, next_action_text, next_action_at, updated_at)
         SELECT m.keep_id, s.stage, s.position, s.next_action_text, s.next_action_at, s.updated_at
           FROM crm_lead_state s
           JOIN tmp_lead_dedup_map m ON m.dup_id = s.lead_id
          WHERE NOT EXISTS (
            SELECT 1
              FROM crm_lead_state k
             WHERE k.lead_id = m.keep_id
          )
         ON CONFLICT (lead_id) DO NOTHING`,
      );
      promotedCrmState = promoteR.rowCount || 0;

      const deleteStateR = await client.query(
        `DELETE FROM crm_lead_state
          WHERE lead_id IN (SELECT dup_id FROM tmp_lead_dedup_map)`,
      );
      removedCrmState = deleteStateR.rowCount || 0;
    }

    const deleteLeadsR = await client.query(
      `DELETE FROM leads
        WHERE id IN (SELECT dup_id FROM tmp_lead_dedup_map)`,
    );

    await client.query("COMMIT");

    return {
      ...summaryBase,
      dry_run: false,
      deleted_leads: deleteLeadsR.rowCount || 0,
      after_leads: allLeads.length - (deleteLeadsR.rowCount || 0),
      migrated: {
        events: migratedEventsR.rowCount || 0,
        lead_notes: migratedLeadNotes,
        crm_lead_notes: migratedCrmLeadNotes,
        crm_lead_state_promoted: promotedCrmState,
        crm_lead_state_removed: removedCrmState,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function normalizeLeadUpdatePayload(body = {}) {
  const patch = {};
  const errors = [];

  if (Object.prototype.hasOwnProperty.call(body, "nome")) {
    const nome = String(body.nome ?? "").trim();
    if (!nome) errors.push("nome nao pode ser vazio");
    else patch.nome = nome.slice(0, 120);
  }

  if (Object.prototype.hasOwnProperty.call(body, "whatsapp")) {
    patch.whatsapp = normalizeOptionalText(body.whatsapp, 32);
  }

  if (Object.prototype.hasOwnProperty.call(body, "email")) {
    patch.email = normalizeOptionalText(body.email, 180);
  }

  if (Object.prototype.hasOwnProperty.call(body, "uf")) {
    const uf = String(body.uf ?? "")
      .trim()
      .toUpperCase();
    patch.uf = uf ? uf.slice(0, 2) : null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "cidade")) {
    patch.cidade = normalizeOptionalText(body.cidade, 120);
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "segmento_interesse") ||
    Object.prototype.hasOwnProperty.call(body, "segmento")
  ) {
    const rawSeg = body.segmento_interesse ?? body.segmento;
    const seg = String(rawSeg ?? "")
      .trim()
      .toUpperCase();
    if (!seg) errors.push("segmento_interesse nao pode ser vazio");
    else patch.segmento_interesse = seg.slice(0, 40);
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "orcamento_faixa") ||
    Object.prototype.hasOwnProperty.call(body, "orcamento")
  ) {
    patch.orcamento_faixa = normalizeOptionalText(
      body.orcamento_faixa ?? body.orcamento,
      40,
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "prazo_compra") ||
    Object.prototype.hasOwnProperty.call(body, "prazo")
  ) {
    patch.prazo_compra = normalizeOptionalText(
      body.prazo_compra ?? body.prazo,
      20,
    );
  }

  return { patch, errors };
}

async function handleLeadUpdate(req, res) {
  const leadId = req.params.id || req.body?.id || req.body?.lead_id;
  if (!leadId)
    return res.status(400).json({ error: "id do lead e obrigatorio" });

  const { patch, errors } = normalizeLeadUpdatePayload(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const keys = Object.keys(patch);
  if (!keys.length) {
    return res
      .status(400)
      .json({ error: "nenhum campo valido enviado para atualizacao" });
  }

  const sets = [];
  const values = [];
  let i = 1;
  for (const key of keys) {
    sets.push(`${key} = $${i++}`);
    values.push(patch[key]);
  }
  values.push(leadId);

  const sql = `
    UPDATE leads
       SET ${sets.join(", ")},
           updated_at = now()
     WHERE id = $${i}
     RETURNING *
  `;

  const r = await query(sql, values);
  if (!r.rows.length)
    return res.status(404).json({ error: "Lead nao encontrado" });

  return res.json({ ok: true, lead: serializeLead(r.rows[0]) });
}

function extractNextActionPayload(body = {}) {
  const nestedNextAction =
    body.next_action && typeof body.next_action === "object"
      ? body.next_action
      : {};
  const nestedProximaAcao =
    body.proxima_acao && typeof body.proxima_acao === "object"
      ? body.proxima_acao
      : {};

  return {
    text:
      body.next_action_text ??
      body.proxima_acao_texto ??
      nestedProximaAcao.texto ??
      nestedProximaAcao.text ??
      (typeof body.proxima_acao === "string" ? body.proxima_acao : undefined) ??
      nestedNextAction.texto ??
      nestedNextAction.text ??
      (typeof body.next_action === "string" ? body.next_action : undefined) ??
      body.texto ??
      body.text,
    date:
      body.next_action_date ??
      body.proxima_acao_data ??
      nestedNextAction.date ??
      nestedNextAction.data ??
      nestedProximaAcao.data ??
      nestedProximaAcao.date ??
      body.data ??
      body.date,
    time:
      body.next_action_time ??
      body.proxima_acao_hora ??
      nestedNextAction.time ??
      nestedNextAction.hora ??
      nestedProximaAcao.hora ??
      nestedProximaAcao.time ??
      body.hora ??
      body.time,
    clear: Boolean(body.clear_next_action ?? body.clear ?? body.limpar),
    source: body.source ?? "ui_admin",
  };
}

async function updateLeadNextAction(leadId, payload) {
  if (!leadId) {
    return { status: 400, body: { error: "lead_id obrigatorio" } };
  }

  const textRaw = payload.clear ? null : payload.text;
  const text =
    textRaw === null || textRaw === undefined
      ? null
      : String(textRaw).trim().slice(0, 500);

  const date = payload.clear ? null : normalizeDateInput(payload.date);
  if (date === undefined) {
    return {
      status: 400,
      body: { error: "Data invalida. Use YYYY-MM-DD ou DD/MM/YYYY." },
    };
  }

  const time = payload.clear ? null : normalizeTimeInput(payload.time);
  if (time === undefined) {
    return {
      status: 400,
      body: { error: "Hora invalida. Use HH:MM." },
    };
  }

  if (time && !date) {
    return {
      status: 400,
      body: { error: "Informe a data quando enviar a hora da proxima acao." },
    };
  }

  if (!payload.clear && !text && !date) {
    return {
      status: 400,
      body: { error: "Informe texto e/ou data para salvar a proxima acao." },
    };
  }

  const leadR = await query("SELECT id FROM leads WHERE id=$1", [leadId]);
  if (leadR.rows.length === 0) {
    return { status: 404, body: { error: "Lead nao encontrado" } };
  }

  const updateR = await query(
    `UPDATE leads
       SET next_action_text=$1,
           next_action_date=$2,
           next_action_time=$3::time,
           next_action_at=CASE
             WHEN $2::date IS NOT NULL THEN ($2::date + COALESCE($3::time, time '00:00'))
             ELSE NULL
           END,
           updated_at=now()
     WHERE id=$4
     RETURNING *`,
    [text, date, time, leadId],
  );

  const eventType = payload.clear ? "next_action_cleared" : "next_action_saved";
  await query(
    "INSERT INTO events (lead_id, event_type, metadata) VALUES ($1,$2,$3)",
    [
      leadId,
      eventType,
      JSON.stringify({
        source: payload.source,
        next_action_text: text,
        next_action_date: date,
        next_action_time: time ? time.slice(0, 5) : null,
      }),
    ],
  );

  const lead = serializeLead(updateR.rows[0]);
  const nextAction = {
    text: lead.next_action_text,
    date: lead.next_action_date,
    time: lead.next_action_time,
  };

  return {
    status: 200,
    body: {
      ok: true,
      lead,
      next_action: nextAction,
      proxima_acao: nextAction,
      proximaAcao: nextAction,
    },
  };
}

async function ensureCrmSchema() {
  // CRM extras used by the Admin UI (Kanban + Próxima ação)
  await query(`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS crm_stage text DEFAULT 'INBOX',
      ADD COLUMN IF NOT EXISTS next_action_text text,
      ADD COLUMN IF NOT EXISTS next_action_date date,
      ADD COLUMN IF NOT EXISTS next_action_time time,
      ADD COLUMN IF NOT EXISTS next_action_at timestamptz
  `);

  // Backfill stage for older rows
  await query(
    `UPDATE leads SET crm_stage = 'INBOX' WHERE crm_stage IS NULL OR crm_stage = ''`,
  );

  // Notes/audit trail for CRM actions (optional, but used by the UI for "Próxima ação")
  await query(`
    CREATE TABLE IF NOT EXISTS lead_notes (
      id bigserial PRIMARY KEY,
      lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      note_type text NOT NULL DEFAULT 'NOTE',
      note_text text NOT NULL,
      action_date date,
      action_time time,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id ON lead_notes(lead_id)`,
  );
}

async function ensureScoreSchema() {
  await query(`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS score_engine text,
      ADD COLUMN IF NOT EXISTS score_model_name text,
      ADD COLUMN IF NOT EXISTS score_probability double precision,
      ADD COLUMN IF NOT EXISTS score_scored_at timestamptz,
      ADD COLUMN IF NOT EXISTS score_meta jsonb
  `);
}

app.get(
  "/health",
  asyncHandler(async (_req, res) => {
    try {
      await query("SELECT 1");
      res.json({
        status: "UP",
        features: {
          crm_next_action: true,
          score_diagnostics: true,
          ml_model_info: true,
        },
      });
    } catch (e) {
      res.status(500).json({ status: "DOWN", error: String(e) });
    }
  }),
);

app.get(
  "/ml/model-info",
  asyncHandler(async (_req, res) => {
    const info = await readMlModelInfo();
    res.json(info);
  }),
);

// -----------------------------
// LEADS
// -----------------------------
app.post(
  "/leads",
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    const nome = normalizeOptionalText(body.nome, 120);
    const whatsapp = normalizeOptionalText(body.whatsapp, 32);
    const email = normalizeOptionalText(body.email, 180);
    const ufRaw = normalizeOptionalText(body.uf, 2);
    const cidade = normalizeOptionalText(body.cidade, 120);
    const segmento_interesse = normalizeOptionalText(
      body.segmento_interesse,
      40,
    );
    const orcamento_faixa = normalizeOptionalText(body.orcamento_faixa, 40);
    const prazo_compra = normalizeOptionalText(body.prazo_compra, 20);
    const uf = ufRaw ? ufRaw.toUpperCase() : null;

    if (!nome || !segmento_interesse) {
      return res
        .status(400)
        .json({ error: "Campos obrigatórios: nome, segmento_interesse" });
    }

    const normalizedSegment = segmento_interesse.toUpperCase();
    const normalizedEmail = normalizeEmailForIdentity(email);
    const normalizedPhone = normalizePhoneDigits(whatsapp);
    const hasContact = Boolean(normalizedEmail || normalizedPhone);

    const duplicateCandidatesR = await query(
      `SELECT *
         FROM leads
        WHERE UPPER(TRIM(nome)) = UPPER(TRIM($1))
          AND UPPER(COALESCE(TRIM(uf), '')) = UPPER(COALESCE(TRIM($2), ''))
          AND UPPER(TRIM(segmento_interesse)) = UPPER(TRIM($3))
          AND created_at >= now() - ($4::int * interval '1 minute')
        ORDER BY created_at DESC
        LIMIT 20`,
      [nome, uf || "", normalizedSegment, LEAD_DUPLICATE_WINDOW_MINUTES],
    );

    const normalizedCity = normalizeIdentityToken(cidade, 120);
    const normalizedBudget = normalizeIdentityToken(orcamento_faixa, 40);
    const normalizedDeadline = normalizeIdentityToken(prazo_compra, 20);

    const duplicate = duplicateCandidatesR.rows.find((row) => {
      const rowCity = normalizeIdentityToken(row.cidade, 120);
      const rowBudget = normalizeIdentityToken(row.orcamento_faixa, 40);
      const rowDeadline = normalizeIdentityToken(row.prazo_compra, 20);

      const cityCompatible =
        !normalizedCity || !rowCity || normalizedCity === rowCity;
      const budgetCompatible =
        !normalizedBudget || !rowBudget || normalizedBudget === rowBudget;
      const deadlineCompatible =
        !normalizedDeadline ||
        !rowDeadline ||
        normalizedDeadline === rowDeadline;

      const optionalFieldsCompatible =
        cityCompatible && budgetCompatible && deadlineCompatible;
      if (!optionalFieldsCompatible) return false;

      if (!hasContact) return true;

      const rowEmail = normalizeEmailForIdentity(row.email);
      const rowPhone = normalizePhoneDigits(row.whatsapp);
      const byEmail = Boolean(
        normalizedEmail && rowEmail && normalizedEmail === rowEmail,
      );
      const byPhone = Boolean(
        normalizedPhone && rowPhone && normalizedPhone === rowPhone,
      );
      const missingContactOnExisting = !rowEmail && !rowPhone;
      return byEmail || byPhone || missingContactOnExisting;
    });

    if (duplicate) {
      return res.json({
        ...serializeLead(duplicate),
        deduplicated: true,
        dedupe_window_minutes: LEAD_DUPLICATE_WINDOW_MINUTES,
      });
    }

    const r = await query(
      `INSERT INTO leads (nome, whatsapp, email, uf, cidade, segmento_interesse, orcamento_faixa, prazo_compra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        nome,
        whatsapp || null,
        email || null,
        uf || null,
        cidade || null,
        normalizedSegment,
        orcamento_faixa || null,
        prazo_compra || null,
      ],
    );

    res.json({ ...serializeLead(r.rows[0]), deduplicated: false });
  }),
);

app.post(
  "/events",
  asyncHandler(async (req, res) => {
    const { lead_id, event_type, metadata } = req.body || {};
    if (!lead_id || !event_type) {
      return res
        .status(400)
        .json({ error: "Campos obrigatórios: lead_id, event_type" });
    }

    const r = await query(
      `INSERT INTO events (lead_id, event_type, metadata)
       VALUES ($1,$2,$3) RETURNING *`,
      [lead_id, event_type, metadata ? JSON.stringify(metadata) : null],
    );

    res.json(r.rows[0]);
  }),
);

app.post(
  "/leads/:id/score",
  asyncHandler(async (req, res) => {
    await ensureScoreSchema();
    const leadId = req.params.id;

    const leadR = await query("SELECT * FROM leads WHERE id=$1", [leadId]);
    if (leadR.rows.length === 0)
      return res.status(404).json({ error: "Lead não encontrado" });

    const eventsR = await query(
      "SELECT event_type, ts, metadata FROM events WHERE lead_id=$1 ORDER BY ts ASC",
      [leadId],
    );

    const payload = { lead: leadR.rows[0], events: eventsR.rows };

    const resp = await fetch(`${SCORING_URL}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      return res.status(502).json({
        error: "Falha no scoring_service",
        details: await resp.text(),
      });
    }

    const scored = await resp.json();
    const meta =
      scored &&
      typeof scored === "object" &&
      scored.meta &&
      typeof scored.meta === "object"
        ? scored.meta
        : {};

    const scoreEngine =
      typeof meta.engine === "string" ? meta.engine.trim() || null : null;
    const scoreModelName =
      typeof meta.model_name === "string"
        ? meta.model_name.trim() || null
        : null;
    const scoreProbability = toFiniteNumberOrNull(meta.probability_qualified);

    await query(
      `UPDATE leads
       SET score=$1,
           status=$2,
           score_motivos=$3,
           score_engine=$4,
           score_model_name=$5,
           score_probability=$6,
           score_scored_at=now(),
           score_meta=$7,
           updated_at=now()
       WHERE id=$8`,
      [
        scored.score,
        scored.status,
        JSON.stringify(scored.motivos || []),
        scoreEngine,
        scoreModelName,
        scoreProbability,
        Object.keys(meta).length ? JSON.stringify(meta) : null,
        leadId,
      ],
    );

    const { rows: leadRows } = await query(
      `SELECT id, score, status, score_engine, score_model_name, score_probability,
              score_scored_at, score_meta, updated_at
         FROM leads
        WHERE id=$1`,
      [leadId],
    );

    const diagnostics = serializeScoreDiagnostics(leadRows[0] || {});
    res.json({
      ...scored,
      diagnostics,
      meta: diagnostics
        ? {
            ...meta,
            engine: diagnostics.engine,
            model_name: diagnostics.model_name,
            probability_qualified: diagnostics.probability_qualified,
          }
        : meta,
    });
  }),
);

app.get(
  "/leads",
  asyncHandler(async (req, res) => {
    const { status, minScore, uf, segment } = req.query;

    const where = [];
    const params = [];
    let i = 1;

    if (status) {
      where.push(`status=$${i++}`);
      params.push(status);
    }
    if (uf) {
      where.push(`uf=$${i++}`);
      params.push(uf);
    }
    if (segment) {
      where.push(`segmento_interesse=$${i++}`);
      params.push(segment);
    }
    if (minScore) {
      where.push(`score >= $${i++}`);
      params.push(Number(minScore));
    }

    const sql = `SELECT *
                 FROM leads
                 ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY created_at DESC
                 LIMIT 500`;

    const r = await query(sql, params);
    const dedupedRows = deduplicateLeadRows(
      r.rows,
      LEAD_DUPLICATE_WINDOW_MINUTES,
    );
    res.json(dedupedRows.map(serializeLead));
  }),
);

app.post(
  "/leads/bulk-delete",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const ids = body.ids ?? body.lead_ids ?? body.leads ?? [];
    const result = await deleteLeadsByIds(ids);

    if (!result.requested && !result.invalid_ids.length) {
      return res
        .status(400)
        .json({ error: "Informe ao menos um id valido em ids[]" });
    }

    return res.json({
      ...result,
      message:
        result.deleted > 0
          ? `${result.deleted} lead(s) removido(s).`
          : "Nenhum lead removido para os ids informados.",
    });
  }),
);

app.get(
  "/leads/:id",
  asyncHandler(async (req, res) => {
    const leadId = req.params.id;
    const r = await query("SELECT * FROM leads WHERE id=$1", [leadId]);
    if (r.rows.length === 0)
      return res.status(404).json({ error: "Lead nao encontrado" });
    res.json(serializeLead(r.rows[0]));
  }),
);

app.delete(
  "/leads/:id",
  asyncHandler(async (req, res) => {
    const leadId = req.params.id;
    const result = await deleteLeadsByIds([leadId]);

    if (result.invalid_ids.length) {
      return res
        .status(400)
        .json({ error: "id invalido", invalid_ids: result.invalid_ids });
    }
    if (result.deleted === 0) {
      return res.status(404).json({
        error: "Lead nao encontrado",
        not_found_ids: result.not_found_ids,
      });
    }

    return res.json({
      ok: true,
      deleted: result.deleted,
      deleted_ids: result.deleted_ids,
      message: "Lead removido com sucesso.",
    });
  }),
);

app.get(
  "/leads/:id/score-diagnostics",
  asyncHandler(async (req, res) => {
    await ensureScoreSchema();
    const leadId = req.params.id;
    const r = await query(
      `SELECT id, score, status, score_engine, score_model_name, score_probability,
              score_scored_at, score_meta, updated_at
         FROM leads
        WHERE id=$1`,
      [leadId],
    );
    if (r.rows.length === 0)
      return res.status(404).json({ error: "Lead nao encontrado" });

    const row = r.rows[0];
    return res.json({
      lead_id: row.id,
      score: row.score,
      status: row.status,
      diagnostics: serializeScoreDiagnostics(row),
    });
  }),
);

app.post("/leads/:id/update", asyncHandler(handleLeadUpdate));
app.patch("/leads/:id", asyncHandler(handleLeadUpdate));
app.put("/leads/:id", asyncHandler(handleLeadUpdate));

async function handleSaveNextAction(req, res) {
  const leadId =
    req.params.id || req.body?.lead_id || req.body?.leadId || req.body?.id;
  const payload = extractNextActionPayload(req.body || {});
  const result = await updateLeadNextAction(leadId, payload);
  return res.status(result.status).json(result.body);
}

async function handleClearNextAction(req, res) {
  const baseBody = req.body && typeof req.body === "object" ? req.body : {};
  req.body = { ...baseBody, clear: true };
  return handleSaveNextAction(req, res);
}

async function handleGetNextAction(req, res) {
  const leadId =
    req.params.id || req.query?.lead_id || req.query?.leadId || req.query?.id;
  if (!leadId) return res.status(400).json({ error: "lead_id obrigatorio" });

  const r = await query("SELECT * FROM leads WHERE id=$1", [leadId]);
  if (r.rows.length === 0)
    return res.status(404).json({ error: "Lead nao encontrado" });

  const lead = serializeLead(r.rows[0]);
  const nextAction = {
    text: lead.next_action_text,
    date: lead.next_action_date,
    time: lead.next_action_time,
  };
  return res.json({
    ok: true,
    lead_id: lead.id,
    next_action: nextAction,
    proxima_acao: nextAction,
    proximaAcao: nextAction,
  });
}

const saveNextActionPaths = [
  "/leads/:id/next-action",
  "/leads/:id/next_action",
  "/leads/:id/proxima-acao",
  "/leads/:id/proxima_acao",
  "/crm/lead/:id/next-action",
  "/crm/lead/:id/proxima-acao",
  "/crm/leads/:id/next-action",
  "/crm/leads/:id/proxima-acao",
  "/crm/next-action",
  "/crm/proxima-acao",
];

const readNextActionPaths = [
  "/leads/:id/next-action",
  "/leads/:id/proxima-acao",
  "/crm/lead/:id/next-action",
  "/crm/lead/:id/proxima-acao",
  "/crm/leads/:id/next-action",
  "/crm/leads/:id/proxima-acao",
  "/crm/next-action",
  "/crm/proxima-acao",
];

for (const p of saveNextActionPaths) {
  app.post(p, asyncHandler(handleSaveNextAction));
  app.patch(p, asyncHandler(handleSaveNextAction));
  app.put(p, asyncHandler(handleSaveNextAction));
  app.delete(p, asyncHandler(handleClearNextAction));
}

for (const p of readNextActionPaths) {
  app.get(p, asyncHandler(handleGetNextAction));
}

/**
 * CRM (Kanban): board + mover estágio + próxima ação + matching de parceiros
 * A UI (Streamlit) consome estes endpoints:
 *   GET  /crm/board
 *   POST /crm/move
 *   POST /crm/leads/:id/notes
 *   GET  /crm/leads/:id/matches
 */
const CRM_KANBAN_STAGES = ["INBOX", "AQUECENDO", "QUALIFICADO", "ENVIADO"];
const CRM_RULE_ENGINE_VERSION = 1;
const CRM_RULE_ENGINE_MODEL = "kanban_event_rules_v1";
const CRM_STATUS_SCORE_BANDS = {
  CURIOSO: { min: 0, max: 39, stage: "INBOX" },
  AQUECENDO: { min: 40, max: 69, stage: "AQUECENDO" },
  QUALIFICADO: { min: 70, max: 100, stage: "QUALIFICADO" },
};
const CRM_QUALIFICATION_SIGNAL_KEYS = [
  "budget_confirmed",
  "timeline_confirmed",
  "need_confirmed",
];
const CRM_EVENT_RULES = [
  {
    code: "whatsapp_reply",
    label: "Respondeu WhatsApp",
    event_type: "whatsapp_reply",
    delta: 8,
  },
  {
    code: "asked_price",
    label: "Pediu valores",
    event_type: "asked_price",
    delta: 12,
  },
  {
    code: "proposal_click",
    label: "Clicou na proposta",
    event_type: "proposal_click",
    delta: 10,
  },
  {
    code: "meeting_scheduled",
    label: "Agendou reuniao",
    event_type: "meeting_scheduled",
    delta: 15,
  },
  {
    code: "meeting_attended",
    label: "Compareceu reuniao",
    event_type: "meeting_attended",
    delta: 18,
  },
  {
    code: "budget_confirmed",
    label: "Confirmou orcamento",
    event_type: "budget_confirmed",
    delta: 15,
    signals: { budget_confirmed: true },
  },
  {
    code: "timeline_confirmed",
    label: "Confirmou prazo",
    event_type: "timeline_confirmed",
    delta: 10,
    signals: { timeline_confirmed: true },
  },
  {
    code: "need_confirmed",
    label: "Confirmou necessidade",
    event_type: "need_confirmed",
    delta: 10,
    signals: { need_confirmed: true },
  },
  {
    code: "proposal_requested",
    label: "Solicitou proposta formal",
    event_type: "proposal_requested",
    delta: 12,
  },
  {
    code: "sent_documents",
    label: "Enviou documentos",
    event_type: "sent_documents",
    delta: 9,
  },
  {
    code: "followup_positive",
    label: "Retorno positivo no follow up",
    event_type: "followup_positive",
    delta: 6,
  },
  {
    code: "no_reply_3d",
    label: "Sem resposta por 3 dias",
    event_type: "no_reply_3d",
    delta: -6,
  },
  {
    code: "no_reply_7d",
    label: "Sem resposta por 7 dias",
    event_type: "no_reply_7d",
    delta: -12,
  },
  {
    code: "no_reply_14d",
    label: "Sem resposta por 14 dias",
    event_type: "no_reply_14d",
    delta: -20,
  },
  {
    code: "postponed_no_date",
    label: "Adiou sem nova data",
    event_type: "postponed_no_date",
    delta: -12,
  },
  {
    code: "no_budget_now",
    label: "Sem orcamento agora",
    event_type: "no_budget_now",
    delta: -20,
    signals: { budget_confirmed: false },
  },
  {
    code: "lost_interest",
    label: "Esfriou sem retorno",
    event_type: "lost_interest",
    delta: -18,
    signals: { need_confirmed: false, timeline_confirmed: false },
  },
  {
    code: "invalid_contact",
    label: "Contato invalido",
    event_type: "invalid_contact",
    delta: -8,
  },
];
const CRM_EVENT_RULES_BY_CODE = new Map(
  CRM_EVENT_RULES.map((rule) => [rule.code, rule]),
);

function normalizeCrmStage(raw) {
  const v = String(raw || "")
    .trim()
    .toUpperCase();
  if (!v) return "INBOX";
  if (CRM_KANBAN_STAGES.includes(v)) return v;
  // Compat: alguns fluxos antigos usam o status "CURIOSO" como etapa inicial
  if (v === "CURIOSO") return "INBOX";
  return "INBOX";
}

function normalizeCrmRuleCode(rawCode) {
  return String(rawCode || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeCrmRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  const code = normalizeCrmRuleCode(rule.code);
  if (!code) return null;
  const label = String(rule.label || code).trim() || code;
  const eventType = String(rule.event_type || code).trim() || code;
  const delta = Number.parseInt(String(rule.delta ?? 0), 10);
  if (!Number.isFinite(delta)) return null;

  const signalsInput = ensurePlainObject(rule.signals);
  const signals = {};
  for (const key of CRM_QUALIFICATION_SIGNAL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(signalsInput, key)) continue;
    signals[key] = Boolean(signalsInput[key]);
  }

  return {
    code,
    label,
    event_type: eventType,
    delta,
    signals,
  };
}

function listCrmRules() {
  return CRM_EVENT_RULES.map(normalizeCrmRule).filter(Boolean);
}

function crmRulePublic(rule) {
  const normalizedRule = normalizeCrmRule(rule);
  if (!normalizedRule) return null;
  return {
    code: normalizedRule.code,
    label: normalizedRule.label,
    event_type: normalizedRule.event_type,
    delta: normalizedRule.delta,
    direction: normalizedRule.delta >= 0 ? "up" : "down",
    signal_patch: normalizedRule.signals,
  };
}

function stageToCommercialStatus(stageRaw, fallbackStatus = "CURIOSO") {
  const stage = normalizeCrmStage(stageRaw);
  if (stage === "AQUECENDO") return "AQUECENDO";
  if (stage === "QUALIFICADO") return "QUALIFICADO";
  if (stage === "ENVIADO") return "ENVIADO";
  if (stage === "INBOX") return "CURIOSO";
  const fallback = String(fallbackStatus || "")
    .trim()
    .toUpperCase();
  if (
    fallback === "AQUECENDO" ||
    fallback === "QUALIFICADO" ||
    fallback === "ENVIADO"
  )
    return fallback;
  return "CURIOSO";
}

function clampLeadScore(rawValue, fallback = 0) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.max(0, Math.min(100, rounded));
}

function scoreBandForStage(stageRaw) {
  const stage = normalizeCrmStage(stageRaw);
  if (stage === "AQUECENDO") return CRM_STATUS_SCORE_BANDS.AQUECENDO;
  if (stage === "QUALIFICADO" || stage === "ENVIADO")
    return CRM_STATUS_SCORE_BANDS.QUALIFICADO;
  return CRM_STATUS_SCORE_BANDS.CURIOSO;
}

function adjustScoreToStageBand(rawScore, stageRaw) {
  const band = scoreBandForStage(stageRaw);
  const parsed = Number(rawScore);
  if (!Number.isFinite(parsed)) return band.min;
  const rounded = Math.round(parsed);
  return Math.max(band.min, Math.min(band.max, rounded));
}

function normalizeCrmSignals(rawSignals = {}) {
  const safe = ensurePlainObject(rawSignals);
  const out = {};
  for (const key of CRM_QUALIFICATION_SIGNAL_KEYS) {
    out[key] = Boolean(safe[key]);
  }
  return out;
}

function extractCrmSignals(scoreMetaRaw) {
  const scoreMeta = ensurePlainObject(scoreMetaRaw);
  const direct = normalizeCrmSignals(scoreMeta.crm_signals);
  const engineMeta = ensurePlainObject(scoreMeta.crm_rule_engine);
  const nested = normalizeCrmSignals(engineMeta.signals);

  const merged = {};
  for (const key of CRM_QUALIFICATION_SIGNAL_KEYS) {
    merged[key] = Boolean(direct[key] || nested[key]);
  }
  return merged;
}

function applyCrmSignalPatch(baseSignalsRaw, patchRaw) {
  const baseSignals = normalizeCrmSignals(baseSignalsRaw);
  const patch = ensurePlainObject(patchRaw);
  const next = { ...baseSignals };

  for (const key of CRM_QUALIFICATION_SIGNAL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    next[key] = Boolean(patch[key]);
  }
  return next;
}

function extractExplicitCrmSignalPatch(rawPatch = {}) {
  const patch = ensurePlainObject(rawPatch);
  const out = {};
  for (const key of CRM_QUALIFICATION_SIGNAL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    out[key] = Boolean(patch[key]);
  }
  return out;
}

function qualificationGateMissingSignals(signalsRaw) {
  const signals = normalizeCrmSignals(signalsRaw);
  return CRM_QUALIFICATION_SIGNAL_KEYS.filter((key) => !signals[key]);
}

function deriveStateByScoreAndSignals(rawScore, signalsRaw, options = {}) {
  const keepSent = Boolean(options.keep_sent);
  const score = clampLeadScore(rawScore, 0);
  const signals = normalizeCrmSignals(signalsRaw);
  const missingSignals = qualificationGateMissingSignals(signals);

  if (keepSent) {
    return {
      score: Math.max(score, CRM_STATUS_SCORE_BANDS.QUALIFICADO.min),
      status: "ENVIADO",
      stage: "ENVIADO",
      qualification_gate_open: true,
      missing_signals: [],
    };
  }

  if (score <= CRM_STATUS_SCORE_BANDS.CURIOSO.max) {
    return {
      score,
      status: "CURIOSO",
      stage: CRM_STATUS_SCORE_BANDS.CURIOSO.stage,
      qualification_gate_open: false,
      missing_signals: missingSignals,
    };
  }

  if (score <= CRM_STATUS_SCORE_BANDS.AQUECENDO.max) {
    return {
      score,
      status: "AQUECENDO",
      stage: CRM_STATUS_SCORE_BANDS.AQUECENDO.stage,
      qualification_gate_open: false,
      missing_signals: missingSignals,
    };
  }

  if (missingSignals.length === 0) {
    return {
      score,
      status: "QUALIFICADO",
      stage: CRM_STATUS_SCORE_BANDS.QUALIFICADO.stage,
      qualification_gate_open: true,
      missing_signals: [],
    };
  }

  return {
    // Mantem o score real (ex.: 69 -> 77), mas bloqueia a promocao de etapa
    // enquanto os sinais obrigatorios de qualificacao nao estiverem completos.
    score,
    status: "AQUECENDO",
    stage: CRM_STATUS_SCORE_BANDS.AQUECENDO.stage,
    qualification_gate_open: false,
    missing_signals: missingSignals,
  };
}

function normalizeScoreMotivos(raw) {
  if (Array.isArray(raw))
    return raw.filter((item) => item && typeof item === "object");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return parsed.filter((item) => item && typeof item === "object");
    } catch {
      return [];
    }
  }
  return [];
}

function buildRuleReason(rule, transition) {
  const fromStage = String(transition?.from_stage || "-").trim();
  const toStage = String(transition?.to_stage || "-").trim();
  const missingSignals = Array.isArray(transition?.missing_signals)
    ? transition.missing_signals
    : [];

  const gateMessage = missingSignals.length
    ? `Pendencias para QUALIFICADO: ${missingSignals.join(", ")}.`
    : "Gate de qualificacao atendido.";

  return {
    fator: `Evento CRM: ${rule.label}`,
    impacto: rule.delta,
    detalhe: `Movimento ${fromStage} -> ${toStage}. ${gateMessage}`,
  };
}

function appendRuleReason(existing, ruleReason, maxItems = 14) {
  const base = normalizeScoreMotivos(existing);
  const trimmed = base.slice(Math.max(0, base.length - (maxItems - 1)));
  return [...trimmed, ruleReason];
}

function normalizeCrmSource(sourceRaw, fallback = "kanban_ui") {
  const source = String(sourceRaw || "").trim();
  if (!source) return fallback;
  return source.slice(0, 80);
}

function serializeCrmLeadRow(row) {
  const lead = serializeLead(row);
  lead.crm_stage = resolveBoardStage(lead);
  return lead;
}

async function applyCrmEventRule({
  leadId,
  ruleCode,
  metadata = {},
  source = "kanban_ui",
}) {
  const normalizedCode = normalizeCrmRuleCode(ruleCode);
  const rule = CRM_EVENT_RULES_BY_CODE.get(normalizedCode);
  if (!rule) {
    return {
      status: 400,
      body: {
        error: "rule_code invalido",
        allowed_rules: listCrmRules().map((item) => item.code),
      },
    };
  }

  const leadR = await query(
    `SELECT id, nome, uf, cidade, segmento_interesse, status, score, crm_stage, score_motivos, score_meta,
            next_action_text, next_action_date, next_action_time, created_at, updated_at
       FROM leads
      WHERE id = $1`,
    [leadId],
  );

  if (!leadR.rows.length) {
    return { status: 404, body: { error: "Lead nao encontrado" } };
  }

  const currentLead = leadR.rows[0];
  const currentStage = resolveBoardStage(currentLead);
  const currentStatus = stageToCommercialStatus(
    currentStage,
    currentLead.status,
  );
  const currentScore = clampLeadScore(currentLead.score, 0);

  const scoreMeta = ensurePlainObject(currentLead.score_meta);
  const baseSignals = extractCrmSignals(scoreMeta);
  const payloadMeta = ensurePlainObject(metadata);
  const signalPatch = {
    ...extractExplicitCrmSignalPatch(rule.signals),
    ...extractExplicitCrmSignalPatch(payloadMeta.signal_patch),
  };
  const nextSignals = applyCrmSignalPatch(baseSignals, signalPatch);

  const nextState = deriveStateByScoreAndSignals(
    currentScore + rule.delta,
    nextSignals,
    {
      keep_sent: currentStatus === "ENVIADO",
    },
  );

  const nextReason = buildRuleReason(rule, {
    from_stage: currentStage,
    to_stage: nextState.stage,
    missing_signals: nextState.missing_signals,
  });
  const nextMotivos = appendRuleReason(currentLead.score_motivos, nextReason);

  const mergedMeta = {
    ...scoreMeta,
    crm_signals: nextSignals,
    crm_rule_engine: {
      ...ensurePlainObject(scoreMeta.crm_rule_engine),
      version: CRM_RULE_ENGINE_VERSION,
      model_name: CRM_RULE_ENGINE_MODEL,
      signals: nextSignals,
      last_rule_code: rule.code,
      last_rule_label: rule.label,
      last_delta: rule.delta,
      last_source: normalizeCrmSource(source),
      last_applied_at: new Date().toISOString(),
      qualification_gate_open: nextState.qualification_gate_open,
      missing_signals: nextState.missing_signals,
    },
  };

  const updatedLeadR = await query(
    `UPDATE leads
        SET score = $2,
            status = $3,
            crm_stage = $4,
            score_motivos = $5,
            score_engine = $6,
            score_model_name = $7,
            score_scored_at = now(),
            score_meta = $8,
            updated_at = now()
      WHERE id = $1
      RETURNING id, nome, uf, cidade, segmento_interesse, status, score, crm_stage, score_motivos,
                score_engine, score_model_name, score_probability, score_scored_at, score_meta,
                next_action_text, next_action_date, next_action_time, created_at, updated_at`,
    [
      leadId,
      nextState.score,
      nextState.status,
      nextState.stage,
      JSON.stringify(nextMotivos),
      "crm_rule_engine",
      CRM_RULE_ENGINE_MODEL,
      JSON.stringify(mergedMeta),
    ],
  );

  const eventMetadata = {
    source: normalizeCrmSource(source),
    rule_code: rule.code,
    rule_label: rule.label,
    score_delta: rule.delta,
    from_score: currentScore,
    to_score: nextState.score,
    from_status: currentStatus,
    to_status: nextState.status,
    from_stage: currentStage,
    to_stage: nextState.stage,
    qualification_gate_open: nextState.qualification_gate_open,
    missing_signals: nextState.missing_signals,
    input: payloadMeta,
  };

  await query(
    "INSERT INTO events (lead_id, event_type, metadata) VALUES ($1, $2, $3)",
    [leadId, rule.event_type, JSON.stringify(eventMetadata)],
  );

  return {
    status: 200,
    body: {
      ok: true,
      rule: crmRulePublic(rule),
      lead: serializeCrmLeadRow(updatedLeadR.rows[0]),
      transition: {
        from_stage: currentStage,
        to_stage: nextState.stage,
        from_status: currentStatus,
        to_status: nextState.status,
        from_score: currentScore,
        to_score: nextState.score,
      },
      qualification_gate: {
        open: nextState.qualification_gate_open,
        missing_signals: nextState.missing_signals,
      },
    },
  };
}

function resolveBoardStage(lead) {
  const stageFromCrm = normalizeCrmStage(lead?.crm_stage);
  const stageFromStatus = normalizeCrmStage(lead?.status);
  if (stageFromStatus === "ENVIADO") return "ENVIADO";

  // Se o CRM ainda está no default INBOX, deixa o status comercial conduzir as colunas.
  if (stageFromCrm === "INBOX" && stageFromStatus !== "INBOX") {
    return stageFromStatus;
  }
  return stageFromCrm;
}

function parseNextActionNote(noteRaw) {
  if (typeof noteRaw !== "string") return null;
  const note = noteRaw.trim();
  // Formato esperado pela UI: NEXT_ACTION|YYYY-MM-DD|HH:MM|texto...
  if (!note.startsWith("NEXT_ACTION|")) return null;
  const parts = note.split("|");
  const date = parts[1] || null;
  const hour = parts[2] || null;
  const text = parts.slice(3).join("|").trim() || null;
  return { text, date, hour };
}

async function handleCrmBoard(req, res) {
  await ensureCrmSchema();
  const { rows } = await query(
    `SELECT id, nome, whatsapp, email, uf, cidade, segmento_interesse, orcamento_faixa, prazo_compra, status, score,
            crm_stage, next_action_text, next_action_date, next_action_time,
            created_at, updated_at
       FROM leads
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST`,
  );

  const dedupedRows = deduplicateLeadRows(rows, LEAD_DUPLICATE_WINDOW_MINUTES);
  const items = dedupedRows.map((r) => {
    const lead = serializeLead(r);
    lead.crm_stage = resolveBoardStage(lead);
    return lead;
  });

  res.json({ items });
}

async function handleCrmMove(req, res) {
  await ensureCrmSchema();
  await ensureScoreSchema();
  const leadId = req.body?.lead_id || req.body?.id || null;
  const stage = normalizeCrmStage(req.body?.stage);
  if (!leadId) return res.status(400).json({ error: "lead_id é obrigatório" });

  const leadR = await query(
    `SELECT id, nome, uf, cidade, segmento_interesse, status, score, crm_stage, score_meta,
            next_action_text, next_action_date, next_action_time, created_at, updated_at
       FROM leads
      WHERE id = $1`,
    [leadId],
  );
  if (!leadR.rows.length)
    return res.status(404).json({ error: "Lead não encontrado" });

  const currentLead = leadR.rows[0];
  const currentStage = resolveBoardStage(currentLead);
  const currentStatus = stageToCommercialStatus(
    currentStage,
    currentLead.status,
  );
  const currentScore = clampLeadScore(
    currentLead.score,
    scoreBandForStage(stage).min,
  );
  const adjustedScore = adjustScoreToStageBand(currentScore, stage);
  const nextStatus = stageToCommercialStatus(stage, currentStatus);

  const previousMeta = ensurePlainObject(currentLead.score_meta);
  const previousSignals = extractCrmSignals(previousMeta);
  const nextSignals =
    stage === "QUALIFICADO" || stage === "ENVIADO"
      ? CRM_QUALIFICATION_SIGNAL_KEYS.reduce(
          (acc, key) => ({ ...acc, [key]: true }),
          {},
        )
      : stage === "INBOX"
        ? CRM_QUALIFICATION_SIGNAL_KEYS.reduce(
            (acc, key) => ({ ...acc, [key]: false }),
            {},
          )
        : previousSignals;

  const scoreMeta = {
    ...previousMeta,
    crm_signals: nextSignals,
    crm_manual_move: {
      source: "kanban_move",
      applied_at: new Date().toISOString(),
      from_stage: currentStage,
      to_stage: stage,
      from_status: currentStatus,
      to_status: nextStatus,
      from_score: currentScore,
      to_score: adjustedScore,
    },
  };

  const { rows } = await query(
    `UPDATE leads
        SET crm_stage = $2,
            status = $3,
            score = $4,
            score_meta = $5,
            score_scored_at = now(),
            updated_at = now()
      WHERE id = $1
      RETURNING id, nome, uf, cidade, segmento_interesse, status, score,
                crm_stage, next_action_text, next_action_date, next_action_time,
                created_at, updated_at`,
    [leadId, stage, nextStatus, adjustedScore, JSON.stringify(scoreMeta)],
  );

  await query(
    "INSERT INTO events (lead_id, event_type, metadata) VALUES ($1, 'crm_manual_move', $2)",
    [
      leadId,
      JSON.stringify({
        source: "kanban_move",
        from_stage: currentStage,
        to_stage: stage,
        from_status: currentStatus,
        to_status: nextStatus,
        from_score: currentScore,
        to_score: adjustedScore,
      }),
    ],
  );

  const lead = serializeLead(rows[0]);
  lead.crm_stage = normalizeCrmStage(lead.crm_stage);
  res.json({
    ok: true,
    lead,
    transition: {
      from_stage: currentStage,
      to_stage: stage,
      from_status: currentStatus,
      to_status: nextStatus,
      from_score: currentScore,
      to_score: adjustedScore,
    },
  });
}

async function handleCrmEventRules(_req, res) {
  const items = listCrmRules().map(crmRulePublic).filter(Boolean);
  res.json({ items });
}

async function handleCrmApplyRule(req, res) {
  await ensureCrmSchema();
  await ensureScoreSchema();

  const leadId = req.params?.id || req.body?.lead_id || req.body?.id || null;
  if (!leadId) return res.status(400).json({ error: "lead_id é obrigatório" });

  const ruleCode =
    req.body?.rule_code || req.body?.event_code || req.body?.event_type || "";
  const metadata = ensurePlainObject(req.body?.metadata);
  const source = normalizeCrmSource(req.body?.source, "kanban_ui");

  const result = await applyCrmEventRule({
    leadId,
    ruleCode,
    metadata,
    source,
  });

  return res.status(result.status).json(result.body);
}

async function handleCrmAddNote(req, res) {
  await ensureCrmSchema();
  const leadId = req.params.id;
  const note = String(req.body?.note || "").trim();
  if (!note) return res.status(400).json({ error: "note é obrigatório" });

  const next = parseNextActionNote(note);
  const noteType = next ? "NEXT_ACTION" : "NOTE";

  const actionDate = next?.date || null;
  const actionTime = next?.hour || null;

  await query(
    `INSERT INTO lead_notes (lead_id, note_type, note_text, action_date, action_time)
     VALUES ($1, $2, $3, $4, $5)`,
    [leadId, noteType, note, actionDate, actionTime],
  );

  // Se for uma próxima ação, também atualiza o snapshot no lead (usado no card do Kanban)
  if (next) {
    await query(
      `UPDATE leads
          SET next_action_text = $2,
              next_action_date = $3,
              next_action_time = $4,
              next_action_at   = CASE
                                  WHEN $3::date IS NULL THEN NULL
                                  WHEN $4::time IS NULL THEN ($3::date)::timestamptz
                                  ELSE ($3::date + $4::time)::timestamptz
                                END,
              updated_at = now()
        WHERE id = $1`,
      [leadId, next.text, next.date, next.hour],
    );
  }

  res.json({ ok: true });
}

async function handleCrmGetNotes(req, res) {
  await ensureCrmSchema();
  const leadId = req.params.id;
  const { rows } = await query(
    `SELECT id, note_type, note_text, action_date, action_time, created_at
       FROM lead_notes
      WHERE lead_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [leadId],
  );

  const notes = rows.map((r) => ({
    id: r.id,
    type: r.note_type,
    text: r.note_text,
    date: r.action_date ? String(r.action_date).slice(0, 10) : null,
    hour: r.action_time ? String(r.action_time).slice(0, 5) : null,
    created_at: r.created_at,
  }));

  res.json({ notes });
}

function normUpper(v) {
  return String(v || "")
    .trim()
    .toUpperCase();
}

function normDigits(v) {
  return String(v || "").replace(/\D+/g, "");
}

async function handleCrmMatches(req, res) {
  await ensureCrmSchema();
  const leadId = req.params.id;
  const limit = Math.max(
    1,
    Math.min(parseInt(req.query?.limit || "10", 10) || 10, 50),
  );

  const leadRes = await query(
    `SELECT id, uf, cidade, segmento_interesse
       FROM leads
      WHERE id = $1`,
    [leadId],
  );
  if (!leadRes.rows.length)
    return res.status(404).json({ error: "Lead não encontrado" });

  const lead = leadRes.rows[0];
  const leadUF = normUpper(lead.uf);
  const leadCity = normUpper(lead.cidade);
  const leadSeg = normUpper(lead.segmento_interesse);

  // Filtros "bons o suficiente" para hackathon: UF + Segmento (quando existir)
  const params = [];
  let sql = `SELECT id, cnpj, razao_social, nome_fantasia, uf, municipio_nome, cnae_principal, segmento, prioridade
               FROM partners
              WHERE 1=1`;

  if (leadUF) {
    params.push(leadUF);
    sql += ` AND UPPER(uf) = $${params.length}`;
  }
  if (leadSeg) {
    params.push(leadSeg);
    sql += ` AND UPPER(segmento) = $${params.length}`;
  }

  sql += ` LIMIT 300`;

  const pRes = await query(sql, params);

  const items = pRes.rows
    .map((p) => {
      let score = 0;

      // Heurística de score simples e explicável
      if (leadUF && normUpper(p.uf) === leadUF) score += 2;
      if (leadSeg && normUpper(p.segmento) === leadSeg) score += 4;
      if (leadCity && normUpper(p.municipio_nome) === leadCity) score += 3;

      // Prioridade do parceiro (se existir)
      const pr = normUpper(p.prioridade);
      if (pr === "ALTA") score += 2;
      else if (pr === "MEDIA" || pr === "MÉDIA") score += 1;

      return {
        id: p.id,
        cnpj: p.cnpj,
        razao_social: p.razao_social,
        nome_fantasia: p.nome_fantasia,
        uf: p.uf,
        municipio_nome: p.municipio_nome,
        cnae_principal: p.cnae_principal,
        segmento: p.segmento,
        prioridade: p.prioridade,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  res.json({ items });
}

function parseJsonObjectSafe(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const txt = String(value || "").trim();
  if (!txt) return fallback;
  if (!(txt.startsWith("{") || txt.startsWith("["))) return fallback;
  try {
    const parsed = JSON.parse(txt);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed;
    return fallback;
  } catch (_err) {
    return fallback;
  }
}

function parseScoreReasons(value) {
  if (Array.isArray(value)) return value;
  const txt = String(value || "").trim();
  if (!txt) return [];
  if (!(txt.startsWith("[") || txt.startsWith("{"))) return [];
  try {
    const parsed = JSON.parse(txt);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
    return [];
  } catch (_err) {
    return [];
  }
}

function isoDateTime(value) {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toISOString();
}

function pctText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function detectSectorByChannel(channelRaw) {
  const channel = String(channelRaw || "")
    .trim()
    .toLowerCase();
  if (!channel) return "";
  if (
    channel.includes("venda") ||
    channel.includes("sales") ||
    channel.includes("comercial")
  )
    return "VENDAS";
  if (
    channel.includes("marketing") ||
    channel.includes("mkt") ||
    channel.includes("nurture")
  )
    return "MARKETING";
  if (
    channel.includes("parceir") ||
    channel.includes("partner") ||
    channel.includes("ecossistema")
  )
    return "PARCEIROS";
  if (channel.includes("operac") || channel.includes("ops")) return "OPERACOES";
  return "";
}

const REPORT_SECTORS = {
  MARKETING: {
    key: "MARKETING",
    code: "MKT-01",
    name: "Setor de Marketing de Nurture",
    owner: "Squad Growth",
  },
  VENDAS: {
    key: "VENDAS",
    code: "VND-01",
    name: "Setor de Vendas Consultivas",
    owner: "Squad Comercial",
  },
  PARCEIROS: {
    key: "PARCEIROS",
    code: "PRC-01",
    name: "Setor de Parcerias Estrategicas",
    owner: "Squad Ecossistema",
  },
  OPERACOES: {
    key: "OPERACOES",
    code: "OPS-01",
    name: "Setor de Operacoes CRM",
    owner: "Squad Operacoes",
  },
};

async function computeManagerialMatchesForLead(lead, limit = 8) {
  const safeLimit = Math.max(
    1,
    Math.min(parseInt(String(limit || "8"), 10) || 8, 50),
  );
  const leadUF = normUpper(lead.uf);
  const leadCity = normUpper(lead.cidade);
  const leadSeg = normUpper(lead.segmento_interesse);

  const params = [];
  let sql = `SELECT id, cnpj, razao_social, nome_fantasia, uf, municipio_nome, cnae_principal, segmento, prioridade
               FROM partners
              WHERE 1=1`;

  if (leadUF) {
    params.push(leadUF);
    sql += ` AND UPPER(uf) = $${params.length}`;
  }
  if (leadSeg) {
    params.push(leadSeg);
    sql += ` AND UPPER(segmento) = $${params.length}`;
  }

  sql += ` LIMIT 300`;
  const pRes = await query(sql, params);

  return (pRes.rows || [])
    .map((p) => {
      let score = 0;
      if (leadUF && normUpper(p.uf) === leadUF) score += 2;
      if (leadSeg && normUpper(p.segmento) === leadSeg) score += 4;
      if (leadCity && normUpper(p.municipio_nome) === leadCity) score += 3;

      const pr = normUpper(p.prioridade);
      if (pr === "ALTA") score += 2;
      else if (pr === "MEDIA" || pr === "MÉDIA") score += 1;

      return {
        id: p.id,
        cnpj: p.cnpj,
        razao_social: p.razao_social,
        nome_fantasia: p.nome_fantasia,
        uf: p.uf,
        municipio_nome: p.municipio_nome,
        cnae_principal: p.cnae_principal,
        segmento: p.segmento,
        prioridade: p.prioridade,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, safeLimit);
}

function inferRoutingDecision({ lead, handoffEvent, matches }) {
  const score = Number(lead?.score);
  const probability = Number(lead?.score_probability);
  const stage = resolveBoardStage(lead);
  const segment = normUpper(lead?.segmento_interesse);
  const deadline = normUpper(lead?.prazo_compra);
  const topMatchScore = Number(matches?.[0]?.score);
  const hasPartnerStrength =
    Array.isArray(matches) &&
    matches.length >= 3 &&
    Number.isFinite(topMatchScore) &&
    topMatchScore >= 6;
  const partnerFriendlySegment = [
    "EVENTOS",
    "EQUIPAMENTOS",
    "CAVALOS",
  ].includes(segment);

  const highIntent =
    (Number.isFinite(score) && score >= 80) ||
    (Number.isFinite(probability) && probability >= 0.72) ||
    stage === "QUALIFICADO" ||
    stage === "ENVIADO";
  const mediumIntent =
    (Number.isFinite(score) && score >= 55) ||
    (Number.isFinite(probability) && probability >= 0.45) ||
    stage === "AQUECENDO";

  const evidence = [];
  if (Number.isFinite(score)) evidence.push(`Score atual ${score}.`);
  if (Number.isFinite(probability))
    evidence.push(`Probabilidade de qualificacao ${pctText(probability)}.`);
  if (deadline === "7D")
    evidence.push("Prazo de compra curto (7d), indicando urgencia comercial.");
  if (partnerFriendlySegment)
    evidence.push(
      `Segmento ${segment} com potencial para roteamento de parceiros.`,
    );
  if (hasPartnerStrength)
    evidence.push("Matching de parceiros com consistencia alta.");

  let primary = REPORT_SECTORS.MARKETING;
  let secondaries = [REPORT_SECTORS.VENDAS, REPORT_SECTORS.PARCEIROS];
  let decisionMode = "SUGERIDO";
  let confidence = 68;

  if (handoffEvent?.sectorKey && REPORT_SECTORS[handoffEvent.sectorKey]) {
    primary = REPORT_SECTORS[handoffEvent.sectorKey];
    decisionMode = "EFETIVO";
    confidence = 96;
    evidence.unshift(
      `Encaminhamento registrado em evento de handoff (canal: ${handoffEvent.channel || "nao informado"}).`,
    );
  } else if (
    stage === "ENVIADO" &&
    partnerFriendlySegment &&
    hasPartnerStrength
  ) {
    primary = REPORT_SECTORS.PARCEIROS;
    secondaries = [REPORT_SECTORS.VENDAS, REPORT_SECTORS.MARKETING];
    confidence = 88;
    evidence.unshift(
      "Lead em etapa ENVIADO com aderencia forte para parceiros.",
    );
  } else if (stage === "ENVIADO" || highIntent) {
    primary = REPORT_SECTORS.VENDAS;
    secondaries = [REPORT_SECTORS.PARCEIROS, REPORT_SECTORS.MARKETING];
    confidence = stage === "ENVIADO" ? 85 : 81;
    evidence.unshift("Lead com alta intencao para conversao comercial.");
  } else if (mediumIntent && partnerFriendlySegment && hasPartnerStrength) {
    primary = REPORT_SECTORS.PARCEIROS;
    secondaries = [REPORT_SECTORS.MARKETING, REPORT_SECTORS.VENDAS];
    confidence = 76;
    evidence.unshift(
      "Lead em aquecimento com oportunidade de aceleracao via parceiros.",
    );
  } else {
    primary = REPORT_SECTORS.MARKETING;
    secondaries = [REPORT_SECTORS.VENDAS, REPORT_SECTORS.PARCEIROS];
    confidence = 71;
    evidence.unshift(
      "Lead ainda em maturacao; recomendada nutricao estruturada.",
    );
  }

  return {
    decision_mode: decisionMode,
    confidence_pct: confidence,
    primary_sector: primary,
    secondary_sectors: secondaries,
    evidence,
  };
}

function buildManagerialActionPlan(primarySectorKey) {
  if (primarySectorKey === "VENDAS") {
    return [
      {
        horizon: "0-24h",
        owner: "Vendas",
        action: "Realizar contato consultivo e validar contexto de compra.",
      },
      {
        horizon: "24-72h",
        owner: "Vendas + Parcerias",
        action: "Preparar proposta com opcoes aderentes ao perfil do lead.",
      },
      {
        horizon: "72h+",
        owner: "Gestao Comercial",
        action: "Registrar status final da oportunidade no CRM.",
      },
    ];
  }
  if (primarySectorKey === "PARCEIROS") {
    return [
      {
        horizon: "0-24h",
        owner: "Parcerias",
        action:
          "Acionar top parceiros do matching e confirmar disponibilidade.",
      },
      {
        horizon: "24-72h",
        owner: "Parcerias + Vendas",
        action: "Consolidar proposta conjunta com condicoes comerciais.",
      },
      {
        horizon: "72h+",
        owner: "Gestao de Ecossistema",
        action: "Mensurar taxa de resposta da rede e ajustar aderencia.",
      },
    ];
  }
  return [
    {
      horizon: "0-24h",
      owner: "Marketing",
      action: "Iniciar jornada de nutricao com conteudo de alto interesse.",
    },
    {
      horizon: "24-72h",
      owner: "Marketing + SDR",
      action: "Requalificar lead por engajamento e sinais de conversao.",
    },
    {
      horizon: "72h+",
      owner: "Gestao Growth",
      action: "Reavaliar roteamento para Vendas ou Parcerias conforme sinais.",
    },
  ];
}

async function handleCrmManagerialReport(req, res) {
  await ensureCrmSchema();
  await ensureScoreSchema();

  const leadId = req.params.id;
  if (!leadId) return res.status(400).json({ error: "lead_id e obrigatorio" });

  const leadR = await query(
    `SELECT id, nome, whatsapp, email, uf, cidade, segmento_interesse, orcamento_faixa, prazo_compra,
            status, score, crm_stage, next_action_text, next_action_date, next_action_time, next_action_at,
            score_engine, score_model_name, score_probability, score_scored_at, score_meta, score_motivos,
            created_at, updated_at
       FROM leads
      WHERE id = $1`,
    [leadId],
  );
  if (!leadR.rows.length)
    return res.status(404).json({ error: "Lead nao encontrado" });
  const lead = leadR.rows[0];

  const [notesR, eventsR, matches] = await Promise.all([
    query(
      `SELECT id, note_type, note_text, action_date, action_time, created_at
         FROM lead_notes
        WHERE lead_id = $1
        ORDER BY created_at DESC
        LIMIT 40`,
      [leadId],
    ),
    query(
      `SELECT event_type, metadata, ts
         FROM events
        WHERE lead_id = $1
        ORDER BY ts DESC
        LIMIT 120`,
      [leadId],
    ),
    computeManagerialMatchesForLead(lead, 8),
  ]);

  const scoreMeta = parseJsonObjectSafe(lead.score_meta, {});
  const scoreReasons = parseScoreReasons(lead.score_motivos)
    .map((item) => ({
      fator: String(item?.fator || "Fator"),
      impacto: Number(item?.impacto),
      detalhe: String(item?.detalhe || "").trim() || null,
    }))
    .slice(0, 8);

  const eventRows = (eventsR.rows || []).map((row) => ({
    event_type: String(row.event_type || "").trim() || "evento",
    metadata: parseJsonObjectSafe(row.metadata, {}),
    at: isoDateTime(row.ts),
  }));
  const eventBreakdown = {};
  for (const ev of eventRows) {
    eventBreakdown[ev.event_type] =
      Number(eventBreakdown[ev.event_type] || 0) + 1;
  }

  const handoffEvent =
    eventRows.find((ev) => ev.event_type.toLowerCase() === "handoff") || null;
  const handoffChannel =
    handoffEvent?.metadata?.channel ||
    handoffEvent?.metadata?.setor ||
    handoffEvent?.metadata?.sector ||
    "";
  const handoffSectorKey = handoffEvent
    ? detectSectorByChannel(handoffChannel) || "OPERACOES"
    : "";

  const routing = inferRoutingDecision({
    lead: {
      ...lead,
      score_probability:
        lead.score_probability ?? scoreMeta.probability_qualified ?? null,
    },
    handoffEvent: handoffEvent
      ? {
          channel: String(handoffChannel || "").trim() || null,
          sectorKey: handoffSectorKey || "",
          at: handoffEvent.at,
        }
      : null,
    matches,
  });

  const latestNotes = (notesR.rows || []).slice(0, 8).map((row) => ({
    id: row.id,
    type: row.note_type,
    text: String(row.note_text || ""),
    action_date: row.action_date ? String(row.action_date).slice(0, 10) : null,
    action_time: row.action_time ? String(row.action_time).slice(0, 5) : null,
    created_at: isoDateTime(row.created_at),
  }));

  const managerialRisks = [];
  if (!lead.whatsapp && !lead.email)
    managerialRisks.push(
      "Lead sem canal de contato principal (telefone/e-mail).",
    );
  if (!matches.length)
    managerialRisks.push("Sem parceiros aderentes no matching atual.");
  if (Number(lead.score) < 50)
    managerialRisks.push(
      "Score abaixo de 50; risco elevado de baixa conversao.",
    );
  if (!lead.next_action_text)
    managerialRisks.push("Nao ha proxima acao registrada no CRM.");

  const reportId = `REL-${String(lead.id).slice(0, 8).toUpperCase()}-${Date.now()
    .toString()
    .slice(-6)}`;

  const report = {
    report_id: reportId,
    generated_at: new Date().toISOString(),
    lead_snapshot: {
      id: lead.id,
      nome: lead.nome,
      uf: lead.uf,
      cidade: lead.cidade,
      segmento: lead.segmento_interesse,
      status: lead.status,
      stage: resolveBoardStage(lead),
      score: lead.score,
      score_probability:
        lead.score_probability ?? scoreMeta.probability_qualified ?? null,
      score_engine: lead.score_engine || scoreMeta.engine || null,
      score_model_name: lead.score_model_name || scoreMeta.model_name || null,
      orcamento_faixa: lead.orcamento_faixa,
      prazo_compra: lead.prazo_compra,
      next_action_text: lead.next_action_text,
      next_action_date: lead.next_action_date
        ? String(lead.next_action_date).slice(0, 10)
        : null,
      next_action_time: lead.next_action_time
        ? String(lead.next_action_time).slice(0, 5)
        : null,
      next_action_at: isoDateTime(lead.next_action_at),
      created_at: isoDateTime(lead.created_at),
      updated_at: isoDateTime(lead.updated_at),
    },
    executive_summary: {
      headline: `Encaminhamento ${routing.decision_mode === "EFETIVO" ? "confirmado" : "recomendado"} para ${routing.primary_sector.name}.`,
      sent_to: routing.primary_sector.name,
      sent_to_code: routing.primary_sector.code,
      decision_mode: routing.decision_mode,
      confidence_pct: routing.confidence_pct,
      why_sent: routing.evidence,
    },
    routing: {
      current_stage: resolveBoardStage(lead),
      primary_sector: routing.primary_sector,
      secondary_sectors: routing.secondary_sectors,
      destination_reasoning: routing.evidence,
      handoff_event: handoffEvent
        ? {
            at: handoffEvent.at,
            channel: String(handoffChannel || "").trim() || null,
            mapped_sector: handoffSectorKey
              ? REPORT_SECTORS[handoffSectorKey]
              : null,
          }
        : null,
    },
    qualification_intelligence: {
      score: lead.score,
      probability_qualified:
        lead.score_probability ?? scoreMeta.probability_qualified ?? null,
      probability_qualified_text: pctText(
        lead.score_probability ?? scoreMeta.probability_qualified ?? null,
      ),
      score_engine: lead.score_engine || scoreMeta.engine || null,
      score_model_name: lead.score_model_name || scoreMeta.model_name || null,
      scored_at: isoDateTime(lead.score_scored_at),
      score_reasons: scoreReasons,
    },
    engagement: {
      total_events: eventRows.length,
      event_breakdown: eventBreakdown,
      latest_event_at: eventRows[0]?.at || null,
      timeline: eventRows.slice(0, 12),
    },
    crm_context: {
      notes_count: (notesR.rows || []).length,
      latest_notes: latestNotes,
      next_action: {
        text: lead.next_action_text || null,
        date: lead.next_action_date
          ? String(lead.next_action_date).slice(0, 10)
          : null,
        time: lead.next_action_time
          ? String(lead.next_action_time).slice(0, 5)
          : null,
        at: isoDateTime(lead.next_action_at),
      },
    },
    partner_matching: {
      total_considered: matches.length,
      top_matches: matches.slice(0, 5),
      recommendation:
        matches.length > 0
          ? "Ha parceiros aderentes para apoiar a estrategia comercial."
          : "Nao ha parceiros aderentes suficientes para recomendacao imediata.",
    },
    managerial_risks: managerialRisks,
    managerial_recommendations: buildManagerialActionPlan(
      routing.primary_sector.key,
    ),
    governance: {
      data_sources: ["leads", "lead_notes", "events", "partners"],
      generated_by: "growth-equestre-report-engine v1",
    },
  };

  return res.json({ ok: true, report });
}

// Rotas "oficiais" consumidas pela UI Admin
app.get("/crm/board", asyncHandler(handleCrmBoard));
app.post("/crm/move", asyncHandler(handleCrmMove));
app.get("/crm/event-rules", asyncHandler(handleCrmEventRules));
app.post("/crm/apply-rule", asyncHandler(handleCrmApplyRule));
app.post("/crm/leads/:id/apply-rule", asyncHandler(handleCrmApplyRule));
app.post("/crm/leads/:id/notes", asyncHandler(handleCrmAddNote));
app.get("/crm/leads/:id/notes", asyncHandler(handleCrmGetNotes));
app.get("/crm/leads/:id/matches", asyncHandler(handleCrmMatches));
app.get(
  "/crm/leads/:id/managerial-report",
  asyncHandler(handleCrmManagerialReport),
);
app.get(
  "/crm/leads/:id/relatorio-gerencial",
  asyncHandler(handleCrmManagerialReport),
);

// Compat: alguns ambientes antigos chamam sem o prefixo /crm
app.get("/board", asyncHandler(handleCrmBoard));
app.post("/move", asyncHandler(handleCrmMove));
app.get("/event-rules", asyncHandler(handleCrmEventRules));
app.post("/apply-rule", asyncHandler(handleCrmApplyRule));
app.post("/leads/:id/apply-rule", asyncHandler(handleCrmApplyRule));
app.post("/leads/:id/notes", asyncHandler(handleCrmAddNote));
app.get("/leads/:id/matches", asyncHandler(handleCrmMatches));
app.get(
  "/leads/:id/managerial-report",
  asyncHandler(handleCrmManagerialReport),
);

// Rotas adicionais de CRM (ex.: /crm/seed, /crm/partners/*).
// Mantido após as rotas principais para preservar os contratos já utilizados pela UI.
app.use("/crm", crmRoutes);

app.post(
  "/handoff",
  asyncHandler(async (req, res) => {
    const { lead_id, channel } = req.body || {};
    if (!lead_id)
      return res.status(400).json({ error: "lead_id é obrigatório" });

    const leadR = await query("SELECT status FROM leads WHERE id=$1", [
      lead_id,
    ]);
    if (!leadR.rows.length)
      return res.status(404).json({ error: "Lead nao encontrado" });

    const currentStatus = String(leadR.rows[0]?.status || "")
      .toUpperCase()
      .trim();
    if (currentStatus !== "QUALIFICADO") {
      return res.status(409).json({
        error: "Handoff permitido apenas para leads com status QUALIFICADO",
        current_status: currentStatus || null,
      });
    }

    await query(
      "UPDATE leads SET status='ENVIADO', crm_stage='ENVIADO', updated_at=now() WHERE id=$1",
      [lead_id],
    );
    await query(
      "INSERT INTO events (lead_id, event_type, metadata) VALUES ($1,'handoff',$2)",
      [lead_id, JSON.stringify({ channel: channel || "manual" })],
    );

    res.json({ ok: true });
  }),
);

// -----------------------------
// PARTNERS
// -----------------------------
app.get(
  "/partners",
  asyncHandler(async (req, res) => {
    const { uf, segment, q } = req.query;

    const where = [];
    const params = [];
    let i = 1;

    if (uf) {
      where.push(`uf=$${i++}`);
      params.push(uf);
    }
    if (segment) {
      where.push(`segmento=$${i++}`);
      params.push(segment);
    }
    if (q) {
      where.push(
        `(coalesce(nome_fantasia,'') ILIKE $${i} OR coalesce(razao_social,'') ILIKE $${i})`,
      );
      params.push(`%${q}%`);
      i++;
    }

    const sql = `SELECT *
                 FROM partners
                 ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY prioridade ASC, nome_fantasia ASC NULLS LAST
                 LIMIT 500`;

    const r = await query(sql, params);
    res.json(r.rows);
  }),
);

app.get(
  "/partners/summary",
  asyncHandler(async (req, res) => {
    const { uf } = req.query;
    const params = [];
    let where = "";

    if (uf) {
      where = "WHERE uf=$1";
      params.push(uf);
    }

    const r = await query(
      `SELECT segmento, COUNT(*)::int as total
       FROM partners
       ${where}
       GROUP BY segmento
       ORDER BY total DESC`,
      params,
    );

    res.json(r.rows);
  }),
);

app.post(
  "/admin/dedup-leads",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const dryRun = parseBooleanFlag(
      body.dry_run ?? body.dryRun ?? req.query?.dry_run,
      false,
    );
    const windowMinutes = normalizeWindowMinutesInput(
      body.window_minutes ?? body.windowMinutes ?? req.query?.window_minutes,
      LEAD_DUPLICATE_WINDOW_MINUTES,
    );

    const result = await cleanupLeadDuplicates({
      dryRun,
      windowMinutes,
    });

    return res.json({
      ...result,
      action: dryRun ? "dry_run" : "cleanup",
      executed_at: new Date().toISOString(),
    });
  }),
);

// -----------------------------
// DEMO — SEED / RESET PARTNERS
// -----------------------------

/**
 * POST /demo/seed-partners
 * Body opcional:
 *  { "n": 160, "replace": false }
 *
 * - n: quantidade desejada (padrão 160, máximo 1000)
 * - replace: se true, limpa a tabela antes de inserir (reset + seed)
 */

const DEMO_LEAD_FIRST_NAMES = [
  "Lucas",
  "Mariana",
  "Rafael",
  "Camila",
  "Bruno",
  "Juliana",
  "Thiago",
  "Patricia",
  "Diego",
  "Renata",
  "Felipe",
  "Aline",
  "Gustavo",
  "Vanessa",
  "Eduardo",
  "Larissa",
  "Rodrigo",
  "Bianca",
  "Andre",
  "Carla",
];

const DEMO_LEAD_LAST_NAMES = [
  "Almeida",
  "Costa",
  "Nogueira",
  "Fernandes",
  "Carvalho",
  "Ribeiro",
  "Martins",
  "Azevedo",
  "Santana",
  "Moraes",
  "Barros",
  "Duarte",
  "Leite",
  "Rocha",
  "Freitas",
  "Gomes",
  "Pires",
  "Melo",
  "Teixeira",
  "Mendes",
];

const DEMO_UF_CITIES = {
  SP: [
    "Sao Paulo",
    "Campinas",
    "Ribeirao Preto",
    "Sorocaba",
    "Sao Jose dos Campos",
  ],
  MG: [
    "Belo Horizonte",
    "Uberlandia",
    "Juiz de Fora",
    "Contagem",
    "Montes Claros",
  ],
  GO: ["Goiania", "Aparecida de Goiania", "Anapolis", "Rio Verde", "Jatai"],
};

const DEMO_SEGMENTS = ["CAVALOS", "SERVICOS", "EVENTOS", "EQUIPAMENTOS"];
const DEMO_BUDGETS = ["0-5k", "5k-20k", "20k-60k", "60k+"];
const DEMO_DEADLINES = ["7d", "30d", "90d"];

function randomInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (hi <= lo) return lo;
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function randomChoice(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[randomInt(0, list.length - 1)];
}

function statusToCrmStage(status) {
  const key = String(status || "")
    .toUpperCase()
    .trim();
  if (key === "AQUECENDO" || key === "QUALIFICADO" || key === "ENVIADO")
    return key;
  return "INBOX";
}

function statusScoreRange(status) {
  const key = String(status || "")
    .toUpperCase()
    .trim();
  if (key === "ENVIADO") return [82, 96];
  if (key === "QUALIFICADO") return [70, 89];
  // Alinhado ao scoring_service (_score_to_status): AQUECENDO >= 40.
  if (key === "AQUECENDO") return [40, 69];
  return [18, 39];
}

function statusProbabilityRange(status) {
  const key = String(status || "")
    .toUpperCase()
    .trim();
  if (key === "ENVIADO") return [0.82, 0.98];
  if (key === "QUALIFICADO") return [0.7, 0.89];
  // Mantem consistencia aproximada com as faixas de score sintetico.
  if (key === "AQUECENDO") return [0.4, 0.69];
  return [0.05, 0.39];
}

function randomFloat(min, max, digits = 4) {
  const raw = min + Math.random() * (max - min);
  return Number(raw.toFixed(digits));
}

function buildStatusPlan(total) {
  const n = Math.max(1, Math.floor(total));
  const target = {
    CURIOSO: Math.floor(n * 0.5),
    AQUECENDO: Math.floor(n * 0.3),
    QUALIFICADO: Math.floor(n * 0.15),
    ENVIADO: 0,
  };
  target.ENVIADO = n - target.CURIOSO - target.AQUECENDO - target.QUALIFICADO;

  const out = [];
  for (const [status, qty] of Object.entries(target)) {
    for (let i = 0; i < qty; i++) out.push(status);
  }

  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }

  return out;
}

function buildSyntheticLead(index, status) {
  const uf = randomChoice(Object.keys(DEMO_UF_CITIES)) || "SP";
  const city = randomChoice(DEMO_UF_CITIES[uf]) || "Sao Paulo";
  const first = randomChoice(DEMO_LEAD_FIRST_NAMES) || "Visitante";
  const last = randomChoice(DEMO_LEAD_LAST_NAMES) || "Demo";
  const serial = String(index + 1).padStart(4, "0");
  const nome = `${first} ${last} ${serial}`;
  const email =
    Math.random() < 0.82
      ? `lead.demo.${Date.now()}.${serial}@exemplo.com`
      : null;
  const whatsapp =
    Math.random() < 0.9
      ? `55${uf === "SP" ? "11" : uf === "MG" ? "31" : "62"}9${String(
          randomInt(10000000, 99999999),
        )}`
      : null;

  const [scoreMin, scoreMax] = statusScoreRange(status);
  const [probMin, probMax] = statusProbabilityRange(status);
  const probability = randomFloat(probMin, probMax, 4);
  const score = randomInt(scoreMin, scoreMax);

  const daysAgo = randomInt(0, 120);
  const minutesAgo = randomInt(0, 24 * 60 - 1);
  const createdAt = new Date(
    Date.now() - (daysAgo * 24 * 60 + minutesAgo) * 60 * 1000,
  );

  const motives = [
    {
      fator: "Regiao foco",
      impacto: uf === "SP" || uf === "MG" ? 4 : 3,
      detalhe: `UF ${uf}`,
    },
    {
      fator: "Orcamento informado",
      impacto: randomChoice(DEMO_BUDGETS) === "60k+" ? 6 : 3,
      detalhe: "Perfil sintetico para treino",
    },
    {
      fator: "Sinal de intencao",
      impacto: status === "QUALIFICADO" || status === "ENVIADO" ? 12 : 4,
      detalhe: `Status alvo: ${status}`,
    },
  ];

  return {
    nome,
    whatsapp,
    email,
    uf,
    cidade: city,
    segmento_interesse: randomChoice(DEMO_SEGMENTS),
    orcamento_faixa: randomChoice(DEMO_BUDGETS),
    prazo_compra: randomChoice(DEMO_DEADLINES),
    status,
    crm_stage: statusToCrmStage(status),
    score,
    score_probability: probability,
    score_engine: "synthetic_seed",
    score_model_name: "seed_generator_v1",
    score_meta: {
      engine: "synthetic_seed",
      model_name: "seed_generator_v1",
      probability_qualified: probability,
      synthetic: true,
    },
    score_motivos: motives,
    created_at: createdAt,
  };
}

function buildSyntheticEvents(status, createdAt) {
  const key = String(status || "")
    .toUpperCase()
    .trim();
  const timeline = [];
  const start = new Date(createdAt);

  const pageViews =
    key === "CURIOSO"
      ? randomInt(1, 2)
      : key === "AQUECENDO"
        ? randomInt(1, 3)
        : randomInt(2, 5);
  for (let i = 0; i < pageViews; i++) {
    timeline.push({
      event_type: "page_view",
      ts: new Date(start.getTime() + (i + 1) * randomInt(10, 120) * 60 * 1000),
      metadata: { source: "seed", step: i + 1 },
    });
  }

  if (
    key === "AQUECENDO" ||
    key === "QUALIFICADO" ||
    key === "ENVIADO" ||
    Math.random() < 0.2
  ) {
    timeline.push({
      event_type: "hook_complete",
      ts: new Date(start.getTime() + randomInt(2, 24) * 60 * 60 * 1000),
      metadata: { source: "seed", form: "quiz" },
    });
  }

  if (
    key === "QUALIFICADO" ||
    key === "ENVIADO" ||
    (key === "AQUECENDO" && Math.random() < 0.5)
  ) {
    timeline.push({
      event_type: "cta_click",
      ts: new Date(start.getTime() + randomInt(3, 48) * 60 * 60 * 1000),
      metadata: { source: "seed", channel: "landing" },
    });
  }

  if (key === "ENVIADO" || (key === "QUALIFICADO" && Math.random() < 0.5)) {
    timeline.push({
      event_type: "whatsapp_click",
      ts: new Date(start.getTime() + randomInt(4, 72) * 60 * 60 * 1000),
      metadata: { source: "seed", channel: "whatsapp" },
    });
  }

  timeline.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  return timeline;
}

app.post(
  "/demo/seed-leads",
  asyncHandler(async (req, res) => {
    await ensureCrmSchema();
    await ensureScoreSchema();

    const nRaw = Number(req.body?.n ?? 450);
    const replace = parseBooleanFlag(req.body?.replace, false);
    const n = Number.isFinite(nRaw)
      ? Math.max(1, Math.min(3000, Math.floor(nRaw)))
      : 450;
    const statusPlan = buildStatusPlan(n);

    const client = await pool.connect();
    const byStatus = { CURIOSO: 0, AQUECENDO: 0, QUALIFICADO: 0, ENVIADO: 0 };
    let insertedEvents = 0;

    try {
      await client.query("BEGIN");

      if (replace) {
        await client.query(
          "TRUNCATE TABLE lead_notes, events, leads RESTART IDENTITY CASCADE",
        );
      }

      for (let i = 0; i < statusPlan.length; i++) {
        const status = statusPlan[i];
        const seed = buildSyntheticLead(i, status);

        const leadIns = await client.query(
          `INSERT INTO leads
            (nome, whatsapp, email, uf, cidade, segmento_interesse, orcamento_faixa, prazo_compra,
             status, crm_stage, score, score_probability, score_engine, score_model_name, score_meta,
             score_motivos, score_scored_at, created_at, updated_at)
           VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,
             $9,$10,$11,$12,$13,$14,$15,
             $16, now(), $17, now())
           RETURNING id`,
          [
            seed.nome,
            seed.whatsapp,
            seed.email,
            seed.uf,
            seed.cidade,
            seed.segmento_interesse,
            seed.orcamento_faixa,
            seed.prazo_compra,
            seed.status,
            seed.crm_stage,
            seed.score,
            seed.score_probability,
            seed.score_engine,
            seed.score_model_name,
            JSON.stringify(seed.score_meta),
            JSON.stringify(seed.score_motivos),
            seed.created_at,
          ],
        );

        const leadId = String(leadIns.rows?.[0]?.id || "");
        if (!leadId) continue;

        byStatus[status] = Number(byStatus[status] || 0) + 1;

        const events = buildSyntheticEvents(status, seed.created_at);
        for (const ev of events) {
          await client.query(
            `INSERT INTO events (lead_id, event_type, metadata, ts)
             VALUES ($1,$2,$3,$4)`,
            [leadId, ev.event_type, JSON.stringify(ev.metadata || {}), ev.ts],
          );
          insertedEvents += 1;
        }
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const totalsR = await query("SELECT COUNT(*)::int AS total FROM leads");
    return res.json({
      ok: true,
      inserted: n,
      by_status: byStatus,
      events_inserted: insertedEvents,
      total_leads: totalsR.rows?.[0]?.total ?? null,
      replace,
      message: `${n} leads sinteticos gerados para treino.`,
    });
  }),
);

app.post(
  "/demo/seed-partners",
  asyncHandler(async (req, res) => {
    const nRaw = Number(req.body?.n ?? 160);
    const replace = Boolean(req.body?.replace ?? false);
    const n = Number.isFinite(nRaw)
      ? Math.max(1, Math.min(1000, Math.floor(nRaw)))
      : 160;

    if (replace) {
      await query("TRUNCATE partners RESTART IDENTITY;");
    }

    // Inserção demo compatível com seu schema.
    // Usa CNPJ pseudo-aleatório e ON CONFLICT para evitar erro se repetir.
    const sql = `
      INSERT INTO partners
      (cnpj, razao_social, nome_fantasia, uf, municipio_cod, municipio_nome,
       cnae_principal, cnaes_secundarios, segmento, prioridade,
       situacao_cadastral, data_inicio_atividade, contato, endereco)
      SELECT
        lpad((10000000000000::bigint + floor(random()*8999999999999)::bigint)::text, 14, '0') as cnpj,
        ('Parceiro Demo '||g||' LTDA') as razao_social,
        ('Parceiro Demo '||g) as nome_fantasia,

        -- UF: alterna SP/MG/GO
        (CASE (g % 3)
          WHEN 0 THEN 'SP'
          WHEN 1 THEN 'MG'
          ELSE 'GO'
        END)::character(2) as uf,

        NULL::integer as municipio_cod,

        -- Município “compatível” com UF
        (CASE (g % 3)
          WHEN 0 THEN (ARRAY['São Paulo','Campinas','Ribeirão Preto','Sorocaba','São José do Rio Preto'])[1 + (g % 5)]
          WHEN 1 THEN (ARRAY['Belo Horizonte','Uberlândia','Juiz de Fora','Montes Claros','Contagem'])[1 + (g % 5)]
          ELSE (ARRAY['Goiânia','Anápolis','Rio Verde','Jataí','Aparecida de Goiânia'])[1 + (g % 5)]
        END) as municipio_nome,

        -- CNAE (texto) só para dar “cara de dado”; você pode substituir pelos CNAEs do seu lookup depois
        (CASE (g % 4)
          WHEN 0 THEN '0152-1/02'  -- cavalos (exemplo)
          WHEN 1 THEN '9313-1/00'  -- serviços esportivos (exemplo)
          WHEN 2 THEN '8230-0/01'  -- eventos (exemplo)
          ELSE '4647-8/01'         -- comércio/equipamentos (exemplo)
        END) as cnae_principal,

        NULL::text[] as cnaes_secundarios,

        -- Segmentos do MVP
        (CASE (g % 4)
          WHEN 0 THEN 'CAVALOS'
          WHEN 1 THEN 'SERVICOS'
          WHEN 2 THEN 'EVENTOS'
          ELSE 'EQUIPAMENTOS'
        END) as segmento,

        -- Prioridade 1/2/3
        (CASE
          WHEN (g % 10) < 3 THEN 1
          WHEN (g % 10) < 7 THEN 2
          ELSE 3
        END) as prioridade,

        NULL::integer as situacao_cadastral,
        (CURRENT_DATE - ((g % 365))::int) as data_inicio_atividade,

        jsonb_build_object(
          'site', 'https://exemplo.com/p/'||g,
          'instagram', '@parceiro_demo_'||g,
          'telefone', '+55 11 9' || lpad((10000000 + (g % 90000000))::text, 8, '0'),
          'email', 'contato'||g||'@exemplo.com'
        ) as contato,

        jsonb_build_object(
          'logradouro', 'Rua Demo',
          'numero', g::text,
          'bairro', 'Centro'
        ) as endereco
      FROM generate_series(1, $1) g
      ON CONFLICT (cnpj) DO NOTHING
      RETURNING 1;
    `;

    const r = await query(sql, [n]);
    const totalR = await query("SELECT COUNT(*)::int AS total FROM partners");
    res.json({
      ok: true,
      inserted: r.rowCount,
      total: totalR.rows?.[0]?.total ?? null,
      message: "Parceiros de demonstração criados com sucesso.",
    });
  }),
);

/**
 * POST /demo/reset
 * Limpa dados de demo para reiniciar o fluxo completo da apresentação.
 * Remove leads, eventos, notas de CRM e parceiros.
 */

/**
 * POST /demo/reset-seeded-leads
 * Remove apenas os leads sinteticos gerados por /demo/seed-leads,
 * sem afetar parceiros ou leads reais.
 */
app.post(
  "/demo/reset-seeded-leads",
  asyncHandler(async (req, res) => {
    await ensureCrmSchema();
    const dryRun = parseBooleanFlag(
      req.body?.dry_run ?? req.query?.dry_run,
      false,
    );

    const client = await pool.connect();
    try {
      const seededR = await client.query(
        `SELECT id
           FROM leads
          WHERE COALESCE(score_engine, '') = 'synthetic_seed'
             OR COALESCE(score_model_name, '') = 'seed_generator_v1'
             OR COALESCE(score_meta->>'synthetic', 'false') = 'true'
             OR COALESCE(email, '') ILIKE 'lead.demo.%@exemplo.com'`,
      );
      const seededIds = (seededR.rows || [])
        .map((row) => String(row.id))
        .filter(Boolean);

      if (!seededIds.length) {
        return res.json({
          ok: true,
          dry_run: Boolean(dryRun),
          matched_seeded_leads: 0,
          deleted: {
            leads: 0,
            events: 0,
            lead_notes: 0,
            crm_lead_notes: 0,
            crm_lead_state: 0,
          },
          message: "Nenhum lead sintetico encontrado para reset.",
        });
      }

      const eventsBeforeR = await client.query(
        "SELECT COUNT(*)::int AS total FROM events WHERE lead_id = ANY($1::uuid[])",
        [seededIds],
      );

      let leadNotesBefore = 0;
      if (await tableExists(client, "public.lead_notes")) {
        const leadNotesBeforeR = await client.query(
          "SELECT COUNT(*)::int AS total FROM lead_notes WHERE lead_id = ANY($1::uuid[])",
          [seededIds],
        );
        leadNotesBefore = leadNotesBeforeR.rows?.[0]?.total ?? 0;
      }

      let crmLeadNotesBefore = 0;
      if (await tableExists(client, "public.crm_lead_notes")) {
        const crmLeadNotesBeforeR = await client.query(
          "SELECT COUNT(*)::int AS total FROM crm_lead_notes WHERE lead_id = ANY($1::uuid[])",
          [seededIds],
        );
        crmLeadNotesBefore = crmLeadNotesBeforeR.rows?.[0]?.total ?? 0;
      }

      let crmLeadStateBefore = 0;
      if (await tableExists(client, "public.crm_lead_state")) {
        const crmLeadStateBeforeR = await client.query(
          "SELECT COUNT(*)::int AS total FROM crm_lead_state WHERE lead_id = ANY($1::uuid[])",
          [seededIds],
        );
        crmLeadStateBefore = crmLeadStateBeforeR.rows?.[0]?.total ?? 0;
      }

      const preview = {
        ok: true,
        dry_run: Boolean(dryRun),
        matched_seeded_leads: seededIds.length,
        deleted: {
          leads: seededIds.length,
          events: eventsBeforeR.rows?.[0]?.total ?? 0,
          lead_notes: leadNotesBefore,
          crm_lead_notes: crmLeadNotesBefore,
          crm_lead_state: crmLeadStateBefore,
        },
      };

      if (dryRun) {
        return res.json({
          ...preview,
          message: "Dry-run concluido. Nenhum registro foi removido.",
        });
      }

      await client.query("BEGIN");

      if (await tableExists(client, "public.crm_lead_state")) {
        await client.query(
          "DELETE FROM crm_lead_state WHERE lead_id = ANY($1::uuid[])",
          [seededIds],
        );
      }

      if (await tableExists(client, "public.crm_lead_notes")) {
        await client.query(
          "DELETE FROM crm_lead_notes WHERE lead_id = ANY($1::uuid[])",
          [seededIds],
        );
      }

      if (await tableExists(client, "public.lead_notes")) {
        await client.query(
          "DELETE FROM lead_notes WHERE lead_id = ANY($1::uuid[])",
          [seededIds],
        );
      }

      await client.query("DELETE FROM events WHERE lead_id = ANY($1::uuid[])", [
        seededIds,
      ]);
      const deletedLeadsR = await client.query(
        "DELETE FROM leads WHERE id = ANY($1::uuid[]) RETURNING id",
        [seededIds],
      );

      await client.query("COMMIT");

      const totalLeadsR = await query(
        "SELECT COUNT(*)::int AS total FROM leads",
      );
      return res.json({
        ...preview,
        deleted: {
          ...preview.deleted,
          leads: deletedLeadsR.rowCount || 0,
        },
        total_leads: totalLeadsR.rows?.[0]?.total ?? null,
        message: "Leads sinteticos removidos com sucesso.",
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // noop
      }
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.post(
  "/demo/reset",
  asyncHandler(async (_req, res) => {
    await ensureCrmSchema();

    const [leadsBefore, eventsBefore, notesBefore, partnersBefore] =
      await Promise.all([
        query("SELECT COUNT(*)::int AS total FROM leads"),
        query("SELECT COUNT(*)::int AS total FROM events"),
        query("SELECT COUNT(*)::int AS total FROM lead_notes"),
        query("SELECT COUNT(*)::int AS total FROM partners"),
      ]);

    await query(
      "TRUNCATE TABLE lead_notes, events, leads, partners RESTART IDENTITY CASCADE",
    );

    res.json({
      ok: true,
      deleted: {
        leads: leadsBefore.rows?.[0]?.total ?? 0,
        events: eventsBefore.rows?.[0]?.total ?? 0,
        lead_notes: notesBefore.rows?.[0]?.total ?? 0,
        partners: partnersBefore.rows?.[0]?.total ?? 0,
      },
      message: "Reset de demo concluido.",
    });
  }),
);

/**
 * POST /demo/reset-partners
 * Limpa totalmente a tabela de parceiros (MVP/demo).
 */
app.post(
  "/demo/reset-partners",
  asyncHandler(async (_req, res) => {
    const before = await query("SELECT COUNT(*)::int AS total FROM partners");
    await query("TRUNCATE partners RESTART IDENTITY;");
    res.json({
      ok: true,
      deleted: before.rows?.[0]?.total ?? null,
      message: "Parceiros removidos (reset concluído).",
    });
  }),
);

/* =========================================================
   OUTPUT ROUTES (Relatórios exportáveis para UI Web)
   =========================================================
*/

function jsonToCsv(rows) {
  if (!rows || !rows.length) return "";
  const headers = [
    "id",
    "nome",
    "whatsapp",
    "email",
    "uf",
    "cidade",
    "segmento_interesse",
    "orcamento_faixa",
    "prazo_compra",
    "status",
    "score",
    "crm_stage",
    "created_at",
  ];

  const lines = [headers.join(",")];

  for (const row of rows) {
    const cols = headers.map((h) => {
      let val = row[h];
      if (val === null || val === undefined) val = "";
      val = String(val).replace(/"/g, '""');
      if (val.includes(",") || val.includes("\\n")) val = `"${val}"`;
      return val;
    });
    lines.push(cols.join(","));
  }
  return lines.join("\\n");
}

app.get(
  "/output/leads",
  asyncHandler(async (req, res) => {
    const { stage, segmento } = req.query;
    const params = [];
    let sql = "SELECT * FROM leads WHERE 1=1";

    // Filtros opcionais usados pela UI Web (output.js)
    if (stage) {
      params.push(stage);
      sql += ` AND (UPPER(status) = UPPER($${params.length}) OR UPPER(crm_stage) = UPPER($${params.length}))`;
    }
    if (segmento) {
      params.push(segmento);
      sql += ` AND UPPER(segmento_interesse) = UPPER($${params.length})`;
    }

    sql += " ORDER BY created_at DESC LIMIT 1000";

    const r = await query(sql, params);
    const items = r.rows.map(serializeLead);
    res.json(items);
  }),
);

app.get(
  "/output/leads/csv",
  asyncHandler(async (req, res) => {
    const { stage, segmento } = req.query;
    const params = [];
    let sql = "SELECT * FROM leads WHERE 1=1";

    if (stage) {
      params.push(stage);
      sql += ` AND (UPPER(status) = UPPER($${params.length}) OR UPPER(crm_stage) = UPPER($${params.length}))`;
    }
    if (segmento) {
      params.push(segmento);
      sql += ` AND UPPER(segmento_interesse) = UPPER($${params.length})`;
    }

    sql += " ORDER BY created_at DESC LIMIT 1000";

    const r = await query(sql, params);
    const items = r.rows.map(serializeLead);
    const csv = jsonToCsv(items);

    res.header("Content-Type", "text/csv");
    res.attachment("leads_output.csv");
    res.send(csv);
  }),
);

async function bootstrap() {
  try {
    await ensureCrmSchema();
  } catch (e) {
    console.warn("Nao foi possivel garantir colunas de CRM no startup:", e);
  }
  try {
    await ensureScoreSchema();
  } catch (e) {
    console.warn(
      "Nao foi possivel garantir colunas de diagnostico de score no startup:",
      e,
    );
  }
  app.listen(PORT, () => console.log(`Backend up on :${PORT}`));
}

bootstrap();
