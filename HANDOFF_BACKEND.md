# Handoff — Backend (pós implementações no frontend)

Documento curto para o agente/setor responsável pelo **lumiz-backend** alinhar banco e deploy com o dashboard web (`lumiz-financeiro`).

---

## 1. Meta mensal — contrato HTTP (`/api/dashboard/goals/monthly`)

- **Frontend:** `setMonthlyGoal` em [`lumiz-financeiro/src/services/dashboard-api.ts`](lumiz-financeiro/src/services/dashboard-api.ts) usa **`PUT`** com body `{ year, month, meta_receita }`.
- **Backend:** [`src/routes/dashboard.routes.js`](src/routes/dashboard.routes.js) expõe **`PUT`** e **`POST`** no mesmo path (mesmo handler)—`POST` serve clientes legados ou ferramentas que só enviam POST.

Handoff resumido para o outro setor: [`lumiz-financeiro/HANDOFF_FRONTEND.md`](lumiz-financeiro/HANDOFF_FRONTEND.md).

---

## 2. Tabela `monthly_goals` — migration no repo

O código usa `monthly_goals` em:

- [`src/routes/dashboard.routes.js`](src/routes/dashboard.routes.js) — `GET` / `PUT` / `POST` em `/goals/monthly`.
- [`src/services/metaCaminhoService.js`](src/services/metaCaminhoService.js) — leitura da meta.

**Migration adicionada:** [`supabase/migrations/20260505000001_create_monthly_goals.sql`](supabase/migrations/20260505000001_create_monthly_goals.sql) — tabela com `UNIQUE (user_id, year, month)`, FK para `profiles(id)`, RLS para `authenticated`.

**Ação em produção:** aplicar no Supabase (`supabase db push` ou executar o SQL no dashboard). Até lá, `GET`/`PUT`/`POST` de meta podem falhar com erro de relação inexistente.

---

## 3. Checklist deploy / sanidade (Railway + Supabase)

Confirmar que a versão deployada no Railway inclui as rotas usadas pelo dashboard estendido:

| Método | Path |
|--------|------|
| GET | `/api/dashboard/health/score` |
| GET | `/api/dashboard/inadimplencia/overview` |
| GET | `/api/dashboard/inadimplencia/cliente/:clienteId` |
| GET | `/api/dashboard/insights/sazonalidade` |
| GET | `/api/dashboard/insights/custo-procedimentos` |
| GET | `/api/dashboard/insights/simular-desconto` |
| GET | `/api/dashboard/goals/caminho` |
| GET | `/api/dashboard/emergency/detalhes` |
| GET | `/api/dashboard/export/report` |

Todas estão definidas em [`src/routes/dashboard.routes.js`](src/routes/dashboard.routes.js). Após aplicar o item 2 (`monthly_goals`), validar em staging/produção com token de utilizador real.

---

## Referência de documentação interna

- Plano geral de implementação backend: [`implementacao2.md`](implementacao2.md) (inclui seção *Handoff pendente — backend (post-frontend)*).
- Plano de telas/contratos no frontend: [`lumiz-financeiro/implementacao2FRONTEND.md`](lumiz-financeiro/implementacao2FRONTEND.md).
