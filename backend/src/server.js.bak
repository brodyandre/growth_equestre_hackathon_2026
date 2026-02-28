import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import { parse as parseCsv } from "csv-parse/sync";
import { query } from "./db.js";
import fs from "node:fs/promises";
import path from "node:path";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;
const SCORING_URL = process.env.SCORING_URL || "http://scoring:8000";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const PARTNER_FIELD_ALIASES = {
  cnpj: ["cnpj"],
  uf: ["uf"],
  razao_social: ["razao_social"],
  nome_fantasia: ["nome_fantasia"],
  municipio_cod: ["municipio_cod", "cod_municipio", "codigo_municipio"],
  municipio_nome: ["municipio_nome", "municipio"],
  cnae_principal: ["cnae_principal"],
  segmento: ["segmento"],
  prioridade: ["prioridade"],
  situacao_cadastral: ["situacao_cadastral"],
  data_inicio_atividade: ["data_inicio_atividade"],
  cnaes_secundarios: ["cnaes_secundarios", "cnae_secundarios"],
};

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

function normalizeHeaderKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function detectCsvDelimiter(content) {
  const firstLine = String(content ?? "")
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);

  const semicolons = (firstLine?.match(/;/g) || []).length;
  const commas = (firstLine?.match(/,/g) || []).length;

  return semicolons > commas ? ";" : ",";
}

function getCsvField(row, fieldName) {
  const aliases = PARTNER_FIELD_ALIASES[fieldName] || [fieldName];
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) {
      return row[alias];
    }
  }
  return undefined;
}

function hasCsvColumn(headers, fieldName) {
  const aliases = PARTNER_FIELD_ALIASES[fieldName] || [fieldName];
  return aliases.some((alias) => headers.has(alias));
}

function toNullableText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function parseOptionalInteger(value, fieldName) {
  const text = toNullableText(value);
  if (text === null) return null;
  if (!/^-?\d+$/.test(text)) {
    throw new Error(`Campo ${fieldName} inválido`);
  }
  return Number(text);
}

function parseOptionalDate(value) {
  const text = toNullableText(value);
  if (text === null) return null;

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  // dd/mm/yyyy -> yyyy-mm-dd
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
    const [day, month, year] = text.split("/");
    return `${year}-${month}-${day}`;
  }

  throw new Error("Campo data_inicio_atividade inválido (use YYYY-MM-DD ou DD/MM/YYYY)");
}

function parseCnaesSecundarios(value) {
  const text = toNullableText(value);
  if (text === null) return null;

  const items = text
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length ? items : null;
}

function normalizeSegmento(value) {
  const v = toNullableText(value);
  return v ? v.toUpperCase() : null;
}

function parsePartnerCsvRow(row) {
  const cnpj = onlyDigits(getCsvField(row, "cnpj"));
  if (!cnpj) {
    throw new Error("Campo cnpj obrigatório");
  }

  const ufRaw = toNullableText(getCsvField(row, "uf"));
  const uf = ufRaw ? ufRaw.toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(uf)) {
    throw new Error("Campo uf inválido (use 2 letras)");
  }

  // prioridade default=2 quando vier vazio/ausente
  const prioridadeParsed = parseOptionalInteger(getCsvField(row, "prioridade"), "prioridade");
  const prioridade = prioridadeParsed ?? 2;

  return {
    cnpj,
    uf,
    razao_social: toNullableText(getCsvField(row, "razao_social")),
    nome_fantasia: toNullableText(getCsvField(row, "nome_fantasia")),
    municipio_cod: parseOptionalInteger(getCsvField(row, "municipio_cod"), "municipio_cod"),
    municipio_nome: toNullableText(getCsvField(row, "municipio_nome")),
    cnae_principal: toNullableText(getCsvField(row, "cnae_principal")),
    segmento: normalizeSegmento(getCsvField(row, "segmento")),
    prioridade,
    situacao_cadastral: parseOptionalInteger(
      getCsvField(row, "situacao_cadastral"),
      "situacao_cadastral"
    ),
    data_inicio_atividade: parseOptionalDate(getCsvField(row, "data_inicio_atividade")),
    cnaes_secundarios: parseCnaesSecundarios(getCsvField(row, "cnaes_secundarios")),
  };
}

