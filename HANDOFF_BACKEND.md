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

**Migration no repositório:** [`supabase/migrations/20260505000001_create_monthly_goals.sql`](supabase/migrations/20260505000001_create_monthly_goals.sql) — `UNIQUE (user_id, year, month)`, FK para `profiles(id)`, RLS para `authenticated`.

**Produção:** aplicada no projeto Supabase **Lumiz** (migration remota `create_monthly_goals`). **Outros ambientes** (local, branch preview): `supabase db push` ou executar o SQL no dashboard se a tabela ainda não existir.

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
| GET | `/api/dashboard/insights/outlook` |
| GET | `/api/dashboard/estoque/compras-por-fornecedor` |
| GET | `/api/dashboard/simulator/scenarios` |

Todas estão definidas em [`src/routes/dashboard.routes.js`](src/routes/dashboard.routes.js). Validar em staging/produção com token de utilizador real após deploy.

**Simulador — preset num único cenário:** `GET /api/dashboard/simulator/scenario?scenario=extra_staff|price_hike|second_room` com overrides opcionais (`staff_monthly_cost`, `price_hike_pct` ou `pct`, `rent_extra`). Sem `scenario`, o comportamento continua só com `extra_revenue`, `cut_expense_pct`, `new_fixed_cost`.

---

## Smoke e regressão (gate antes de dar backend por fechado)

Na raiz do repo `lumiz-backend`:

```bash
npm run test:regression
```

Smoke de carregamento do router (processo deve terminar sozinho após ~1s):

```bash
node -e "require('./src/routes/dashboard.routes.js'); setTimeout(()=>process.exit(0),1000)"
```

**Nota:** com `REDIS_URL` a apontar para um host inacessível em local, podem aparecer logs de erro Redis/BullMQ; o importante é exit code `0` no smoke. O script `test:regression` desliga cache e fila MDR para o Jest não ficar pendurado.

---

## Referência de documentação interna

- Plano geral de implementação backend: [`implementacao2.md`](implementacao2.md) (inclui *Definition of Done* e *Handoff — backend / deploy*).
- Plano de telas/contratos no frontend: [`lumiz-financeiro/implementacao2FRONTEND.md`](lumiz-financeiro/implementacao2FRONTEND.md).
