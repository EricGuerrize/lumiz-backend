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

- `GET /api/dashboard/preferences`
  - lê preferências do usuário autenticado em `profiles`.
  - contrato atual: `{ reporte_mensal_whatsapp, alertas_whatsapp_ativos }`.

- `PUT /api/dashboard/preferences`
  - aceita update parcial com `{ reporte_mensal_whatsapp?: boolean, alertas_whatsapp_ativos?: boolean }`.
  - `alertas_whatsapp_ativos` nasce com default `false` e controla alertas/insights automáticos via WhatsApp.

## Cron atualizado

- Cron diário 8h (`src/server.js`) agora também executa:
  - `margemAlertaService.checkAndAlertMargemCaindo()`
  - `whatsappOperationalAlertService.sendBillDueAlerts()`, `sendValidityAlerts()`, `sendCriticalStockAlerts()`, `sendDailyBriefings()`, `sendPatientReturnAlerts()`, `sendPatientReactivationAlerts()` e `sendInadimplenciaAlerts()`; todos só disparam se as envs específicas estiverem habilitadas e se o usuário tiver `profiles.alertas_whatsapp_ativos = true`.
  - `emergencyModeService`, `estoqueService`, `goalReminderService`, `insightService` e `alterInsightCronService` agora só enviam WhatsApp se `profiles.alertas_whatsapp_ativos = true`.
- Cron mensal mantém WhatsApp e, no mesmo fluxo, chama e-mail:
  - `monthlyReportDeliveryService` -> `emailReportService.sendMonthlyReportEmail()`
- Endpoint manual/protegido: `GET /api/cron/operational-alerts` roda briefing diário, contas a pagar, validade/lote, estoque crítico, retorno/reativação de pacientes e inadimplência sob demanda com header `x-cron-secret`.

## Variáveis de ambiente

- Opcional: `RESEND_API_KEY`
  - sem chave: fluxo degrada graceful com `skipped: missing_api_key`.
- Redis/filas:
  - `REDIS_CACHE_ENABLED=true` habilita cache Redis.
  - `REDIS_QUEUE_ENABLED=true` habilita producers BullMQ.
  - `QUEUE_WORKER_ENABLED=false` no serviço HTTP evita consumir filas no webhook.
  - `QUEUE_WORKER_ENABLED=true` no serviço worker consome `mdr-ocr`, `document-processing` e `pdf-generation` via `npm run worker`.
  - `WHATSAPP_OUTBOUND_QUEUE_ENABLED=true` habilita reenvio de respostas WhatsApp quando a Evolution falha temporariamente.
  - `WHATSAPP_OUTBOUND_WORKER_ENABLED=true` consome a fila `whatsapp-outbound` no próprio serviço HTTP.
  - `WHATSAPP_DAILY_BRIEFING_ENABLED=false` controla o briefing financeiro diário proativo via WhatsApp. Mantém opt-in obrigatório em `profiles.alertas_whatsapp_ativos`.
  - `WHATSAPP_BILL_DUE_ALERTS_ENABLED=false` controla alertas proativos de contas a pagar vencendo em 7/3/1 dias. Mantém opt-in obrigatório em `profiles.alertas_whatsapp_ativos`.
  - `WHATSAPP_VALIDITY_ALERTS_ENABLED=false` controla alertas proativos de validade de estoque/NF/lotes. Mantém opt-in obrigatório em `profiles.alertas_whatsapp_ativos`.
  - `WHATSAPP_CRITICAL_STOCK_ALERTS_ENABLED=false` controla alertas proativos de estoque abaixo do mínimo configurado. Mantém opt-in obrigatório em `profiles.alertas_whatsapp_ativos`.
  - `WHATSAPP_PATIENT_RETURN_ALERTS_ENABLED=false` controla alertas internos de sugestão de retorno por ciclo de procedimento. Não envia mensagem automática para pacientes.
  - `WHATSAPP_PATIENT_REACTIVATION_ALERTS_ENABLED=false` controla alertas internos semanais de pacientes sem atendimento recente. Não envia mensagem automática para pacientes.
  - `WHATSAPP_INADIMPLENCIA_ALERTS_ENABLED=false` controla alertas proativos de parcelas vencidas/inadimplência. Mantém opt-in obrigatório em `profiles.alertas_whatsapp_ativos`.
  - `WHATSAPP_ASYNC_MEDIA_PROCESSING=false` envia um aviso imediato ao receber PDF/foto antes do OCR terminar; o resumo final continua sendo enviado depois, com confirmação obrigatória.
  - `WHATSAPP_PROCESSING_WARN_MS`, `WHATSAPP_SEND_WARN_MS`, `WHATSAPP_TOTAL_WARN_MS` ajustam os limiares dos logs `[WA_LATENCY]`.
- WhatsApp Meta Cloud API:
  - `WA_WEBHOOK_VERIFY_TOKEN` valida o handshake GET `/api/webhook` da Meta.
  - `WA_ACCESS_TOKEN` permite baixar imagens, documentos e áudios recebidos via webhook nativo da Meta.
  - `WA_PHONE_NUMBER_ID`, `WABA_ID` e `WA_GRAPH_API_VERSION` documentam a conta oficial usada na migração.
  - `META_APP_SECRET` é opcional; quando configurado, `POST /api/webhook` valida `X-Hub-Signature-256` em payloads nativos da Meta e rejeita assinatura ausente/inválida.
  - `EVOLUTION_WEBHOOK_SECRET` é opcional; quando configurado, payloads não-Meta precisam enviar o segredo em `x-webhook-secret`, `x-evolution-webhook-secret` ou `Authorization: Bearer`.

## Hardening WhatsApp — PDF, webhook e auth

- PDF/documentos recebidos por buffer da Meta Cloud API agora usam o mesmo `DocumentHandler` das imagens:
  - OCR cria confirmação pendente persistida em `conversation_runtime_states`;
  - receita/despesa só é registrada após confirmação explícita;
  - lançamentos confirmados carregam `origem`, `source_phone`, `source_message_id`, `raw_message`, `is_test=false` e `metadata` com mime/file/confiança quando disponível.
- Confirmações de documentos aceitam correção natural antes de registrar:
  - exemplos: `corrigir valor para 900`, `categoria taxas`, `vencimento 10/06`, `beneficiário Evopharma`;
  - o pending é atualizado e o bot pede nova confirmação;
  - para `supplier_doc`, o snapshot em `supplier_documents.parsed_json` também é atualizado de forma não crítica.
- Semântica de cancelamento:
  - `cancelar`/`não` em confirmação pendente descarta o documento/leitura;
  - nada é registrado em `atendimentos` ou `contas_pagar`;
  - quando já existe `supplier_document` pendente, ele recebe `status='cancelled'` para auditoria.
- Falhas relevantes de documento/webhook registram `messageReliabilityService` com `kind` específico:
  - `media_download_failed`;
  - `document_ocr_failed`;
  - `document_no_transactions`;
  - `pending_confirmation_expired`;
  - `webhook_signature_failed`.
- Falhas de provider outbound também são registradas antes do fallback:
  - `outbound_provider_failed` com `reason=meta_text_failed:*` ou `meta_document_failed:*`;

## Observabilidade de latência WhatsApp

- `whatsappLatencyService` registra uma janela em memória com até 100 eventos recentes, consumida pelo painel admin/monitor.
- O webhook responde `200` imediatamente e processa a mensagem em segundo plano; o log `[WA_LATENCY]` separa:
  - `ack_ms`: tempo até devolver 200 para Meta/Evolution;
  - `processing_ms`: tempo gasto no bot até montar a resposta;
  - `send_ms`: tempo para enviar a resposta;
  - `total_ms`: ciclo completo recebido -> resposta enviada.
