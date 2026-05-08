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

---

# Onda 1–4: Captura multimodal + Supplier Docs + Alter mock + Empty States

> Plano de referência: `.cursor/plans/backend_completo_financeiro_alter_whatsapp_91e0e02c.plan.md`.
> ROADMAP: ver `ROADMAP.md` (fases 11, 16, 20.4 atualizadas).

## Onda 1 — Captura WhatsApp multimodal + confidence score

### Áudio (Whisper)
- Webhook (`src/routes/webhook.js`) detecta `audioMessage`, baixa via Evolution, transcreve via `audioTranscriptionService.transcribe(buffer, mimeType)`, prefixa `🎤 _Entendi assim:_` e injeta no fluxo de texto.
- Limite: 25 MB / até 2 min.
- Modelo: `WHISPER_MODEL` (default `whisper-1`), idioma `WHISPER_LANGUAGE` (default `pt`).

### Confidence score
- Prompts (`src/config/prompts.js`) retornam `confidence_score: 0..1` em `buildIntentClassificationPrompt` e `buildDocumentExtractionPrompt`.
- `transactionHandler` e `documentHandler` usam `src/copy/captureConfirmCopy.js`:
  - Threshold `CAPTURE_LOW_CONFIDENCE_THRESHOLD` (default `0.8`).
  - Banner `🤔 *Não tenho 100% de certeza, confere por favor:*` injetado quando `confidence_score < threshold`.
- Estado `awaiting_data` mantido via `conversationRuntimeStateService`.

## Onda 2 — Supplier Documents (NF/Boleto/Comprovante) → contas_pagar + estoque

### Schema novo
- `supabase/migrations/20260507000020_create_supplier_documents.sql` cria `supplier_documents`.
- `20260507000021_fornecedores_extra_fields.sql` adiciona `cnpj`, `email`, `whatsapp`.
- `20260507000022_contas_pagar_origem_parcelas.sql` adiciona `origem`, `supplier_document_id`, `fornecedor_id`, `parcela_numero`, `parcela_total`.

### Endpoints
| Método | Rota | Notas |
|---|---|---|
| GET | `/api/dashboard/supplier-documents` | filtros: `status`, `limit` |
| GET | `/api/dashboard/supplier-documents/:id` | retorna parsed_json + status |
| POST | `/api/dashboard/supplier-documents/process` | sobe arquivo, extrai e persiste |
| POST | `/api/dashboard/supplier-documents/:id/link-fornecedor` | body `{ fornecedor_id }` |
| POST | `/api/dashboard/supplier-documents/:id/match-itens` | body `{ matches: [{descricao, procedimento_id, quantidade}] }` |
| GET\|POST\|PUT\|DELETE | `/api/dashboard/fornecedores[/:id]` | CRUD fornecedores |
| GET | `/api/dashboard/contas-a-receber` | aging buckets + mix forma de pagamento |

### WhatsApp
- Ao detectar NF/Boleto/Comprovante: `documentHandler` salva `supplier_document` em estado `pending`, manda copy em `src/copy/supplierDocWhatsappCopy.js` e aguarda confirmação 1/2/3. Confirmação cria `contas_pagar` (parcelas) e aplica estoque via `supplierDocumentService.applyEstoqueEntradaFromItens`.

## Onda 3 — Alter pré-pronta com adapter mockado

### Schema novo
- `20260507000030_create_feature_flags.sql`
- `20260507000031_create_alter_recebiveis.sql`
- `20260507000032_create_alter_antecipacoes.sql`
- `20260507000033_create_alter_cobertura_snapshots.sql`

### Adapter
- Contrato: `src/services/alter/alterAdapterContract.js` — interface base com `NotImplementedError`.
- Mock: `src/services/alter/mockAlterAdapter.js` — deriva `alter_recebiveis` de `parcelas` + `mdr_configs`. Custo spot configurável: `ALTER_FEE_SPOT_PCT` (default 2.5%), `ALTER_FEE_SPOT_MIN_PCT` (1.5%), `ALTER_FEE_SPOT_MAX_PCT` (4.5%).
- Real: `src/services/alter/realAlterAdapter.js` — stub; lança `NotImplementedError` enquanto `ALTER_API_URL`/`ALTER_API_KEY` não definidos.
- Factory: `src/services/alter/alterAdapter.js` resolve por env (`ALTER_API_URL` + `ALTER_API_KEY` → real; senão → mock).

