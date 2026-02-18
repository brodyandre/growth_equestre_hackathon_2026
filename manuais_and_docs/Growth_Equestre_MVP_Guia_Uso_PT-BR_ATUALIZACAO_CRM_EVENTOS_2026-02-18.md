# Growth Equestre - Atualização CRM Kanban (18/02/2026)

Documento complementar ao `Growth_Equestre_MVP_Guia_Uso_PT-BR.pdf`.

Objetivo: refletir o comportamento atual da automação por evento no CRM (Kanban), com foco em uso prático.

## 1) O que mudou

No painel de detalhes do lead (tela CRM Kanban), foi adicionada a seção:
- `Automacao por evento`
- campo: `Evento objetivo (ajusta o score e move o lead)`
- botão: `Aplicar evento`

Ao aplicar um evento:
1. o score é atualizado por delta (`+` ou `-`);
2. o status comercial é recalculado;
3. a coluna do Kanban é atualizada automaticamente;
4. o evento é registrado para rastreabilidade no relatório gerencial.

## 2) Faixas de score e colunas

- `IN CURIOSO`: `0-39`
- `AQ AQUECENDO`: `40-69`
- `QL QUALIFICADO`: `70-100`
- `EV ENVIADO`: etapa final de handoff

## 3) Gate para virar QUALIFICADO

Além do score, é obrigatório confirmar os 3 sinais:
- `budget_confirmed` (orçamento)
- `timeline_confirmed` (prazo)
- `need_confirmed` (necessidade)

Importante:
- se faltar algum sinal, o lead pode ter score acima de 70 e continuar em `AQUECENDO`;
- assim que os sinais forem cumpridos, o lead passa a `QUALIFICADO`.

## 4) Regras objetivas (eventos)

Eventos positivos:
- `Respondeu WhatsApp` (`whatsapp_reply`) = `+8`
- `Pediu valores` (`asked_price`) = `+12`
- `Clicou na proposta` (`proposal_click`) = `+10`
- `Agendou reuniao` (`meeting_scheduled`) = `+15`
- `Compareceu reuniao` (`meeting_attended`) = `+18`
- `Confirmou orcamento` (`budget_confirmed`) = `+15`
- `Confirmou prazo` (`timeline_confirmed`) = `+10`
- `Confirmou necessidade` (`need_confirmed`) = `+10`
- `Solicitou proposta formal` (`proposal_requested`) = `+12`
- `Enviou documentos` (`sent_documents`) = `+9`
- `Retorno positivo no follow up` (`followup_positive`) = `+6`

Eventos negativos:
- `Sem resposta por 3 dias` (`no_reply_3d`) = `-6`
- `Sem resposta por 7 dias` (`no_reply_7d`) = `-12`
- `Sem resposta por 14 dias` (`no_reply_14d`) = `-20`
- `Adiou sem nova data` (`postponed_no_date`) = `-12`
- `Sem orcamento agora` (`no_budget_now`) = `-20`
- `Esfriou sem retorno` (`lost_interest`) = `-18`
- `Contato invalido` (`invalid_contact`) = `-8`

## 5) Movimento manual de coluna

Ao mover manualmente (botão `Atualizar etapa`):
- o score é ajustado para a faixa da coluna destino;
- evita inconsistência de card/score.

Exemplos:
- mover para `AQUECENDO` garante score em `40-69`;
- mover para `QUALIFICADO` garante score em `70-100`;
- mover para `CURIOSO` garante score em `0-39`.

## 6) Relatório gerencial e rastreabilidade

O botão `Visualizar relatorio gerencial` mostra:
- `event_breakdown` com tipos de evento aplicados;
- `timeline` com histórico cronológico;
- inteligência de qualificação (score, fatores e contexto).

As movimentações automáticas e manuais ficam registradas (ex.: `crm_manual_move`, `whatsapp_reply`, etc.).

## 7) Endpoints de referência

- `GET /crm/event-rules`
- `POST /crm/leads/:id/apply-rule`
- `POST /crm/move`
- `GET /crm/leads/:id/managerial-report`

## 8) Checklist rápido de validação

1. Escolha um lead em `AQ AQUECENDO`.
2. Aplique `Respondeu WhatsApp (+8)`.
3. Verifique aumento de score no card.
4. Abra `Visualizar relatorio gerencial`.
5. Confirme presença do evento em `event_breakdown` e `timeline`.
6. Aplique eventos negativos e valide queda de score/retorno para `IN CURIOSO`.
