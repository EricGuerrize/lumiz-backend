# Lumiz — Monitoramento de Implementação (Phases 1–4)

> **Última atualização:** 2026-05-04
> **Repositório backend:** https://github.com/EricGuerrize/lumiz-backend
> **Repositório frontend:** https://github.com/EricGuerrize/lumiz-financeiro
> **Deploy backend:** Railway (branch `main` → auto-deploy)
> **Deploy frontend:** Vercel (branch `main` → auto-deploy)

---

## Como continuar o trabalho (Cursor + Claude Code)

1. Abra o repo no Cursor: `cursor /caminho/para/lumiz-backend`
2. Abra o terminal integrado do Cursor e inicie o Claude Code: `claude`
3. O Claude vai carregar o `CLAUDE.md` automaticamente com toda a arquitetura
4. Para commits: sempre use `git -c commit.gpgsign=false commit` (GPG desativado no repo)
5. Para rodar testes unitários: `npm run test:unit`
6. Para smoke tests (requer Supabase): `npm test`
7. Para rodar localmente: `npm run dev`

---

## Variáveis de ambiente necessárias (.env)

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
GEMINI_API_KEY=
ASAAS_API_KEY=
REDIS_URL=                   # opcional — degrada gracefully
CRON_SECRET=                 # protege GET /api/cron/reminders
TEST_ONBOARDING_PHONE=5511999999999   # usado nos smoke tests
```

---

## Estado das Fases

### ✅ Phase 1 — Régua de Cobrança + Meta Financeira
**Commits:** `0773314`, `cf88d42`, `8c3c9ed`
**Status:** Implementado, testado, em produção

#### Serviços criados
| Arquivo | O que faz |
|---|---|
| `src/services/reminderService.js` | Envia lembretes de parcelas e contas a pagar via WhatsApp. 5 janelas: -3d, hoje, +3d, +7d, +15d. Consulta tabela `parcelas` diretamente por `data_vencimento`. |
| `src/services/goalReminderService.js` | Envia acompanhamento semanal de meta financeira toda sexta às 18h. Friday guard + dedup por semana ISO. |
| `src/services/reminderSentHelper.js` | Helper compartilhado: `alreadySent(refId, tipo)` e `markSent(userId, refId, tipo)`. Evita reenvios via tabela `reminders_sent`. |

#### Cópia WhatsApp
| Arquivo | Funções |
|---|---|
| `src/copy/reminderWhatsappCopy.js` | `parcelaAntecipado`, `parcelaNoDia`, `parcelaAtraso`, `contaAntecipada`, `contaNoDia`, `contaAtraso` |
| `src/copy/goalWhatsappCopy.js` | `progressoSemanal` (barra visual ▓░), `semMeta` |

#### Migrations aplicadas
| Migration | O que cria |
|---|---|
| `20260502000009_create_reminders_sent.sql` | Tabela `reminders_sent` com unique `(referencia_id, tipo_lembrete)` |
| `20260502000010_add_meta_mensal_to_profiles.sql` | Colunas `meta_mensal` e `meta_atualizada_em` na tabela `profiles` |
| `20260503000011_add_data_vencimento_to_contas_pagar.sql` | Colunas `data_vencimento` e `prioridade` na tabela `contas_pagar` |

#### Crons registrados (src/server.js)
```
0 8 * * *   → reminderService.checkAndSendReminders()  (diário às 8h)
0 18 * * 5  → goalReminderService.checkAndSendGoalReminders()  (sexta às 18h)
```

#### Testes
- `tests/unit/reminderSentHelper.test.js` — 4 testes
- `tests/unit/goalReminderService.test.js` — 6 testes

---

### ✅ Phase 2 — Cashflow + Calendário + Contas Priority
**Commits:** `34f7ddb`, `8c3c9ed`
**Status:** Implementado, testado, em produção

#### Serviços criados
| Arquivo | O que faz |
|---|---|
| `src/services/cashflowService.js` | Três métodos principais (ver abaixo) |

**Métodos de `cashflowService`:**

`getContasPagarPriority(userId, opts)`
- Lê tabela `contas_pagar`
- Classifica por prioridade: `vencida` (diasAtraso > 0), `hoje` (0), `proximo` (1–7d), `futuro` (>7d)
- Retorna `{ total, valorTotal, items[] }`

`getCashflowProjection(userId, days)`
- Lê `parcelas` (entradas) e `contas_pagar` pendentes (saídas)
- Constrói buckets diários com `saldoAcumulado` running
- Retorna apenas dias com eventos: `{ saldoAtual, summary, days[] }`
- `days[i].data` = chave de data (formato YYYY-MM-DD)

`getFinancialCalendar(userId, startDate, endDate)`
- Retorna eventos reais (`predicted: false`) + recorrentes previstos (`predicted: true`)
- `events` é um objeto `{ "YYYY-MM-DD": [evento, ...] }`

#### Endpoints adicionados (src/routes/dashboard.routes.js)
```
GET /api/dashboard/contas-a-pagar?status=pendente&days_ahead=60&limit=50
GET /api/dashboard/cashflow/projection?days=30
GET /api/dashboard/calendar?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
```

#### Testes
- `tests/unit/cashflowService.test.js` — 10 testes

---

### ✅ Phase 3 — Simulator + Pricing Intelligence + Emergency Mode + Export
**Commits:** `7545aa7`, `43b1a30`, `bd82a3f`
**Status:** Implementado, testado, em produção

#### Serviços criados
| Arquivo | O que faz |
|---|---|
| `src/services/simulatorService.js` | Projeção what-if: `runScenario(userId, { extraRevenue, cutExpensePct, newFixedCost, month, year })`. Compara baseline vs projeção. |
| `src/services/pricingIntelligenceService.js` | Analisa ticket médio por procedimento (coluna `observacoes`) vs benchmarks estáticos de mercado. Coluna de valor: `valor_total`. |
| `src/services/emergencyModeService.js` | Detecta saldo negativo nos próximos 30 dias via `cashflowService.getCashflowProjection`. Campo de data nos dias: `day.data` (não `day.date`). |
| `src/services/exportService.js` | Exporta relatório mensal em PDF (via `pdfService`) ou CSV com escape de injection. |

#### Cópia WhatsApp
| Arquivo | Funções |
|---|---|
| `src/copy/emergencyWhatsappCopy.js` | `alertaCaixaNegativo(saldoMinimo, dataRisco)` |

#### Endpoints adicionados (src/routes/dashboard.routes.js)
```
GET /api/dashboard/simulator/scenario?extra_revenue=0&cut_expense_pct=0&new_fixed_cost=0
GET /api/dashboard/insights/pricing?months=3
GET /api/dashboard/emergency/status
GET /api/dashboard/export/report?format=pdf|csv&month=YYYY-MM
```

#### Cron registrado (src/server.js)
```
0 8 * * *   → emergencyModeService.checkAndAlert() + estoqueService.checkAndAlertEstoqueBaixo()  (diário às 8h)
```

#### Correções pós-revisão (commit bd82a3f)
- `emergencyModeService`: `day.date` → `day.data` (campo correto do cashflowService)
- `exportService`: CSV injection escape para campos com `=`, `+`, `-`, `@`
- `dashboard.routes`: validação de range nos params do simulator (0–1M para valores, 0–100 para %)
- `server.js`: cron secret aceita apenas header `x-cron-secret` (removido fallback query param)

#### Testes
- `tests/unit/simulatorService.test.js` — 6 testes
- `tests/unit/pricingIntelligenceService.test.js` — 5 testes
- `tests/unit/emergencyModeService.test.js` — 3 testes

---

### ✅ Phase 4 — Estoque (nível em `procedimentos.estoque_ml`)
**Status:** Backend implementado; aplicar migrations no Supabase (`supabase db push`). UI web opcional (ver prompt para o repo `lumiz-financeiro`).

#### Serviços criados
| Arquivo | O que faz |
|---|---|
| `src/services/estoqueService.js` | `getEstoqueStatus`, `getAlertasBaixoEstoque`, `sugerirReposicao(userId, saldoAtual)`, `registrarEntrada`, `checkAndAlertEstoqueBaixo`. Consumo em 90 dias: soma `atendimento_procedimentos.ml_utilizado` + movimentações tipo `saida`. Níveis: `ok`, `baixo`, `critico` (&lt; 50% do mínimo), `sem_historico`. |

#### Cópia WhatsApp
| Arquivo | Funções |
|---|---|
| `src/copy/estoqueWhatsappCopy.js` | `alertaEstoqueBaixo(produtos)`, `alertaEstoqueCritico`, `entradaRegistrada`, `resumoEstoqueLinhas`, mensagens de ajuda/erro |

#### Bot WhatsApp
| Peça | Detalhe |
|---|---|
| Intents | `estoque_entrada`, `consultar_estoque` no `geminiService.js`; heurísticas em `intentHeuristicService.js` |
| Handler | `src/controllers/messages/estoqueHandler.js` → `messageController` |

#### Migrations aplicadas
| Migration | O que cria |
|---|---|
| `20260504000012_create_fornecedores.sql` | Tabela `fornecedores`, RLS |
| `20260504000013_estoque_movimentacoes.sql` | Colunas `estoque_minimo`, `unidade`, `fornecedor_id` em `procedimentos`; migração legado `estoque_atual` → `estoque_ml` se existir; `movimentacoes_estoque`; amplia `reminders_sent.tipo_lembrete` para varchar(80) |

#### Endpoints (src/routes/dashboard.routes.js)
```
GET  /api/dashboard/estoque
GET  /api/dashboard/estoque/alertas
GET  /api/dashboard/estoque/sugestoes?saldo_disponivel=
POST /api/dashboard/estoque/entrada   body: procedimento_id, quantidade, custo_unitario?, fornecedor_id?, observacoes?, data?
```

#### Cron (src/server.js)
```
0 8 * * *   → emergencyModeService.checkAndAlert() + estoqueService.checkAndAlertEstoqueBaixo()
```

#### Testes
- `tests/unit/estoqueService.test.js` — 6 testes

#### Roadmap (não no escopo deste backend)
- Entrada por **áudio** (transcrever e reutilizar intent `estoque_entrada`)
- Entrada por **NF** (OCR + extração + match em procedimentos)

---

### ✅ Phase 5 — Meta Mensal Persistida + Health Score + Inadimplência + Sazonalidade
**Status:** Backend implementado e validado. Sem novas migrations (tabela `monthly_goals` já aplicada).

#### Serviços criados
| Arquivo | O que faz |
|---|---|
| `src/services/healthScoreService.js` | Calcula score 0–100 com 4 componentes: margem do mês (40), pontualidade de recebimentos (30), cobertura de caixa 30 dias (20), tendência de receita vs mês anterior (10). Retorna `score`, `nivel`, `componentes` e `recomendacao`. |
| `src/services/inadimplenciaService.js` | Consolida parcelas vencidas não pagas por cliente com classificação de risco (`baixo`, `medio`, `alto`) e detalha inadimplência por cliente. |
| `src/services/sazonalidadeService.js` | Calcula sazonalidade mensal (receita/custos/lucro), identifica mês forte/fraco, média de receita e tendência por comparação de médias dos últimos 3 meses vs 3 anteriores. |

#### Endpoints adicionados (`src/routes/dashboard.routes.js`)
```
GET /api/dashboard/goals/monthly?year=2026&month=5
PUT /api/dashboard/goals/monthly
GET /api/dashboard/health/score
GET /api/dashboard/inadimplencia/overview
GET /api/dashboard/inadimplencia/cliente/:clienteId
GET /api/dashboard/insights/sazonalidade?months=12
```

#### Regras de validação aplicadas
- `goals/monthly` (GET): `year` e `month` obrigatórios; `month` no range `1..12`
- `goals/monthly` (PUT): `year`, `month`, `meta_receita >= 0`
- `inadimplencia/cliente/:clienteId`: valida UUID; retorna `400` quando inválido
- `insights/sazonalidade`: `months` com clamp `2..24` (default `12`)

#### Observações de implementação
- Upsert de meta mensal com `onConflict: 'user_id,year,month'` e `updated_at`
- GET de meta mensal retorna registro existente ou fallback `{ year, month, meta_receita: 0 }`
- Sem alteração de comportamento das rotas existentes; apenas novas rotas adicionadas

---

## Frontend (lumiz-financeiro)

**Commit:** `66ce7f7`
**Status:** Implementado, em produção no Vercel

### Páginas criadas
| Rota | Componente | O que faz |
|---|---|---|
| `/dashboard/contas-a-pagar` | `ContasPagarDashboard.tsx` | 4 seções por prioridade, badges coloridos, filtro pendente/todas |
| `/dashboard/cashflow` | `CashflowPage.tsx` | Aba Projeção (recharts line chart) + Aba Calendário (grid mensal + modal de dia) |
| `/dashboard/simulator` | `SimuladorPage.tsx` | 3 sliders, debounce 500ms, comparação antes/depois, delta card |
| `/dashboard/pricing` | `PrecificacaoPage.tsx` | Seletor de período, banner de alerta, tabela com tooltip de recomendação |

### Componentes adicionados
| Componente | Onde aparece | O que faz |
|---|---|---|
| `EmergencyAlert.tsx` | `Dashboard.tsx` (home) | Widget verde/vermelho baseado em `/emergency/status` |
| `ExportButtons.tsx` | `Relatorios.tsx` | Botões CSV/PDF com download via Blob |

### Arquivos modificados
| Arquivo | Mudança |
|---|---|
| `src/hooks/use-new-dashboard.ts` | useQuery hooks para todos os 5 novos endpoints |
| `src/services/dashboard-api.ts` | 7 novos tipos + 6 novas funções de API |
| `src/App.tsx` | 4 novas rotas lazy-loaded |
| `src/components/AppSidebar.tsx` | 4 novos itens na seção "Análises" |

### Testes E2E (Playwright)
**Commit:** `307c722`
- `tests/e2e/dashboard.spec.ts` — smoke tests para todas as novas páginas
- Cobertura: Dashboard home, Contas a Pagar, Cashflow (2 tabs), Simulador, Precificação, Export

---

## Resumo de todos os endpoints do backend (Phase 1–4)

```
# Phase 1 — Cron HTTP + outros crons no server.js
GET /api/cron/reminders          → reminderService, nudges, insights, trial, goal (ver `server.js`; não inclui estoque)
# Cron 8h (server.js) também roda emergency + estoque baixo