/**
 * Middleware: só aplica multer quando a requisição for multipart/form-data.
 * Evita erro quando a UI manda POST sem arquivo/sem boundary.
 */
function maybeMulterSingle(fieldName) {
  return (req, res, next) => {
    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("multipart/form-data")) return next();
    upload.single(fieldName)(req, res, (err) => {
      if (err)
        return res.status(400).json({
          inserted: 0,
          updated: 0,
          skipped: 0,
          errors: [{ row: null, error: `Falha no upload: ${err.message}` }],
        });
      next();
    });
  };
}

async function readPartnersCsvFromDisk() {
  const tried_paths = [];
  const candidates = [];

  if (process.env.PARTNERS_CSV_PATH) candidates.push(process.env.PARTNERS_CSV_PATH);
  candidates.push(path.resolve(process.cwd(), "data", "partners_demo.csv"));
  candidates.push("/app/data/partners_demo.csv");

  for (const csvPath of candidates) {
    tried_paths.push(csvPath);
    try {
      const csvContent = await fs.readFile(csvPath, "utf-8");
      return { csvContent, csvPath, tried_paths };
    } catch {
      // tenta o proximo caminho
    }
  }

  return { csvContent: null, csvPath: null, tried_paths };
}

app.get(
  "/health",
  asyncHandler(async (_req, res) => {
    try {
      await query("SELECT 1");
      res.json({ status: "UP" });
    } catch (e) {
      res.status(500).json({ status: "DOWN", error: String(e) });
    }
  })
);

// -----------------------------
// LEADS
// -----------------------------
app.post(
  "/leads",
  asyncHandler(async (req, res) => {
    const { nome, whatsapp, email, uf, cidade, segmento_interesse, orcamento_faixa, prazo_compra } =
      req.body || {};

    if (!nome || !segmento_interesse) {
      return res.status(400).json({ error: "Campos obrigatórios: nome, segmento_interesse" });
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
        segmento_interesse,
        orcamento_faixa || null,
        prazo_compra || null,
      ]
    );

    res.json(r.rows[0]);
  })
);

app.post(
  "/events",
  asyncHandler(async (req, res) => {
    const { lead_id, event_type, metadata } = req.body || {};
    if (!lead_id || !event_type) {
      return res.status(400).json({ error: "Campos obrigatórios: lead_id, event_type" });
    }

    const r = await query(
      `INSERT INTO events (lead_id, event_type, metadata)
       VALUES ($1,$2,$3) RETURNING *`,
      [lead_id, event_type, metadata ? JSON.stringify(metadata) : null]
    );

    res.json(r.rows[0]);
  })
);

app.post(
  "/leads/:id/score",
  asyncHandler(async (req, res) => {
    const leadId = req.params.id;

    const leadR = await query("SELECT * FROM leads WHERE id=$1", [leadId]);
    if (leadR.rows.length === 0) return res.status(404).json({ error: "Lead não encontrado" });

    const eventsR = await query(
      "SELECT event_type, ts, metadata FROM events WHERE lead_id=$1 ORDER BY ts ASC",
      [leadId]
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

    await query(
      `UPDATE leads
       SET score=$1, status=$2, score_motivos=$3, updated_at=now()
       WHERE id=$4`,
      [scored.score, scored.status, JSON.stringify(scored.motivos || []), leadId]
    );

    res.json(scored);
  })
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
    res.json(r.rows);
  })
);

