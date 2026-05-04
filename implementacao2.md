# Lumiz — Monitoramento de Implementação (Phases 1–6)

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
| `GET` | `insights/sazonalidade?months=` *(opcional; default comportamental 12)* |
| `GET` | `insights/custo-procedimentos?months=` *(opcional; default 3)* |
| `GET` | `insights/simular-desconto?procedimento_id=&desconto_pct=` *(aliases: `procedimentoId`, `descontoPct`)* |
| `GET` | `goals/caminho` |
| `GET` | `emergency/detalhes` |

#### Validações principais (query / body)

- **`GET goals/monthly`:** `year` e `month` inteiros obrigatórios; `month` ∈ `1..12`; `year` inteiro válido (sem clamp explícito de faixa).
- **`PUT` / `POST` `goals/monthly` *(JSON body)*:** `year`, `month` inteiros (`month` `1..12`); `meta_receita` número finito `>= 0`.
- **`GET inadimplencia/cliente/:clienteId`:** `:clienteId` UUID (regex estrita); senão `400`.
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
POST /api/dashboard/goals/monthly
GET /api/dashboard/health/score
GET /api/dashboard/inadimplencia/overview
GET /api/dashboard/inadimplencia/cliente/:clienteId
GET /api/dashboard/insights/sazonalidade

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
| §2b Validade / NF | Lumiz (futuro) | Pipeline NF não fechado. |
| §2c Emissão NF | Fora / terceiros | — |
| §2f Pagamento distribuidor via recebível | Alter | **Alter** |
| §3a–c Lucro/caixa 6 meses, CMV | Lumiz (gap) | Projeção curta; **6 meses / CMV** = backlog (não Alter). |
| §3d–f Agenda recebível, antecipação, cobertura fornecedor | Alter | **Alter** |
| §3g Score saúde | Misto | **GET /health/score**; refinement com recebível = **Alter**. |
| §3h Economia se não antecipar | Alter | **Alter** |
| §4 Estoque + compras + histórico fornecedor | Lumiz (parcial) | Estoque; histórico compras **gap** (sem cruzar recebível Alter). |
| §5 Sazonalidade, margens, benchmark | Misto | **Sazonalidade** OK; margens/evolução parcial (custo real **Phase 6**); benchmark **gap**. |
| §6 Custo real, preço mínimo, desconto, prejuízo | Misto | **Phase 3 + 6**; custo total com antecipação no centavo = **Alter**. |
| §7 Inadimplência, risco, régua WhatsApp, **impacto no caixa** | Lumiz | Overview + detalhe; `percentualFaturamento`, **`mensagemImpacto`**, `faturamentoMesReferencia`; régua **Phase 1**. |
| §8 Simulador “e se?” | Misto | Cenário base **Phase 3**; troca maquininha / parar antecipar / recebível = **Alter**; funcionária / preço / segunda sala = **backlog**. |
| §9 Calendário preditivo, dias negativos | Lumiz | Calendário + projeção; **`caixaNegativo` por dia** e `temProjecaoCaixaNegativo` na projeção (PDF §9b). |
| §10 Meta lucro/reserva + caminho | Misto | Meta receita **monthly_goals** + **caminho**; meta reserva = **gap**. |
| §11 Relatório sócio PDF/email | Misto | **Export**; envio automático = **gap** (cron). |
| §12 Emergência | Misto | **emergency** + detalhes; priorização fina com recebível travado = **Alter**. |

**Próximos blocos sugeridos (só Lumiz, sem Alter):** projeção multi-mês; simulador multi-cenário (sem MDR Alter); histórico compras por fornecedor; meta reserva; relatório mensal automatizado.

**Alteração recente (API para dashboard):**

- `GET /api/dashboard/cashflow/projection` — cada item em `days` inclui `caixaNegativo` (boolean). `summary` inclui `diasComCaixaNegativo`, `primeiroDiaCaixaNegativo`, `temProjecaoCaixaNegativo`.
- `GET /api/dashboard/inadimplencia/overview` — resposta inclui `mensagemImpacto`, `faturamentoMesReferencia`, `periodoFaturamentoReferencia` (além de `totalEmAtraso` e `percentualFaturamento` já existentes).

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

## Definition of Done — backend Phases 1–6 (fecho)

- **Rotas:** todas as entradas do bloco “Resumo de todos os endpoints” (Phase 1–6) existem em [`src/routes/dashboard.routes.js`](src/routes/dashboard.routes.js) (e crons em [`src/server.js`](src/server.js) onde aplicável).
- **Base de dados:** `monthly_goals` definida em [`supabase/migrations/20260505000001_create_monthly_goals.sql`](supabase/migrations/20260505000001_create_monthly_goals.sql); **produção (projeto Lumiz)** aplicada via migration remota / MCP. Outros ambientes: `supabase db push` ou SQL manual.
- **Regressão automática:** `npm run test:regression` — slice `estoqueService` + `cashflowService`, Redis cache/fila desligados, `--forceExit` (evita processo preso por BullMQ).
- **Smoke de módulo:** `node -e "require('./src/routes/dashboard.routes.js'); setTimeout(()=>process.exit(0),1000)"` na raiz (avisos Redis/`ENOTFOUND` em local sem Railway são esperados).
- **Sanidade pós-deploy (manual):** Railway com o mesmo commit que o repo; chamadas com Bearer às rotas listadas em [`HANDOFF_BACKEND.md`](HANDOFF_BACKEND.md).

---

## Handoff — backend / deploy

**Onde registrar:** checklist operacional em **[`HANDOFF_BACKEND.md`](HANDOFF_BACKEND.md)** (prioridade para o agente de backend). Ponteiros para o frontend em [`lumiz-financeiro/HANDOFF_FRONTEND.md`](lumiz-financeiro/HANDOFF_FRONTEND.md).

- [x] **Meta mensal HTTP** — `PUT` e **`POST`** em `/api/dashboard/goals/monthly` com o mesmo body (`year`, `month`, `meta_receita`). O cliente em [`lumiz-financeiro/src/services/dashboard-api.ts`](lumiz-financeiro/src/services/dashboard-api.ts) usa `PUT`.
- [x] **Migration `monthly_goals`** — migration no repo + **aplicada em produção (Supabase projeto Lumiz)**. Clones/staging: correr `supabase db push` ou aplicar o ficheiro SQL se ainda não existir a tabela.
- [ ] **Deploy / sanidade** — Railway na revisão alinhada a `main`; validar rotas em [`HANDOFF_BACKEND.md`](HANDOFF_BACKEND.md) com token real (passo humano após cada release).

- feito pelo Cursor no backend