### Services
- `alterRecebiveisService` — list/getPosicao/getAging/getMix.
- `antecipacaoService` — simular/executar/recomendar/pararAutomatica.
- `coberturaFornecedorService` — calcular cobertura por fornecedor + snapshots.
- `pagarComRecebivelService` — sugerir/executar pagamento com recebíveis.
- `alterInsightCronService` — cron semanal de insight via WhatsApp.

### Feature flag (Fase 16)
- `featureFlagService.isEnabled(flag, userId)` resolve em camadas: tabela por user → tabela global → `FEATURE_FLAGS` JSON env → env booleano (`ALTER_ENABLED`) → default false.
- Middleware `requireFeature(flag)` em `src/services/featureFlagService.js`.
- Whitelist exposta ao frontend: `src/config/featureFlagsRegistry.js` (flags conhecidas + descrição + default). Flags fora do registry NÃO são devolvidas pelo `/api/config/features`.
- Endpoint público `GET /api/config/features` (auth opcional, sempre 200):
  - Bearer token válido → propaga `user_id` em `resolvedFor` e no merge.
  - Sem token / token inválido → resolve apenas globais/env (`resolvedFor.user_id = null`).
  - DB indisponível → degrada para defaults (`false`) sem 5xx.
  - Resposta: `{ flags: { alter_enabled, excel_import, ofx_export, multi_tenant, audit_log, posthog_enabled, mfa_required, lgpd_self_service }, descriptions, resolvedFor, meta: { generated_at } }`.

### Endpoints (todos atrás de `requireFeature('alter_enabled')`)
| Método | Rota | Body / Query |
|---|---|---|
| GET | `/api/dashboard/alter/recebiveis` | `status`, `adquirente`, `from`, `to` |
| GET | `/api/dashboard/alter/recebiveis/aging` | — |
| GET | `/api/dashboard/alter/recebiveis/mix` | — |
| GET | `/api/dashboard/alter/antecipacao/sugestao` | `horizonte_dias` (default 30) |
| POST | `/api/dashboard/alter/antecipacao/simular` | `{ valor_alvo, horizonte_dias }` |
| POST | `/api/dashboard/alter/antecipacao/executar` | `{ valor_alvo, horizonte_dias, simulacao? }` |
| POST | `/api/dashboard/alter/antecipacao/parar-automatica` | — |
| GET | `/api/dashboard/alter/cobertura` | `horizonte_dias`, `snapshot=true` |
| POST | `/api/dashboard/alter/pagar-fornecedor` | `{ supplier_document_id?, conta_pagar_id? }` |
| POST | `/api/dashboard/alter/pagar-fornecedor/executar` | `{ recebiveis_ids[], conta_pagar_id? }` |

### Health Score
- `healthScoreService.getScore(userId)` ganha 5º componente `cobertura_fornecedor` quando `alter_enabled` ligado. Peso configurável: `HEALTH_SCORE_COBERTURA_FORNECEDOR_PESO` (default 10 pontos). Fallback graceful se cobertura falhar.

### Cron novo
- `GET /api/cron/alter-insights` (header `x-cron-secret`) — roda `alterInsightCronService.run()`. Configurar Railway cron em sexta 18h.
- Idempotência semanal via `feature_flags(name='alter_insight_last_sent')`.

## Onda 4 — Empty states & contratos consistentes

- Endpoints novos retornam `meta: { is_empty: boolean, hint: string|null }` quando não há dados suficientes:
  - `contas-a-receber`, `alter/recebiveis`, `alter/recebiveis/aging`, `alter/recebiveis/mix`, `alter/antecipacao/sugestao`, `alter/cobertura`, `alter/pagar-fornecedor`.
- `meta.confianca` (`baixa`/`media`/`alta`) ainda em endpoints existentes (sazonalidade/outlook/pricing) quando aplicável.

## Variáveis de ambiente novas

