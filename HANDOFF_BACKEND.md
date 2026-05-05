# Handoff Backend (Lumiz)

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