app.post(
  "/handoff",
  asyncHandler(async (req, res) => {
    const { lead_id, channel } = req.body || {};
    if (!lead_id) return res.status(400).json({ error: "lead_id é obrigatório" });

    await query("UPDATE leads SET status='ENVIADO', updated_at=now() WHERE id=$1", [lead_id]);
    await query("INSERT INTO events (lead_id, event_type, metadata) VALUES ($1,'handoff',$2)", [
      lead_id,
      JSON.stringify({ channel: channel || "manual" }),
    ]);

    res.json({ ok: true });
  })
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
        `(coalesce(nome_fantasia,'') ILIKE $${i} OR coalesce(razao_social,'') ILIKE $${i})`
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
  })
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
      params
    );

    res.json(r.rows);
  })
);

// -----------------------------
// ADMIN — IMPORT PARTNERS (CSV)
// -----------------------------
app.post(
  "/admin/import/partners",
  maybeMulterSingle("file"),
  asyncHandler(async (req, res) => {
    // Fonte do CSV: upload OU arquivo em disco (partners_demo.csv)
    let csvContent = null;
    let source = null;
    let csvPath = null;

    if (req.file?.buffer?.length) {
      csvContent = req.file.buffer.toString("utf-8");
      source = "upload";
    } else {
      const disk = await readPartnersCsvFromDisk();
      if (!disk.csvContent) {
        return res.status(400).json({
          inserted: 0,
          updated: 0,
          skipped: 0,
          errors: [
            {
              row: null,
              error:
                "Arquivo não enviado (multipart/form-data, campo 'file') e partners_demo.csv não encontrado em disco.",
            },
          ],
          hints: {
            upload: "Envie multipart/form-data com o arquivo no campo 'file'.",
            disk: "Monte o CSV via volume e/ou configure PARTNERS_CSV_PATH.",
          },
          tried_paths: disk.tried_paths,
        });
      }
      csvContent = disk.csvContent;
      csvPath = disk.csvPath;
      source = "disk";
    }

    const delimiter = detectCsvDelimiter(csvContent);

    let headers = [];
    let rows = [];

    try {
      // Parse único: captura headers normalizados via callback "columns"
      rows = parseCsv(csvContent, {
        bom: true,
        delimiter,
        trim: true,
        skip_empty_lines: true,
        relax_column_count: true,
        columns: (rawHeaders) => {
          const normalized = rawHeaders.map((h, idx) => normalizeHeaderKey(h) || `col_${idx + 1}`);
          headers = normalized;
          return normalized;
        },
      });
    } catch (e) {
      return res.status(400).json({
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: null, error: `CSV inválido: ${String(e.message || e)}` }],
        source,
        csvPath: csvPath || null,
      });
    }

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: null, error: "CSV sem linhas de dados." }],
        source,
        csvPath: csvPath || null,
      });
    }

    const headerSet = new Set(headers);
    if (!hasCsvColumn(headerSet, "cnpj") || !hasCsvColumn(headerSet, "uf")) {
      return res.status(400).json({
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: null, error: "CSV precisa ter as colunas cnpj e uf." }],
        detected_headers: headers,
        source,
        csvPath: csvPath || null,
      });
    }

    const updatableFields = [
      "razao_social",
      "nome_fantasia",
      "municipio_cod",
      "municipio_nome",
      "cnae_principal",
      "segmento",
      "prioridade",
      "situacao_cadastral",
      "data_inicio_atividade",
      "cnaes_secundarios",
    ];

    // Se a coluna não existir no CSV, preserva o valor atual (partners.campo)
    const updateAssignments = updatableFields.map((field) => {
      const src = hasCsvColumn(headerSet, field) ? `EXCLUDED.${field}` : `partners.${field}`;
      return `${field} = ${src}`;
    });

    const upsertSql = `
      INSERT INTO partners (
        cnpj, uf, razao_social, nome_fantasia, municipio_cod, municipio_nome,
        cnae_principal, segmento, prioridade, situacao_cadastral, data_inicio_atividade,
        cnaes_secundarios
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (cnpj) DO UPDATE
      SET
        uf = EXCLUDED.uf,
        ${updateAssignments.join(",\n        ")},
        updated_at = now()
      RETURNING (xmax = 0) AS inserted;
    `;

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (let index = 0; index < rows.length; index += 1) {
      const rowNumber = index + 2; // 1=header, então dados começam na 2
      const row = rows[index];

      try {
        const partner = parsePartnerCsvRow(row);

        const result = await query(upsertSql, [
          partner.cnpj,
          partner.uf,
          partner.razao_social,
          partner.nome_fantasia,
          partner.municipio_cod,
          partner.municipio_nome,
          partner.cnae_principal,
          partner.segmento,
          partner.prioridade,
          partner.situacao_cadastral,
          partner.data_inicio_atividade,
          partner.cnaes_secundarios,
        ]);

        if (result.rows?.[0]?.inserted) inserted += 1;
        else updated += 1;
      } catch (e) {
        skipped += 1;
        if (errors.length < MAX_IMPORT_ERRORS) {
          errors.push({ row: rowNumber, error: String(e.message || e) });
        }
      }
    }

    res.json({
      inserted,
      updated,
      skipped,
      total: rows.length,
      errors,
      source,
      csvPath: csvPath || null,
    });
  })
);