- `OPENAI_API_KEY` (já existia; reforçado) — usado por Whisper e Vision quando ativo.
- `WHISPER_MODEL`, `WHISPER_LANGUAGE` — opcionais; defaults `whisper-1` / `pt`.
- `CAPTURE_LOW_CONFIDENCE_THRESHOLD` — default `0.8`.
- `ALTER_ENABLED` — boolean, ativa rotas Alter (alternativa: registro em `feature_flags`).
- `ALTER_API_URL`, `ALTER_API_KEY` — opcionais; quando ambos definidos, factory usa `realAlterAdapter`.
- `ALTER_FEE_SPOT_PCT` / `ALTER_FEE_SPOT_MIN_PCT` / `ALTER_FEE_SPOT_MAX_PCT` — taxas mock spot.
- `ALTER_RECOMEND_SAFETY_PCT` — buffer de segurança em `antecipacaoService.recomendar` (default 0.10).
- `HEALTH_SCORE_COBERTURA_FORNECEDOR_PESO` — peso do novo componente (default 10).
- `FEATURE_FLAGS` — JSON env opcional (`{"alter_enabled":true}`).
- `CRON_SECRET` — protege `/api/cron/alter-insights`.

## Dependências

- `openai` (já em uso por `openaiService`/`audioTranscriptionService`).

## Testes

- `tests/unit/audioTranscriptionService.test.js`
- `tests/unit/captureConfirmFlow.test.js`
- `tests/unit/supplierDocumentService.test.js`
- `tests/unit/contasReceberService.test.js`
- `tests/unit/alterAdapter.contract.test.js`
- `tests/unit/alterRecebiveisService.test.js`
- `tests/unit/antecipacaoService.test.js`
- `tests/unit/coberturaFornecedorService.test.js`
- `tests/unit/pagarComRecebivelService.test.js`
- `tests/unit/configFeaturesEndpoint.test.js`
- `tests/unit/exportServiceOfx.test.js`
- `tests/unit/auditLogService.test.js`

## Matriz feature × endpoint × empty state

| Feature | Endpoint | Empty state | Hint padrão |
|---|---|---|---|
| Recebíveis | `/alter/recebiveis` | `data: []` | "Sem recebíveis no cartão ainda. Conforme registrar vendas parceladas, aparecem aqui." |
| Aging | `/alter/recebiveis/aging` | `total: 0`, buckets zerados | "Sem recebíveis em aberto. Quando começar a vender no cartão, a agenda aparece aqui." |
| Mix | `/alter/recebiveis/mix` | listas vazias | "Mix vai aparecer quando houver recebíveis no cartão." |
| Antecipação | `/alter/antecipacao/sugestao` | `entradas=0 saidas=0` | "Não tenho entradas e saídas suficientes para sugerir antecipação." |
| Cobertura | `/alter/cobertura` | `fornecedores: []` | "Sem contas a pagar com fornecedor no horizonte. Quando subir uma NF/boleto, a cobertura aparece aqui." |
| Pagar fornecedor | `/alter/pagar-fornecedor` | `cobertura: null` | "Nada a pagar para esses parâmetros." |
| Contas a receber | `/contas-a-receber` | `data: []` | "Você ainda não tem parcelas em aberto. Conforme registrar vendas parceladas, aparecem aqui." |

---

# Convenções de código (contrato vivo)

> Esta seção é referência para qualquer trabalho futuro no repo (humano ou
> agente). Quem editar código DEVE manter estes padrões.

## Documentação obrigatória

- Todo arquivo novo em `src/services/`, `src/controllers/`, `src/routes/` começa com bloco JSDoc descrevendo:
  1. Onda/fase do roadmap a que pertence (ex.: `Onda 3.B`, `Fase 16`).
  2. Responsabilidade única em uma frase.
  3. Dependências externas (DB, APIs, env vars).
- Métodos públicos de classes (sem prefixo `_`) recebem JSDoc com `@param` tipado e `@returns`.
- Métodos privados (prefixo `_`) recebem `@private` e comentário breve quando não-óbvios.
- Migrations recebem comentário no topo (`-- Onda X.Y — descrição curta`) e `COMMENT ON COLUMN` para campos não-óbvios.