- Quando uma etapa interna passa de 500ms, o log inclui `slow_steps`, por exemplo:
  - `media_download_ms`;
  - `media_process_ms`;
  - `audio_transcription_ms`;
  - `member_lookup_ms`;
  - `gemini_intent_ms`;
  - `route_ms`.
- Para PDF/foto, `WHATSAPP_ASYNC_MEDIA_PROCESSING=true` reduz a sensação de travamento: o usuário recebe um aviso curto de que o arquivo foi recebido, e depois recebe o resumo para confirmar/corrigir/cancelar.
  - o fallback para Evolution continua não bloqueante quando configurado.
- Rotas sensíveis de dashboard/admin agora exigem JWT Supabase:
  - `src/routes/dashboard.routes.js` usa `authenticateToken`;
  - `src/routes/admin.routes.js` usa `authenticateToken` + `requireAdmin`;
  - fallback por telefone via `authenticateFlexible` permanece apenas em rotas legacy/WhatsApp onde ainda é intencional.

### Agente WhatsApp (`agentic_*`)

- **Railway / `.env`:** ver guia **[docs/AGENTIC_ENV_RAILWAY.md](docs/AGENTIC_ENV_RAILWAY.md)** (JSON `FEATURE_FLAGS` ou `AGENTIC_ROUTER_ENABLED` / `AGENTIC_TOOLS_ENABLED` / `AGENTIC_SHADOW_MODE`).
- **Supabase:** tabela `feature_flags` (override por `user_id` ou linhas globais `user_id` NULL); precedência acima do JSON vazio — ver `src/services/featureFlagService.js`.

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
- Ao detectar NF/Boleto/Comprovante: `documentHandler` salva `supplier_document` em estado `pending`, manda copy em `src/copy/supplierDocWhatsappCopy.js` e aguarda confirmação 1/2/3. Confirmação cria `contas_pagar` (parcelas). O estoque não é alterado automaticamente; itens detectados ficam como contexto para etapa manual/futura.
- Antes da confirmação, `corrigir ...` atualiza valor, vencimento, categoria ou fornecedor e reenvia o resumo para nova aprovação.

## Onda 3 — Alter pré-pronta com adapter mockado

### Schema novo
- `20260507000030_create_feature_flags.sql`
- `20260507000031_create_alter_recebiveis.sql`
- `20260507000032_create_alter_antecipacoes.sql`
- `20260507000033_create_alter_cobertura_snapshots.sql`

### Adapter
- Contrato: `src/services/alter/alterAdapterContract.js` — interface base com `NotImplementedError`.
- Mock: `src/services/alter/mockAlterAdapter.js` — deriva `alter_recebiveis` de `parcelas` + `mdr_configs`. Custo spot configurável: `ALTER_FEE_SPOT_PCT` (default 2.5%), `ALTER_FEE_SPOT_MIN_PCT` (1.5%), `ALTER_FEE_SPOT_MAX_PCT` (4.5%).
- Real: `src/services/alter/realAlterAdapter.js` — **implementado (27/05/2026)**. OAuth2 client_credentials com token cache. Métodos: `listRecebiveis`, `getAggregatePosition`, `simulateAntecipacaoSpot`, `executeAntecipacaoSpot`, `cancelAutomatica`, `registerBusinessPartner`, `requestOptIn`, `getBusinessPartner`, `setWebhookUrl`.
- Factory: `src/services/alter/alterAdapter.js` resolve por env (`ALTER_CLIENT_ID` + `ALTER_CLIENT_SECRET` → real; senão → mock).

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
| POST | `/api/dashboard/alter/onboarding/registrar` | `{ name, cnpj, email?, phone? }` — cria BP Alter + salva `alter_bp_id` em profiles |
| POST | `/api/dashboard/alter/onboarding/opt-in` | — dispara opt-in Núclea |
| GET | `/api/dashboard/alter/onboarding/status` | — retorna BP + `nuclea_opt_in` (polling) |
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

### Webhook Alter
- `POST /webhooks/alter` — recebe eventos Alter (HMAC-SHA256, spec Alter).
- Trata `opt_in.confirmed` → `profiles.alter_opt_in_status = 'active'`.
- Trata `opt_in.failed` → `profiles.alter_opt_in_status = 'failed'`.
- Secret: `ALTER_WEBHOOK_SECRET` (fornecido pela Alter em canal privado após registrar URL com `alterAdapter.setWebhookUrl()`).
- Fail-closed em produção sem secret (503). Em dev sem secret, aceita com warning.

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
- `FOUNDER_CALL_URL` — opcional; se definido, o CTA de pós-onboarding para "falar com o Eric" devolve esse link diretamente no WhatsApp.
- `ONBOARDING_DASHBOARD_TEASER_VIDEO_URL` — opcional; URL pública de MP4 enviada ao final do onboarding como teaser do dashboard futuro. Se ausente, nada é enviado.
- `ALTER_ENABLED` — boolean, ativa rotas Alter (alternativa: registro em `feature_flags`).
- `ALTER_CLIENT_ID`, `ALTER_CLIENT_SECRET` — credenciais OAuth2 da API Alter; quando ambos definidos, factory usa `realAlterAdapter`.
- `ALTER_WEBHOOK_SECRET` — secret HMAC para validar eventos webhook Alter; fornecido pela Alter em canal privado.
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

## Frontend — Audit Log UI (Fase 15)

**Status (2026-05-09):** UI entregue e **push enviado** para o remoto GitHub (`lumiz-financeiro`): branch `feat/audit-log-fase15`, commit `530c206` → `origin/feat/audit-log-fase15`. Abrir PR a partir daí quando possível — **sem URL fictícia**.

- Página `/dashboard/configuracoes/audit-log` consumindo `GET /api/dashboard/audit-log` com filtros e paginação.

**Obs. operacional:** em ambiente local o disco chegou ao limite (`No space left on device`); o push foi efetuado no GitHub mesmo assim — **screenshots de QA e atualização opcional da ref via `git fetch` ficam pendentes** até liberar espaço local.

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

---

# Fase 18 — MFA (TOTP)

## Visão geral

Backend **só enforça e audita**. Enrollment/verify/unenroll roda no frontend via `supabase.auth.mfa.*` (Supabase Auth tem TOTP nativo). Rollout via flag `mfa_required` (já registrada em `featureFlagsRegistry`).

## Conceitos

- **AAL** (Authentication Assurance Level): `aal1` = só senha; `aal2` = senha + TOTP nesta sessão. O claim vem no JWT do Supabase. Backend extrai com `mfaService.extractAal(token)`.
- **Factor**: instância de TOTP enrolada (ex: "iPhone", "Authy"). Cada usuário pode ter múltiplos. Lista vem de `supabase.auth.admin.mfa.listFactors({userId})`.

## Endpoints

### `GET /api/user/mfa/status`
- Auth: Bearer JWT.
- Response 200:
  ```json
  {
    "aal": "aal1" | "aal2" | null,
    "mfa_required": false,
    "enrolled": false,
    "factors": [
      {
        "id": "...",
        "friendly_name": "iPhone",
        "factor_type": "totp",
        "status": "verified",
        "created_at": "...",
        "updated_at": "..."
      }
    ]
  }
  ```
- Frontend usa para:
  - mostrar banner "Ative MFA agora" quando `mfa_required && !enrolled`.
  - mostrar prompt de re-verify quando `enrolled && aal !== 'aal2'`.
  - listar/remover factores em `/configuracoes/seguranca`.

