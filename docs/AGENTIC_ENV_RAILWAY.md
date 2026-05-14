# Agente WhatsApp — variáveis (Railway + `.env`)

O backend resolve flags em **`featureFlagService.isEnabled`** nesta ordem:

1. `feature_flags` no Supabase com **`user_id` = UUID da clínica** (override por usuário)
2. `feature_flags` com **`user_id` IS NULL** (global para todos)
3. **`FEATURE_FLAGS`** (JSON no env)
4. Variável booleana **`NOME_DA_FLAG` em MAIÚSCULAS** (ex.: `AGENTIC_TOOLS_ENABLED=true`)
5. Default **false**

Há **cache de 60s** em memória; após mudar DB ou env, espere até 1 minuto ou reinicie o serviço.

---

## Três flags que importam

| Flag | Função |
|------|--------|
| **`agentic_tools_enabled`** | Se `true`, o `messageController` pode chamar **`processAgenticMessage`** (Gemini + tools). Se `false`, **nunca** entra no agente. |
| **`agentic_router_enabled`** | Se `true`, o **`agentRouterService`** considera o agente ligado (rotas `agentic` vs `deterministic`). |
| **`agentic_shadow_mode`** | Se `true`, o router **ainda calcula** rota agentic mas **força resposta determinística** (só log/telemetria). Produção com agente “de verdade”: **`false`**. |

Para o bot usar o **agente de forma completa** (LLM + tools quando o router mandar):

- `agentic_tools_enabled` = **true**
- `agentic_router_enabled` = **true**
- `agentic_shadow_mode` = **false**

---

## Railway (recomendado: um JSON só)

No projeto do backend no Railway → **Variables**:

**Opção A — uma variável (recomendada)**

- Nome: `FEATURE_FLAGS`
- Valor (uma linha JSON):

```json
{"agentic_router_enabled":true,"agentic_tools_enabled":true,"agentic_shadow_mode":false}
```

Opcional no mesmo JSON: `"agentic_onboarding_enabled":false,"profile_builder_enabled":true` (se você usar essas flags no projeto).

**Opção B — variáveis separadas** (equivalente à camada 4 da precedência)

```
AGENTIC_ROUTER_ENABLED=true
AGENTIC_TOOLS_ENABLED=true
AGENTIC_SHADOW_MODE=false
```

**Desligar o agente** (só fluxo determinístico / handlers clássicos):

```json
{"agentic_router_enabled":false,"agentic_tools_enabled":false,"agentic_shadow_mode":false}
```

ou omitir `FEATURE_FLAGS` e **não** ter linhas globais `true` no Supabase para esses nomes.

---

## `.env` local (exemplo)

```bash
# Agente WhatsApp ligado (desenvolvimento)
FEATURE_FLAGS={"agentic_router_enabled":true,"agentic_tools_enabled":true,"agentic_shadow_mode":false}
```

Shadow (só medir o que o agente faria, sem executar resposta agentic no sentido de substituir o fluxo):

```bash
FEATURE_FLAGS={"agentic_shadow_mode":true,"agentic_router_enabled":true,"agentic_tools_enabled":true}
```

---

## Supabase (opcional, além do env)

A migration `supabase/migrations/20260512203001_seed_global_agentic_feature_flags.sql` insere/atualiza linhas **globais** (`user_id` NULL). Se essas linhas existirem com `enabled = true`, elas valem **antes** do `FEATURE_FLAGS` vazio — mas **depois** de override por `user_id`.

Para um usuário específico: `INSERT`/`UPDATE` em `feature_flags` com o `user_id` do `profiles.id`.

---

## Referência no código

- Resolução: `src/services/featureFlagService.js`
- Uso “tools”: `src/controllers/messageController.js` (`agentic_tools_enabled`)
- Uso “router”: `src/services/agentic/agentRouterService.js` (`agentic_router_enabled` / `agentic_shadow_mode`)
- Intents que **nunca** passam pelo agente (contrato da ajuda): `src/config/helpCommandContract.js` + `agentRouterService` (`DETERMINISTIC_ONLY_INTENTS`)
