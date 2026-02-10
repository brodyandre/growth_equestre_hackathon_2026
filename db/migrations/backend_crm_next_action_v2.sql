-- CRM Next Action schema hardening (v2) (Postgres)
-- Garante colunas e UNIQUE(lead_id) para UPSERT em crm_lead_state

ALTER TABLE IF EXISTS crm_lead_state
  ADD COLUMN IF NOT EXISTS next_action_text TEXT NULL;

ALTER TABLE IF EXISTS crm_lead_state
  ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ NULL;

ALTER TABLE IF EXISTS crm_lead_state
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL DEFAULT NOW();

-- Garante UNIQUE(lead_id) (necessário para ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint c
    JOIN   pg_class t ON t.oid = c.conrelid
    WHERE  t.relname = 'crm_lead_state'
       AND c.contype = 'u'
       AND c.conname = 'crm_lead_state_lead_id_key'
  ) THEN
    ALTER TABLE crm_lead_state
      ADD CONSTRAINT crm_lead_state_lead_id_key UNIQUE (lead_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
