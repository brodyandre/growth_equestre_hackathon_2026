import pg from "pg";
import fs from "node:fs";

const DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/growth_equestre";
const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function init() {
  try {
    const sql = fs.readFileSync("../db/init.sql", "utf-8");
    console.log("Executando init.sql...");
    await pool.query(sql);
    console.log("Tabelas base criadas com sucesso!");

    console.log("Adicionando colunas de CRM e Score...");
    await pool.query(`
      ALTER TABLE leads 
      ADD COLUMN IF NOT EXISTS crm_stage text DEFAULT 'INBOX',
      ADD COLUMN IF NOT EXISTS next_action_text text,
      ADD COLUMN IF NOT EXISTS next_action_date date,
      ADD COLUMN IF NOT EXISTS next_action_time time,
      ADD COLUMN IF NOT EXISTS next_action_at timestamptz,
      ADD COLUMN IF NOT EXISTS score_engine text,
      ADD COLUMN IF NOT EXISTS score_model_name text,
      ADD COLUMN IF NOT EXISTS score_probability double precision,
      ADD COLUMN IF NOT EXISTS score_scored_at timestamptz,
      ADD COLUMN IF NOT EXISTS score_meta jsonb;
    `);

    await pool.query(`
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

    console.log("Estrutura completa preparada!");
  } catch (err) {
    console.error("Erro ao inicializar banco:", err);
  } finally {
    await pool.end();
  }
}

init();