### `POST /api/user/mfa/event`
- Auth: Bearer JWT.
- Body: `{ "action": "mfa_enrolled" | "mfa_verified" | "mfa_unenrolled" | "mfa_challenge_failed", "factor_id"?: "...", "friendly_name"?: "..." }`
- Response 202: `{ "accepted": true }`
- 400 com `{ allowed: [...] }` se action fora do whitelist.
- Frontend chama após enroll/verify/unenroll bem-sucedidos no Supabase JS para deixar trilha auditável.

## Endpoints protegidos por `requireMFA`

Quando `mfa_required=true` e `aal !== 'aal2'`:

| Endpoint | Por quê |
|---|---|
| `PUT /api/dashboard/transactions/:id` | edição de receita/despesa |
| `DELETE /api/dashboard/transactions/:id` | exclusão de receita/despesa |
| `PATCH /api/dashboard/prolabore/:id` | mutação de pró-labore |
| `POST /api/dashboard/alter/antecipacao/executar` | movimenta dinheiro real |
| `POST /api/dashboard/alter/antecipacao/parar-automatica` | reverte estratégia financeira |
| `POST /api/dashboard/alter/pagar-fornecedor/executar` | usa recebíveis para quitar boleto |

Resposta 403:
```json
{
  "error": "Esta operação requer verificação de segundo fator (MFA).",
  "code": "MFA_REQUIRED",
  "hint": "Verifique seu código TOTP e tente novamente."
}
```

## Garantias do service

- **Fail-open em erro de resolução**: se o featureFlagService cai ou se a admin API do Supabase falha, o middleware deixa passar. MFA é proteção extra, não pode quebrar fluxo crítico por erro de infra. Logs em `console.warn`.
- **Sem cookies/sessão custom**: tudo derivado do JWT que já vem na request. Backend é stateless.
- **Audit fire-and-forget**: `mfa_enrolled/verified/unenrolled/challenge_failed` viram entries no `audit_log` com `entity_type=mfa_factor`.
- **Flag opt-in**: enquanto `mfa_required=false` (default), endpoints sensíveis funcionam normalmente. Permite rollout gradual.

## Frontend pendente

### 1. `/configuracoes/seguranca`

```ts
const { data, error } = await supabase.auth.mfa.enroll({
  factorType: 'totp',
  friendlyName: 'iPhone Maria',
});
// data.totp.qr_code → render <img src="data:image/svg+xml;..." />
// data.totp.secret → mostrar como fallback para apps que não escaneiam

// Após usuário digitar o código:
const challenge = await supabase.auth.mfa.challenge({ factorId: data.id });
const verify = await supabase.auth.mfa.verify({
  factorId: data.id,
  challengeId: challenge.data.id,
  code: userTypedCode,
});

// Sucesso → reportar:
await fetch('/api/user/mfa/event', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'mfa_enrolled', factor_id: data.id, friendly_name: 'iPhone Maria' }),
});
```

- Listar factors via `GET /api/user/mfa/status` ou `supabase.auth.mfa.listFactors()`.
- Remover via `supabase.auth.mfa.unenroll({ factorId })` + `POST /api/user/mfa/event { action: 'mfa_unenrolled' }`.

### 2. Interceptor global de re-verify

Quando qualquer fetch/axios receber `403 { code: 'MFA_REQUIRED' }`:
1. Abrir modal "Verifique seu código TOTP".
2. `const f = await supabase.auth.mfa.listFactors(); const factorId = f.data.totp[0].id`.
3. `const c = await supabase.auth.mfa.challenge({ factorId })`.
4. `await supabase.auth.mfa.verify({ factorId, challengeId: c.data.id, code: userInput })`.
5. Reportar `POST /api/user/mfa/event { action: 'mfa_verified' }`.
6. Refazer a request original (a session do supabase-js já está com `aal2` automaticamente após o verify).

### 3. Quando ativar a flag

Não ative `mfa_required=true` globalmente até a UI de enrollment estar deployada. Sequência sugerida:
1. UI de enrollment em produção (frontend deploya).
2. Comunicar usuárias por email/WhatsApp: "Em X dias vamos exigir 2FA para ações financeiras."
3. Habilitar para usuários piloto via override per-user em `feature_flags` (`{ user_id, name: 'mfa_required', enabled: true }`).
4. Após validar, ativar globalmente.

---

# Database Security & Compliance (audit do Supabase Advisor)

## Estado atual (08/05/2026)

Após `20260509000010_security_hardening.sql` + `20260509000020_security_hardening_round2.sql` (aplicadas em produção):

- **0 critical errors** no Supabase Advisor.
- **34/35 tabelas** com `user_id` operacional têm RLS habilitada **+ ao menos 1 policy**.
- Única exceção: `reminders_sent` tem RLS sem policy (= nega tudo do client). **Intencional** — apenas o backend escreve/lê via service-role para dedupe de reminders.

## Fixes aplicados (resumo executivo)

| Antes | Depois | Risco eliminado |
|---|---|---|
| `subscriptions` sem RLS | RLS ON + `users read own subscription` (clinic_id = auth.uid()) | Qualquer authenticated podia ler/manipular assinaturas alheias |
| `view_financial_ledger` `SECURITY DEFINER` | `security_invoker = on` | View ignorava RLS de `atendimentos`/`contas_pagar` — qualquer login lia tudo |
| `view_finance_balance` `SECURITY DEFINER` | `security_invoker = on` | Idem (saldo de todas as clínicas) |
| `view_monthly_report` `SECURITY DEFINER` | `security_invoker = on` | Idem (relatório mensal de todas as clínicas) |
| `exec_sql_readonly(text)` exposta a `anon` | EXECUTE revogada de PUBLIC/anon/authenticated | **CRÍTICO**: qualquer um podia executar SELECT arbitrário (filtros regex burláveis com obfuscação) — vazaria `auth.users`, secrets, etc. |
| `admin_get_subscription_stats()` exposta | EXECUTE revogada de anon/authenticated | Authenticated normal podia listar clínicas + assinaturas de todo mundo |
| `is_user_admin(uuid)` exposta | EXECUTE revogada de anon/authenticated (backend usa via service-role) | Info disclosure de papéis admin |
| `generate_orcamento_numero()` exposta | EXECUTE revogada de anon/authenticated | Função SECURITY DEFINER sem necessidade de exposição pública |
| `match_learned_knowledge()` sem search_path fixo | `SET search_path = public, pg_catalog` | Search-path hijacking (baixo risco mas é boa prática) |

## Como o backend continua funcionando

O cliente em `src/db/supabase.js` é instanciado com `SUPABASE_SERVICE_ROLE_KEY`. Service-role:
- bypassa RLS (lê/escreve qualquer linha — necessário para crons, webhooks, agent do WhatsApp, jobs de OCR, etc.);
- mantém EXECUTE em todas as funções, mesmo as revogadas de anon/authenticated.

Frontend autenticado usa `SUPABASE_ANON_KEY` + JWT do usuário no Authorization header. Para esse caminho:
- RLS ativa filtra automaticamente para `auth.uid()`.
- Funções privadas estão fora do alcance.

## Pendências não-bloqueantes (não impedem go-live)

1. **`vector` extension em `public`** (WARN). Mover para schema `extensions` quebra a coluna `learned_knowledge.embedding` — exige migration cuidadosa (DROP/CREATE da coluna + reindexação). Fica como tech debt; risco real é baixo (extension é só `pgvector`).
2. **Leaked password protection desativada** (WARN). Configuração no painel Supabase Auth, não SQL. **Recomendado habilitar antes do go-live**:
   - Dashboard → Authentication → Providers → Email → "Leaked password protection" → ON.
   - Bloqueia cadastros/trocas de senha com senhas vazadas (HaveIBeenPwned).
