<<<<<<< HEAD
# growth_equestre_hackathon_2026
Growth Equestre — MVP para hackathon (2026): plataforma de captação e qualificação de leads com lead scoring, funil e diretório de parceiros (MG/SP/GO), composta por UI Streamlit (admin) + backend Node/Express + Postgres + serviço de scoring, tudo orquestrado via Docker Compose.
=======
# growth_equestre_hackathon_2026 (Template MVP)

MVP de Growth para o mercado equestre (Hackathon NoCountry 2026):
- Funil visitante → lead qualificado (hook/quiz + captura de contato)
- Tracking de eventos do funil
- Diretório de parceiros (CNPJ filtrado por CNAE + UF)
- Lead scoring (regras explicáveis, pronto para evoluir para ML)
- Foco inicial: MG / SP / GO

## Pré-requisitos
- Docker Desktop (Windows 11)
- VSCode (opcional)

## Como rodar
1) Copie `.env.example` para `.env`
   - PowerShell: `Copy-Item .env.example .env`

2) Suba os serviços:
```bash
docker compose up -d --build
```

3) Teste:
- Backend: http://localhost:3000/health
- Scoring: http://localhost:8000/health
- UI Admin: http://localhost:8501

## Onde colocar os CSVs (CNAE seed/lookup)
Crie (ou use) a pasta `data/` na raiz e copie:
- `data/cnae_seed_mvp_mg_sp_go.csv`
- `data/cnae_lookup_subclasses_2_3_corrigido.csv`

## Importar parceiros no Postgres (quando houver `data/partners.csv`)
```bash
docker compose exec db psql -U app -d appdb -c "\copy partners(cnpj,razao_social,nome_fantasia,uf,municipio_nome,municipio_cod,cnae_principal,cnaes_secundarios,segmento,prioridade,contato,endereco,situacao_cadastral,data_inicio_atividade) FROM '/data/partners.csv' WITH (FORMAT csv, HEADER true, DELIMITER ';')"
```

## Importar parceiros via API (CSV upload)
Exemplo com endpoint `POST /admin/import/partners`:
```bash
curl -X POST "http://localhost:3000/admin/import/partners" \
  -F "file=@data/partners.csv"
```

## Pastas
- `backend/` — API Node/Express
- `scoring_service/` — FastAPI (scoring regras + motivos)
- `ui_admin/` — Streamlit admin
- `db/init.sql` — schema do Postgres
- `jobs/` — scripts (ex.: gerar partners.csv a partir do CNPJ)
>>>>>>> 841d1fe (chore: initial commit)
