# Checklist E2E — WhatsApp com agente (LLM + tools)

Rodar em **homolog** com `agentic_tools_enabled` + `agentic_router_enabled` (ou shadow primeiro). Registrar data, build e operador.

## Pré-condições

- [ ] Usuário de teste onboarded, assinatura ativa (ou trial conforme política).
- [ ] Flags ativas para o `user_id` ou global via `FEATURE_FLAGS`.
- [ ] `GEMINI_API_KEY` válida; logs sem erro de quota.

## Ordem de prioridade de confirmações (sim/não)

1. `pendingTransactions` / confirmação de transação  
2. `pendingDocumentTransactions` / documento persistido (`getPersistedPendingConfirmation`)  
3. `pendingEdits`  
4. **`agentic_confirm`** (tool agentic) — ver [HANDOFF_BACKEND.md](../HANDOFF_BACKEND.md) secção Agente conversacional  

## Cenários mínimos

| # | Ação do usuário | Resultado esperado |
|---|-----------------|---------------------|
| 1 | "Quanto tenho de saldo?" | Resposta coerente (agentic ou determinístico); sem erro. |
| 2 | "Últimas movimentações" / histórico | Lista ou resumo; sem travar. |
| 3 | Mensagem ambígua longa | Agente ou fallback útil; sem loop infinito. |
| 4 | Lançamento que dispare tool com confirmação | Texto de confirmação + estado `agentic_confirm`; **sim** executa; **não** cancela. |
| 5 | Com **agentic_confirm** pendente, enviar documento | Documento segue fluxo `documentHandler` (prioridade acima, se aplicável ao produto). |
| 6 | `ASSINAR` / atalhos de copy | Link ou copy; não exige Gemini de intent. |
| 7 | Membro secundário vs dono | Regras de assinatura / bloqueio inalteradas. |
| 8 | Timeout / falha Gemini | Mensagem de fallback amigável; não quebra webhook. |

## Pós-teste

- [ ] Revisar `conversation_history` (intent `agentic` quando aplicável).
- [ ] Revisar logs `[AgentRouter]` (shadow) ou métricas Fase 5 quando existirem.

## Banco (antes de homolog/prod)

- [ ] Migrations aplicadas: `supabase db push` (ou pipeline equivalente), incluindo `domain_procedure_benchmarks`, `conversational_nps_responses`, `trial_accounts`, agentic.

## Rollout cohort

1. Ligar `agentic_shadow_mode` — validar logs de decisão.  
2. Cohort pequeno: `agentic_router_enabled` + `agentic_tools_enabled` para usuários de teste.  
3. Monitorar `GET /api/admin/agentic-analytics?days=1` e volume de `agentic_deterministic_fallback`.  
4. Ampliar cohort após limiares estáveis.

## Billing (Asaas → trial → live)

- [ ] `ASAAS_WEBHOOK_SECRET` + URL do Asaas apontando para `POST /webhooks/asaas` (produção).  
- [ ] Pagamento de teste: `subscriptions.status` → `paid`; `trial_accounts.status` → `converted` quando houver snapshot; evento `subscription_activated_via_webhook` em `analytics_events`.  
- [ ] Reenvio do mesmo webhook (idempotência): não duplica `activate`; ainda tenta `migrateToLiveAccount` se trial pendente.

## Admin (pós-teste interno)

- [ ] `GET /api/admin/conversational-nps` — amostra NPS.  
- [ ] `GET /api/admin/agentic-analytics?days=7` — contagem de eventos agentic/billing.  
- [ ] `GET /api/admin/trial-accounts?limit=50` — contas-fantasma.

## Próxima iteração (fora deste checklist)

- Busca semântica / embeddings (Anexo A “RAG estrito”): avaliar `pgvector` + orçamento de tokens; hoje o catálogo entra como texto no contexto do agente.
