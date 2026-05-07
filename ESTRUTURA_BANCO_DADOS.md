# 📊 Estrutura do Banco de Dados - Lumiz

**Última atualização:** 07/05/2026

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
- `created_at`, `updated_at`

**Uso:** Histórico de atendimento por paciente, CRM básico

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

**Migration:** `supabase/migrations/20260507000030_create_feature_flags.sql`

**Colunas principais:**
- `id` (PK)
- `user_id` (FK → profiles, nullable para flag global)
- `name`
- `enabled`
- `meta` (JSONB)
- `created_at`, `updated_at`

**Uso:** `alter_enabled`, `alter_antecipacao_automatica_off`, `alter_insight_last_sent` e futuras flags de rollout.

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
**Tabelas Auxiliares:** 11+ tabelas de suporte  
**Views:** 2 views otimizadas  
**Total:** 21+ estruturas principais

**Princípio:** Separação clara entre entradas (`atendimentos`) e saídas (`contas_pagar`) para facilitar cálculos financeiros e relatórios.