## Organização

- **camadas**: `routes → controllers → services → db`. Routes nunca tocam Supabase direto; controllers nunca fazem regra de negócio pesada.
- **um service = uma responsabilidade**: se passar de ~400 linhas, considerar split (ex.: `alter/` é uma pasta com 6 services pequenos em vez de um `alterService.js` gigante).
- **copy fica em `src/copy/`**: mensagens WhatsApp NUNCA são hardcoded em service/controller. Centralizar em arquivo `*WhatsappCopy.js`.
- **prompts LLM ficam em `src/config/prompts.js`**: nunca espalhar em services.

## Empty states e meta

- Todo endpoint que pode devolver vazio inclui `meta: { is_empty: boolean, hint: string|null }` no payload — frontend renderiza `hint` direto sem precisar de string própria.
- Endpoints de insight (sazonalidade, outlook, pricing) ganham `meta.confianca: 'baixa'|'media'|'alta'` quando histórico é insuficiente.

## Feature flags

- Toda feature em rollout gradual usa `featureFlagService.requireFeature('flag_name')` como middleware. Nunca acoplar `if (process.env.X)` direto em routes.
- Nomes de flags em `snake_case`: `alter_enabled`, `multi_tenant_enabled`, etc.

## Naming

- Migrations: `YYYYMMDDHHMMSS_descricao_curta.sql` (timestamp em UTC, descrição em snake_case).
- Tabelas/colunas: `snake_case`, sempre em português quando for vocabulário de domínio (ex.: `contas_pagar`, `data_vencimento`).
- Services: `camelCaseService.js`. Classes em `PascalCase`. Helpers privados em `_camelCase` (prefixo underscore).
- Variáveis de env: `UPPER_SNAKE_CASE`. Booleanas terminam em `_ENABLED` ou `_OFF` quando aplicável.

## Testes

- Toda nova feature ganha test unit (`tests/unit/<service>.test.js`) que valida pelo menos 1 caso feliz + 1 caso de empty/erro.
- Suite de regressão (`npm run test:regression`) roda em < 5s, sem Redis e sem rede. Adicionar test à regressão somente se for autocontido.
- Anti-padrão a evitar: testar mocks (ver `~/.claude/skills/default/testing-anti-patterns/SKILL.md`).

## Commits

- Mensagens em PT-BR, prefixo conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- 1 commit por onda/fase quando possível. Cada commit deixa `npm run test:regression` verde.
- GPG desligado neste repo: `git -c commit.gpgsign=false commit`.

## Atualização de documentação ao mexer em código

Quem alterar código DEVE atualizar, na mesma PR/commit:

| Tipo de mudança | Atualizar |
|---|---|
| Endpoint novo ou contrato mudou | `HANDOFF_BACKEND.md` (tabela de endpoints + matriz empty state) |
| Migration nova | `ESTRUTURA_BANCO_DADOS.md` |
| Fase do roadmap concluída | `ROADMAP.md` (status na tabela + bloco da fase) |
| Variável de ambiente nova | `.env.example` + `HANDOFF_BACKEND.md` (seção env vars) |
| Onda do plano concluída | bloco "Phase 7+" em `implementacao2.md` |

## Débito técnico conhecido

- `alterInsightCronService._listTargetUsers` faz N+1 lookups de feature flag. Refatorar para RPC `select_users_with_feature_flag` quando a base passar de ~500 usuários ativos.
- `realAlterAdapter` é stub — os métodos lançam `NotImplementedError` enquanto sandbox/contrato Alter não chegam.
- `GET /api/config/features` é público (sem rate limiting próprio além do global). Avaliar inclusão no `userRateLimit` se virar rota muito chamada.
- `exportOFX` usa `BANKID=LUMIZ` (placeholder, não código bancário real). Alguns parsers contábeis exigem código de instituição numérico — se um cliente reclamar, expor `OFX_BANK_ID` como env var.

---

# Fase 13 — Export OFX

## Endpoints