# Phase 2
GET /api/dashboard/contas-a-pagar
GET /api/dashboard/cashflow/projection
GET /api/dashboard/calendar

# Phase 3
GET /api/dashboard/simulator/scenario
GET /api/dashboard/insights/pricing
GET /api/dashboard/emergency/status
GET /api/dashboard/export/report

# Phase 4
GET /api/dashboard/estoque
GET /api/dashboard/estoque/alertas
GET /api/dashboard/estoque/sugestoes
POST /api/dashboard/estoque/entrada

# Phase 5
GET /api/dashboard/goals/monthly
PUT /api/dashboard/goals/monthly
GET /api/dashboard/health/score
GET /api/dashboard/inadimplencia/overview
GET /api/dashboard/inadimplencia/cliente/:clienteId
GET /api/dashboard/insights/sazonalidade
```

---

## Próximos passos sugeridos (pós Phase 4)

- [ ] Dashboard web: telas de estoque consumindo os endpoints Phase 4 (repo `lumiz-financeiro`)
- [ ] Integração com dados reais de concorrentes para `pricingIntelligenceService` (atualmente usa benchmarks estáticos)
- [ ] Simulador multi-período (atualmente projeta apenas o mês atual)
- [ ] Notificações push no dashboard web (atualmente só WhatsApp)
- [ ] Histórico de alertas de emergência (guardar em tabela para auditoria)
- [ ] Testes E2E no backend com Playwright/Supertest contra ambiente de staging
- [ ] Rate limiting específico por endpoint nos novos routes de dashboard

---

## Padrões de código importantes

```js
// Commits (GPG desativado)
git -c commit.gpgsign=false commit -m "mensagem"

// Mock de Supabase em unit tests (padrão obrigatório)
beforeEach(() => {
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  supabase = require('../../src/db/supabase');
  serviceUnderTest = require('../../src/services/meuService');
});

// Campo de data nos dias do cashflowService
projection.days[i].data  // CORRETO (não .date)

// Cron secret — apenas via header
req.headers['x-cron-secret']  // nunca req.query.secret
```
