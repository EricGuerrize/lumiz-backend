# Rollout: agente WhatsApp global (todos os usuários)

Objetivo: `agentic_tools_enabled` e `agentic_router_enabled` verdadeiros para o público; `agentic_shadow_mode` falso (shadow só mede decisão, não executa o agente).

## Duas formas de ligar (use uma ou combine conforme precedência)

Precedência no backend: **linha por `user_id`** > **linha global (`user_id` NULL)** > **`FEATURE_FLAGS` JSON** > **env booleano** > default `false`. Ver [`src/services/featureFlagService.js`](../src/services/featureFlagService.js).

### A) Variável `FEATURE_FLAGS` (ex.: Railway)

Definir (uma linha, JSON compacto):

```json
{"agentic_router_enabled":true,"agentic_tools_enabled":true,"agentic_shadow_mode":false}
```

Garantir que não haja outro `FEATURE_FLAGS` em outro serviço com `agentic_shadow_mode:true`.

### B) Supabase — linhas globais

Aplicar migration [`supabase/migrations/20260512203000_seed_global_agentic_feature_flags.sql`](../supabase/migrations/20260512203000_seed_global_agentic_feature_flags.sql) (`supabase db push` ou pipeline).

## Auditoria: overrides por usuário que desligam o agente

Rodar no SQL Editor (ajustar schema se necessário):

```sql
SELECT user_id, name, enabled, updated_at
FROM public.feature_flags
WHERE name IN (
  'agentic_tools_enabled',
  'agentic_router_enabled',
  'agentic_shadow_mode',
  'agentic_onboarding_enabled'
)
ORDER BY user_id NULLS LAST, name;
```

Linhas com `user_id` **não nulo** e `enabled = false` para `agentic_tools_enabled` ou `agentic_router_enabled` mantêm aquele usuário no fluxo determinístico para essa flag.

## Smoke pós-deploy

1. Usuário já onboardado: mensagem de consulta simples (ex. saldo / histórico) e uma mensagem composta (“mostra X e também Y”).
2. Se uma tool exigir confirmação: ver prompt com *sim* / *não* e execução após *sim*.
3. Métricas: `agentic_turn_completed`, `agentic_deterministic_fallback` (taxa alta indica problema), `agentic_first_tool_invoked`. Admin: `GET /api/admin/agentic-analytics?days=7` (JWT admin).

## Kill switch rápido

- Remover ou zerar chaves agentic em `FEATURE_FLAGS`, **ou**
- `UPDATE public.feature_flags SET enabled = false, updated_at = now() WHERE user_id IS NULL AND name IN ('agentic_tools_enabled','agentic_router_enabled');`
- Aguardar até **60s** (cache em memória do `featureFlagService`) ou reiniciar o processo.

## `agentic_onboarding_enabled` (opcional, escopo separado)

Controla assistência LLM **dentro** do onboarding (`onboardingAgenticAssistService`), não o router pós-onboarding. **Recomendação:** deixar **desligado** no mesmo rollout até validar custo/latência do fluxo principal; habilitar em cohort depois se desejado.

## Limitação de produto

Mesmo com flags ligadas, onboarding ativo, confirmações pendentes e intenções em `DETERMINISTIC_ONLY_INTENTS` permanecem no caminho determinístico. Ver [`src/services/agentic/agentRouterService.js`](../src/services/agentic/agentRouterService.js).
