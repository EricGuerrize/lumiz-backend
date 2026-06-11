# 📊 Estrutura do Banco de Dados - Lumiz

**Última atualização:** 12/05/2026 (Anexo A benchmarks + NPS conversacional)

Esta documentação detalha a estrutura completa do banco de dados Supabase utilizado pelo sistema Lumiz.

---

## 🗂️ Tabelas Principais (Core)

### 1. `profiles`
**Descrição:** Armazena os dados dos usuários (clínicas) do sistema. Vinculado ao Supabase Auth.

**Colunas Principais:**
- `id` (PK, mesmo que Auth UID)
- `nome_completo`
- `nome_clinica`
- `telefone` (Unique)
- `email`
- `whatsapp_contato`
- `cidade`
- `tipo_clinica`
- `ticket_medio`
- `procedimentos_mes`
- `is_active`
- `reporte_mensal_whatsapp` (opt-in do resumo mensal via WhatsApp)
- `alertas_whatsapp_ativos` (opt-in de alertas/insights automáticos via WhatsApp, default `false`)
- `created_at`, `updated_at`

**Uso:** Autenticação, Onboarding, Configurações de Perfil

---

### 2. `atendimentos` (Entradas)
**Descrição:** Registra cada venda ou atendimento realizado. É a tabela central de receitas.

**Colunas Principais:**
- `id` (PK)
- `user_id` (FK → profiles)
- `cliente_id` (FK → clientes)
- `data`
- `valor_total`
- `custo_total` (estimado)
- `forma_pagamento`
- `status_pagamento`
- `parcelas`
- `bandeira_cartao`
- `observacoes`
- `created_at`, `updated_at`

**Uso:** Registro de Vendas, Cálculo de Faturamento

---

### 3. `contas_pagar` (Saídas)
**Descrição:** Registra todas as despesas e custos da clínica.

**Colunas Principais:**
- `id` (PK)
- `user_id` (FK → profiles)
- `descricao`
- `valor`
- `data`
- `tipo` (fixa/variavel)
- `categoria` (Ex: Aluguel, Insumos)
- `status_pagamento`
- `created_at`, `updated_at`

**Uso:** Registro de Custos, Cálculo de Lucro

---

### 4. `clientes`
**Descrição:** Cadastro de pacientes/clientes atendidos.

