# Backlog (GitHub Issues) - Growth Equestre UI Web

Estado: backlog atualizado para o contrato de API atual (pós MVP Kanban + automação por evento).

Sugestão de labels:
- `epic`
- `frontend`
- `backend`
- `ui/ux`
- `bug`
- `infra`
- `good first issue`
- `priority/p0`
- `priority/p1`

---

## EPIC 1 - CRM Kanban Operacional
1. **[P0] Melhorar feedback visual do Kanban após aplicar evento**
   - Critérios: card atualizado sem necessidade de refresh manual; feedback de score/stage sempre visível.
2. **[P1] Histórico dedicado de movimentações por lead**
   - Critérios: painel com trilha de `crm_manual_move` e eventos de automação.
3. **[P1] Filtros avançados por pendências de qualificação**
   - Critérios: filtrar leads por sinais faltantes (`budget/timeline/need`).

## EPIC 2 - Contrato de API (estado atual)
4. **[P0] Consolidar documentação dos endpoints de CRM**
   - Kanban e automação:
     - `GET /crm/board`
     - `POST /crm/move`
     - `GET /crm/event-rules`
     - `POST /crm/leads/:id/apply-rule`
   - Relatório:
     - `GET /crm/leads/:id/managerial-report`
5. **[P1] Adicionar endpoint de simulação de regras em lote**
   - Critérios: receber lista de eventos e retornar simulação sem persistência.

## EPIC 3 - UX do Relatório Gerencial
6. **[P1] Separar seção “Movimentações de Kanban” no relatório**
   - Critérios: tabela explícita para transições de etapa e motivo.
7. **[P2] Exportar relatório em PDF**
   - Critérios: botão de exportação com layout consistente para handoff executivo.

## EPIC 4 - Qualidade e Observabilidade
8. **[P1] Testes automatizados para regras de evento (+/- score)**
   - Critérios: cobertura para todos os eventos objetivos.
9. **[P1] Testes E2E do fluxo do botão “Visualizar relatório gerencial”**
   - Critérios: validar carregamento e conteúdo mínimo do relatório.
10. **[P2] Logs estruturados para operações de CRM**
   - Critérios: rastrear `lead_id`, `rule_code`, `from_score`, `to_score`.

## EPIC 5 - Segurança e Governança
11. **[P1] Autenticação e autorização por perfil**
   - Critérios: restringir ações críticas (delete, move manual, apply-rule).
12. **[P2] Auditoria administrativa**
   - Critérios: trilha de usuário, timestamp e origem por ação.

---

## Template sugerido de issue

### Título
`[P?][UI|API] ...`

### Descrição
- Contexto:
- Objetivo:
- Rotas/contratos envolvidos:
- Critérios de aceite:
- Evidência (print/video):
