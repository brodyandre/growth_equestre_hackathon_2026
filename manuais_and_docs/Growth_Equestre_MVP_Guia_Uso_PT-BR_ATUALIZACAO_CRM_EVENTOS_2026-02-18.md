# Growth Equestre - Atualizacao CRM Kanban (base 18/02/2026, revisado em 19/02/2026)

Documento complementar ao `Growth_Equestre_MVP_Guia_Uso_PT-BR.pdf`.

Objetivo: refletir o comportamento atual da automacao por evento no CRM (Kanban) da UI Node.js, com foco operacional.

## 1) O que mudou na operacao

No painel de detalhes do lead (CRM Kanban):
- secao `Automacao por evento`;
- campo `Evento objetivo (ajusta o score e move o lead)`;
- botao `Aplicar evento`.

Ao aplicar um evento:
1. o score e atualizado por delta (`+` ou `-`);
2. o status comercial e recalculado;
3. a coluna do Kanban e atualizada automaticamente;
4. o evento e registrado para rastreabilidade no relatorio gerencial.

## 2) Faixas de score e status/colunas

Regras objetivas vigentes no backend:

- `IN CURIOSO` (`INBOX`): `0-39`
- `AQ AQUECENDO`: `40-69`
- `QL QUALIFICADO`: `70-100` (somente com gate de qualificacao completo)
- `EV ENVIADO`: coluna final de handoff; usa banda alta (`70-100`) quando ha ajuste por etapa

Importante sobre `ENVIADO ACOMPANHANDO`:
- `ACOMPANHANDO` nao e uma coluna nova;
- e um substatus operacional de `ENVIADO`;
- aparece quando o lead em `ENVIADO` tem proxima acao valida (`texto + data`).

## 3) Gate para virar QUALIFICADO

Mesmo com score alto, para virar `QUALIFICADO` e obrigatorio confirmar os 3 sinais:
- `budget_confirmed` (orcamento)
- `timeline_confirmed` (prazo)
- `need_confirmed` (necessidade)

Se faltar sinal:
- o lead pode ficar com score `>= 70` e permanecer em `AQUECENDO`.

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

## 5) Movimento manual de coluna e ajuste de score

Ao mover manualmente (`Atualizar etapa`), o score e ajustado para a faixa da coluna destino.

Mapeamento de ajuste por etapa:
- mover para `CURIOSO` (`INBOX`) garante `0-39`;
- mover para `AQUECENDO` garante `40-69`;
- mover para `QUALIFICADO` garante `70-100`;
- mover para `ENVIADO` tambem usa banda alta `70-100`.

## 6) Regra de acompanhamento na UI Node.js

Acompanhamento valido agora e de `ENVIADO`:
- filtro: `Enviado em acompanhamento` / `Enviado sem acompanhamento`;
- badge no card: `ACOMPANHANDO` quando ha `texto + data` em proxima acao;
- KPI: contador de acompanhamento exibido dentro do card KPI de `ENVIADO`.

Para marcar `ENVIADO` como acompanhando:
1. selecionar lead em `ENVIADO`;
2. preencher `Proxima acao` com `Texto` e `Data`;
3. salvar proxima acao.

## 7) Relatorio gerencial e rastreabilidade

`Visualizar relatorio gerencial` exibe:
- `event_breakdown` com tipos de evento aplicados;
- `timeline` com historico cronologico;
- contexto de qualificacao (score, fatores e sinais).

Movimentos manuais e automacoes ficam registrados (ex.: `crm_manual_move`, `whatsapp_reply`).

## 8) Endpoints de referencia

- `GET /crm/event-rules`
- `POST /crm/leads/:id/apply-rule`
- `POST /crm/move`
- `POST /crm/leads/:id/notes`
- `GET /crm/leads/:id/managerial-report`

## 9) Checklist rapido de validacao

1. Escolha um lead em `AQ AQUECENDO`.
2. Aplique `Respondeu WhatsApp (+8)` e valide score/coluna.
3. Leve o lead para `ENVIADO` (evento ou movimento manual).
4. Em `Proxima acao`, preencha `Texto` e `Data`.
5. Salve e confirme badge `ACOMPANHANDO`.
6. No filtro de acompanhamento, valide `Enviado em acompanhamento`.
7. Abra `Visualizar relatorio gerencial` e confirme registro na `timeline`.
