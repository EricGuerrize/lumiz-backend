# Lumiz — Monitoramento de Implementação (Phases 1–6)

> **Última atualização:** 2026-05-09 (Hardening pré-launch — Asaas webhook fail-closed + LGPD consent prova auditável + Fase 17 PostHog + Fase 12 Importador Excel + Fase 18 MFA + Fase 15 Audit Log UI frontend + Database Security Hardening)
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
| `src/services/simulatorService.js` | Projeção what-if: `runScenario(userId, { extraRevenue, cutExpensePct, newFixedCost, month, year })`. Presets PDF §8: `runScenarioPreset`, `runAllPresets` (`extra_staff`, `price_hike`, `second_room`). Compara baseline vs projeção. |
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
GET /api/dashboard/simulator/scenario?scenario=extra_staff|price_hike|second_room&month=&year=&staff_monthly_cost=&price_hike_pct=&rent_extra=
GET /api/dashboard/simulator/scenarios?month=&year=&… (mesmos overrides opcionais; devolve os 3 presets)
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
| `src/services/estoqueService.js` | `getEstoqueStatus`, `getAlertasBaixoEstoque`, `sugerirReposicao(userId, saldoAtual)`, `registrarEntrada`, `getComprasPorFornecedor(userId, months)`, `checkAndAlertEstoqueBaixo`. Consumo em 90 dias: soma `atendimento_procedimentos.ml_utilizado` + movimentações tipo `saida`. Níveis: `ok`, `baixo`, `critico` (&lt; 50% do mínimo), `sem_historico`. |

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
GET  /api/dashboard/estoque/compras-por-fornecedor?months=12
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

### ✅ Phase 5 & 6 — Dashboard backend (referência única)

**Escopo Phase 5:** meta mensal (GET/PUT), health score, inadimplência (overview + por cliente), sazonalidade.  
**Escopo Phase 6:** custo real por procedimento, simulação de desconto, caminho da meta, emergência detalhada.  
**Wire:** todas as rotas abaixo em `src/routes/dashboard.routes.js` (auth dashboard existente).

#### Serviços

| Fase | Arquivo | Responsabilidade |
|------|---------|------------------|
| 5 | `src/services/healthScoreService.js` | `getScore(userId)` — score 0–100 (margem, pontualidade recebimentos, cobertura caixa ~30d, tendência vs mês anterior); `nivel`, `componentes`, `recomendacao`. Usa Supabase + `transactionController` para métricas do período corrente. |
| 5 | `src/services/inadimplenciaService.js` | `getOverview`, `getDetalheCliente` — parcelas vencidas não pagas agregadas por cliente, risco `baixo` / `medio` / `alto`. |
| 5 | `src/services/sazonalidadeService.js` | `getSazonalidade(userId, months)` — séries mensais receita/custo/lucro, mês forte/fraco, tendência (média últimos 3 vs 3 anteriores). |
| 5 | `src/services/outlookService.js` | `getOutlook(userId, months)` — PDF §3a–c: por mês calendário, `receita` (soma `atendimentos.valor_total`), `custos` (saidas do `getMonthlyReport` / ledger, alinhado ao `monthly-report`), `lucro`, `margem_pct`; campo `nota` explica limites (não CMV completo). |
| 5 | *(sem service dedicado)* | Metas mensais: `dashboard.routes.js` faz `select` / `upsert` na tabela `monthly_goals` (`onConflict: user_id,year,month`, `updated_at`). |
| 6 | `src/services/procedimentoCustoService.js` | `getCustoRealProcedimentos`, `simularImpactoDesconto` — médias por procedimento (material, MDR cartão), margem, preço mínimo; simulação de impacto do desconto. |
| 6 | `src/services/metaCaminhoService.js` | `calcularCaminhoMeta` — meta do mês atual em `monthly_goals`, fallback `profiles.meta_mensal`; ritmo vs necessário, falta para bater meta, sugestões. |
| 6 | `src/services/emergencyModeService.js` | `getEmergenciaDetalhada` — além do `getStatus` (cashflow 30d), prioriza `contas_pagar`, recebíveis ~15d, sugestão de antecipação; `getStatus` permanece para cron/WhatsApp. |

#### Rotas (caminhos relativos a `/api/dashboard`)

| Método | Caminho |
|--------|---------|
| `GET` | `goals/monthly?year=&month=` |
| `PUT` | `goals/monthly` |
| `POST` | `goals/monthly` *(mesmo corpo que `PUT`; alias para clientes legados)* |
| `GET` | `health/score` |
| `GET` | `inadimplencia/overview` |
| `GET` | `inadimplencia/cliente/:clienteId` |
| `GET` | `insights/outlook?months=` *(default 6; clamp 1–24)* |
| `GET` | `insights/sazonalidade?months=` *(opcional; default comportamental 12)* |
| `GET` | `insights/custo-procedimentos?months=` *(opcional; default 3)* |
| `GET` | `insights/simular-desconto?procedimento_id=&desconto_pct=` *(aliases: `procedimentoId`, `descontoPct`)* |
| `GET` | `goals/caminho` |
| `GET` | `emergency/detalhes` |

#### Validações principais (query / body)

