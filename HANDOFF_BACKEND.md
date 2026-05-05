# Handoff Backend (Lumiz)

## Fases 7 e 8 — contrato (alinhado ao frontend)

- **Pró-labore**
  - `GET /api/dashboard/prolabore` — lista contas com `is_pro_labore` (e totais conforme implementação do serviço).
  - `PATCH /api/dashboard/prolabore/:id` — body `{ is_pro_labore: boolean }`.
  - `GET /api/dashboard/summary` — `pro_labore_mensal`, `pro_labore_ratio_receita` (alerta &gt; 15% no front).
  - Campo em `contas_pagar`: `is_pro_labore` (migration `20260504000001_prolabore_flag.sql`).

- **Colaboradores e comissões**
  - `GET|POST /api/dashboard/colaboradores`
  - `PUT|DELETE /api/dashboard/colaboradores/:id`
  - `GET /api/dashboard/colaboradores/:id/comissoes?month=YYYY-MM`
  - Custo real / precificação: endpoint de insights de custo por procedimento (ex. `GET /api/dashboard/insights/custo-procedimentos`) inclui `comissao_media` e `custo_total_real` com comissão embutida (`procedimentoCustoService`).

## Fases 9 e 10 — suporte backend para execução do frontend

As fases 9 e 10 são majoritariamente frontend. No backend, o foco é garantir contrato estável e smoke de rotas.

- **Contrato disponível para Fase 9 (empty/sparse):**
  - Não há endpoint novo. Os estados de empty/sparse devem usar respostas já existentes (arrays vazios, totais zerados, histórico curto).

- **Contrato disponível para Fase 10 (páginas faltando):**
  - `GET /api/dashboard/estoque`
  - `GET /api/dashboard/nf-validade`
  - `GET /api/dashboard/inadimplencia/overview`
  - `GET /api/dashboard/insights/sazonalidade`
  - `GET /api/dashboard/health/score`
  - `GET /api/dashboard/insights/custo-procedimentos`
  - `GET /api/dashboard/emergency/detalhes`
  - `GET /api/dashboard/insights/outlook`
  - `GET /api/dashboard/clientes/perfil-pagamento`
  - `GET /api/dashboard/insights/margem-comparativa`

- **Checklist de smoke backend (enquanto frontend implementa):**
  - Verificar autenticação em todas as rotas acima (`401` sem token).
  - Verificar payload vazio sem erro (`200` com lista vazia/objeto default).
  - Verificar parâmetros opcionais (`month`, `months`, filtros) sem regressão.
  - Confirmar limites de rota onde aplicável (`heavyDashboardReadLimiter`).

## Novas entregas deste bloco

- `GET /api/dashboard/clientes/perfil-pagamento`
  - serviço: `src/services/clientePerfilService.js`
  - retorna perfil por cliente (`formas_usadas`, `forma_preferida`, `ticket_medio`, `indice_risco_pagamento`).

- `GET /api/dashboard/insights/margem-comparativa`
  - serviço: `src/services/margemAlertaService.js`
  - compara margem mês atual vs anterior; inclui diagnóstico e recomendação.

- `POST /api/dashboard/reports/send-email?month=YYYY-MM`
  - serviço: `src/services/emailReportService.js`
  - status: `{ success: true }` ou `{ skipped: true, reason }`.

## Cron atualizado

- Cron diário 8h (`src/server.js`) agora também executa:
  - `margemAlertaService.checkAndAlertMargemCaindo()`
- Cron mensal mantém WhatsApp e, no mesmo fluxo, chama e-mail:
  - `monthlyReportDeliveryService` -> `emailReportService.sendMonthlyReportEmail()`

## Variáveis de ambiente

- Opcional: `RESEND_API_KEY`
  - sem chave: fluxo degrada graceful com `skipped: missing_api_key`.

## Dependências

- Adicionada: `resend`

## Testes

- `tests/unit/clientePerfilService.test.js`
- `tests/unit/margemAlertaService.test.js`
- `tests/unit/emailReportService.test.js`
- `npm run test:regression` atualizado e aprovado.

## Smoke local

- `node -e "require('./src/routes/dashboard.routes.js'); setTimeout(()=>process.exit(0),500)"`
