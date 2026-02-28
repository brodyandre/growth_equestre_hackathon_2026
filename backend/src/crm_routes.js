import express from "express";
import fs from "fs";
import { query } from "./db.js";

const router = express.Router();

/**
 * Helpers
 */
const STAGES = ["INBOX", "AQUECENDO", "QUALIFICADO", "ENVIADO"];

// status -> stage (keep this mapping stable; do not delete existing values)
function mapStatusToStage(status) {
  const s = String(status || "").toUpperCase().trim();
  if (s === "ENVIADO") return "ENVIADO";
  if (s === "QUALIFICADO") return "QUALIFICADO";
  if (s === "AQUECENDO") return "AQUECENDO";
  // "CURIOSO" e outros entram como INBOX (primeiro estágio)
  return "INBOX";
}

function normalizeText(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeHeader(h) {
  const s = normalizeText(h);
  return String(s || "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toStageSafe(v) {
  const s = String(v || "").toUpperCase().trim();
  return STAGES.includes(s) ? s : "";
}

/**
 * Handler padrão para evitar crash e responder com erro consistente.
 */
function asyncHandler(fn) {
  return (req, res) =>
    Promise.resolve(fn(req, res)).catch((e) => {
      console.error(e);
      res.status(500).json({ error: "Erro interno no servidor", details: String(e) });
    });
}

/**
 * CRM schema / bootstrap helpers
 */
async function ensureCrmSchema() {
  await query(`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS crm_stage text,
      ADD COLUMN IF NOT EXISTS crm_position int,
      ADD COLUMN IF NOT EXISTS crm_notes text,
      ADD COLUMN IF NOT EXISTS crm_updated_at timestamptz
  `);
}

async function resyncStagesForUntouchedLeads() {
  // Regras:
  // - Só ajusta se o lead nunca foi movido no Kanban (crm_updated_at IS NULL)
  // - Se stage estiver vazio/inválido OU estiver INBOX mas o status indicar outro estágio
  await query(`
    UPDATE leads
       SET crm_stage = CASE
             WHEN upper(coalesce(status,'')) = 'ENVIADO' THEN 'ENVIADO'
             WHEN upper(coalesce(status,'')) = 'QUALIFICADO' THEN 'QUALIFICADO'
             WHEN upper(coalesce(status,'')) = 'AQUECENDO' THEN 'AQUECENDO'
             ELSE 'INBOX'
           END
     WHERE crm_updated_at IS NULL
       AND (
            crm_stage IS NULL
         OR upper(trim(crm_stage)) NOT IN ('INBOX','AQUECENDO','QUALIFICADO','ENVIADO')
         OR (
              upper(trim(crm_stage)) = 'INBOX'
          AND upper(coalesce(status,'')) IN ('ENVIADO','QUALIFICADO','AQUECENDO')
            )
       )
  `);
}

/**
 * CRM: seed board (sync stages from lead.status)
 * POST /crm/seed?force=1
 * - force=1: sobrescreve crm_stage/crm_position de todos os leads (útil para "consertar" bases antigas)
 * - sem force: só preenche crm_stage/crm_position quando estiverem NULL
 */
router.post(
  "/seed",
  asyncHandler(async (req, res) => {
    await ensureCrmSchema();

    const force = String(req.query.force || "").trim() === "1";
    const leadsR = await query("SELECT id, status, created_at FROM leads ORDER BY created_at DESC");
    let position = 0;

    for (const row of leadsR.rows) {
      const stage = mapStatusToStage(row.status);
      position += 1;

      if (force) {
        await query(
          `
          UPDATE leads
             SET crm_stage = $1,
                 crm_position = $2,
                 crm_updated_at = COALESCE(crm_updated_at, now())
           WHERE id = $3
          `,
          [stage, position, row.id]
        );
      } else {
        await query(
          `
          UPDATE leads
             SET crm_stage = COALESCE(crm_stage, $1),
                 crm_position = COALESCE(crm_position, $2),
                 crm_updated_at = COALESCE(crm_updated_at, now())
           WHERE id = $3
          `,
          [stage, position, row.id]
        );
      }
    }

    res.json({ ok: true, seeded: leadsR.rows.length, force });
  })
);

/**
 * CRM: get board
 */
router.get(
  "/board",
  asyncHandler(async (_req, res) => {
    await ensureCrmSchema();

    // mantém o board coerente (sem quebrar movimentos manuais)
    await resyncStagesForUntouchedLeads();

    const r = await query(
      `
      SELECT *
        FROM leads
       ORDER BY COALESCE(crm_position, 999999) ASC, updated_at DESC
      `
    );

    // normalize to a simple list of items
    const items = (r.rows || []).map((lead) => {
      const stored = toStageSafe(lead.crm_stage);
      const fromStatus = mapStatusToStage(lead.status);
      const stageFinal =
        fromStatus === "ENVIADO"
          ? "ENVIADO"
          : stored ||
            fromStatus;

      return {
        ...lead,
        lead_id: lead.id,
        // IMPORTANTE: a UI usa "crm_stage" para agrupar colunas.
        // Então devolvemos crm_stage já normalizado.
        crm_stage: stageFinal,
        stage: stageFinal,
        position: lead.crm_position ?? null,
        notes: lead.crm_notes ?? null,
        updated_at: lead.crm_updated_at ?? lead.updated_at ?? lead.created_at,
      };
    });

    res.json({ items });
  })
);

/**
 * CRM: move lead
 * POST /crm/move { lead_id, stage }
 */
router.post(
  "/move",
  asyncHandler(async (req, res) => {
    await ensureCrmSchema();

    const leadId = req.body?.lead_id;
    const stageRaw = req.body?.stage;

    if (!leadId) return res.status(400).json({ error: "lead_id obrigatório" });

    const stage = String(stageRaw || "").toUpperCase().trim();
    if (!STAGES.includes(stage)) {
      return res.status(400).json({ error: `stage inválido. Use: ${STAGES.join(", ")}` });
    }

    // keep stable ordering by pushing moved items to the end
    const maxPosR = await query("SELECT COALESCE(MAX(crm_position), 0) AS max FROM leads");
    const maxPos = Number(maxPosR.rows?.[0]?.max ?? 0);

    await query(
      `
      UPDATE leads
         SET crm_stage=$1,
             crm_position=$2,
             crm_updated_at=now()
       WHERE id=$3
      `,
      [stage, maxPos + 1, leadId]
    );

    res.json({ ok: true, lead_id: leadId, stage });
  })
);

/**
 * CRM: notes
 * GET  /crm/leads/:id/notes
 * POST /crm/leads/:id/notes { note/notes }
 */
router.get(
  "/leads/:id/notes",
  asyncHandler(async (req, res) => {
    await ensureCrmSchema();
    const leadId = req.params.id;

    const r = await query("SELECT crm_notes, crm_updated_at FROM leads WHERE id=$1", [leadId]);
    if (r.rows.length === 0) return res.status(404).json({ error: "Lead não encontrado" });

    const note = r.rows[0].crm_notes;
    const when = r.rows[0].crm_updated_at;

    if (!note) return res.json({ notes: [] });
    res.json({ notes: [{ note, created_at: when }] });
  })
);

router.post(
  "/leads/:id/notes",
  asyncHandler(async (req, res) => {
    await ensureCrmSchema();
    const leadId = req.params.id;
    const note = String(req.body?.note ?? req.body?.notes ?? "").trim();

    if (!note) return res.status(400).json({ error: "Nota vazia" });

    await query(
      `
      UPDATE leads
         SET crm_notes = CASE
               WHEN crm_notes IS NULL OR crm_notes = '' THEN $1
               ELSE crm_notes || E'\n' || $1
             END,
             crm_updated_at = now()
       WHERE id=$2
      `,
      [note, leadId]
    );

    res.json({ ok: true });
  })
);

/**
 * -------------------------
 * Partners: loader (CSV/DB)
 * -------------------------
 *
 * Tenta carregar parceiros a partir de:
 * - CSV em PARTNERS_CSV_PATH (se existir)
 * - fallback DB: tabela partners (se existir)
 *
 * Estrutura esperada por UI:
 * - uf
 * - segmento
 * - nome_fantasia / razao_social / contato / cnae...
 */

let partnersCsvCache = null;
let partnersCsvCacheAt = 0;

function splitCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  const s = String(line ?? "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === '"') {
      // escape "" dentro de campo com aspas
      if (inQuotes && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map((v) => String(v ?? "").trim());
}

function parseCsv(content) {
  // Remove BOM e linhas vazias
  const text = String(content || "").replace(/^\uFEFF/, "");
  const rawLines = text.split(/\r?\n/);

  const lines = rawLines
    .map((l) => String(l ?? "").trimEnd())
    .filter((l) => l.trim() !== "");

  if (lines.length < 2) return [];

  // Detecta delimitador a partir do header (prioriza o que aparece mais)
  const headerLine = lines[0];
  const semi = (headerLine.match(/;/g) || []).length;
  const comma = (headerLine.match(/,/g) || []).length;
  const delim = semi >= comma ? ";" : ",";

  const rawHeader = splitCsvLine(headerLine, delim);
  const header = rawHeader.map((h, idx) => normalizeHeader(h || `col_${idx + 1}`));

  // garante headers únicos
  const seen = {};
  const uniqHeader = header.map((h, idx) => {
    const base = h || `col_${idx + 1}`;
    const n = (seen[base] = (seen[base] || 0) + 1);
    return n === 1 ? base : `${base}_${n}`;
  });

  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line, delim);
    if (!cols.length || cols.every((c) => String(c).trim() === "")) continue;

    const obj = {};
    for (let i = 0; i < uniqHeader.length; i++) {
      obj[uniqHeader[i]] = (cols[i] ?? "").trim();
    }
    rows.push(obj);
  }
  return rows;
}

async function loadPartnersFromCsvOrDb() {
  const ttlMs = 15_000; // cache curto (evita travar UI em reruns)
  if (partnersCsvCache && Date.now() - partnersCsvCacheAt < ttlMs) {
    return partnersCsvCache;
  }

  // 1) CSV
  const csvPath = process.env.PARTNERS_CSV_PATH;
  if (csvPath && fs.existsSync(csvPath)) {
    const content = fs.readFileSync(csvPath, "utf-8");
    const parsed = parseCsv(content);

    const pickFirst = (obj, keys) => {
      for (const k of keys) {
        if (!k) continue;
        const v = obj?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return v;
      }
      return "";
    };

    const toNumOrNull = (v) => {
      const raw = String(v ?? "").trim();
      if (!raw) return null;
      const n = Number(raw.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };

    const normalized = parsed.map((p, idx) => {
      const cnpj = String(
        pickFirst(p, ["cnpj", "cnpj_basico", "cnpj_raiz", "cnpj_completo", "cnpj_numero", "documento"])
      ).trim();

      const nome_fantasia = String(
        pickFirst(p, ["nome_fantasia", "nomefantasia", "fantasia", "nome", "nome_empresa", "nome_loja"])
      ).trim();

      const razao_social = String(
        pickFirst(p, ["razao_social", "razao", "nome_razao_social", "razao_social_empresa"])
      ).trim();

      const uf = String(pickFirst(p, ["uf", "estado", "sigla_uf"]))
        .trim()
        .toUpperCase();

      const cidade = String(
        pickFirst(p, ["municipio", "municipio_nome", "nome_municipio", "municipio_name", "cidade", "municipio_nome_ibge"])
      ).trim();

      const segmento = String(
        pickFirst(p, ["segmento", "segment", "segmento_interesse", "segmento_de_atuacao", "segmento_interesse_1"])
      )
        .trim()
        .toUpperCase();

      const prioridade = toNumOrNull(pickFirst(p, ["prioridade", "priority", "rank", "score_prioridade"]));

      const cnae = String(
        pickFirst(p, ["cnae", "cnae_principal", "cnae_fiscal", "cnae_subclasse", "cnae_classe"])
      ).trim();

      const contato = String(
        pickFirst(p, ["contato", "telefone", "tel", "email", "whatsapp", "celular", "contato_principal"])
      ).trim();

      // cria id estável (para tabela/UI) quando não existir
      const id = String(pickFirst(p, ["id", "uuid"])).trim() || `${cnpj || "p"}_${uf || "UF"}_${idx + 1}`;

      return {
        id,
        cnpj,
        razao_social,
        nome_fantasia,
        uf,
        cidade,
        municipio: cidade, // alias útil para UI
        segmento,
        prioridade,
        cnae,
        contato,
      };
    });

    partnersCsvCache = normalized;
    partnersCsvCacheAt = Date.now();
    return normalized;
  }

  // 2) DB fallback
  try {
    const r = await query(
      "SELECT * FROM partners ORDER BY prioridade ASC NULLS LAST, nome_fantasia ASC NULLS LAST LIMIT 5000"
    );
    const rows = (r.rows || []).map((p) => ({
      ...p,
      uf: String(p.uf || "").toUpperCase(),
      segmento: String(p.segmento || "").toUpperCase(),
      cidade: p.cidade || p.municipio || p.municipio_nome || p.municipioName || null,
      municipio: p.municipio || p.municipio_nome || p.cidade || null,
      cnae: p.cnae || p.cnae_principal || null,
    }));
    partnersCsvCache = rows;
    partnersCsvCacheAt = Date.now();
    return rows;
  } catch (e) {
    console.warn("Não foi possível carregar parceiros (CSV/DB).", e);
    partnersCsvCache = [];
    partnersCsvCacheAt = Date.now();
    return [];
  }
}

// -------------------------------------------------------
// PARTNERS (CSV/DB) — rotas para UI do Admin
// -------------------------------------------------------

/**
 * GET /crm/partners
 * Retorna lista simples (array) para compatibilidade com a UI (main.py).
 * Query: uf, segment (ou segmento), q, limit
 */
router.get(
  "/partners",
  asyncHandler(async (req, res) => {
    const { uf, q } = req.query;
    const segment = req.query.segment ?? req.query.segmento;
    const limitRaw = Number(req.query.limit ?? 500);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 500;

    let partners = await loadPartnersFromCsvOrDb();
    if (!Array.isArray(partners)) partners = [];

    const ufNorm = uf ? String(uf).trim().toUpperCase() : "";
    const segNorm = segment ? String(segment).trim().toUpperCase() : "";
    const qNorm = q ? String(q).trim().toLowerCase() : "";

    if (ufNorm) partners = partners.filter((p) => String(p.uf || "").trim().toUpperCase() === ufNorm);
    if (segNorm) partners = partners.filter((p) => String(p.segmento || p.segment || "").trim().toUpperCase() === segNorm);

    if (qNorm) {
      partners = partners.filter((p) => {
        const nome = String(p.nome_fantasia || p.nome || "").toLowerCase();
        const razao = String(p.razao_social || "").toLowerCase();
        return nome.includes(qNorm) || razao.includes(qNorm);
      });
    }

    // Ordenação: prioridade asc (quando existir), depois nome_fantasia
    partners.sort((a, b) => {
      const pa = Number.isFinite(Number(a.prioridade)) ? Number(a.prioridade) : 999;
      const pb = Number.isFinite(Number(b.prioridade)) ? Number(b.prioridade) : 999;
      if (pa !== pb) return pa - pb;
      const na = String(a.nome_fantasia || a.nome || "").toLowerCase();
      const nb = String(b.nome_fantasia || b.nome || "").toLowerCase();
      return na.localeCompare(nb);
    });

    res.json(partners.slice(0, limit));
  })
);

/**
 * GET /crm/partners/list
 * Retorna { count, items } (mantido para compatibilidade com versões antigas).
 * Query: uf, segment (ou segmento), q, limit
 */
router.get(
  "/partners/list",
  asyncHandler(async (req, res) => {
    const { uf, q } = req.query;
    const segment = req.query.segment ?? req.query.segmento;
    const limitRaw = Number(req.query.limit ?? 500);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 500;

    let partners = await loadPartnersFromCsvOrDb();
    if (!Array.isArray(partners)) partners = [];

    const ufNorm = uf ? String(uf).trim().toUpperCase() : "";
    const segNorm = segment ? String(segment).trim().toUpperCase() : "";
    const qNorm = q ? String(q).trim().toLowerCase() : "";

    if (ufNorm) partners = partners.filter((p) => String(p.uf || "").trim().toUpperCase() === ufNorm);
    if (segNorm) partners = partners.filter((p) => String(p.segmento || p.segment || "").trim().toUpperCase() === segNorm);

    if (qNorm) {
      partners = partners.filter((p) => {
        const nome = String(p.nome_fantasia || p.nome || "").toLowerCase();
        const razao = String(p.razao_social || "").toLowerCase();
        return nome.includes(qNorm) || razao.includes(qNorm);
      });
    }

    // Ordenação: prioridade asc (quando existir), depois nome_fantasia
    partners.sort((a, b) => {
      const pa = Number.isFinite(Number(a.prioridade)) ? Number(a.prioridade) : 999;
      const pb = Number.isFinite(Number(b.prioridade)) ? Number(b.prioridade) : 999;
      if (pa !== pb) return pa - pb;
      const na = String(a.nome_fantasia || a.nome || "").toLowerCase();
      const nb = String(b.nome_fantasia || b.nome || "").toLowerCase();
      return na.localeCompare(nb);
    });

    res.json({ count: partners.length, items: partners.slice(0, limit) });
  })
);

/**
 * GET /crm/partners/summary
 * Retorna lista no formato:
 *   [{ segmento: "CAVALOS", total: 12 }, ...]
 * Query: uf
 */
router.get(
  "/partners/summary",
  asyncHandler(async (req, res) => {
    const { uf } = req.query;

    let partners = await loadPartnersFromCsvOrDb();
    if (!Array.isArray(partners)) partners = [];

    const ufNorm = uf ? String(uf).trim().toUpperCase() : "";
    if (ufNorm) partners = partners.filter((p) => String(p.uf || "").trim().toUpperCase() === ufNorm);

    const counts = new Map();
    for (const p of partners) {
      const seg = String(p.segmento || p.segment || "").trim().toUpperCase() || "—";
      counts.set(seg, (counts.get(seg) || 0) + 1);
    }

    const out = Array.from(counts.entries())
      .map(([segmento, total]) => ({ segmento, total }))
      .sort((a, b) => b.total - a.total);

    res.json(out);
  })
);

/**
 * -----------------------------------
 * Matching: /crm/leads/:id/matches
 * -----------------------------------
 *
 * Retorna ranking simples de parceiros para um lead.
 * Query: limit/top (default 8)
 *
 * Importante:
 * - A UI do Streamlit espera receber um JSON com "items" (array) ou um array diretamente.
 * - Quando o lead existe, a rota retorna 200 com items, mesmo se vazio.
 * - Quando o lead não existe, retorna 404.
 */
router.get(
  "/leads/:id/matches",
  asyncHandler(async (req, res) => {
    const leadId = req.params.id;
    const rawLimit = parseInt(String(req.query.limit || req.query.top || "8"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 8;

    // 1) Busca lead (critério de matching)
    const leadQ = await query(
      `
      SELECT id, nome, uf, cidade, segmento_interesse
      FROM leads
      WHERE id = $1
      `,
      [leadId]
    );

    if (leadQ.rowCount === 0) return res.status(404).json({ error: "Lead não encontrado" });

    const lead = leadQ.rows[0];
    const uf = String(lead.uf || "").trim().toUpperCase();
    const cidade = String(lead.cidade || "").trim();
    const segmento = String(lead.segmento_interesse || "").trim().toUpperCase();

    // 2) Carrega parceiros (CSV/DB)
    let partners = await loadPartnersFromCsvOrDb();
    if (!Array.isArray(partners) || partners.length === 0) {
      return res.json({
        lead_id: leadId,
        criteria: { uf, cidade, segmento },
        items: [],
        note: "partners_empty",
      });
    }

    const cidadeNorm = normalizeText(cidade);
    const ufNorm = String(uf || "").toUpperCase();
    const segNorm = String(segmento || "").toUpperCase();

    if (!segNorm) {
      return res.json({
        lead_id: leadId,
        criteria: { uf, cidade, segmento },
        items: [],
        note: "lead_without_segmento",
      });
    }

    // 3) Matching simples (segmento obrigatório, desempate por UF/cidade/prioridade)
    const scored = partners
      .map((p) => {
        const pSeg = String(p.segmento || p.segment || "").trim().toUpperCase();
        if (pSeg !== segNorm) return null;

        const pUf = String(p.uf || "").trim().toUpperCase();
        const pCidade = String(p.cidade || p.municipio || p.municipio_nome || "").trim();

        let tier = 1; // segmento bate
        if (pUf && ufNorm && pUf === ufNorm) tier = 2;
        if (tier === 2 && cidadeNorm && normalizeText(pCidade) === cidadeNorm) tier = 3;

        const pr = Number.isFinite(Number(p.prioridade)) ? Number(p.prioridade) : 999;

        return {
          ...p,
          uf: pUf || p.uf || "",
          cidade: pCidade || p.cidade || p.municipio || "",
          segmento: pSeg || p.segmento || "",
          prioridade: Number.isFinite(Number(p.prioridade)) ? Number(p.prioridade) : null,
          match_tier: tier,
          _sort_pr: pr,
          _sort_name: normalizeText(p.nome_fantasia || p.nome || p.razao_social || ""),
        };
      })
      .filter(Boolean);

    scored.sort((a, b) => {
      if (a.match_tier !== b.match_tier) return b.match_tier - a.match_tier;
      if (a._sort_pr !== b._sort_pr) return a._sort_pr - b._sort_pr;
      return a._sort_name.localeCompare(b._sort_name);
    });

    const items = scored.slice(0, limit).map((m) => {
      // remove campos auxiliares de ordenação
      const { _sort_pr, _sort_name, ...rest } = m;
      return rest;
    });

    return res.json({
      lead_id: leadId,
      criteria: { uf, cidade, segmento },
      items,
    });
  })
);

export default router;