- **`GET goals/monthly`:** `year` e `month` inteiros obrigatórios; `month` ∈ `1..12`; `year` inteiro válido (sem clamp explícito de faixa).
- **`PUT` / `POST` `goals/monthly` *(JSON body)*:** `year`, `month` inteiros (`month` `1..12`); `meta_receita` número finito `>= 0`.
- **`GET inadimplencia/cliente/:clienteId`:** `:clienteId` UUID (regex estrita); senão `400`.
- **`GET insights/outlook`:** `months` inteiro opcional; default `6`; clamp `1..24`.
- **`GET insights/sazonalidade`:** se `months` for inteiro, clamp `2..24`; ausente → `12`.
- **`GET insights/custo-procedimentos`:** `months` inteiro `1..12` (default `3` se omitido).
- **`GET insights/simular-desconto`:** `procedimento_id` string 36 chars (formato UUID com hífens); `desconto_pct` finito `1..99`; procedimento inexistente → `404` com mensagem do service.
- **`GET health/score`**, **`GET inadimplencia/overview`**, **`GET goals/caminho`**, **`GET emergency/detalhes`:** sem parâmetros adicionais além do usuário autenticado.

#### Notas

- Phase 5: tabela `monthly_goals` — migration [`20260505000001_create_monthly_goals.sql`](supabase/migrations/20260505000001_create_monthly_goals.sql); após `db push`, GET meta devolve linha ou `{ year, month, meta_receita: 0 }` se não houver registo.
- Phase 6: sem migration; campos usam dados já existentes (procedimentos, transações, parcelas, etc.).
- **Testes:** a suite unitária completa pode falhar por testes não relacionados a este slice; para este escopo Phase 6, os testes de **`estoqueService`** e **`cashflowService`** estão verdes quando rodados isoladamente *(slice estoque + cashflow)*.

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

## Resumo de todos os endpoints do backend (Phase 1–6)

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
GET /api/dashboard/simulator/scenarios
GET /api/dashboard/insights/pricing
GET /api/dashboard/emergency/status
GET /api/dashboard/export/report

# Phase 4
GET /api/dashboard/estoque
GET /api/dashboard/estoque/alertas
GET /api/dashboard/estoque/sugestoes
GET /api/dashboard/estoque/compras-por-fornecedor
POST /api/dashboard/estoque/entrada

# Phase 5
GET /api/dashboard/goals/monthly
PUT /api/dashboard/goals/monthly
POST /api/dashboard/goals/monthly
GET /api/dashboard/health/score
GET /api/dashboard/inadimplencia/overview
GET /api/dashboard/inadimplencia/cliente/:clienteId
GET /api/dashboard/insights/sazonalidade
GET /api/dashboard/insights/outlook