3. **`reminders_sent` sem policy** (INFO). Deliberado. Não tocar.

## RLS coverage detalhado

Todas as 28 tabelas com `user_id` direto têm RLS + ao menos 1 policy SELECT (`user_id = auth.uid()`):

```
account_deletion_tokens, agendamentos, alter_antecipacoes, alter_cobertura_snapshots,
alter_recebiveis, analytics_events, atendimentos, audit_log, beta_feedback, clientes,
colaboradores, comissoes, contas_pagar, conversation_history, emergency_alert_history,
feature_flags, fornecedores, mdr_configs, monthly_goals, movimentacoes_estoque,
nf_validade_itens, ocr_jobs, onboarding_progress, orcamentos, procedimentos,
supplier_documents, user_insights, user_roles
```

Tabelas relacionais sem `user_id` direto (`parcelas`, `clinic_members`) têm RLS via tabela-pai (FK `atendimento_id`/`clinic_id`).

## Como rodar este audit periodicamente

Use o MCP `user-Supabase` (já configurado no Cursor):

```
get_advisors({ project_id: "whmbyfnwnlbrfmgdwdfw", type: "security" })
get_advisors({ project_id: "whmbyfnwnlbrfmgdwdfw", type: "performance" })
```

Ou no painel: Database → Security Advisor.

**Política sugerida:** rodar antes de cada release maior; tratar todo `ERROR` como bloqueador de deploy.

---

# Fase 12 — Importador Excel (backend)

## Status

Backend concluído em 09/05/2026. Frontend pendente: página `/dashboard/import`.

## Schema

Migration aplicada: `supabase/migrations/20260509000030_excel_import_batches.sql`.

- `excel_import_batches`
  - `id uuid` — também usado como `import_token`.
  - `user_id uuid`.
  - `status`: `preview | confirmed | undone | expired`.
  - `filename`, `mapping`, `rows`, `preview`, `inconsistencias`, `summary`.
  - contadores: `original_row_count`, `valid_row_count`, `invalid_row_count`.
  - `confirmed_at`, `undone_at`, `expires_at`, `created_at`, `updated_at`.
  - RLS ON; usuário autenticado só lê batches próprios.
- `atendimentos.import_batch_id uuid`.
- `contas_pagar.import_batch_id uuid`.

## Endpoints

### `POST /api/dashboard/import/excel/preview`

Upload `multipart/form-data`, campo `file`.

Limites:
- `.xlsx` ou `.xls`.
- Até 5MB por padrão (`EXCEL_IMPORT_MAX_FILE_BYTES`).
- Até 5.000 linhas por padrão (`EXCEL_IMPORT_MAX_ROWS`).

Resposta:

```json
{
  "import_token": "uuid",
  "preview": [
    {
      "tipo": "entrada",
      "data": "2026-05-07",
      "valor": 1500.5,
      "descricao": "Importação Excel",
      "cliente": "Maria",
      "procedimento": "Botox",
      "categoria": "Procedimento",
      "forma_pagamento": "pix"
    }
  ],
  "inconsistencias": [
    {
      "sheet": "Movimentacoes",
      "row_number": 4,
      "errors": ["data_invalida", "valor_invalido"]
    }
  ],
  "mapping": {
    "Movimentacoes": {
      "tipo": "Tipo",
      "data": "Data",
      "valor": "Valor",
      "cliente": "Cliente"
    }
  },
  "summary": {
    "total_rows": 10,
    "valid_rows": 8,
    "invalid_rows": 2,
    "receitas_count": 5,
    "despesas_count": 3,
    "receitas_total": 8000,
    "despesas_total": 2300
  }
}
```

### `POST /api/dashboard/import/excel/confirm`

Body:

```json
{ "import_token": "uuid" }
```

Materializa:
- `entrada` → `atendimentos` + `atendimento_procedimentos`; cria `clientes` e `procedimentos` se não existirem por nome exato.
- `saida` → `contas_pagar` com `origem = "import"`.

Todos os registros recebem `import_batch_id`.

Resposta:

```json
{
  "ok": true,
  "batch_id": "uuid",
  "summary": {
    "inserted_atendimentos": 5,
    "inserted_contas_pagar": 3
  }
}
```

Também envia WhatsApp fire-and-forget para `req.user.telefone`: "Importação concluída".

### `GET /api/dashboard/import/excel/history?limit=20`

Resposta:

```json
{
  "data": [
    {
      "id": "uuid",
      "filename": "controle.xlsx",
      "status": "confirmed",
      "summary": {},
      "original_row_count": 10,
      "valid_row_count": 8,
      "invalid_row_count": 2,
      "created_at": "..."
    }
  ]
}
```

### `DELETE /api/dashboard/import/excel/:batchId`

Desfaz lote inteiro:
- deleta `atendimentos` com `import_batch_id=batchId`;
- deleta `contas_pagar` com `import_batch_id=batchId`;
- marca batch como `undone`.

## Segurança

- Parser `xlsx` roda com `cellFormula=false`, `cellNF=false`, `cellStyles=false`.
- Upload em memória com limite de tamanho.
- Dados só são persistidos como lançamentos após confirmação explícita.
- RLS em `excel_import_batches`; escrita via service-role backend.

## Frontend pendente

Implementar `/dashboard/import`:
- Step 1: drag-and-drop de arquivo.
- Step 2: preview dos primeiros registros + inconsistências.
- Step 3: confirmar importação.
- Step 4: histórico + botão "Desfazer importação".

---

# Fase 17 — Analytics de produto (PostHog) — backend

> **Status:** backend concluído (09/05/2026). Frontend pendente (instalar `posthog-js`, init em `main.tsx`, `identify` pós-login, pageview por rota, track manual).

## Decisão arquitetural

- O backend **espelha** todo evento do `analyticsService.track()` para o PostHog, **sem substituir** a tabela `analytics_events` no Supabase. Os dois rodam em paralelo:
  - Supabase: histórico estruturado, queryável via RPC, retido no banco da clínica.
  - PostHog: dashboards de funil/retention, segmentação, replays (quando ativados).
- O envio para PostHog é **fire-and-forget** — falha do PostHog jamais bloqueia ou derruba a request original.
- Sem `POSTHOG_API_KEY` ou com flag `posthog_enabled` OFF, o serviço é **no-op silencioso** (graceful degradation).

## Configuração

Variáveis de ambiente (todas opcionais):

| Variável | Default | Descrição |
|---|---|---|
| `POSTHOG_API_KEY` | _ausente_ | API key do projeto PostHog. Sem ela, o PostHog é desligado por completo. |
| `POSTHOG_HOST` | `https://us.i.posthog.com` | Host do PostHog (use `https://eu.i.posthog.com` para EU, ou self-hosted). |
| `POSTHOG_FLUSH_AT` | `20` | Tamanho do batch antes de flushar. |
| `POSTHOG_FLUSH_INTERVAL_MS` | `10000` | Intervalo (ms) para flush automático. |

Flag (já no registry): `posthog_enabled` — controla per-user/global. Default `false`. Para ligar globalmente:

```sql
INSERT INTO feature_flags (user_id, name, enabled, meta)
VALUES (NULL, 'posthog_enabled', true, '{"enabled_by":"fase_17_release"}'::jsonb);
```

## Eventos instrumentados

Todos enviados pelo `analyticsService.track(eventName, payload)` e **espelhados automaticamente** no PostHog via `posthogService.capture()`. distinctId resolvido como `userId → phone:<phone> → anonymous`.

