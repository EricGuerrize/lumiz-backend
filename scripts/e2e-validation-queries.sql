-- ==============================================================
-- E2E Validation Queries (Onboarding + WhatsApp + Dashboard)
-- ==============================================================
-- Uso:
-- 1) Substitua <USER_ID> abaixo pelo UUID da clinica.
-- 2) Execute bloco a bloco no Supabase SQL Editor.
-- 3) Use junto do runbook:
--    docs/e2e_onboarding_whatsapp_dashboard_runbook.md

-- --------------------------------------------------------------
-- 0) Identificar clinic/user pelo telefone
-- --------------------------------------------------------------
-- Substitua <PHONE_E164> (ex.: +5565999999999)
select
  cm.clinic_id as user_id,
  cm.telefone,
  cm.nome,
  cm.is_primary,
  cm.confirmed,
  cm.is_active
from public.clinic_members cm
where cm.telefone = '<65992556938>'
order by cm.created_at desc;

-- --------------------------------------------------------------
-- 1) Ver membros ativos/gestor (controle de acesso)
-- --------------------------------------------------------------
select
  id,
  clinic_id,
  telefone,
  nome,
  funcao,
  is_primary,
  confirmed,
  is_active,
  created_at
from public.clinic_members
where clinic_id = '<USER_ID>'
order by is_primary desc, created_at desc;

-- --------------------------------------------------------------
-- 2) Ultimos custos (contas_pagar)
-- --------------------------------------------------------------
select
  id,
  user_id,
  data,
  categoria,
  descricao,
  tipo,
  valor,
  status_pagamento,
  created_at
from public.contas_pagar
where user_id = '<USER_ID>'
order by created_at desc
limit 20;

-- --------------------------------------------------------------
-- 3) Ultimas vendas (atendimentos)
-- --------------------------------------------------------------
select
  id,
  user_id,
  data,
  valor_total,
  custo_total,
  forma_pagamento,
  status_pagamento,
  observacoes,
  split_group_id,
  split_part,
  split_total_parts,
  created_at
from public.atendimentos
where user_id = '<USER_ID>'
order by created_at desc
limit 20;

-- --------------------------------------------------------------
-- 4) Ultimas parcelas de cartao (se houver)
-- --------------------------------------------------------------
select
  id,
  atendimento_id,
  numero,
  valor,
  data_vencimento,
  paga,
  bandeira_cartao,
  valor_bruto,
  valor_liquido,
  recebimento_previsto,
  created_at
from public.parcelas
where atendimento_id in (
  select id
  from public.atendimentos
  where user_id = '<USER_ID>'
  order by created_at desc
  limit 20
)
order by created_at desc
limit 40;

-- --------------------------------------------------------------
-- 5) Ultimas interacoes de conversa (auditoria)
-- --------------------------------------------------------------
select
  id,
  user_id,
  phone,
  direction,
  message,
  intent,
  created_at
from public.conversation_history
where user_id = '<USER_ID>'
order by created_at desc
limit 30;

-- --------------------------------------------------------------
-- 6) Estado de onboarding (se ainda ativo)
-- --------------------------------------------------------------
select
  id,
  phone,
  user_id,
  stage,
  phase,
  step,
  status,
  updated_at
from public.onboarding_progress
where user_id = '<USER_ID>'
order by updated_at desc
limit 10;

-- --------------------------------------------------------------
-- 7) Views de validacao para dashboard
-- --------------------------------------------------------------
select *
from public.view_finance_balance
where user_id = '<USER_ID>';

select *
from public.view_financial_ledger
where user_id = '<USER_ID>'
order by data desc, created_at desc
limit 30;

select *
from public.view_monthly_report
where user_id = '<USER_ID>'
order by ano desc, mes desc
limit 12;