# Phase 6
GET /api/dashboard/insights/custo-procedimentos
GET /api/dashboard/insights/simular-desconto
GET /api/dashboard/goals/caminho
GET /api/dashboard/emergency/detalhes
```

---

## PDF *Lumiz Estética* — mapeamento backlog (Lumiz vs Alter)

Referência: [`Lumiz Estética.pdf`](Lumiz%20Estética.pdf) (melhorias). Itens marcados **Alter** ficam com integração **externa** (antecipação, boletos, cruzamento recebível–distribuidor, cenários de antecipação, cobertura fornecedor com recebível, parte do score/crédito ligada à Alter, etc.). O backend **Lumiz** foca no que é possível com dados próprios (Supabase + regras).

| Tema (PDF) | Escopo | Estado no backend Lumiz |
|------------|--------|-------------------------|
| §1a MDR / antecipar / comparar credenciadoras | Alter + dados concorrentes | MDR em atendimentos; comparativo profundo = **Alter**. |
| §1b Recebíveis 30–180d livre vs comprometido + simulação antecipação | Alter | Parcial: parcelas em **cashflow**; “comprometido” = **Alter**. |
| §1c Compras + caixa + recebíveis | Alter | **Alter** para cruzar com recebível. |
| §1d Estoque operacional, mín/máx, alertas | Lumiz | **Phase 4** estoque + cron. |
| §1e Fluxo gaps + ações (antecipar…) | Misto | Projeção **cashflow**; sugestões com antecipação = **Alter**. |
| §2a–2e Registro vendas, estoque, lembretes, contas | Lumiz | WhatsApp + **Phase 2** contas/cashflow + **Phase 1** lembretes. |
| §2b Validade / NF | Lumiz (mínimo) | Tabela **`nf_validade_itens`** + CRUD `GET|POST|DELETE /api/dashboard/nf-validade`; OCR/NF-e automática = futuro. |
| §2c Emissão NF | Fora / terceiros | — |
| §2f Pagamento distribuidor via recebível | Alter | **Alter** |
| §3a–c Lucro/caixa 6 meses, CMV | Lumiz | **`GET /api/dashboard/insights/outlook?months=`** — receita por `atendimentos`; custos pelo ledger mensal (`monthly-report`); `nota` sobre CMV. |
| §3d–f Agenda recebível, antecipação, cobertura fornecedor | Alter | **Alter** |
| §3g Score saúde | Misto | **GET /health/score**; refinement com recebível = **Alter**. |
| §3h Economia se não antecipar | Alter | **Alter** |
| §4 Estoque + compras + histórico fornecedor | Lumiz | Estoque Phase 4; **`GET /api/dashboard/estoque/compras-por-fornecedor`** (entradas `movimentacoes_estoque` + `fornecedores`; sem recebível Alter). |
| §5 Sazonalidade, margens, benchmark | Misto | **Sazonalidade** OK; margens/evolução parcial (custo real **Phase 6**); benchmark **gap**. |
| §6 Custo real, preço mínimo, desconto, prejuízo | Misto | **Phase 3 + 6**; custo total com antecipação no centavo = **Alter**. |
| §7 Inadimplência, risco, régua WhatsApp, **impacto no caixa** | Lumiz | Overview + detalhe; `percentualFaturamento`, **`mensagemImpacto`**, `faturamentoMesReferencia`; régua **Phase 1**. |
| §8 Simulador “e se?” | Misto | Cenário base **Phase 3**; presets Lumiz: **`scenario=extra_staff|price_hike|second_room`** em `GET …/simulator/scenario` + **`GET …/simulator/scenarios`**; troca maquininha / antecipação recebível = **Alter**. |
| §9 Calendário preditivo, dias negativos | Lumiz | Calendário + projeção; **`caixaNegativo` por dia** e `temProjecaoCaixaNegativo` na projeção (PDF §9b). Calendário inclui `summary.notaCashflow` a remeter para a projeção (saldo acumulado). |
| §10 Meta lucro/reserva + caminho | Misto | **`monthly_goals.meta_reserva`**, **`meta_lucro`** + GET/PUT goals; **`GET /goals/caminho`** estende lucro mês (outlook) e metas opcionais. |
| §11 Relatório sócio PDF/email | Misto | **Export**; **`reporte_mensal_whatsapp`** + cron dia 1 10h + **`GET /api/cron/monthly-report`** (WhatsApp resumo mês anterior). |
| §12 Emergência | Misto | **emergency** + detalhes + **`GET /emergency/history`**; priorização fina com recebível travado = **Alter**. |

**Próximos blocos sugeridos (só Lumiz, sem Alter):** notificações push dashboard; E2E HTTP real contra staging; integração concorrentes além de `PRICING_BENCHMARK_JSON`.

**Alteração recente (API para dashboard):**

- `GET /api/dashboard/cashflow/projection` — cada item em `days` inclui `caixaNegativo` (boolean). `summary` inclui `diasComCaixaNegativo`, `primeiroDiaCaixaNegativo`, `temProjecaoCaixaNegativo`.
- `GET /api/dashboard/calendar` — `summary.notaCashflow` orienta o cliente a usar a projeção para saldo acumulado e dias críticos (PDF §9).
- `GET /api/dashboard/inadimplencia/overview` — resposta inclui `mensagemImpacto`, `faturamentoMesReferencia`, `periodoFaturamentoReferencia` (além de `totalEmAtraso` e `percentualFaturamento` já existentes).
- **Testes:** `tests/unit/outlookService.test.js`; presets + multi-mês em `tests/unit/simulatorService.test.js`; `getComprasPorFornecedor` em `tests/unit/estoqueService.test.js`; calendário em `tests/unit/cashflowService.test.js`; `tests/unit/pricingIntelligenceService.test.js`; `tests/e2e/dashboardPlanContracts.e2e.test.js`.
- **Metas reserva/lucro:** migrations `20260506000002_monthly_goals_reserva_lucro.sql`; body opcional `meta_reserva`, `meta_lucro` no PUT goals/monthly.
- **Relatório mensal WhatsApp:** migration `20260506000003_profiles_reporte_mensal.sql`; `PUT /api/dashboard/preferences`; cron `0 10 1 * *` + `GET /api/cron/monthly-report`.
- **Emergency history:** migration `20260506000004_emergency_alert_history.sql`.
- **Estoque máximo / excesso:** migration `20260506000005_procedimentos_estoque_maximo.sql`; `GET /api/dashboard/estoque/alertas-excesso`; cron 8h inclui `checkAndAlertEstoqueExcesso`.
- **NF / validade (mínimo):** migration `20260506000006_nf_validade_itens.sql`; `GET|POST|DELETE /api/dashboard/nf-validade`.
- **Benchmarks precificação:** env `PRICING_BENCHMARK_JSON` (merge por chave de categoria).
- **Perfil de pagamento por cliente:** `GET /api/dashboard/clientes/perfil-pagamento` com `formas_usadas`, `forma_preferida`, `ticket_medio`, `indice_risco_pagamento`.
- **Margem comparativa + alerta:** `GET /api/dashboard/insights/margem-comparativa`; cron 8h chama `margemAlertaService.checkAndAlertMargemCaindo()` com dedupe `margem_caindo_YYYY-MM`.
- **Email relatório mensal (Resend):** `src/services/emailReportService.js`; integração em `monthlyReportDeliveryService` após WhatsApp; rota manual `POST /api/dashboard/reports/send-email?month=YYYY-MM`; degrade graceful sem `RESEND_API_KEY`.
- **Testes novos deste bloco:** `tests/unit/clientePerfilService.test.js`, `tests/unit/margemAlertaService.test.js`, `tests/unit/emailReportService.test.js`.

---

## Próximos passos sugeridos (pós Phase 4)

- [ ] Dashboard web: telas de estoque consumindo os endpoints Phase 4 (repo `lumiz-financeiro`)
- [ ] Integração com dados reais de concorrentes para `pricingIntelligenceService` (além de `PRICING_BENCHMARK_JSON` / estático)
- [x] Simulador multi-período — query `projection_months` em `GET /api/dashboard/simulator/scenario` (+ serviço `runScenarioMultiMonth` / preset multi)
- [ ] Notificações push no dashboard web (atualmente só WhatsApp)
- [x] Histórico de alertas de emergência — tabela `emergency_alert_history` + `GET /api/dashboard/emergency/history`
- [x] Testes de contrato — `tests/e2e/dashboardPlanContracts.e2e.test.js` + regressão alargada (`npm run test:regression`)
- [x] Rate limiting por rota pesada — [`src/middleware/dashboardRouteRateLimits.js`](src/middleware/dashboardRouteRateLimits.js) aplicado em rotas dashboard selecionadas

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

## Definition of Done — backend Phases 1–6 (fecho)

- **Rotas:** todas as entradas do bloco “Resumo de todos os endpoints” (Phase 1–6) existem em [`src/routes/dashboard.routes.js`](src/routes/dashboard.routes.js) (e crons em [`src/server.js`](src/server.js) onde aplicável).
- **Base de dados:** `monthly_goals` definida em [`supabase/migrations/20260505000001_create_monthly_goals.sql`](supabase/migrations/20260505000001_create_monthly_goals.sql); **produção (projeto Lumiz)** aplicada via migration remota / MCP. Outros ambientes: `supabase db push` ou SQL manual.
- **Regressão automática:** `npm run test:regression` — estoque, cashflow, outlook, simulador, pricing, contrato e2e; Redis cache/fila desligados, `--forceExit`.
- **Smoke de módulo:** `node -e "require('./src/routes/dashboard.routes.js'); setTimeout(()=>process.exit(0),1000)"` na raiz (avisos Redis/`ENOTFOUND` em local sem Railway são esperados).
- **Sanidade pós-deploy (manual):** Railway com o mesmo commit que o repo; chamadas com Bearer às rotas listadas em [`HANDOFF_BACKEND.md`](HANDOFF_BACKEND.md).

---

## Handoff — backend / deploy

**Onde registrar:** checklist operacional em **[`HANDOFF_BACKEND.md`](HANDOFF_BACKEND.md)** (prioridade para o agente de backend). Ponteiros para o frontend em [`lumiz-financeiro/HANDOFF_FRONTEND.md`](lumiz-financeiro/HANDOFF_FRONTEND.md).

- [x] **Meta mensal HTTP** — `PUT` e **`POST`** em `/api/dashboard/goals/monthly` com o mesmo body (`year`, `month`, `meta_receita`). O cliente em [`lumiz-financeiro/src/services/dashboard-api.ts`](lumiz-financeiro/src/services/dashboard-api.ts) usa `PUT`.
- [x] **Migration `monthly_goals`** — migration no repo + **aplicada em produção (Supabase projeto Lumiz)**. Clones/staging: correr `supabase db push` ou aplicar o ficheiro SQL se ainda não existir a tabela.
- [ ] **Deploy / sanidade** — Railway na revisão alinhada a `main`; validar rotas em [`HANDOFF_BACKEND.md`](HANDOFF_BACKEND.md) com token real (passo humano após cada release).

- feito pelo Cursor no backend

---

## Phase 7 — Captura multimodal + Supplier docs + Alter mock (Onda 1–4)

> Plano completo: [.cursor/plans/backend_completo_financeiro_alter_whatsapp_91e0e02c.plan.md](.cursor/plans/backend_completo_financeiro_alter_whatsapp_91e0e02c.plan.md).
> Detalhes operacionais e contratos: [HANDOFF_BACKEND.md](HANDOFF_BACKEND.md) (seção "Onda 1–4").
> Atualizações de roadmap: [ROADMAP.md](ROADMAP.md) (Fases 11, 16, 20.4 marcadas concluídas).

### Onda 1 — Captura multimodal + confidence
- [src/routes/webhook.js](src/routes/webhook.js) (audioMessage → Whisper).
- [src/services/audioTranscriptionService.js](src/services/audioTranscriptionService.js).
- [src/copy/captureConfirmCopy.js](src/copy/captureConfirmCopy.js) + [src/config/prompts.js](src/config/prompts.js) (campo `confidence_score` em ambos prompts).
- Handlers: [src/controllers/messages/transactionHandler.js](src/controllers/messages/transactionHandler.js), [src/controllers/messages/documentHandler.js](src/controllers/messages/documentHandler.js).

### Onda 2 — Supplier documents
- Migrations:
  - `supabase/migrations/20260507000020_create_supplier_documents.sql`
  - `supabase/migrations/20260507000021_fornecedores_extra_fields.sql`
  - `supabase/migrations/20260507000022_contas_pagar_origem_parcelas.sql`
- Serviços: [src/services/supplierDocumentService.js](src/services/supplierDocumentService.js), [src/services/contasReceberService.js](src/services/contasReceberService.js).
- Copy: [src/copy/supplierDocWhatsappCopy.js](src/copy/supplierDocWhatsappCopy.js).
- Endpoints novos em [src/routes/dashboard.routes.js](src/routes/dashboard.routes.js) (`supplier-documents`, `fornecedores`, `contas-a-receber`).

### Onda 3 — Alter pré-pronta com mock
- Migrations:
  - `20260507000030_create_feature_flags.sql`
  - `20260507000031_create_alter_recebiveis.sql`
  - `20260507000032_create_alter_antecipacoes.sql`
  - `20260507000033_create_alter_cobertura_snapshots.sql`
- Adapter: `src/services/alter/alterAdapterContract.js`, `mockAlterAdapter.js`, `realAlterAdapter.js`, `alterAdapter.js` (factory).
- Domínio: `alterRecebiveisService.js`, `antecipacaoService.js`, `coberturaFornecedorService.js`, `pagarComRecebivelService.js`.
- Cron semanal: `alterInsightCronService.js`, exposto via `GET /api/cron/alter-insights`.
- Health score: 5º componente `cobertura_fornecedor` em [src/services/healthScoreService.js](src/services/healthScoreService.js).
- Feature flag: [src/services/featureFlagService.js](src/services/featureFlagService.js) (com middleware `requireFeature`).

### Onda 4 — Empty states + handoff
- Endpoints novos com `meta: { is_empty, hint }`.
- Handoff: [HANDOFF_BACKEND.md](HANDOFF_BACKEND.md) (seção "Onda 1–4").
- Suítes novas: `tests/unit/audioTranscriptionService.test.js`, `captureConfirmFlow.test.js`, `supplierDocumentService.test.js`, `contasReceberService.test.js`, `alterAdapter.contract.test.js`, `alterRecebiveisService.test.js`, `antecipacaoService.test.js`, `coberturaFornecedorService.test.js`, `pagarComRecebivelService.test.js`.

### Patch Fase 16 — `GET /api/config/features`
- Whitelist registry: [src/config/featureFlagsRegistry.js](src/config/featureFlagsRegistry.js) (8 flags: `alter_enabled`, `excel_import`, `ofx_export`, `multi_tenant`, `audit_log`, `posthog_enabled`, `mfa_required`, `lgpd_self_service`).
- Rota: [src/routes/config.routes.js](src/routes/config.routes.js) montada em `app.use('/api/config', configRoutes)` (server.js).
- Auth opcional (Bearer best-effort, anônimo permitido), degradação segura para defaults se Supabase falhar.
- Suíte: `tests/unit/configFeaturesEndpoint.test.js` (6 casos cobrindo defaults, whitelist filter, anônimo, token válido, token inválido, falha de DB).
- Fase 16 marcada ✅ no [ROADMAP.md](ROADMAP.md). Frontend já tinha `useFeatureFlag` consumindo este endpoint.

### Hardening pré-launch — Asaas webhook + prova de consentimento LGPD (09/05/2026)

Auditoria pré-launch revelou dois gaps críticos. Backend concluído, regression **210/210 verde**.

#### 1. Webhook Asaas — fail-closed em produção
- **Problema:** `POST /api/webhooks/asaas` antes aceitava qualquer payload se `ASAAS_WEBHOOK_SECRET` não estivesse configurada → vetor de fraude de billing.
- [src/routes/webhooks.js](src/routes/webhooks.js) — `NODE_ENV=production` sem secret → **503** + log crítico, `paymentService.handleWebhook` NÃO é chamado. Token errado → 401. Em dev/test sem secret → warn alto + processa.
- [src/config/env.js](src/config/env.js) — `ASAAS_WEBHOOK_SECRET` agora é validada como **obrigatória em produção** na startup. App falha fast em vez de subir vulnerável.
- Tests: [tests/unit/asaasWebhookSecurity.test.js](tests/unit/asaasWebhookSecurity.test.js) — 7 cenários (prod sem/com correto/errado/sem header, dev sem/com errado, test sem).

#### 2. Prova de consentimento LGPD persistida
- **Problema:** "1️⃣ Autorizo" do onboarding via WhatsApp era registrado apenas em `analytics_events` (`event=onboarding_consent_given`), sem prova robusta auditável (timestamp + versão dos termos) — frágil para auditoria ANPD ou disputa civil. LGPD Art. 8º §1º exige prova.
- Migration: [supabase/migrations/20260509000040_profiles_consent_lgpd.sql](supabase/migrations/20260509000040_profiles_consent_lgpd.sql) (aplicada via MCP). Adiciona em `profiles`: `consent_given_at`, `terms_version`, `privacy_version`, `consent_ip`, `consent_user_agent` + índice parcial `idx_profiles_consent_versions`.
- [src/services/consentService.js](src/services/consentService.js):
  - `recordConsent({ phone, req })` — busca profile por telefone, persiste timestamp + versões + IP + UA, grava entry em `audit_log` (`action='consent_given'`, `entityType='profile'`). Idempotente. Re-consent automático quando versões mudam. Fire-and-forget — erro de DB nunca propaga.
  - `hasGivenConsent({ phone })` — confere se user consentiu nas versões ativas.
  - `getActiveVersions()` — lê env `LUMIZ_TERMS_VERSION`/`LUMIZ_PRIVACY_VERSION` (default `2026-05-09`).
- Plug em ambos handlers de consent: [src/services/onboarding/profileHandlers.js](src/services/onboarding/profileHandlers.js) e [src/services/onboardingFlowService.js](src/services/onboardingFlowService.js) — após "Autorizo", chamam `consentService.recordConsent` fire-and-forget.
- Tests: [tests/unit/consentService.test.js](tests/unit/consentService.test.js) — 13 cenários (persistência, audit_log, idempotência, re-consent, profile inexistente, fire-and-forget em erro, x-forwarded-for, getActiveVersions, hasGivenConsent).

#### Variáveis de ambiente novas
- **OBRIGATÓRIA em prod:** `ASAAS_WEBHOOK_SECRET=<segredo-cadastrado-no-painel-asaas>`. Sem ela, server falha na startup.
- **Recomendadas:** `LUMIZ_TERMS_VERSION=2026-05-09`, `LUMIZ_PRIVACY_VERSION=2026-05-09`. Bumpar força re-consent global.

#### Frontend pendente
- Para Fase 19 (LGPD self-service): exibir versões aceitas em "Configurações → Privacidade", banner "Termos atualizados" quando versões diferem das ativas, fluxo de re-consent. Detalhes em `HANDOFF_BACKEND.md` seção "Hardening pré-launch — Webhook Asaas + prova de consentimento LGPD".

## Refator design system + páginas admin (09/05/2026)

- **Backend:** `GET /api/user/whoami` (commit `6e9cdf4` na `main`); 6 testes unitários em `tests/unit/whoamiEndpoint.test.js`; regressão **216/216** verde.
- **Frontend** (repo `lumiz-financeiro`, entregue por agente separado, mesma data): migração de `apps/dashboard` para tokens/components alinhados ao mock `lumiz-nb-clinic.html`; **5 páginas admin** com RBAC via `whoami` (`/admin`, `/admin/usuarios`, `/admin/assinaturas`, `/admin/feedback`, `/admin/diagnostico`); ajustes pontuais (`.dot-warn`, `AppSidebar` com `PlugZap`→`ShieldCheck`, `Topbar`, `SidebarTrigger`, `GlobalSearch`, `dashboard-api.ts`, `AppLayout`); mock copiado para `lumiz-financeiro/apps/dashboard/_design/`.
- **Verificação front:** `cd lumiz-financeiro && npx tsc --noEmit` exit 0; `npm run build` ✓ (~8,8 s).
- **Follow-up:** limpar blocos extras do sidebar fora do espec (**Operações extras**, outlook, pricing) em PR separada (decisão de produto). PR/screenshots/preview ficam sob captura do PO quando houver preview.

### Fase 17 — Analytics de produto via PostHog (backend)
Backend concluído em 09/05/2026. Frontend pendente.
- Dependência: `posthog-node@5.33.4` (MIT, oficial PostHog).
- [src/services/posthogService.js](src/services/posthogService.js): cliente lazy-init, `capture`, `identify`, `shutdown`. Fire-and-forget — falhas nunca propagam. Sem `POSTHOG_API_KEY` vira no-op silencioso.
  - Mascaramento recursivo de propriedades sensíveis (`cpf`, `password`, `pwd`, `token`, `access_token`, `refresh_token`, `pix_chave`, `cartao*`, `cvv`, `rg`).
  - Respeita flag `posthog_enabled` per-user/global via `featureFlagService.isEnabled`.
- [src/services/analyticsService.js](src/services/analyticsService.js): `track()` agora **espelha** todo evento no PostHog após salvar em `analytics_events`. distinctId resolvido `userId → phone:<phone> → anonymous`.
- Eventos novos instrumentados nesta fase:
  - `transaction_created` em [src/controllers/messages/transactionHandler.js](src/controllers/messages/transactionHandler.js) (após confirmação WhatsApp).
  - `report_exported` em `GET /api/dashboard/export/report` (formato + mês).
  - `excel_imported` em `POST /api/dashboard/import/excel/confirm` (qtd + totais).
  - `goal_set` em `PUT|POST /api/dashboard/goals/monthly` (ano/mês/meta + is_first_set).
  - `simulator_run` em `GET /api/dashboard/simulator/scenario(s)`.
  - `emergency_triggered` em [src/services/emergencyModeService.js](src/services/emergencyModeService.js) (cron).
  - `onboarding_completed` em [src/services/onboarding/summaryHandlers.js](src/services/onboarding/summaryHandlers.js) (handoff).
- Variáveis de ambiente novas (todas opcionais): `POSTHOG_API_KEY`, `POSTHOG_HOST`, `POSTHOG_FLUSH_AT`, `POSTHOG_FLUSH_INTERVAL_MS`. Sem chave → no-op.
- [src/server.js](src/server.js): graceful shutdown chama `posthogService.shutdown()` antes de `process.exit(0)` (evita perda de batch em deploys).
- Suíte: [tests/unit/posthogService.test.js](tests/unit/posthogService.test.js) — 22 casos. Regression suite: **190/190 verde**.
- Rollout: flag `posthog_enabled` segue OFF por default. Para ligar globalmente: `INSERT INTO feature_flags(user_id, name, enabled, meta) VALUES (NULL, 'posthog_enabled', true, '{"enabled_by":"fase_17_release"}'::jsonb);`.
- Frontend pendente: instalar `posthog-js`, init em `main.tsx` atrás de feature flag, `identify` pós-login, pageview por rota, track manual em ações UI-only. Detalhes na seção Fase 17 do [HANDOFF_BACKEND.md](HANDOFF_BACKEND.md).

### Fase 12 — Importador Excel (backend + frontend)
Backend e frontend concluídos em 09/05/2026.
- Migration `20260509000030_excel_import_batches.sql`: cria `excel_import_batches` com RLS + `import_batch_id` em `atendimentos` e `contas_pagar`.
- `excelService.importFromExcel`: preview seguro de `.xlsx/.xls`, mapeamento automático de colunas, normalização BRL/data BR, inconsistências e summary.
- `excelService.confirmImport`: materializa entradas em `atendimentos` + `atendimento_procedimentos` e saídas em `contas_pagar` (`origem='import'`), tudo com `import_batch_id`.
- `excelService.undoImport`: remove lote inteiro por `import_batch_id` e marca batch como `undone`.
- Endpoints:
  - `POST /api/dashboard/import/excel/preview` (`multipart/form-data`, campo `file`).
  - `POST /api/dashboard/import/excel/confirm`.
  - `GET /api/dashboard/import/excel/history`.
  - `DELETE /api/dashboard/import/excel/:batchId`.
- Segurança: `multer` em memória, limite padrão 5MB, limite padrão 5.000 linhas, parser sem fórmulas/estilos.
- WhatsApp: confirmação fire-and-forget em `POST /confirm` via `excelImportWhatsappCopy`.
- Testes: `tests/unit/excelImportService.test.js`; regression **168/168**.
- Frontend: rota `/dashboard/import` com drag-and-drop, prévia, inconsistências, histórico e desfazer; gated por `useFeatureFlag('excel_import')`.
- Feature flag `excel_import` ativada globalmente em `feature_flags(user_id IS NULL)` em 09/05/2026 — descrição atualizada em `featureFlagsRegistry.js`.

### Database Security Hardening (08/05/2026)
Após review do Supabase Advisor: **4 ERRORS críticos eliminados**. Migrations [`20260509000010_security_hardening.sql`](supabase/migrations/20260509000010_security_hardening.sql) + [`20260509000020_security_hardening_round2.sql`](supabase/migrations/20260509000020_security_hardening_round2.sql).
- `subscriptions`: RLS ON + policy `users read own subscription` (clinic_id = auth.uid()).
- 3 views (`view_financial_ledger`, `view_finance_balance`, `view_monthly_report`): trocadas para `security_invoker = on` — passam a respeitar RLS das tabelas-base.
- `exec_sql_readonly`, `admin_get_subscription_stats`, `is_user_admin`, `generate_orcamento_numero`: REVOKE EXECUTE de `anon` + `authenticated`. Backend continua chamando via service-role.
- `match_learned_knowledge`: `search_path` fixado em `public, pg_catalog`.
- Coverage: 34/35 tabelas com RLS + policy. Única exceção `reminders_sent` é intencional (apenas backend).
- WARN restantes (não-bloqueantes): `vector` em schema `public` (tech debt), `auth_leaked_password_protection` (habilitar via painel Auth antes do go-live).
- Detalhes completos no [HANDOFF_BACKEND.md](HANDOFF_BACKEND.md) seção "Database Security & Compliance".

### Fase 18 — MFA obrigatório (backend)
- Decisão: enrollment/verify/unenroll fica 100% no frontend via `supabase.auth.mfa.*` (TOTP nativo do Supabase Auth). Backend cumpre 3 papéis: status para a UI, enforcement e auditoria.
- Service: [src/services/mfaService.js](src/services/mfaService.js):
  - `extractAal(token)` decodifica JWT (sem revalidar, o `authenticateToken` já validou via `getUser`) e lê o claim `aal`. Fallback em `amr` (presença de `totp` ⇒ `aal2`).
  - `getStatus({userId, accessToken})` combina `supabase.auth.admin.mfa.listFactors()` + flag `mfa_required` + AAL atual.
  - `isMfaRequiredFor(userId)` resolve via `featureFlagService.listForUser` (layered: per-user → global → false).
  - `shouldBlock({userId, accessToken})` true se flag ativa **e** sessão `aal !== 'aal2'`. Fail-open em erro.
  - `logEvent({userId, action, factorId, friendlyName, req})` grava no audit_log (`entity_type=mfa_factor`). Whitelist: `mfa_enrolled/verified/unenrolled/challenge_failed`.
- Middleware: [src/middleware/mfaMiddleware.js](src/middleware/mfaMiddleware.js):
  - `requireMFA` → 403 `{ code: 'MFA_REQUIRED' }` quando bloqueio aplica. Bypass em rota pública, flag off, ou erro inesperado.
- Endpoints em [src/routes/user.routes.js](src/routes/user.routes.js):
  - `GET /api/user/mfa/status` — devolve `{ aal, mfa_required, enrolled, factors[] }`.
  - `POST /api/user/mfa/event` — frontend reporta enroll/verify/unenroll/challenge_failed para audit.
- `requireMFA` aplicado em 6 mutações financeiras críticas em [src/routes/dashboard.routes.js](src/routes/dashboard.routes.js):
  - `PUT /transactions/:id`, `DELETE /transactions/:id`, `PATCH /prolabore/:id`, `POST /alter/antecipacao/executar`, `POST /alter/antecipacao/parar-automatica`, `POST /alter/pagar-fornecedor/executar`.
- Sem migration nova (Supabase já gerencia `auth.mfa_factors` no schema `auth`).
- Suíte: [tests/unit/mfaService.test.js](tests/unit/mfaService.test.js) (17 casos — extração de AAL/AMR, status, shouldBlock, logEvent, middleware bypass/block/fail-open). Regression suite: **165 testes verde**.
- Rollout: flag `mfa_required` fica desligada por default; ativar gradualmente após UI de enrollment estar em produção (per-user override em `feature_flags` para piloto, depois global).
- Frontend pendente: `/configuracoes/seguranca` (enrollment + lista de factors) + interceptor global de re-verify ao receber 403/MFA_REQUIRED.

### Fase 19 — LGPD: export + esquecimento (backend)
- Migration: [supabase/migrations/20260508000050_create_account_deletion_tokens.sql](supabase/migrations/20260508000050_create_account_deletion_tokens.sql) (aplicada em produção via MCP). Tabela com TTL 24h, RLS, índice parcial em tokens ativos.
- Service: [src/services/lgpdService.js](src/services/lgpdService.js):
  - `collectUserData()` varre 28 tabelas com `user_id` + `parcelas` (via JOIN em `atendimentos.id`). Retorna dump JSON estruturado por tabela com `summary` de contagem.
  - `requestDeletionToken()` cria token com TTL 24h; reaproveita token ativo recente (<60min).
  - `consumeDeletionToken()` valida expiração + usado_em (codes: `TOKEN_MISSING/INVALID/USED/EXPIRED`).
  - `executeDeletion()` pipeline: `cancelSubscription` → `anonymizeAuditLog` → `purgeOperationalData` → `softDeleteProfile`. Cada step degrada graciosamente.
  - `anonymizeAuditLog` zera `user_id`/`ip_address`/`user_agent` em audit_log (preserva action/entity para auditoria sem PII).
  - `softDeleteProfile` zera nome/clínica/telefone/email/cidade + `is_active=false` + `deactivated_at`. Email vira `deleted-<uuid>@lumiz.deleted` (placeholder único).
- Templates email: [src/copy/lgpdEmailCopy.js](src/copy/lgpdEmailCopy.js) — export (com anexo JSON) e confirmação (link `${FRONTEND_URL}/conta/confirmar-exclusao?token=...`).
- Endpoints em [src/routes/user.routes.js](src/routes/user.routes.js):
  - `GET /api/user/export-data` — auth Bearer. Suporta `?download=true` para inline. Padrão: envia anexo por email + 202 com summary.
  - `DELETE /api/user/account` — auth Bearer. Gera token e envia email. Idempotente em <60min.
  - `POST /api/user/account/confirm-delete` — público (autenticado pelo token). Body `{token}`. Resposta inclui `summary.purged_tables`.
- Suíte: [tests/unit/lgpdService.test.js](tests/unit/lgpdService.test.js) (21 casos). Regression suite: **148 testes verde**.
- Frontend pendente: configurações → privacidade + página `/conta/confirmar-exclusao`.

### Fase 15 — Audit log (backend)
- Migration: [supabase/migrations/20260508000040_create_audit_log.sql](supabase/migrations/20260508000040_create_audit_log.sql) (aplicada em produção via MCP).
- Service: [src/services/auditLogService.js](src/services/auditLogService.js) — `log()` fire-and-forget, `list()` paginado, `extractContext()` para IP/UA, mascaramento recursivo de chaves sensíveis.
- Integração nas 11 mutações mais críticas do dashboard (transactions, goals, prolabore, estoque, alter executar, supplier docs).
- Endpoint: `GET /api/dashboard/audit-log` com filtros `entity_type`, `action`, `limit`, `offset` e `meta` empty state.
- Suíte: `tests/unit/auditLogService.test.js` (14 casos). Regression suite: 127 testes verde.

### Fase 15 — Audit log (frontend UI) — 09/05/2026

- Repo **lumiz-financeiro**: branch `feat/audit-log-fase15`, commit `530c206`, push OK → `origin/feat/audit-log-fase15`. PR contra `main` a abrir (sem inventar URL).
- Rota `/dashboard/configuracoes/audit-log` integrada ao endpoint `GET /api/dashboard/audit-log` com filtros e paginação.
- Nota: ambiente local com disco cheio dificulta `git fetch` e anexos de evidência — screenshots/PR link podem ficar pendente até liberar espaço.

### Fase 13 — Export OFX para contador (backend)
- [src/services/exportService.js](src/services/exportService.js) ganhou `exportOFX(userId, monthStr)`:
  - OFX 2.0 (XML) com BOM UTF-8.
  - `<STMTTRN>` por transação: TRNTYPE/DTPOSTED/TRNAMT/FITID/NAME/MEMO.
  - FITID prefixado E/S (entrada/saída) evitando colisão de UUID compartilhado.
  - Truncate antes de escape XML; transações inválidas (valor 0, data ruim) descartadas.
  - LEDGERBAL = entradas - saídas do período.
- [src/routes/dashboard.routes.js](src/routes/dashboard.routes.js) — endpoint `GET /api/dashboard/export/report` agora aceita `format=ofx`. PDF/CSV inalterados.
- Bug fix de passagem em `exportCSV`: aceita `transacoes` (PT) além de `transactions` (alias EN). Antes, CSV vinha vazio porque o método retornava `transacoes` mas o serviço iterava `transactions`.
- Suíte: `tests/unit/exportServiceOfx.test.js` (10 casos). Regression suite agora 113 testes.
- Frontend pendente: botão "OFX (Contador)" em `ExportButtons.tsx`.

### Variáveis de ambiente novas
Ver bloco completo em [HANDOFF_BACKEND.md](HANDOFF_BACKEND.md). Resumo:
- `WHISPER_MODEL`, `WHISPER_LANGUAGE`, `CAPTURE_LOW_CONFIDENCE_THRESHOLD`.
- `ALTER_ENABLED`, `ALTER_API_URL`, `ALTER_API_KEY`, `ALTER_FEE_SPOT_PCT`, `ALTER_FEE_SPOT_MIN_PCT`, `ALTER_FEE_SPOT_MAX_PCT`.
- `ALTER_RECOMEND_SAFETY_PCT`, `HEALTH_SCORE_COBERTURA_FORNECEDOR_PESO`.
- `FEATURE_FLAGS` (JSON env opcional).
