# ui_web — Dashboard Admin (HTML/JS Standalone)

Interface administrativa do **Growth Equestre** em HTML + CSS + JavaScript puro, sem dependências de framework. Funciona abrindo os arquivos diretamente no navegador ou servindo via qualquer servidor estático.

## Estrutura

```
ui_web/
├── index.html     # Dashboard com KPIs e distribuição por estágio
├── leads.html     # Listagem, filtros, criação e exclusão de leads
├── kanban.html    # Board Kanban CRM (4 colunas: Inbox → Enviado)
├── output.html    # Relatórios de output com exportação CSV e info do modelo ML
├── style.css      # Tema completo (design system light)
├── api.js         # Camada de comunicação com o backend REST
├── dashboard.js   # Lógica da página Dashboard
├── leads.js       # Lógica da página Leads
├── kanban.js      # Lógica do Kanban CRM (cards, regras, notas, próxima ação)
└── output.js      # Lógica de relatórios e exportação CSV
```

## Como usar

### Servidor local rápido
```bash
cd ui_web
python3 -m http.server 8080
# Acesse: http://localhost:8080
```

### Configurar URL da API
A URL padrão é `http://localhost:3000`. Para alterar:
1. Abra o DevTools (F12) → Console
2. Execute: `API.setBase('http://SEU_HOST:3000')`
3. Recarregue a página

Ou edite a constante `DEFAULT_BASE` em `api.js`.

## Páginas

| Página | Arquivo | Descrição |
|--------|---------|----------|
| Dashboard | `index.html` | KPIs, distribuição por estágio, últimos leads |
| Leads | `leads.html` | CRUD de leads, pontuação, exclusão em massa |
| Kanban CRM | `kanban.html` | Board 4 colunas, regras CRM, próxima ação, notas |
| Relatórios | `output.html` | Filtros, tabela exportável em CSV, info do modelo ML |

## Endpoints consumidos

- `GET /health`
- `GET /leads`, `POST /leads`, `PATCH /leads/:id`, `DELETE /leads/:id`
- `POST /leads/bulk-delete`
- `POST /leads/:id/score`
- `GET/POST/DELETE /leads/:id/next-action`
- `GET /crm/board`, `POST /crm/move`
- `GET /crm/event-rules`, `POST /crm/leads/:id/apply-rule`
- `GET/POST /crm/leads/:id/notes`
- `GET /crm/leads/:id/matches`
- `GET /crm/leads/:id/managerial-report`
- `GET /ml/model-info`
- `GET /output/leads` (fallback para `/leads`)
