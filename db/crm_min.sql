-- db/crm_min.sql
-- CRM minimo: Kanban (stage) + notas + proxima acao (next_action)

BEGIN;

-- (opcional) para UUID caso voce queira usar futuramente
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Estado do CRM por lead (1:1)
CREATE TABLE IF NOT EXISTS crm_lead_state (
  lead_id uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'INBOX'
    CHECK (stage IN ('INBOX', 'AQUECENDO', 'QUALIFICADO', 'ENVIADO')),
  position integer NOT NULL DEFAULT 0,
  next_action_text text NULL,
  next_action_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_state_stage
  ON crm_lead_state(stage);

CREATE INDEX IF NOT EXISTS idx_crm_lead_state_next_action_at
  ON crm_lead_state(next_action_at);

-- 2) Notas do lead (1:N)
CREATE TABLE IF NOT EXISTS crm_lead_notes (
  id bigserial PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_notes_lead_id
  ON crm_lead_notes(lead_id);

-- 3) Seed idempotente do estado CRM por lead
INSERT INTO crm_lead_state (lead_id, stage, position)
SELECT
  l.id AS lead_id,
  CASE
    WHEN l.status IS NULL OR upper(trim(l.status)) = 'CURIOSO' THEN 'INBOX'
    WHEN upper(trim(l.status)) = 'AQUECENDO' THEN 'AQUECENDO'
    WHEN upper(trim(l.status)) = 'QUALIFICADO' THEN 'QUALIFICADO'
    WHEN upper(trim(l.status)) = 'ENVIADO' THEN 'ENVIADO'
    ELSE 'INBOX'
  END AS stage,
  0 AS position
FROM leads l
LEFT JOIN crm_lead_state cls ON cls.lead_id = l.id
WHERE cls.lead_id IS NULL
ON CONFLICT (lead_id) DO NOTHING;

COMMIT;

-- PowerShell (psql via docker compose):
-- Get-Content .\db\crm_min.sql -Raw | docker compose exec -T db psql -U app -d appdb
