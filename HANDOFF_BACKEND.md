# Handoff — backend Lumiz

## Deploy e smoke (humano)

1. Confirmar commit na `main` alinhado ao Railway (ou branch de release).
2. Variáveis obrigatórias: ver [`src/config/env.js`](src/config/env.js) (`validate()`).
3. Aplicar migrations Supabase: `supabase db push` ou SQL dos ficheiros em `supabase/migrations/` (inclui `20260506000002`–`006` deste plano).
4. Smoke com token real (dashboard):
   - `GET /api/dashboard/summary`
   - `GET /api/dashboard/goals/monthly?year=&month=`
   - `PUT /api/dashboard/goals/monthly` com `meta_receita`, opcional `meta_reserva`, `meta_lucro`
   - `GET /api/dashboard/goals/caminho`
   - `GET /api/dashboard/emergency/history`
   - `GET /api/dashboard/nf-validade?days=30`
   - `PUT /api/dashboard/preferences` body `{ "reporte_mensal_whatsapp": true }`
5. Cron protegido: header `x-cron-secret: $CRON_SECRET`
   - `GET /api/cron/monthly-report` — envia resumo do mês anterior (opt-in)
   - `GET /api/cron/reminders` — inalterado

## Novas rotas / mudanças (resumo)

| Método | Rota | Notas |
|--------|------|--------|
| PUT | `/api/dashboard/preferences` | `reporte_mensal_whatsapp` boolean |
| GET | `/api/dashboard/emergency/history?limit=` | Histórico de alertas de caixa |
| GET/POST/DELETE | `/api/dashboard/nf-validade` | Validades / lembretes manuais |
| GET | `/api/dashboard/estoque/alertas-excesso` | Acima de `estoque_maximo` |
| GET | `/api/dashboard/simulator/scenario?projection_months=3` | Série multi-mês (com ou sem `scenario`) |
| GET | `/api/cron/monthly-report` | Cron manual |

## Rate limit

- Leituras pesadas do dashboard: `heavyDashboardReadLimiter` (40/min por utilizador autenticado, memória Express).
- Export: `dashboardExportLimiter` (25 / 15 min).

## Opt-in relatório mensal

Coluna `profiles.reporte_mensal_whatsapp`. Cron interno: dia **1** às **10:00** (`node-cron`), além do endpoint HTTP acima.

## Benchmarks precificação

Env opcional `PRICING_BENCHMARK_JSON` — objeto por chave de categoria (ver [`src/services/pricingIntelligenceService.js`](src/services/pricingIntelligenceService.js)).
