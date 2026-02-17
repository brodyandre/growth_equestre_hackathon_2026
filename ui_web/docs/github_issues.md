# Backlog (GitHub Issues) — Growth Equestre UI Web

Sugestão de labels:
- `epic`, `frontend`, `backend`, `ui/ux`, `bug`, `infra`, `good first issue`, `priority/p0`, `priority/p1`

---

## EPIC 1 — UI Web (MVP) substituindo Streamlit
1. **[P0] Criar UI Web base (Express + EJS + proxy /api)**
   - Critérios: roda local, proxy funcionando, páginas: dashboard/kanban/leads/partners/settings.
2. **[P0] Implementar Kanban com drag-and-drop**
   - Critérios: mover cards entre colunas; persistência via endpoint (quando existir).
3. **[P1] Padronizar design system mínimo**
   - Tipografia, spacing, componentes (card/botão/tabela), responsivo.

## EPIC 2 — Contrato de API (alinhamento com backend)
4. **[P0] Definir contrato do Kanban**
   - `GET /crm/kanban` e `POST /crm/kanban/move` (payload).
5. **[P0] Definir contrato do Dashboard**
   - `GET /crm/summary` (KPIs).
6. **[P1] Leads e Parceiros (CRUD mínimo)**
   - Rotas: listar / criar / atualizar.

## EPIC 3 — Autenticação e perfis
7. **[P1] Login simples (JWT)**
   - Guardar token, middleware no proxy.
8. **[P2] Perfis e permissões**
   - Admin vs viewer.

## EPIC 4 — Observabilidade e qualidade
9. **[P1] Logging e health**
   - `/health-ui` e log estruturado.
10. **[P2] Testes básicos**
   - smoke tests (rotas) + lint.

## EPIC 5 — Infra/Deploy
11. **[P1] Docker Compose integrado**
   - Serviço `ui_web`, networking, envs.
12. **[P2] Deploy em cloud (OCI)**
   - Ajustar proxy/URL e documentar.

---

## Templates (copiar e colar nas issues)

### Título
`[P?][UI] ...`

### Descrição
- Contexto:
- Objetivo:
- Rotas/contratos envolvidos:
- Critérios de aceite:
- Evidência (print/video):