// -----------------------------
// DEMO — SEED / RESET PARTNERS
// -----------------------------

/**
 * POST /demo/seed-partners
 * Body opcional:
 *  { "n": 160, "replace": false }
 */
app.post(
  "/demo/seed-partners",
  asyncHandler(async (req, res) => {
    const nRaw = Number(req.body?.n ?? 160);
    const replace = Boolean(req.body?.replace ?? false);
    const n = Number.isFinite(nRaw) ? Math.max(1, Math.min(1000, Math.floor(nRaw))) : 160;

    if (replace) {
      await query("TRUNCATE partners RESTART IDENTITY;");
    }

    const sql = `
      INSERT INTO partners
      (cnpj, razao_social, nome_fantasia, uf, municipio_cod, municipio_nome,
       cnae_principal, cnaes_secundarios, segmento, prioridade,
       situacao_cadastral, data_inicio_atividade, contato, endereco)
      SELECT
        lpad((10000000000000::bigint + floor(random()*8999999999999)::bigint)::text, 14, '0') as cnpj,
        ('Parceiro Demo '||g||' LTDA') as razao_social,
        ('Parceiro Demo '||g) as nome_fantasia,

        (CASE (g % 3)
          WHEN 0 THEN 'SP'
          WHEN 1 THEN 'MG'
          ELSE 'GO'
        END)::character(2) as uf,

        NULL::integer as municipio_cod,

        (CASE (g % 3)
          WHEN 0 THEN (ARRAY['São Paulo','Campinas','Ribeirão Preto','Sorocaba','São José do Rio Preto'])[1 + (g % 5)]
          WHEN 1 THEN (ARRAY['Belo Horizonte','Uberlândia','Juiz de Fora','Montes Claros','Contagem'])[1 + (g % 5)]
          ELSE (ARRAY['Goiânia','Anápolis','Rio Verde','Jataí','Aparecida de Goiânia'])[1 + (g % 5)]
        END) as municipio_nome,

        (CASE (g % 4)
          WHEN 0 THEN '0152-1/02'
          WHEN 1 THEN '9313-1/00'
          WHEN 2 THEN '8230-0/01'
          ELSE '4647-8/01'
        END) as cnae_principal,

        NULL::text[] as cnaes_secundarios,

        (CASE (g % 4)
          WHEN 0 THEN 'CAVALOS'
          WHEN 1 THEN 'SERVICOS'
          WHEN 2 THEN 'EVENTOS'
          ELSE 'EQUIPAMENTOS'
        END) as segmento,

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
  })
);

/**
 * POST /demo/reset-partners
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
  })
);

app.listen(PORT, () => console.log(`Backend up on :${PORT}`));



