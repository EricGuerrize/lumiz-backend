# 📊 Estrutura do Banco de Dados - Lumiz

**Última atualização:** 13/01/2026

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

**Política:** `user_id = auth.uid()` - Usuários só acessam seus próprios dados

---

## 📊 Relacionamentos Principais

```
profiles (1) ──→ (N) atendimentos
profiles (1) ──→ (N) contas_pagar
profiles (1) ──→ (N) clientes
profiles (1) ──→ (N) procedimentos
profiles (1) ──→ (N) agendamentos

atendimentos (1) ──→ (N) atendimento_procedimentos
atendimentos (1) ──→ (N) parcelas

procedimentos (1) ──→ (N) atendimento_procedimentos
clientes (1) ──→ (N) atendimentos
clientes (1) ──→ (N) agendamentos
```

---

## 🎯 Resumo

**Tabelas Core:** 8 tabelas principais  
**Tabelas Auxiliares:** 6 tabelas de suporte  
**Views:** 2 views otimizadas  
**Total:** 16 estruturas principais

**Princípio:** Separação clara entre entradas (`atendimentos`) e saídas (`contas_pagar`) para facilitar cálculos financeiros e relatórios.