| Método | Rota | Body / Query |
|---|---|---|
| GET | `/api/dashboard/export/report?format=ofx&month=YYYY-MM` | gera OFX 2.0 (BOM UTF-8) com `Content-Type: application/x-ofx; charset=utf-8` e `Content-Disposition: attachment; filename="extrato-YYYY-MM.ofx"` |

Os formatos existentes (`format=pdf`, `format=csv`, padrão `csv`) continuam funcionando sem mudança de contrato.

## Estrutura OFX gerada

- Header: `<?xml version="1.0" encoding="UTF-8"?>` + `<?OFX OFXHEADER="200" VERSION="200"...?>`.
- `<SIGNONMSGSRSV1>` com `<FI><ORG>Lumiz</ORG><FID>LUMIZ</FID></FI>`.
- `<BANKMSGSRSV1>` com 1 `<STMTTRNRS>`:
  - `<BANKACCTFROM>`: `BANKID=LUMIZ`, `ACCTID=LUMIZ-<sufixo userId 12 chars hex>`, `ACCTTYPE=CHECKING`.
  - `<BANKTRANLIST>` com `DTSTART`/`DTEND` no formato `YYYYMMDDHHMMSS[-3:BRT]` e 1 `<STMTTRN>` por transação.
  - `<LEDGERBAL>`: `BALAMT = entradas - saidas` do período.
- Cada `<STMTTRN>`:
  - `TRNTYPE`: `CREDIT` (entrada) ou `DEBIT` (saída).
  - `DTPOSTED`: data da transação às 12:00 BRT (evita drift de timezone).
  - `TRNAMT`: positivo para entrada, negativo para saída, 2 decimais.
  - `FITID`: `E<id-sanitizado>` ou `S<id-sanitizado>` (255 chars max). Prefixo previne colisão entrada↔saída quando UUIDs coincidem.
  - `NAME`: descrição truncada a 32 chars (limite OFX 2.0).
  - `MEMO`: categoria truncada a 255 chars (omitido se vazio).
- BOM UTF-8 (`\uFEFF`) prefixa o arquivo todo (compat Excel / Sage legacy).

## Garantias de robustez

- Truncate é aplicado **antes** do escape XML (preserva entities `&amp;`/`&lt;`/`&gt;`/`&quot;`/`&apos;`).
- Transação com valor 0 ou data inválida é silenciosamente descartada (preserva arquivo bem-formado mesmo com dados ruins).
- Mês vazio gera OFX válido com `<BANKTRANLIST>` sem `<STMTTRN>`.

## Frontend pendente

- Adicionar botão "OFX (Contador)" em `ExportButtons.tsx` apontando para `?format=ofx`. Ver prompt de handoff frontend.

---

# Fase 15 — Audit log

## Schema

Tabela `public.audit_log` (migration `20260508000040_create_audit_log.sql`):

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `user_id` | uuid | FK `profiles(id)` ON DELETE SET NULL |
| `clinic_id` | uuid | reservado para Fase 14 (multi-tenant) — hoje sempre NULL |
| `action` | varchar(100) | ex: `transaction_updated`, `goal_updated`, `estoque_entrada` |
| `entity_type` | varchar(50) | ex: `transaction`, `monthly_goal`, `supplier_document` |
| `entity_id` | text | UUID ou chave composta (`goal:2026:5`) |
| `old_value` | jsonb | snapshot anterior (mascarado) |
| `new_value` | jsonb | snapshot novo (mascarado) |
| `ip_address` | varchar(45) | suporta IPv6 |
| `user_agent` | text | truncado a 500 chars no service |
| `created_at` | timestamptz | default `now()` |

Índices: `(user_id, created_at DESC)`, `(entity_type, entity_id)`, `(action, created_at DESC)`.

RLS: leitura por usuário autenticado restrita a `user_id = auth.uid()`. Escrita só via service-role (backend).

## Endpoints

| Método | Rota | Notas |
|---|---|---|
| GET | `/api/dashboard/audit-log` | filtros `limit` (1..200, default 50), `offset` (default 0), `entity_type`, `action` |

