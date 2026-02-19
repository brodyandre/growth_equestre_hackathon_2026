import express from "express";
import fetch from "node-fetch";
import { query } from "./db.js";

const router = express.Router();

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// GET /api/v1/leads/export
// Retorna todos os leads com score para uso na demo / exportação
// ---------------------------------------------------------------------------
router.get("/api/v1/leads/export", async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, nome, whatsapp, email, uf, cidade,
              segmento_interesse, orcamento_faixa, prazo_compra,
              status, score, crm_stage,
              score_engine, score_model_name, score_probability,
              next_action_text, next_action_date, next_action_time,
              created_at, updated_at
         FROM leads
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT 1000`
    );
    res.json({ ok: true, total: rows.length, leads: rows });
  } catch (e) {
    console.error("[output_routes] /api/v1/leads/export", e);
    res.status(500).json({ error: "Erro ao exportar leads", details: String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/report/summary
// Contadores por status, etapa, segmento e score médio
// ---------------------------------------------------------------------------
router.get("/api/v1/report/summary", async (_req, res) => {
  try {
    const [byStatus, byStage, bySegment, scoreStats] = await Promise.all([
      query(
        `SELECT COALESCE(status, 'SEM_STATUS') AS label, COUNT(*) AS total
           FROM leads GROUP BY status ORDER BY total DESC`
      ),
      query(
        `SELECT COALESCE(crm_stage, 'INBOX') AS label, COUNT(*) AS total
           FROM leads GROUP BY crm_stage ORDER BY total DESC`
      ),
      query(
        `SELECT COALESCE(segmento_interesse, 'NÃO INFORMADO') AS label, COUNT(*) AS total
           FROM leads GROUP BY segmento_interesse ORDER BY total DESC`
      ),
      query(
        `SELECT COUNT(*) AS total_leads,
                ROUND(AVG(score)::numeric, 1) AS avg_score,
                MAX(score) AS max_score,
                MIN(score) AS min_score,
                COUNT(*) FILTER (WHERE score >= 70) AS qualificados,
                COUNT(*) FILTER (WHERE score >= 40 AND score < 70) AS aquecendo,
                COUNT(*) FILTER (WHERE score < 40 OR score IS NULL) AS curiosos
           FROM leads`
      ),
    ]);

    res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      totals: scoreStats.rows[0] || {},
      by_status: byStatus.rows,
      by_stage: byStage.rows,
      by_segment: bySegment.rows,
    });
  } catch (e) {
    console.error("[output_routes] /api/v1/report/summary", e);
    res.status(500).json({ error: "Erro ao gerar relatório", details: String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /demo/seed-full
// Popula banco com leads sintéticos para reset de demo ao vivo
// ---------------------------------------------------------------------------
const SEED_LEADS = [
  { nome: "Carlos Mendonça", whatsapp: "11999990001", email: "carlos@haras.com.br", uf: "SP", cidade: "Campinas", segmento_interesse: "CAVALO", orcamento_faixa: "ACIMA R$200K", prazo_compra: "IMEDIATO" },
  { nome: "Fernanda Rocha", whatsapp: "21988880002", email: "fernanda@equitacao.com", uf: "RJ", cidade: "Petrópolis", segmento_interesse: "EQUITACAO", orcamento_faixa: "R$50K-200K", prazo_compra: "3-6 MESES" },
  { nome: "Ricardo Alves", whatsapp: "31977770003", email: null, uf: "MG", cidade: "Belo Horizonte", segmento_interesse: "POLO", orcamento_faixa: "ATÉ R$50K", prazo_compra: "6-12 MESES" },
  { nome: "Mariana Souza", whatsapp: "41966660004", email: "mariana@polo.com.br", uf: "PR", cidade: "Curitiba", segmento_interesse: "POLO", orcamento_faixa: "ACIMA R$200K", prazo_compra: "IMEDIATO" },
  { nome: "João Figueiredo", whatsapp: "51955550005", email: "joao@gaucheria.com", uf: "RS", cidade: "Porto Alegre", segmento_interesse: "CAVALO", orcamento_faixa: "R$50K-200K", prazo_compra: "3-6 MESES" },
  { nome: "Ana Beatriz Lima", whatsapp: "62944440006", email: null, uf: "GO", cidade: "Goiânia", segmento_interesse: "EQUITACAO", orcamento_faixa: "ATÉ R$50K", prazo_compra: "6-12 MESES" },
  { nome: "Pedro Cavalcante", whatsapp: "81933330007", email: "pedro@nordeste.com", uf: "PE", cidade: "Recife", segmento_interesse: "CAVALO", orcamento_faixa: "R$50K-200K", prazo_compra: "IMEDIATO" },
  { nome: "Luiza Teixeira", whatsapp: "48922220008", email: "luiza@hipismo.com", uf: "SC", cidade: "Florianópolis", segmento_interesse: "EQUITACAO", orcamento_faixa: "ACIMA R$200K", prazo_compra: "3-6 MESES" },
  { nome: "Bruno Silveira", whatsapp: "61911110009", email: null, uf: "DF", cidade: "Brasília", segmento_interesse: "POLO", orcamento_faixa: "ATÉ R$50K", prazo_compra: "6-12 MESES" },
  { nome: "Camila Nunes", whatsapp: "71900000010", email: "camila@bahia.com", uf: "BA", cidade: "Salvador", segmento_interesse: "CAVALO", orcamento_faixa: "ACIMA R$200K", prazo_compra: "IMEDIATO" },
];

const SEED_EVENTS = [
  ["whatsapp_reply", "asked_price", "meeting_attended", "budget_confirmed", "timeline_confirmed", "need_confirmed"],
  ["whatsapp_reply", "asked_price", "meeting_scheduled"],
  ["whatsapp_reply"],
  ["whatsapp_reply", "asked_price", "proposal_click", "meeting_attended", "budget_confirmed", "timeline_confirmed", "need_confirmed", "proposal_requested"],
  ["whatsapp_reply", "asked_price", "followup_positive"],
  ["whatsapp_reply"],
  ["whatsapp_reply", "asked_price", "meeting_scheduled", "meeting_attended"],
  ["whatsapp_reply", "asked_price", "proposal_click", "budget_confirmed", "need_confirmed"],
  ["whatsapp_reply", "no_reply_3d"],
  ["whatsapp_reply", "asked_price", "meeting_attended", "proposal_requested", "sent_documents"],
];

router.post("/demo/seed-full", async (_req, res) => {
  try {
    const created = [];

    for (let i = 0; i < SEED_LEADS.length; i++) {
      const lead = SEED_LEADS[i];

      // Inserir lead
      const { rows } = await query(
        `INSERT INTO leads (nome, whatsapp, email, uf, cidade, segmento_interesse, orcamento_faixa, prazo_compra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [lead.nome, lead.whatsapp, lead.email, lead.uf, lead.cidade,
         lead.segmento_interesse, lead.orcamento_faixa, lead.prazo_compra]
      );
      const leadId = rows[0].id;

      // Inserir eventos
      const events = SEED_EVENTS[i] || [];
      for (const eventType of events) {
        await query(
          `INSERT INTO events (lead_id, event_type, metadata) VALUES ($1, $2, $3)`,
          [leadId, eventType, JSON.stringify({ source: "seed-full" })]
        );
      }

      // Acionar scoring via fetch interno
      try {
        await fetch(`http://localhost:${PORT}/leads/${leadId}/score`, { method: "POST" });
      } catch (_scoreErr) {
        // scoring pode falhar se o serviço ainda está subindo — não bloqueia
      }

      created.push({ id: leadId, nome: lead.nome, events: events.length });
    }

    res.json({
      ok: true,
      message: `${created.length} leads sintéticos inseridos com sucesso.`,
      leads: created,
    });
  } catch (e) {
    console.error("[output_routes] /demo/seed-full", e);
    res.status(500).json({ error: "Erro no seed-full", details: String(e) });
  }
});

export default router;
