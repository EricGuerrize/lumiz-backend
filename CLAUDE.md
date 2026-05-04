# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # nodemon (desenvolvimento local)
npm start            # produção
npm run test:unit    # testes unitários com cobertura
npm run test:regression  # gate Phases 1–6: estoque + cashflow, Redis cache/fila off (ver implementacao2.md)
npm run test:integration
npm run test:e2e
npm run check:rls    # verifica políticas RLS do Supabase
```

Run a single test file: `npx jest tests/unit/moneyParser.test.js`
Run by name pattern: `npx jest --testNamePattern="extractInstallments"`

## Architecture

### Request flow (WhatsApp → backend)

```
Evolution API (WhatsApp) → POST /api/webhook → messageController.js
  ├─ if user not onboarded → onboardingController.js → onboardingFlowService.js
  │    └─ step handlers: src/services/onboarding/{profile,context,ahaRevenue,ahaCosts,mdr,summary}Handlers.js
  └─ if onboarded → MessageController (class in messageController.js)
       ├─ intentHeuristicService.js (fast regex pre-check before LLM)
       ├─ geminiService.js (intent classification via LLM)
       └─ delegates to: src/controllers/messages/{transaction,query,document,edit,search,goal,help,installment,export,schedule,insights,member}Handler.js
```

### Key services

| Service | Role |
|---|---|
| `geminiService.js` | All Gemini LLM calls (intent, OCR, extraction) |
| `evolutionService.js` | Sends WhatsApp messages via Evolution API |
| `onboardingFlowService.js` | ~2200-line state machine; owns all onboarding steps |
| `intentHeuristicService.js` | Regex heuristics to skip LLM on obvious intents |
| `mdrChatFlowService.js` | Conversational flow for MDR (card machine rate) setup post-onboarding |
| `mdrOcrService.js` / `mdrPricingService.js` | MDR document extraction and rate comparison |
| `cacheService.js` | Redis cache wrapper (degrades gracefully if Redis absent) |
| `mdrService.js` | BullMQ queue worker for async MDR processing |
| `subscriptionService.js` | Trial + paid plan logic (Asaas payment gateway) |

### Config & prompts

- `src/config/prompts.js` — all LLM prompts. Key builders:
  - `buildDocumentExtractionPrompt()` — OCR for invoices/receipts
  - `buildIntentClassificationPrompt()` — classify free-text user messages
  - `buildMdrExtractionPrompt()` — extract card machine rates from uploaded docs
- `src/config/env.js` — validates required env vars on startup; fails hard in production
- `Lumiz Contexto Financeiro SystemPrompt.md` — business context injected into LLM prompts via `CONTEXTO_CLINICAS`, `JARGOES_FINANCEIROS`, `REGRAS_OURO` constants in `prompts.js`

### WhatsApp copy

All user-facing WhatsApp message text lives in `src/copy/onboardingWhatsappCopy.js` and `src/copy/mdrWhatsappCopy.js`. Never hardcode message strings in service/controller files.

### Database

- Supabase (PostgreSQL + RLS)
- Client: `src/db/supabase.js` (service-role key, bypasses RLS for backend)
- Migrations: `supabase/migrations/` — apply via `supabase db push`
- Admin-only queries that need to bypass RLS use `SECURITY DEFINER` RPCs (see `src/routes/admin.routes.js`)

### Redis (optional)

Two independent flags:
- `REDIS_CACHE_ENABLED` — response caching via `cacheService.js`
- `REDIS_QUEUE_ENABLED` — BullMQ queues for async MDR document processing

Both degrade gracefully to synchronous/no-cache mode when Redis is unavailable.

### Runtime conversation state

`conversationRuntimeStateService.js` persists in-flight conversation state (e.g., `awaiting_data`) to Supabase so it survives process restarts. `MessageController` keeps an in-memory `Map` as L1 cache and syncs to this service.

### Onboarding step machine

Steps flow: `START → CONSENT → PROFILE_* → CONTEXT_* → AHA_REVENUE* → AHA_COSTS* → BALANCE_* → MDR_SETUP_*`

Each handler group is in `src/services/onboarding/`. The orchestrator (`onboardingFlowService.js`) routes by `currentStep` field in the `profiles` table.

### Infrastructure

- Deployed on Railway (`railway.toml`, `nixpacks.toml`)
- Frontend dashboard: `lumiz-financeiro/` (separate Vite/React app, deployed to Vercel)
- Sentry for error tracking (`src/instrument.js` — must be imported first in `server.js`)
- Cron endpoint: `GET /api/cron/reminders` (called by Railway cron, protected by `CRON_SECRET`)