Resposta:
```json
{
  "data": [
    {
      "id": "...",
      "user_id": "...",
      "action": "transaction_updated",
      "entity_type": "transaction",
      "entity_id": "tx-uuid",
      "old_value": null,
      "new_value": { "input": {...}, "output": {...} },
      "ip_address": "203.0.113.10",
      "user_agent": "Mozilla/5.0 ...",
      "created_at": "2026-05-08T..."
    }
  ],
  "meta": {
    "total": 42,
    "has_more": false,
    "next_offset": null,
    "is_empty": false,
    "hint": null
  }
}
```

## Ações instrumentadas (entrega inicial)

| Action | Entity type | Onde |
|---|---|---|
| `transaction_updated` | `transaction` | `PUT /transactions/:id` |
| `transaction_deleted` | `transaction` | `DELETE /transactions/:id` |
| `goal_updated` | `monthly_goal` | `PUT|POST /goals/monthly` (entity_id `goal:YYYY:M`) |
| `prolabore_updated` | `conta_pagar` | `PATCH /prolabore/:id` |
| `estoque_entrada` | `estoque` | `POST /estoque/entrada` |
| `alter_antecipacao_executed` | `alter_antecipacao` | `POST /alter/antecipacao/executar` |
| `alter_antecipacao_paused` | `alter_antecipacao` | `POST /alter/antecipacao/parar-automatica` |
| `alter_pago_recebivel_executed` | `conta_pagar` | `POST /alter/pagar-fornecedor/executar` |
| `supplier_doc_processed` | `supplier_document` | `POST /supplier-documents/process` |
| `supplier_doc_linked` | `supplier_document` | `POST /supplier-documents/:id/link-fornecedor` |
| `supplier_doc_matched` | `supplier_document` | `POST /supplier-documents/:id/match-itens` |

Outras mutações (colaboradores, fornecedores CRUD, NF validade, preferences, profile/initial-balance) ainda não instrumentadas — adicionar incrementalmente conforme demanda. O contrato do `auditLogService.log()` aceita qualquer rota: basta `auditLogService.log({ userId, action, entityType, entityId, oldValue?, newValue?, req })`.

## Garantias do service

- **Fire-and-forget**: `log()` retorna Promise que NUNCA rejeita. Falha do audit log nunca derruba a request principal.
- **Mask de dados sensíveis**: chaves `senha`/`password`/`pwd`/`token`/`access_token`/`refresh_token`/`jwt`/`authorization`/`cpf`/`rg`/`pix_chave`/`cartao*`/`cvv` viram `***` recursivamente (até 6 níveis).
- **Truncate**: `entity_id` 512 chars, `user_agent` 500 chars, `action` 100 chars, `entity_type` 50 chars, `ip_address` 45 chars.
- **Empty state**: `list()` devolve `meta.is_empty=true` + `hint` quando vazio; em erro de DB devolve empty + hint de retry (não 5xx).

## Frontend pendente

- Página `/dashboard/configuracoes/audit-log` consumindo `GET /api/dashboard/audit-log` com filtros e paginação. Ver prompt de handoff.

---

# Fase 19 — LGPD: portabilidade + esquecimento

## Visão geral

Atende os direitos LGPD Art. 18, V (portabilidade) e Art. 18, VI (eliminação). Todos os endpoints estão sob `/api/user/*`.

## Schema

Migration `20260508000050_create_account_deletion_tokens.sql` (aplicada em prod). Tabela:

```
account_deletion_tokens
  id              uuid PK default gen_random_uuid()
  user_id         uuid NOT NULL references profiles(id) ON DELETE CASCADE
  token           uuid NOT NULL unique default gen_random_uuid()
  expira_em       timestamptz NOT NULL
  usado_em        timestamptz NULL
  requested_ip    varchar(45)
  requested_user_agent text
  created_at      timestamptz default now()
```

RLS: usuário só lê o próprio. Mutações apenas service-role.

## Endpoints

### `GET /api/user/export-data`

**Auth:** Bearer JWT.

**Query opcional:** `?download=true` retorna o JSON inline com `Content-Disposition: attachment` (testes/admin); padrão é envio por email.

**Comportamento padrão (sem `download`):**
1. Coleta dump completo em memória (28 tabelas com `user_id` + `parcelas` via `atendimentos`).
2. Envia anexo `lumiz-export-<userId>-<YYYY-MM-DD>.json` para `req.user.email` via Resend.
3. Devolve `202` com `summary` (contagem por tabela), `generated_at`, `delivered`, `to`.