**Colunas Principais:**
- `id` (PK)
- `user_id` (FK → profiles)
- `nome`
- `telefone`
- `email`
- `cpf`
- `data_nascimento`
- `observacoes` (item #36 — observações livres, opcional)
- `created_at`, `updated_at`

**Uso:** Histórico de atendimento por paciente, CRM básico

**Migration relacionada:** `20260611120000_add_paciente_basic_fields.sql` (item #36) — garante (aditivo, `ADD COLUMN IF NOT EXISTS`) os campos `telefone`, `cpf`, `data_nascimento`, `email`, `observacoes` e reforça RLS por `user_id` na tabela `clientes`.

---

### 5. `procedimentos`
**Descrição:** Catálogo de serviços ou procedimentos oferecidos pela clínica.

**Colunas Principais:**
- `id` (PK)
- `user_id` (FK → profiles)
- `nome`
- `tipo` (botox, acido, outros)
- `custo_material_ml`
- `valor_sugerido`
- `created_at`, `updated_at`

**Uso:** Padronização de nomes de procedimentos, estimativa de custos

---

### 6. `atendimento_procedimentos`
**Descrição:** Tabela de junção (Join Table) que liga um atendimento aos procedimentos realizados nele. Permite que um atendimento tenha múltiplos procedimentos.

**Colunas Principais:**
- `id` (PK)
- `atendimento_id` (FK → atendimentos)
- `procedimento_id` (FK → procedimentos)
- `valor_cobrado`
- `custo_material`
- `created_at`, `updated_at`

**Uso:** Detalhamento da venda

---

### 7. `parcelas`
**Descrição:** Registra as parcelas futuras de uma venda parcelada.

**Colunas Principais:**
- `id` (PK)
- `atendimento_id` (FK → atendimentos)
- `numero` (1, 2, 3...)
- `valor`
- `data_vencimento`
- `paga` (boolean)
- `created_at`, `updated_at`

**Uso:** Controle de Fluxo de Caixa Futuro (Contas a Receber)

---

### 8. `agendamentos`
**Descrição:** Agenda de compromissos futuros.

**Colunas Principais:**
- `id` (PK)
- `user_id` (FK → profiles)
- `cliente_id` (FK → clientes)
- `procedimento_id` (FK → procedimentos)
- `data_agendamento`
- `status`
- `created_at`, `updated_at`

**Uso:** Funcionalidade de agenda (em expansão)

---

### 9. `clinic_members`
**Descrição:** Permite vincular múltiplos números WhatsApp a uma mesma clínica. Cada membro tem uma função (dona, gestora, adm, secretária, profissional) e pode acessar os dados financeiros.

**Colunas Principais:**
- `id` (PK, UUID)
- `clinic_id` (FK → profiles) - Clínica à qual o membro pertence
- `telefone` (VARCHAR, Unique quando ativo) - Número WhatsApp do membro
- `nome` (VARCHAR) - Nome do membro
- `funcao` (VARCHAR) - Função: 'dona', 'gestora', 'adm', 'financeiro', 'secretaria', 'profissional'
- `is_primary` (BOOLEAN) - Se é o número que fez o onboarding original
- `is_active` (BOOLEAN) - Se o vínculo está ativo
- `confirmed` (BOOLEAN) - Se o membro confirmou o vínculo
- `confirmed_at` (TIMESTAMP) - Data/hora da confirmação
- `created_by` (FK → profiles) - Quem cadastrou este membro
- `created_at`, `updated_at`

**Índices:**
- `idx_clinic_members_telefone` - Busca rápida por telefone
- `idx_clinic_members_clinic_id` - Listar membros por clínica
- `idx_clinic_members_active` - Filtro por membros ativos

**Constraints:**
- `UNIQUE(telefone)` quando `is_active = TRUE` - Telefone só pode estar em uma clínica
- `CHECK funcao IN (...)` - Valida funções permitidas

**Uso:** Multi-usuário por clínica, acesso via número pessoal da dona

---

## 📈 Views (Otimização)

### 1. `view_finance_balance`
**Descrição:** Visualização SQL pré-calculada para saldo instantâneo.

**Retorna:**
- `user_id`
- `total_receitas` (soma de atendimentos)
- `total_despesas` (soma de contas_pagar)
- `saldo` (receitas - despesas)

**Motivo:** Performance (evita somar milhares de linhas no Javascript)

**Uso:** Cálculo rápido de saldo financeiro

---

### 2. `view_monthly_report`
**Descrição:** Agrega dados por mês.

**Retorna:**
- `user_id`
- `ano`
- `mes`
- `receitas` (agregadas por mês)
- `despesas` (agregadas por mês)
- `total_transacoes`

**Motivo:** Simplifica queries de relatórios mensais

**Uso:** Relatórios e dashboards mensais

### 3. `view_financial_ledger`
**Descrição:** Ledger consolidado usado pelo dashboard e relatórios operacionais.

**Regra operacional:** a view filtra lançamentos com `is_test = true`. Assim, dados de onboarding, diagnóstico ou simulação podem ficar auditáveis no banco sem entrar no saldo, relatório mensal ou indicadores reais.

### 4. `view_financial_ledger_all`
**Descrição:** Ledger consolidado sem filtro de teste, criado para auditoria e debug.

**Uso:** conferência técnica, suporte e investigações. Não deve ser usado como fonte principal do dashboard financeiro.

---

## 🔧 Tabelas Auxiliares

### 1. `user_roles`
**Descrição:** Gerenciamento de permissões (Admin vs Funcionário).

**Colunas:**
- `id` (PK)
- `user_id` (FK → profiles)
- `role` (enum: 'admin', 'funcionario')
- `created_by`
- `created_at`

---

### 2. `onboarding_progress`
**Descrição:** Estado do processo de onboarding.

**Colunas:**
- `id` (PK)
- `phone` (Unique)
- `user_id` (FK → profiles)
- `stage`, `phase`
- `steps` (JSONB)
- `data` (JSONB)
- `progress_percent`
- `completed`
- `completed_at`
- `ab_variant`
- `resume_token`
- `meta` (JSONB)
- `nps_score`, `nps_feedback`
- `created_at`, `updated_at`

---

### 3. `mdr_configs`
**Descrição:** Configurações de taxas de cartão (MDR - Merchant Discount Rate).

**Colunas:**
- `id` (PK)
- `user_id` (FK → profiles)
- `phone`
- `source` (manual/ocr)
- `provider` (Stone, PagSeguro, etc)
- `bandeiras` (JSONB)
- `tipos_venda` (JSONB)
- `parcelas` (JSONB)
- `raw_payload` (JSONB)
- `status`
- `created_at`, `updated_at`

---

### 4. `ocr_jobs`
**Descrição:** Fila de processamento de imagens/PDFs para extração de taxas MDR.

**Colunas:**
- `id` (PK)
- `user_id` (FK → profiles)
- `phone`
- `provider`
- `source_url`
- `status` (pending/processing/completed/failed)
- `extracted_data` (JSONB)
- `error`
- `created_at`, `updated_at`

---

### 5. `user_insights`
**Descrição:** Armazena dicas geradas pela IA para o usuário.

**Colunas:**
- `id` (PK)
- `user_id` (FK → profiles)
- `phone`
- `title`
- `summary`
- `insights` (JSONB)
- `sent_via`
- `sent_at`
- `metadata` (JSONB)
- `created_at`

---

### 6. `conversation_history`
**Descrição:** Histórico de conversas para RAG (Retrieval Augmented Generation).

**Colunas:**
- `id` (PK)
- `user_id` (FK → profiles)
- `phone`
- `message`
- `response`
- `intent`
- `metadata` (JSONB)
- `created_at`

**Uso:** Melhora o entendimento do bot usando contexto histórico

---

## 🔐 Row Level Security (RLS)

As seguintes tabelas têm RLS habilitado para segurança:

- ✅ `atendimentos`
- ✅ `contas_pagar`
- ✅ `clientes`
- ✅ `procedimentos`
- ✅ `onboarding_progress`
- ✅ `mdr_configs`
- ✅ `ocr_jobs`
- ✅ `user_insights`
- ✅ `supplier_documents`
- ✅ `feature_flags`
- ✅ `alter_recebiveis`
- ✅ `alter_antecipacoes`
- ✅ `alter_cobertura_snapshots`

**Política:** `user_id = auth.uid()` - Usuários só acessam seus próprios dados

---

## 🧾 Onda 2 — Supplier docs / OCR de fornecedor

### `supplier_documents`
**Descrição:** Registro do documento enviado pelo usuário (NF, boleto, comprovante), texto bruto extraído e JSON estruturado usado para criar contas a pagar e sugestões de estoque.

**Migration:** `supabase/migrations/20260507000020_create_supplier_documents.sql`

**Colunas principais:**
- `id` (PK)
- `user_id` (FK → profiles)
- `fornecedor_id` (FK → fornecedores, nullable)
- `tipo` (`nf`, `boleto`, `comprovante`, `outro`)
- `raw_text`
- `parsed_json` (JSONB)
- `status` (`pending`, `linked`, `failed`, `cancelled`)
- `conta_pagar_id` (FK → contas_pagar, compatibilidade com documento de parcela única)
- `source_phone`
- `file_hash`
- `confidence_score`
- `created_at`, `updated_at`

**Uso:** OCR de NF/boleto/comprovante, fluxo de confirmação no WhatsApp, deduplicação por hash e auditoria do que foi extraído pela IA.

### Extensões em `fornecedores`
**Migration:** `supabase/migrations/20260507000021_fornecedores_extra_fields.sql`

Campos adicionados:
- `cnpj`
- `email`
- `whatsapp`

**Uso:** match de fornecedor por CNPJ/nome e CRUD de fornecedores no dashboard.

### Extensões em `contas_pagar`
**Migration:** `supabase/migrations/20260507000022_contas_pagar_origem_parcelas.sql`

Campos adicionados:
- `origem` (`manual`, `whatsapp_text`, `nf_ocr`, `boleto_ocr`, `comprovante_ocr`, `import`)
- `supplier_document_id` (FK → supplier_documents)
- `fornecedor_id` (FK → fornecedores)
- `parcela_numero`
- `parcela_total`

**Uso:** rastrear origem da conta a pagar e representar boletos/NFs parcelados como múltiplas linhas.

---

## 🔀 Onda 3 — Feature flags e Alter mock

### `feature_flags`
**Descrição:** Flags globais ou por usuário para ativar/desativar features sem deploy.

**Migrations:** `supabase/migrations/20260507192545_create_feature_flags.sql` (tabela); `supabase/migrations/20260512203000_seed_global_agentic_feature_flags.sql` (seed global opcional: `agentic_tools_enabled`, `agentic_router_enabled` ON; `agentic_shadow_mode` OFF).

**Colunas principais:**
- `id` (PK)
- `user_id` (FK → profiles, nullable para flag global)
- `name`
- `enabled`
- `meta` (JSONB)
- `created_at`, `updated_at`

**Uso:** `alter_enabled`, flags agentic (`agentic_*`), rollout por `user_id` ou linha global (`user_id` NULL). Precedência vs env: ver `featureFlagService.js`. Guia ops: `docs/AGENTIC_GLOBAL_ROLLOUT.md`.

### `alter_recebiveis`
**Descrição:** Agenda de recebíveis por clínica. No mock, é derivada de `parcelas`; no futuro, será sincronizada da API Alter.

**Migration:** `supabase/migrations/20260507000031_create_alter_recebiveis.sql`

**Colunas principais:**
- `id` (PK)
- `user_id` (FK → profiles)
- `adquirente`
- `bandeira`
- `parcelas_total`, `parcela_numero`
- `valor_bruto`, `valor_liquido`
- `mdr`
- `data_venda`, `data_disponivel`
- `status` (`livre`, `comprometido`, `antecipado`, `liquidado`, `cancelado`)
- `source` (`mock`, `alter_api`, `manual`)
- `external_id`
- `parcela_id` (FK → parcelas)
- `created_at`, `updated_at`

**Uso:** agenda de recebíveis, aging, mix por adquirente/parcelas, simulação de antecipação e cobertura de fornecedor.

### `alter_antecipacoes`
**Descrição:** Registro de simulações/execuções de antecipação spot.

**Migration:** `supabase/migrations/20260507000032_create_alter_antecipacoes.sql`

**Colunas principais:**
- `id` (PK)
- `user_id` (FK → profiles)
- `tipo` (`spot`)
- `valor_solicitado`
- `valor_liquido_recebido`
- `custo_antecipacao`
- `taxa_efetiva_pct`
- `recebiveis_ids` (uuid[])
- `status` (`simulada`, `executada`, `cancelada`, `falhou`)
- `payload_simulacao`
- `created_at`, `updated_at`

**Uso:** auditoria da matemática de antecipação e execução no mock/real adapter.

### `alter_cobertura_snapshots`
**Descrição:** Snapshot diário de cobertura de fornecedores por recebíveis disponíveis.

**Migration:** `supabase/migrations/20260507000033_create_alter_cobertura_snapshots.sql`

**Colunas principais:**
- `id` (PK)
- `user_id` (FK → profiles)
- `fornecedor_id` (FK → fornecedores)
- `data_snapshot`
- `total_a_pagar`
- `total_recebivel_disponivel`
- `cobertura_pct`
- `gap_dias`
- `payload`
- `created_at`

**Uso:** histórico de cobertura, ranking de fornecedores em risco e componente `cobertura_fornecedor` do health score.

### `audit_log`
**Descrição:** Append-only log de mutações críticas (POST/PUT/DELETE/PATCH). Captura quem alterou o quê, quando, com IP e user-agent.

**Migration:** `supabase/migrations/20260508000040_create_audit_log.sql`

**Colunas principais:**
- `id` (PK)
- `user_id` (FK → profiles, ON DELETE SET NULL)
- `clinic_id` (reservado para Fase 14 multi-tenant — hoje sempre NULL)
- `action` (varchar 100): ex `transaction_updated`, `goal_updated`, `estoque_entrada`
- `entity_type` (varchar 50): ex `transaction`, `monthly_goal`, `supplier_document`
- `entity_id` (text): UUID ou chave composta como `goal:2026:5`
- `old_value`, `new_value` (jsonb com dados sensíveis mascarados)
- `ip_address` (varchar 45, suporta IPv6)
- `user_agent` (text, truncado a 500 chars no service)
- `created_at`

**Índices:** `(user_id, created_at DESC)`, `(entity_type, entity_id)`, `(action, created_at DESC)`.

**RLS:** leitura por usuário autenticado restrita a `user_id = auth.uid()`; escrita só via service-role (backend).

**Uso:** rastreabilidade de quem alterou o quê (atende compliance LGPD), debugging em produção, base para anonimização da Fase 19.

**Mascaramento:** chaves sensíveis (senha, token, cpf, jwt, pix_chave, cartao*, cvv...) viram `***` recursivamente em `old_value`/`new_value`.

### `account_deletion_tokens`
**Descrição:** Tokens de confirmação para exclusão de conta (Fase 19 — LGPD Art. 18, VI). Confirmação dupla: o usuário inicia pela sessão autenticada e finaliza clicando no link enviado por email.

**Migration:** `supabase/migrations/20260508000050_create_account_deletion_tokens.sql`

**Colunas principais:**
- `id` (PK uuid)
- `user_id` (FK → profiles, ON DELETE CASCADE)
- `token` (uuid unique, gerado com `gen_random_uuid()`)
- `expira_em` (timestamptz, default agora + 24h)
- `usado_em` (timestamptz NULL — marca consumo único)
- `requested_ip` (varchar 45)
- `requested_user_agent` (text)
- `created_at`

**Índices:** `(user_id, created_at DESC)`, índice parcial em `token WHERE usado_em IS NULL` para lookup rápido de tokens ativos.

**RLS:** leitura por usuário autenticado restrita a `user_id = auth.uid()`; escrita só via service-role.

**Uso:** Backend cria via `lgpdService.requestDeletionToken()` quando o usuário chama `DELETE /api/user/account`. Validação e consumo via `lgpdService.consumeDeletionToken()` em `POST /api/user/account/confirm-delete`.

---

## 🤖 Fase Agentic — Tabelas de Agente

### `clinic_profiles`
**Descrição:** Perfil rico da clínica com patterns, preferences e learned_facts. Injetado no contexto LLM a cada turno.

**Migration:** `supabase/migrations/20260512100001_create_clinic_profiles.sql`

**Colunas principais:**
- `id` (PK uuid)
- `user_id` (FK → profiles, UNIQUE)
- `clinic_name`, `clinic_type`, `tier`, `city`
- `professionals` (JSONB) - array de profissionais
- `tax_regime`, `tax_bracket`
- `patterns` (JSONB) - ticket médio, top procedures, sazonalidade, payment mix, acquirer fees, recurring costs
- `preferences` (JSONB) - estilo de comunicação, horário de notificação
- `learned_facts_summary` (JSONB) - resumo dos fatos aprendidos
- `profile_version`, `data_points_total`, `last_builder_run_at`
- `created_at`, `updated_at`

**Uso:** Contexto persistente da clínica para o agente LLM.

---

### `learned_facts_agentic`
**Descrição:** Fatos aprendidos sobre a clínica (memória de longo prazo) com busca semântica via embeddings.

**Migration:** `supabase/migrations/20260512100002_create_learned_facts_agentic.sql`

**Colunas principais:**
- `id` (PK uuid)
- `clinic_id` (FK → clinic_profiles)
- `user_id` (FK → profiles)
- `fact` (text) - o fato aprendido
- `fact_type` (varchar) - vendor_pattern, payment_pattern, seasonality, client_pattern, procedure_pattern, general
- `embedding` (vector 1536) - para busca semântica
- `confidence` (float 0-1)
- `supporting_records` (text[]) - IDs de evidências
- `is_active`, `invalidated_at`, `invalidated_reason`
- `source` - inferred, user_stated, document_extracted, profile_builder
- `learned_at`, `last_used_at`, `use_count`
- `created_at`, `updated_at`

**RPC:** `match_learned_facts_agentic(query_embedding, match_threshold, match_count, p_clinic_id)` para busca semântica.

**Uso:** Memória de longo prazo do agente sobre padrões da clínica.

---

### Helpers Agentic de Perfil
**Descrição:** Funções auxiliares para atualização incremental do perfil rico.

**Migration:** `supabase/migrations/20260512100003_add_agentic_profile_builder_helpers.sql`

**RPCs:**
- `increment_clinic_data_points(p_user_id, p_count)` - incrementa o contador usado como gatilho do `profileBuilderService`

**Uso:** Permitir rebuild assíncrono do perfil com base em novos lançamentos sem recalcular tudo a cada turno.

---

### `agentic_tool_calls`
**Descrição:** Log de todas as chamadas de tools do agente para auditoria, debugging e métricas.

**Migration:** `supabase/migrations/20260512100000_create_agentic_tool_calls.sql`

**Colunas principais:**
- `id` (PK uuid)
- `user_id`, `clinic_id`, `phone`
- `tool_name`, `tool_version`
- `input_params`, `output_result` (JSONB)
- `status` - pending, executing, success, failed, cancelled, requires_confirmation
- `error_message`, `error_code`
- `conversation_turn_id`
- `triggered_by` - llm, user_explicit, system, fallback
- `confidence_score`
- `required_confirmation`, `user_confirmed`, `confirmed_at`
- `execution_time_ms`, `tokens_used`
- `created_at`, `completed_at`

**Uso:** Auditoria, debugging e métricas de qualidade do agente.

---

### `trial_accounts`
**Descrição:** Conta-fantasma do onboarding. Guarda os lançamentos do teste rápido antes da conversão em uso real após pagamento.

**Migration:** `supabase/migrations/20260512181259_create_trial_accounts.sql`

**Colunas principais:**
- `id` (PK uuid)
- `phone` (varchar, UNIQUE) - telefone principal do teste
- `clinic_id` (FK → profiles, nullable até o profile ser criado)
- `owner_name`, `clinic_name`, `role`
- `status` - active, converted, discarded
- `snapshot` (JSONB) - vendas, custos, saldo inicial e totais do onboarding
- `referral_summary` (text) - resumo pronto para encaminhamento à dona/gestora
- `metadata` (JSONB) - trilhas auxiliares da conversão
- `converted_at`, `created_at`, `updated_at`

**Uso:** Persistir a experiência agentic do trial e migrar os dados para `atendimentos` / `contas_pagar` quando a assinatura é confirmada.

---

### `domain_procedure_benchmarks`
**Descrição:** Catálogo global read-only de benchmarks de procedimentos estéticos (faixas de preço, insumo, margem, tempo) — **Anexo A** do `lumizchatbotdesign.md`. Distinto de `procedimentos` (por `user_id` / estoque da clínica).

**Migration:** `supabase/migrations/20260512203000_domain_procedure_benchmarks.sql`

**Colunas principais:** `slug` (unique), `nome`, `categoria`, `preco_min_brl`, `preco_max_brl`, `insumo_pct_min/max`, `margem_tipica`, `tempo_medio_min`, `sort_order`, `active`, `created_at`.

**Uso:** `domainProcedureBenchmarkService` carrega linhas ativas e injeta texto em `conversationContextService` / prompt agentic.

---

### `conversational_nps_responses`
**Descrição:** Respostas NPS 0–10 coletadas no WhatsApp (ex.: mensagem `nps: 9 comentário...`).

**Migration:** `supabase/migrations/20260512203100_conversational_nps_responses.sql`

**Colunas principais:** `user_id` (FK profiles, nullable), `phone`, `score` (0–10), `comment`, `raw_message`, `source`, `created_at`.

**Uso:** `conversationalNpsService.tryConsumeNpsMessage` + evento `conversational_nps_submitted` no `analyticsService`. INSERT apenas via backend (service role); RLS: owner `SELECT` para `authenticated`.

---

## 📊 Relacionamentos Principais

```
profiles (1) ──→ (N) atendimentos
profiles (1) ──→ (N) contas_pagar
profiles (1) ──→ (N) clientes
profiles (1) ──→ (N) procedimentos
profiles (1) ──→ (N) agendamentos
profiles (1) ──→ (N) supplier_documents
profiles (1) ──→ (N) alter_recebiveis
profiles (1) ──→ (N) alter_antecipacoes
profiles (1) ──→ (N) alter_cobertura_snapshots
profiles (1) ──→ (N) audit_log
profiles (1) ──→ (N) account_deletion_tokens
profiles (1) ──→ (1) clinic_profiles
profiles (1) ──→ (0..1) trial_accounts
profiles (1) ──→ (N) agentic_tool_calls

clinic_profiles (1) ──→ (N) learned_facts_agentic

atendimentos (1) ──→ (N) atendimento_procedimentos
atendimentos (1) ──→ (N) parcelas

procedimentos (1) ──→ (N) atendimento_procedimentos
clientes (1) ──→ (N) atendimentos
clientes (1) ──→ (N) agendamentos

fornecedores (1) ──→ (N) supplier_documents
fornecedores (1) ──→ (N) contas_pagar
supplier_documents (1) ──→ (N) contas_pagar
parcelas (1) ──→ (0..1) alter_recebiveis
```

---

## 🎯 Resumo

**Tabelas Core:** 8 tabelas principais  
**Tabelas Auxiliares:** 12+ tabelas de suporte  
**Views:** 2 views otimizadas  
**Total:** 22+ estruturas principais

**Princípio:** Separação clara entre entradas (`atendimentos`) e saídas (`contas_pagar`) para facilitar cálculos financeiros e relatórios.


---

### `profiles.whatsapp_real_mode_confirmed_at`

**Migration:** `supabase/migrations/20260529183500_add_whatsapp_real_mode_to_profiles.sql`

**Descrição:** timestamp nullable que registra quando o usuário confirmou explicitamente que mensagens pós-onboarding podem virar lançamentos financeiros reais no WhatsApp.

**Uso:** `realModeService` + `messageController`. Se a coluna existir e estiver vazia, o primeiro lançamento real é retido em `conversation_runtime_states.flow = 'real_mode_confirm'` até confirmação do usuário.

**Fallback operacional:** enquanto a migration não estiver aplicada, a confirmação também é persistida em `conversation_runtime_states.flow = 'real_mode_confirmed'` com TTL longo.

---

## Hardening financeiro — rastreabilidade de lançamentos

**Migrations:**
- `supabase/migrations/20260529195500_financial_traceability_hardening.sql`
- `supabase/migrations/20260601165000_filter_test_financial_views.sql`

### `atendimentos`
Novas colunas operacionais:
- `origem` — origem do lançamento (`manual`, `whatsapp_text`, `dashboard`, `import`, `nf_ocr`, `document_ocr`, `agentic`).
- `is_test` — indica lançamento de teste/simulação. Default `false` para preservar dados existentes como reais.
- `source_phone` — telefone que originou o lançamento via WhatsApp.
- `source_message_id` — ID externo da mensagem/evento quando o provider expõe.
- `raw_message` — mensagem original usada para criar o lançamento.
- `metadata` — metadados de captura, como `confidence_score`, split e origem de intent.

### `contas_pagar`
Novas colunas operacionais:
- `is_test`, `source_phone`, `source_message_id`, `raw_message`, `metadata` com o mesmo contrato de rastreabilidade.
- `origem` já existia em `contas_pagar` desde a Onda 2.A e passa a receber `whatsapp_text` para custos criados no WhatsApp.

### Índices adicionados
- `atendimentos(user_id, data DESC)` e `atendimentos(user_id, created_at DESC)`.
- `atendimentos(user_id, recebimento_previsto)` parcial.
- `contas_pagar(user_id, data DESC)` e `contas_pagar(user_id, created_at DESC)`.
- `contas_pagar(user_id, data_vencimento)` parcial.
- Índices parciais para `source_message_id` em receitas e despesas.
- `conversation_runtime_states(flow, expires_at)` para limpeza e consultas operacionais.

### Views financeiras filtradas
- `view_financial_ledger_all` mantém receitas/despesas reais e de teste para auditoria.
- `view_financial_ledger` lê de `view_financial_ledger_all` e exclui `is_test = true`.
- `view_finance_balance` e `view_monthly_report` usam o ledger filtrado, evitando que onboarding/testes alterem saldo e relatórios do usuário.

---

## Inventário real — produtos, lotes e movimentos

**Migration:** `supabase/migrations/20260609160000_real_inventory_tables.sql`

**Objetivo:** separar o estoque físico real da clínica do modelo legado acoplado a `procedimentos`, permitindo controlar produtos, lotes, validade, custo e movimentações auditáveis.

### `estoque_produtos`
Cadastro dos itens físicos controlados pela clínica.

Colunas principais:
- `user_id` — dono do inventário.
- `nome` — nome do produto/insumo.
- `categoria` — agrupamento operacional (`Toxina botulínica`, `Descartáveis`, `Insumos`, etc.).
- `unidade` — unidade operacional (`frasco`, `seringa`, `caixa`, `unidade`, etc.).
- `estoque_minimo`, `estoque_maximo` — limites para alerta e excesso.
- `custo_medio` — custo médio de referência.
- `fornecedor_id`, `ativo`, `metadata`.

### `estoque_lotes`
Saldo físico por lote/validade.

Colunas principais:
- `produto_id`, `user_id`.
- `lote`, `validade`.
- `quantidade_atual`.
- `custo_unitario`.
- `supplier_document_id` — vínculo opcional com NF/boleto/documento extraído por OCR.

### `estoque_movimentos_reais`
Ledger auditável das movimentações de estoque.

Colunas principais:
- `tipo` — `entrada`, `saida`, `ajuste`, `inventario`.
- `quantidade`, `custo_unitario`.
- `origem` — `manual`, `whatsapp_text`, `document_ocr`, `inventario`, etc.
- `source_phone`, `source_message_id`.
- `observacoes`, `metadata`, `data`.

### `procedimento_consumos`
Mapeia consumo padrão de produtos por procedimento para uma fase futura de atualização pós-procedimento.

Exemplos:
- `Botox` consome `0,25 frasco` de `Botox 100UI`.
- `Preenchimento labial` consome `1 seringa` de `Ácido hialurônico`.

Colunas principais:
- `user_id`, `procedimento_id`, `produto_id`.
- `quantidade_por_procedimento`.
- `unidade`, `ativo`, `metadata`.

**Status atual:** estrutura criada, mas sem uso automático no fluxo público. Vendas confirmadas não baixam estoque sozinhas. A decisão de produto é fazer uma etapa explícita pós-procedimento, com confirmação do usuário sobre atualizar ou não o estoque e quais insumos foram usados.

### Relacionamentos adicionados

```
profiles (1) ──→ (N) estoque_produtos
estoque_produtos (1) ──→ (N) estoque_lotes
estoque_produtos (1) ──→ (N) estoque_movimentos_reais
estoque_lotes (1) ──→ (N) estoque_movimentos_reais
supplier_documents (1) ──→ (N) estoque_lotes
procedimentos (1) ──→ (N) procedimento_consumos
estoque_produtos (1) ──→ (N) procedimento_consumos
```
