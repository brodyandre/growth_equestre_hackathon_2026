# Growth Equestre — UI Web (Node.js)

Objetivo: substituir/replicar a UI em Streamlit por uma UI Web em Node.js, mantendo consumo do backend existente via **proxy**.

## Stack
- Node.js + Express
- EJS (server-side rendering)
- Proxy `/api/*` -> `BACKEND_URL` (evita CORS)
- CSS/JS simples (sem build)

## Como rodar (local)
1. Copie as variáveis:
   - `cp .env.example .env`
2. Instale dependências:
   - `npm install`
3. Suba:
   - `npm run dev`
4. Acesse:
   - http://localhost:3100

## Como rodar (Docker)
Se você usa Docker Compose no projeto Growth Equestre, adicione um serviço `ui_web` com `BACKEND_URL=http://backend:3000`.

Exemplo (trecho):

```yaml
services:
  ui_web:
    build: ./ui_web
    ports:
      - "3100:3100"
    environment:
      - PORT=3100
      - BACKEND_URL=http://backend:3000
    depends_on:
      - backend
```

## Endpoints esperados no backend
A UI tenta consumir:
- `GET /health`
- `GET /crm/summary`
- `GET /crm/kanban`
- `POST /crm/kanban/move`

Se alguma rota não existir ainda, a UI **não quebra**: ela usa mocks para manter a demo do hackathon funcionando.

## Próximos passos
Veja `docs/github_issues.md` para o backlog em formato de issues/épicos.