**Erros:**
- `400` se usuário não tem email cadastrado.
- `202` com `delivered:false` + warning se o envio do email falhar (export foi gerado mas email pifou).

### `DELETE /api/user/account`

**Auth:** Bearer JWT. **Não exclui imediatamente.**

1. Cria token UUID em `account_deletion_tokens` (TTL 24h).
2. Reaproveita token ativo recente (<60min) — evita spam de emails se o usuário clicar várias vezes.
3. Manda email de confirmação com link para `${FRONTEND_URL}/conta/confirmar-exclusao?token=<uuid>`.
4. Resposta `202` com `expira_em`, `delivered`, `reused`.

### `POST /api/user/account/confirm-delete`

**Auth:** Pelo próprio token (NÃO exige Bearer JWT — o link é aberto no email, possivelmente em outro device).

**Body:** `{ "token": "<uuid>" }` (também aceita `?token=` query).

**Pipeline (em ordem):**
1. `cancelSubscription(userId)` — `UPDATE subscriptions SET status='cancelled' WHERE clinic_id = userId` (single-tenant atual: clinic_id = userId).
2. `anonymizeAuditLog(userId)` — zera `user_id`, `ip_address`, `user_agent` em `audit_log`. Mantém `action`/`entity_type` para preservar trilha sem PII.
3. `purgeOperationalData(userId)` — `DELETE` em todas as 27 tabelas operacionais com `user_id`. Cascateia parcelas via FK em `atendimentos`. NÃO deleta `audit_log` nem `profiles`.
4. `softDeleteProfile(userId)` — define `is_active=false`, `deactivated_at=now()`, e zera nome/clinica/telefone/email/cidade/whatsapp_contato/responsavel_info.

**Status codes:**
- `200` em sucesso. Resposta inclui `summary.purged_tables` com `{ atendimentos: 12, contas_pagar: 5, ... }`.
- `400` para token ausente/inválido/usado (`code: TOKEN_MISSING/TOKEN_INVALID/TOKEN_USED`).
- `410` para token expirado (`code: TOKEN_EXPIRED`).

## Garantias do service

- **Confirmação dupla**: a sessão autenticada inicia (DELETE), mas só o clique no email finaliza (POST). Reduz drasticamente exclusões acidentais ou por sequestro de sessão.
- **Idempotência**: dois `DELETE /account` em sequência reaproveitam o mesmo token (não criam dois emails).
- **Degradação graciosa**: cada step do pipeline reporta erro individualmente em vez de abortar. Se `purgeOperationalData` falhar em uma tabela, a anonymization e o soft-delete ainda rodam.
- **PII zerada por placeholder único**: email vira `deleted-<uuid>@lumiz.deleted` e telefone `+0deleted<id>` para evitar conflito com índices unique e deixar explícito que a conta foi excluída.
- **Auth user (Supabase Auth) NÃO é excluído** — operação manual do operador. Permite trilha de auditoria interna mesmo após exclusão.

## Frontend pendente

- Página `/configuracoes/privacidade` (ou seção em `/configuracoes`):
  - Botão **Exportar meus dados** → `GET /api/user/export-data`. Mostrar toast: "Vamos enviar o JSON com seus dados para `<email>` em alguns segundos. Pode levar até 1 minuto."
  - Botão **Excluir minha conta** → modal de confirmação com input de texto que exige digitar `EXCLUIR`. Ao confirmar, chama `DELETE /api/user/account` e mostra: "Enviamos um email de confirmação para `<email>`. Clique no link em até 24h para finalizar."
- Página pública `/conta/confirmar-exclusao?token=<uuid>`:
  - Lê `token` da query, mostra resumo do que vai acontecer, botão "Confirmar exclusão definitiva".
  - Ao clicar, chama `POST /api/user/account/confirm-delete` com `{ token }`.
  - Em sucesso: mostra `summary.purged_tables` e CTA "Voltar ao site". Em token inválido/expirado: mostra erro humano em PT-BR.
