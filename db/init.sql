CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome text NOT NULL,
  whatsapp text,
  email text,
  uf char(2),
  cidade text,
  segmento_interesse text NOT NULL,
  orcamento_faixa text,
  prazo_compra text,
  score int,
  status text DEFAULT 'CURIOSO',
  score_motivos jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  ts timestamptz DEFAULT now(),
  metadata jsonb
);

CREATE TABLE IF NOT EXISTS partners (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cnpj text UNIQUE NOT NULL,
  razao_social text,
  nome_fantasia text,
  uf char(2) NOT NULL,
  municipio_cod int,
  municipio_nome text,
  cnae_principal text,
  cnaes_secundarios text[],
  segmento text,
  prioridade int DEFAULT 2,
  situacao_cadastral int,
  data_inicio_atividade date,
  contato jsonb,
  endereco jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_partners_uf_municipio ON partners(uf, municipio_cod);
CREATE INDEX IF NOT EXISTS idx_partners_cnae_principal ON partners(cnae_principal);
