# Growth Equestre - Hackathon 2026

MVP de Growth para o mercado equestre (Hackathon NoCountry 2026):
- Funil visitante → lead qualificado (hook/quiz + captura de contato)
- Tracking de eventos do funil
- Diretório de parceiros (CNPJ filtrado por CNAE + UF)
- Lead scoring (regras explicáveis, pronto para evoluir para ML)
- **Scraper CNAE com robustez, cache e rate limiting**
- Foco inicial: MG / SP / GO

## Pré-requisitos
- Docker Desktop (Windows 11)
- Python 3.11+ (para ferramentas/scrapers)
- VSCode (opcional)

## Como rodar

### 1. Configuração Inicial
Copie `.env.example` para `.env`:
```powershell
Copy-Item .env.example .env
```

### 2. Subir Serviços Docker
```bash
docker compose up -d --build
```

### 3. Testar Endpoints
- Backend: http://localhost:3000/health
- Scoring: http://localhost:8000/health
- UI Admin: http://localhost:8501

## Scraper CNAE

Ferramenta robusta para coletar códigos CNAE do CONCLA/IBGE com:
- ✅ Rate limiting (controle de RPM)
- ✅ Retry com exponential backoff
- ✅ Cache local (JSON + HTML raw)
- ✅ Batch processing
- ✅ Logging detalhado

### Instalação de Dependências

```bash
# Criar ambiente virtual (recomendado)
python -m venv .venv
.venv\Scripts\activate

# Instalar dependências do scraper
pip install -r tools/cnae/requirements.txt
```

### Uso do Scraper

```bash
# Execução básica
python tools/cnae/generate_cnae_map.py --in tools/cnae/cnae_keywords.csv

# Com rate limiting conservador
python tools/cnae/generate_cnae_map.py \
  --in tools/cnae/cnae_keywords.csv \
  --rate-limit-rpm 30 \
  --min-delay 1.0 \
  --verbose

# Processar apenas 5 keywords
python tools/cnae/generate_cnae_map.py \
  --in tools/cnae/cnae_keywords.csv \
  --batch-size 5
```

**Saída:**
- `data/cnae/cnae_map.csv` - CSV consolidado
- `data/cnae/raw/` - Cache e HTML raw

Consulte [tools/cnae/README.md](tools/cnae/README.md) para mais detalhes.

## Dados CNAE

A pasta `data/` deve conter:
- `data/cnae_seed_mvp_mg_sp_go.csv` - Seeds iniciais
- `data/cnae_lookup_subclasses_2_3_corrigido.csv` - Lookup de subclasses
- `data/cnae/cnae_map.csv` - Gerado pelo scraper

## Importar Parceiros

### Via Postgres (Docker)
```bash
docker compose exec db psql -U app -d appdb -c "\copy partners(cnpj,razao_social,nome_fantasia,uf,municipio_nome,municipio_cod,cnae_principal,cnaes_secundarios,segmento,prioridade,contato,endereco,situacao_cadastral,data_inicio_atividade) FROM '/data/partners.csv' WITH (FORMAT csv, HEADER true, DELIMITER ';')"
```

### Via API
```bash
curl -X POST "http://localhost:3000/admin/import/partners" \
  -F "file=@data/partners.csv"
```

## Estrutura do Projeto

```
.
├── backend/              # API Node/Express
├── scoring_service/      # FastAPI (lead scoring)
├── ui_admin/            # Streamlit admin
├── db/                  # Schema Postgres
├── jobs/                # Scripts (geração de partners.csv)
├── tools/
│   └── cnae/           # Scraper CNAE
│       ├── generate_cnae_map.py
│       ├── cnae_keywords.csv
│       ├── requirements.txt
│       └── README.md
└── data/
    ├── cnae/           # Outputs do scraper
    │   ├── cnae_map.csv
    │   └── raw/        # Cache + HTML
    └── partners.csv    # Dados de parceiros
```

## Tecnologias

- **Backend**: Node.js + Express
- **Scoring**: Python + FastAPI
- **UI Admin**: Streamlit
- **Database**: PostgreSQL
- **Scraper**: Python + BeautifulSoup + Requests
- **Orquestração**: Docker Compose