| Evento | Origem | Propriedades chave |
|---|---|---|
| `onboarding_started` | `profileHandlers` (WhatsApp) | `phone_present` |
| `onboarding_consent_given` | `profileHandlers` | — |
| `onboarding_profile_completed` | `contextHandlers` | — |
| `onboarding_first_sale` | `ahaRevenueHandlers` | `valor` |
| `onboarding_cost_recorded` | `ahaCostsHandlers` | `categoria`, `valor` |
| `onboarding_summary_shown` | `summaryHandlers` | `total_vendas`, `total_custos` |
| `onboarding_completed` | `summaryHandlers` (handoff) | `had_first_sale`, `custos_recorded` |
| `transaction_confirmation_accepted` | `transactionHandler` | — |
| `transaction_confirmation_cancelled` | `transactionHandler` | — |
| `transaction_created` | `transactionHandler` (após create) | `tipo`, `valor`, `categoria`, `forma_pagamento`, `parcelas`, `is_split` |
| `report_exported` | `GET /api/dashboard/export/report` | `format` (pdf/csv/ofx), `month` |
| `excel_imported` | `POST /api/dashboard/import/excel/confirm` | `valid_rows`, `receitas_count`, `despesas_count`, `receitas_total`, `despesas_total`, `batch_id` |
| `goal_set` | `PUT|POST /api/dashboard/goals/monthly` | `year`, `month`, `meta_receita`, `is_first_set` |
| `simulator_run` | `GET /api/dashboard/simulator/scenario(s)` | `scenario`, `projection_months`, `month`, `year` |
| `emergency_triggered` | `emergencyModeService.checkAndAlert` (cron) | `saldo_minimo`, `data_risco`, `canal` |

Eventos antigos (Fase 1+) continuam funcionando — qualquer chamada existente de `analyticsService.track()` agora também alimenta o PostHog automaticamente.

## Segurança

- Propriedades sensíveis são **mascaradas** antes do envio: `cpf`, `password`, `pwd`, `token`, `access_token`, `refresh_token`, `jwt`, `authorization`, `pix_chave`, `cartao*`, `cvv`, `rg`. Mascaramento recursivo até depth 4.
- `phone` nunca é enviado como propriedade — só seu hash via distinctId (`phone:<phone>`) ou flag `phone_present: boolean`.
- Erros do cliente PostHog são logados (`[POSTHOG]`) mas nunca propagam.

## Graceful shutdown

`server.js` chama `posthogService.shutdown()` durante `SIGTERM`/`SIGINT` para flushar a fila antes de `process.exit(0)`. Sem isso, o último batch poderia ser perdido em deploys.

## Frontend pendente

1. Instalar `posthog-js`.
2. Inicializar em `main.tsx` ATRÁS da flag `posthog_enabled`:
   ```ts
   if (await featureFlags.isEnabled('posthog_enabled')) {
     posthog.init(import.meta.env.VITE_POSTHOG_API_KEY, {
       api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
       person_profiles: 'identified_only',
       capture_pageview: true,
     });
   }
   ```
3. Pós-login, `posthog.identify(userId, { clinic_name, tier, created_at, phone_e164: false })`. Não envie CPF, senha, telefone ou qualquer dado sensível como property.
4. Track manual em ações que não viram request (clique em filtros, navegação interna que não mude rota, abrir modal):
   - `dashboard_filter_changed`
   - `chart_zoomed`
   - `widget_dragged`
5. Use o mesmo `distinctId` do backend (`userId`) para o funil cruzar (a query distinctId fica unificada).

Sem a key `VITE_POSTHOG_API_KEY` configurada, o front deve no-op silenciosamente — espelho da degradação do backend.

---

# Hardening pré-launch — Webhook Asaas + prova de consentimento LGPD

> **Status:** backend concluído (09/05/2026). Migration `20260509000040_profiles_consent_lgpd.sql` aplicada no Supabase remoto.

## 1. Webhook Asaas — fail-closed em produção

### Problema

Antes desta entrega, `POST /api/webhooks/asaas` tinha o seguinte fluxo:

```js
if (process.env.ASAAS_WEBHOOK_SECRET && token !== process.env.ASAAS_WEBHOOK_SECRET) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

Se a env var **não estivesse configurada** em produção (esquecimento humano), a verificação virava `false && ...`, permitindo que **qualquer um** mandasse webhooks forjados (PAYMENT_RECEIVED, etc.) e ativasse assinaturas pagas sem pagar.

### Solução

Hardening em duas camadas:

1. **Runtime** ([src/routes/webhooks.js](src/routes/webhooks.js)):
   - `NODE_ENV=production` SEM `ASAAS_WEBHOOK_SECRET` → **503** + log `[WEBHOOK/ASAAS] BLOQUEADO`. `paymentService.handleWebhook` NUNCA é chamado.
   - `NODE_ENV=production` COM secret configurado: token correto → 200, token errado/ausente → 401.
   - `NODE_ENV=development`/`test` SEM secret → warn alto + processa (ergonomia local).
   - Em qualquer ambiente com secret configurado, token errado → 401.

2. **Startup** ([src/config/env.js](src/config/env.js)):
   - `ASAAS_WEBHOOK_SECRET` é validada como **obrigatória em produção** dentro de `validateSensitivePlaceholders`. Se ausente, a startup falha em `validateOrThrow` antes de aceitar tráfego — operador vê erro de config no boot do Railway, não em billing inválido depois.

### Variável obrigatória em prod

```
ASAAS_WEBHOOK_SECRET=<segredo-do-painel-asaas>
```

Sem ela em produção: backend nem sobe (depende de `validate()` em `server.js`), ou se subir, devolve 503 em todo evento de billing.

### Tests

`tests/unit/asaasWebhookSecurity.test.js` — 7 cenários:
- prod sem secret → 503 (handler não chamado)
- prod com secret correto → 200 (handler chamado)
- prod com secret errado → 401
- prod sem header → 401
- dev sem secret → 200 + warn
- dev com secret errado → 401
- test sem secret → 200 (não polui suite)

### Endpoint real + idempotência + trial

- **URL no servidor:** `POST /webhooks/asaas` (ver [`src/server.js`](src/server.js) — `app.use('/webhooks', ...)`). Alguns testes montam o router em `/api/webhooks` só para isolamento.
- **`paymentService.handleWebhook`**: em `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED`, localiza `subscriptions` por `asaas_customer_id`; se `last_payment_id` já for igual ao `payment.id`, **não** chama `activate` de novo e **reexecuta** `trialAccountService.migrateToLiveAccount` (recuperação se a migração falhou após o primeiro webhook).
- No primeiro processamento: `subscriptionService.activate` + migração trial + evento **`subscription_activated_via_webhook`** em `analytics_events` (via [`analyticsService`](src/services/analyticsService.js)).

## 2. Prova de consentimento LGPD

### Problema

LGPD Art. 8º §1º exige que o controlador (Lumiz) mantenha **prova robusta** do consentimento — com timestamp e versão dos termos vigentes naquele momento. Antes desta entrega, o "1️⃣ Autorizo" do onboarding via WhatsApp era registrado APENAS em `analytics_events` com `event=onboarding_consent_given`. Falhas silenciosas de DB (`error.code 42P01` quando tabela não existe) podiam fazer a prova evaporar — frágil para auditoria ANPD ou disputa civil.

### Solução

#### Migration ([20260509000040_profiles_consent_lgpd.sql](supabase/migrations/20260509000040_profiles_consent_lgpd.sql))

Adiciona em `profiles`:

| Coluna | Tipo | Significado |
|---|---|---|
| `consent_given_at` | `timestamptz` | Timestamp do consentimento mais recente |
| `terms_version` | `text` | Versão dos Termos aceita |
| `privacy_version` | `text` | Versão da Política de Privacidade aceita |
| `consent_ip` | `text` | IP de origem (x-forwarded-for honored) |
| `consent_user_agent` | `text` | User-agent (truncado a 500 chars) |

Mais um índice parcial `idx_profiles_consent_versions` em `(terms_version, privacy_version)` filtrando por `consent_given_at IS NOT NULL` (consultas tipo "tem consent ativo nas versões atuais?").

#### Service ([src/services/consentService.js](src/services/consentService.js))

API:

```js
const consentService = require('./services/consentService');

