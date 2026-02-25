# Growth Equestre - UI Web (Node.js)

UI web em Node.js + EJS para operação comercial do CRM, consumindo o backend via proxy `/api`.

## Stack
- Node.js + Express
- EJS (SSR)
- Proxy `/api/*` -> `BACKEND_URL`
- CSS/JS sem build frontend

## Como rodar (local)
1. Copie variáveis:
   - `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`)
2. Instale dependências:
   - `npm install`
3. Suba:
   - `npm run dev`
4. Acesse:
   - `http://localhost:3100`

## Como rodar (Docker)
No projeto raiz:

```powershell
docker compose up -d --build ui_web backend scoring db
```

## Variáveis relevantes
- `PORT` (default `3100`)
- `BACKEND_URL` (default `http://localhost:3000`)
- `KANBAN_PATH` (default `/crm/board`)
- `KANBAN_MOVE_PATH` (default `/crm/move`)
- `CRM_EVENT_RULES_PATH` (default `/crm/event-rules`)
- `CRM_APPLY_RULE_BASE_PATH` (default `/crm/leads`)

## Endpoints esperados no backend (atuais)
- `GET /health`
- `GET /crm/board`
- `POST /crm/move`
- `GET /crm/event-rules`
- `POST /crm/leads/:id/apply-rule`
- `GET /crm/leads/:id/matches`
- `GET /crm/leads/:id/managerial-report`
- `POST /crm/leads/:id/notes`

## Observações operacionais do Kanban
- Faixas por etapa:
  - `IN CURIOSO`: `0-39`
  - `AQ AQUECENDO`: `40-69`
  - `QL QUALIFICADO`: `70-100`
- Gate para `QUALIFICADO`: exige `budget_confirmed + timeline_confirmed + need_confirmed`.
- Score pode subir acima de `70` e permanecer em `AQUECENDO` enquanto faltar gate.
- Movimento manual de etapa ajusta score para a faixa da coluna.

## Backlog
Veja `ui_web/docs/github_issues.md`.