// Persiste consent (ou skip se já bate com versões ativas)
await consentService.recordConsent({ phone: '+5566912345678', req });

// Verifica se user consentiu nas versões ATIVAS
const ok = await consentService.hasGivenConsent({ phone: '+5566912345678' });

// Versões vigentes (env-overridable)
const { termsVersion, privacyVersion } = consentService.getActiveVersions();
```

Comportamento:
1. **Persistência**: faz `UPDATE profiles SET consent_given_at, terms_version, privacy_version, consent_ip, consent_user_agent WHERE telefone = ?`.
2. **Audit log**: grava entry com `action='consent_given'`, `entityType='profile'`, `oldValue` (versões anteriores se re-consent) e `newValue` (versões atuais + timestamp).
3. **Idempotência**: se `consent_given_at` já existe e `terms_version`/`privacy_version` batem com as ativas, retorna `{ skipped: true, reason: 'already_consented' }` sem regravar.
4. **Re-consent**: se versões mudaram (env LUMIZ_TERMS_VERSION ou LUMIZ_PRIVACY_VERSION incrementadas), grava novo timestamp + audita oldValue.
5. **Fire-and-forget**: erro de DB nunca propaga; loga warn e devolve `{ ok: false, skipped: true, reason: ... }`.
6. **Profile não encontrado**: retorna `skipped`, avisa, NÃO cria perfil (segurança).

#### Plug nos handlers

Ambos os handlers de consent (`src/services/onboarding/profileHandlers.js` e `src/services/onboardingFlowService.js`) chamam `recordConsent` fire-and-forget no momento do "Autorizo":

```js
if (choseAuthorize) {
  onboarding.step = 'PROFILE_NAME';
  await analyticsService.track('onboarding_consent_given', { phone, source: 'whatsapp' });
  consentService.recordConsent({ phone: normalizedPhone, req: onboarding?.req }).catch(() => {});
  return await respond(onboardingCopy.profileNameQuestion(), true);
}
```

#### Configuração

Variáveis de ambiente (opcionais, com defaults):

| Variável | Default | Descrição |
|---|---|---|
| `LUMIZ_TERMS_VERSION` | `2026-05-09` | Versão vigente dos Termos. Bumpar força re-consent. |
| `LUMIZ_PRIVACY_VERSION` | `2026-05-09` | Versão vigente da Política. Bumpar força re-consent. |

### Tests

`tests/unit/consentService.test.js` — 13 cenários: persistência, audit, idempotência, re-consent, profile inexistente, fire-and-forget em DB error, IP via x-forwarded-for, getActiveVersions com env vars, defaults, hasGivenConsent.

Regression suite: **210/210 verde** (subiu de 190 → 210 com 7 + 13 novos).

## Frontend pendente

Nenhuma mudança imediata necessária. Para Fase 19 (LGPD self-service), a UI deve:
1. Exibir as versões dos Termos/Privacidade aceitas em "Configurações → Privacidade" (consumir `GET /api/user/me` ou criar `GET /api/user/consent` se preciso).
2. Mostrar banner "Termos atualizados — leia e reconfirme" quando `terms_version`/`privacy_version` do user diferem das ativas (server retorna a comparação).
3. Após confirmação no front, chamar endpoint que delega para `consentService.recordConsent` (ou — alternativa mais simples — exigir reconsentimento via WhatsApp).

## GET /api/user/whoami + refator design system (09/05/2026)

### Por que existe

O frontend precisa decidir com segurança se renderiza o grupo **Administração** no sidebar (e rotas `/admin/*`) sem depender de chamar `/api/admin/*` e inferir papel via **403**. O endpoint dedicado permite um contrato estável antes de qualquer rota administrativa sensível.

### Contrato

- **Método/rota:** `GET /api/user/whoami`
- **Auth:** Bearer JWT (`Authorization`)
- **Resposta JSON:** `{ user_id, email, is_admin }`

### Degradação segura

Se o RPC Postgres `is_user_admin` falhar (ou degradar por erro técnico), a resposta **nunca eleva privilégio**: devolve `is_admin: false`.

### Entrega backend / testes

- **Commit:** `6e9cdf4` na branch `main`
- **Testes:** 6 cenários em `tests/unit/whoamiEndpoint.test.js`
- **Regressão:** suíte **216/216** verde na data da entrega

### Status do frontend (mesma data)

Design system aplicado ao dashboard; páginas admin atrás do `whoami`: `/admin`, `/admin/usuarios`, `/admin/assinaturas`, `/admin/feedback`, `/admin/diagnostico`, `/admin/whatsapp`. Qualidade build: `npx tsc --noEmit` (exit 0) e `npm run build` (sucesso).

### Monitor WhatsApp admin (02/06/2026)

- **Método/rota:** `GET /api/admin/whatsapp-monitor?days=7&limit=80`
- **Auth:** Bearer JWT + `requireAdmin` via RPC `is_user_admin`.
- **Objetivo:** monitorar conversas recentes, funil básico de onboarding, estados runtime ativos, onboardings incompletos, latência e falhas recentes do bot.
- **Privacidade:** telefone sai mascarado (`...1234`); mensagens aparecem apenas no painel admin autenticado.
- **Degradação:** se uma fonte opcional falhar (`analytics_events`, `conversation_runtime_states`, etc.), a resposta inclui `meta.warnings` e mantém o restante do painel utilizável.
- **Frontend:** rota `/admin/whatsapp`, menu `Administração > Monitor WhatsApp`.

### Sidebar + navegação (✅ follow-up produto — 09/05/2026)

O alinhamento do menu ao espec de produto foi **concluído** na branch `feat/audit-log-fase15`, commit **`79c9a4a`** (push enviado). PR contra `main` a abrir via compare: https://github.com/EricGuerrize/lumiz-financeiro/compare/feat/audit-log-fase15 — verificações na data: **`npx tsc --noEmit`** e **`npm run build`** verdes no `lumiz-financeiro`.

- **Sidebar — 20 itens em 4 grupos:** **Operacional (6)** — Visão geral, Faturamento, Contas a pagar, Pacientes, Procedimentos, Estoque. **Inteligência (5)** — Calendário financeiro, Simulador "e se?", Metas, Insights, Inadimplência. **Powered by Alter (4)** — Recebíveis (badge), Maquininha, Score de saúde, Relatório do sócio. **Administração (5)** — Painel admin, Usuários, Assinaturas, Feedback, Diagnóstico.
- **Footer (como mockup):** toggle de tema Claro/Escuro; linha de perfil com dropdown → Configurações / Perfil / Sair.
- **Hooks LGPD (consentimento no dashboard — consomem API já entregue no backend, commit `e006e24`):** `useConsentStatus()` — prefetch no `AppLayout`; `useAcceptCurrentTerms()` — mutation com tratamento **409**. Endpoints: **`GET /api/user/consent`** e **`POST /api/user/consent`**.

---

## Agente conversacional (WhatsApp) — LLM + tools (Fase Agentic)

Integração no fluxo real do webhook: após classificar intenção (heurística +/ou Gemini) e **antes** de `routeIntent`, o backend pode delegar a resposta ao loop **Gemini function calling** (`geminiService.processAgenticMessage`), com tools registradas em `src/services/agentic/registerDefaultTools.js` e roteamento em `src/services/agentic/agentRouterService.js`.

### Flags (`feature_flags` / `FEATURE_FLAGS` JSON / registry)

Definições e defaults: [`src/config/featureFlagsRegistry.js`](src/config/featureFlagsRegistry.js). As relevantes para o bot:

| Flag | Papel |
|------|--------|
| `agentic_shadow_mode` | Se **true**, o router **calcula** rota agentic e **loga** (`[AgentRouter] Shadow decision`), mas a execução no WhatsApp continua **determinística** (sem `processAgenticMessage`). `_isAgenticEnabled` considera shadow como “agentic ligado para observabilidade”. |
| `agentic_router_enabled` | Se **true** (e shadow **false**), decisões `route === 'agentic'` podem seguir para o loop LLM+tools **quando** `agentic_tools_enabled` também estiver true (ver abaixo). |
| `agentic_tools_enabled` | **Obrigatória** para executar o agente no `messageController`: sem ela, mesmo com router agentic, o código **não** chama `processAgenticMessage`. |
| `agentic_onboarding_enabled` | Quando **true**, o onboarding usa assistência LLM na **primeira venda** (Ato 2): `onboardingAgenticAssistService` → `geminiService.extractOnboardingSaleJson` se o parser regex não extrair valor. |

### Matriz de prioridade (confirmações sim/não)

Alinhar testes manuais a esta ordem (detalhe em [`docs/AGENTIC_WHATSAPP_E2E_CHECKLIST.md`](docs/AGENTIC_WHATSAPP_E2E_CHECKLIST.md)):

1. Confirmação de transação em memória (`pendingTransactions`).
2. Confirmação de documento / OCR (`pendingDocumentTransactions` / `getPersistedPendingConfirmation`).
3. Edição pendente (`pendingEdits`).
4. **`agentic_confirm`** (tool com `requiresConfirmation`).

### Checklist E2E (homolog)

- [`docs/AGENTIC_WHATSAPP_E2E_CHECKLIST.md`](docs/AGENTIC_WHATSAPP_E2E_CHECKLIST.md) — saldo, histórico, confirmação de tool, shadow, membro vs dono, timeout.

### Ordem sugerida de rollout (homolog → prod)

1. **`agentic_shadow_mode`** (sozinha ou com router off): validar logs de decisão vs tráfego real, sem mudar resposta ao usuário.
2. **`agentic_router_enabled` + `agentic_tools_enabled`** em cohort pequeno: respostas reais via tools; monitorar erros e confirmações.
3. Ajustar cohort / thresholds no router conforme métricas (ver `agentRouterService` — intents alinhados ao prompt em `buildIntentClassificationPrompt`).

### Confirmação de tools

Tools marcadas com `requiresConfirmation` (ex.: `register_sale`, `register_cost`) interrompem o loop e persistem estado em **`conversation_runtime_states`** com `flow = 'agentic_confirm'` e payload `{ toolName, args }`. O usuário responde **sim** / **não**; o `messageController` resolve via `_tryResolveAgenticToolConfirmation` e executa `toolRegistry.execute(..., { userConfirmed: true })`.

### Histórico e analytics

- Respostas geradas pelo agente são salvas em `conversation_history` com intent **`agentic`** (não dispara captura passiva de `failed_intent` para `mensagem_ambigua` quando a resposta veio do agente).
- `hasPendingConversationContext` considera `agentic_confirm` para não tratar `sim`/`1` como opção órfã.
- **Eventos (cap. 13 / PostHog + `analytics_events`):**
  - `agentic_turn_completed` — turno agentic com resposta ao usuário: `mode`, `intent`, `had_text`, **`latency_ms`**, **`router_reason`**.
  - `agentic_deterministic_fallback` — router mandou agentic mas não houve resposta utilizável ou houve exceção (`messageController` + `safeAgenticTrack` em [`src/services/agenticTelemetryService.js`](src/services/agenticTelemetryService.js)).
  - `agentic_first_tool_invoked` — primeira `functionCall` do turno (`geminiService.processAgenticMessage`).
  - `agentic_tool_requires_confirmation` | `agentic_tool_executed` (success/fail) | `agentic_tool_not_found` | `agentic_tool_validation_failed` — [`toolRegistry.js`](src/services/agentic/toolRegistry.js).
  - `agentic_tool_confirmation_accepted` | `agentic_tool_confirmation_rejected` | `agentic_tool_confirmation_failed` — `_tryResolveAgenticToolConfirmation` no `messageController`.
  - `conversational_nps_submitted` — [`conversationalNpsService.js`](src/services/conversationalNpsService.js); persistência em `conversational_nps_responses`.
  - `subscription_activated_via_webhook` — [`paymentService.handleWebhook`](src/services/paymentService.js) após primeiro `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` conhecido (com migração trial quando aplicável).
  - `onboarding_act_entered` — marcos Ato 2 / Ato 3 (`contextHandlers`, `onboardingFlowService`).
- **Admin — export NPS:** `GET /api/admin/conversational-nps?limit=&offset=&since=` (JWT admin via `is_user_admin`), mesmo stack de [`admin.routes.js`](src/routes/admin.routes.js).
- **Admin — agentic / billing:** `GET /api/admin/agentic-analytics?days=7` (contagens em `analytics_events` para eventos `agentic_*`, `subscription_activated_via_webhook`, `onboarding_act_entered`).
- **Admin — trial:** `GET /api/admin/trial-accounts?limit=50` (lista `trial_accounts` para suporte).

**Comportamento “agente-LLM” (rollout):** com `agentic_router_enabled` e `agentic_tools_enabled`, o [`agentRouterService`](src/services/agentic/agentRouterService.js) usa **`default_agentic_preferred`**: qualquer intenção **fora** de `DETERMINISTIC_ONLY_INTENTS` vai para `processAgenticMessage`. Intenções de membro (`adicionar_numero`, `listar_numeros`, `remover_numero`), documento, MDR, edição, ajuda export, etc. permanecem determinísticas.

**Ligar o agente para todos os usuários:** guia operacional em [`docs/AGENTIC_GLOBAL_ROLLOUT.md`](docs/AGENTIC_GLOBAL_ROLLOUT.md). Resumo: (1) `FEATURE_FLAGS={"agentic_router_enabled":true,"agentic_tools_enabled":true,"agentic_shadow_mode":false}` no deploy, **ou** (2) aplicar migration `20260512203000_seed_global_agentic_feature_flags.sql` (linhas globais `user_id` NULL). Não ativar `agentic_shadow_mode` se o objetivo é resposta agentic real (shadow só loga “o que faria”). Auditar overrides por usuário na tabela `feature_flags`. **`agentic_onboarding_enabled`:** opcional e separado (onboarding assist); recomenda-se validar o fluxo pós-onboarding antes de ligar no mesmo rollout.

### Arquivos principais

- Orquestração: [`src/controllers/messageController.js`](src/controllers/messageController.js)
- Loop LLM + tools: [`src/services/geminiService.js`](src/services/geminiService.js) (`processAgenticMessage`)
- Router: [`src/services/agentic/agentRouterService.js`](src/services/agentic/agentRouterService.js)
- Módulo: [`src/services/agentic/index.js`](src/services/agentic/index.js)
- Telemetria agentic: [`src/services/agenticTelemetryService.js`](src/services/agenticTelemetryService.js)

### Testes

- `tests/unit/agentRouterService.test.js`
- `tests/unit/featureFlagService.agenticGlobal.test.js`
- `tests/unit/messageController.optionGuard.test.js` (mocks de `featureFlagService`, `agentic`, `conversationRuntimeStateService.get`, `onboardingFlowService.isOnboarding`)
- `tests/unit/onboardingAgenticAssistService.test.js`, `tests/unit/conversationalNpsService.test.js`, `tests/unit/contextHandlers.multiChoice.test.js`, `tests/unit/agenticTelemetryService.test.js`, `tests/unit/paymentService.webhook.test.js`

### Referência de produto

- Especificação: `lumizchatbotdesign.md` / `ROADMAP.md` (Fase 23).

### Reconciliação anexos B–E (implementação v2.1)

| Anexo | Onde vive no código |
|-------|---------------------|
| B — System prompt | `src/config/prompts.js` (`buildAgenticSystemPrompt`, `buildIntentClassificationPrompt`, extração documento/MDR conforme fase) |
| C — Perfil da clínica | `src/services/agentic/clinicProfileService.js`, tabela `clinic_profiles` |
| D — Tools | `src/services/agentic/registerDefaultTools.js`, `toolRegistry.js` |
| E — Mensagens | `src/copy/*WhatsappCopy.js` (onboarding, MDR, etc.); sem strings soltas em controllers |

## 2026-05-29 — Segurança pós-onboarding: modo real e desfazer/corrigir

- Adicionado gate de confirmação explícita de modo real via `realModeService`.
- Quando `profiles.whatsapp_real_mode_confirmed_at` existe e está vazio, o primeiro intent `registrar_entrada`/`registrar_saida` não grava transação: o bot pede confirmação e persiste o lançamento pendente em `conversation_runtime_states` com `flow = 'real_mode_confirm'`.
- Resposta `sim` atualiza `profiles.whatsapp_real_mode_confirmed_at`, invalida cache do usuário/telefone e reprocessa o lançamento original.
- Resposta `não` cancela sem gravar.
- Comandos reforçados: `apagar último lançamento`, `isso foi teste` → `desfazer`; `corrigir último lançamento` → abre edição da última transação.
- `EditHandler.handleUndoLastTransaction` agora usa `transactionController.deleteTransaction` para remover relações de atendimento/parcelas em vez de deletar tabela direta.
- Se a migration ainda não estiver aplicada, o serviço faz fallback persistente em `conversation_runtime_states` com `flow = 'real_mode_confirmed'` e TTL longo, evitando bloquear a feature por divergência de histórico do Supabase CLI.

## 2026-05-29 — Hardening seguro do banco financeiro

- Reconciliado drift de migration remoto com placeholder local `20260527172223_remote_history_placeholder.sql`; essa versão já constava aplicada no Supabase remoto, mas não existia no repositório.
- Migration `20260529195500_financial_traceability_hardening.sql` adiciona rastreabilidade financeira incremental:
  - `atendimentos`: `origem`, `is_test`, `source_phone`, `source_message_id`, `raw_message`, `metadata`.
  - `contas_pagar`: `is_test`, `source_phone`, `source_message_id`, `raw_message`, `metadata`.
- Migration `20260601165000_filter_test_financial_views.sql` separa auditoria e operação:
  - `view_financial_ledger_all` mantém lançamentos reais e de teste;
  - `view_financial_ledger`, `view_finance_balance` e `view_monthly_report` excluem `is_test=true`.
- Lançamentos confirmados via WhatsApp passam a salvar `origem='whatsapp_text'`, telefone, texto original, `is_test=false` e metadados de confiança quando disponíveis.
- `transactionController` mantém fallback para schema antigo: se o Supabase acusar coluna ausente nos campos novos, reexecuta o insert sem rastreabilidade para não derrubar produção durante deploy/migration.
- Novo cleanup operacional: `conversationRuntimeStateService.cleanupExpired(limit)` e endpoint protegido `GET /api/cron/runtime-cleanup` removem estados expirados sem tocar estados ativos.

## 2026-06-10 — Inventário real WhatsApp-first

- Adicionado modelo incremental de inventário real via migration `20260609160000_real_inventory_tables.sql`:
  - `estoque_produtos` para cadastro físico por clínica;
  - `estoque_lotes` para validade/lote/saldo;
  - `estoque_movimentos_reais` para ledger de entrada/saída/ajuste/inventário;
  - `procedimento_consumos` como estrutura reservada para futura atualização pós-procedimento.
- Novo serviço `src/services/estoqueProdutoService.js`:
  - parse de lista de inventário inicial enviada no WhatsApp;
  - cadastro/upsert de produtos;
  - entrada com lote/validade/custo;
  - baixa FIFO por validade/criação;
  - consulta geral e por item.
- `src/controllers/messages/estoqueHandler.js` agora usa `conversation_runtime_states.flow='inventory_setup'` para fluxo persistente:
  - `configurar estoque` abre instruções;
  - usuário envia uma lista com um item por linha;
  - bot confirma com `1 Confirmar`, `2 Cancelar`, `3 Corrigir`;
  - confirmação grava produtos/lotes/movimentos com origem `inventario`.
- Comandos de estoque tentam inventário real primeiro e mantêm fallback para `estoqueService` legado enquanto clínicas antigas não migrarem.
- Documentos de fornecedor (`supplierDocumentService`) extraem itens, lote e validade quando visíveis, mas não dão entrada automática no estoque no fluxo público atual.
- Vendas confirmadas não baixam estoque automaticamente. A decisão de produto é tratar estoque pós-procedimento em uma etapa explícita futura, com confirmação do usuário e escolha/escrita dos insumos usados.
- `npm run test:regression` agora inclui `tests/unit/estoqueProdutoService.test.js` e `tests/unit/estoqueHandler.inventorySetup.test.js`.
- Validação local: syntax check dos arquivos alterados, testes focados de inventário e regressão completa passaram.

### Pendências operacionais

- Deploy Railway após validação local.
- Testar manualmente no WhatsApp:
  - `configurar estoque`;
  - lista com produtos/lotes;
  - `1` para confirmar;
  - `estoque`, `saldo botox`, `entrada estoque ...`, `baixar estoque ...`.
- Próxima fase de produto: desenhar atualização de estoque pós-procedimento com botões (`Sim`/`Não`) e seleção manual dos insumos usados.

## 2026-06-10 — Inadimplência no WhatsApp e copy de áudio

- Comando determinístico novo:
  - `/inadimplencia`;
  - `inadimplência`;
  - `clientes em atraso`;
  - `recebíveis vencidos`;
  - `parcelas vencidas`.
- O comando usa `inadimplenciaService.getOverview(user.id)` e retorna:
  - total vencido;
  - quantidade de parcelas vencidas;
  - impacto sobre faturamento de referência;
  - lista resumida dos principais clientes em atraso.
- Alerta diário opcional:
  - `whatsappOperationalAlertService.sendInadimplenciaAlerts()`;
  - controlado por `WHATSAPP_INADIMPLENCIA_ALERTS_ENABLED=true`;
  - exige `profiles.alertas_whatsapp_ativos=true`;
  - usa `reminderSentHelper` para evitar duplicidade diária por perfil.
- `GET /api/cron/operational-alerts` agora retorna também:
  - `inadimplenciaAlerts`;
  - `inadimplencia_alerts_sent`.
- Copy de áudio foi centralizada em `src/copy/audioWhatsappCopy.js`, mantendo fallback amigável para:
  - áudio indisponível;
  - falha de download;
  - transcrição vazia;
  - erro temporário de processamento.
