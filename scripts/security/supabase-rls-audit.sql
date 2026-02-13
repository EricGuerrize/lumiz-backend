-- =============================================================================
-- SUPABASE RLS AUDIT (READ-ONLY)
-- =============================================================================

-- 1) Status RLS por tabela de produção
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'agendamentos','analytics_events','atendimento_procedimentos','atendimentos','categories',
    'clientes','clinic_members','contas_pagar','conversation_history','learned_knowledge',
    'mdr_configs','ocr_jobs','onboarding_progress','parcelas','procedimentos','profiles',
    'setup_tokens','user_insights','user_roles','users'
  )
ORDER BY tablename;

-- 2) Quantidade de policies por tabela
SELECT
  tablename,
  COUNT(*)::int AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- 3) Policies detalhadas (nome + comando)
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'agendamentos','atendimento_procedimentos','atendimentos','categories','clientes',
    'contas_pagar','learned_knowledge','mdr_configs','ocr_jobs','onboarding_progress',
    'parcelas','procedimentos','profiles','setup_tokens','user_roles','users',
    'clinic_members','conversation_history','analytics_events','user_insights'
  )
ORDER BY tablename, policyname;

-- 4) Views financeiras e definição
SELECT
  schemaname,
  viewname,
  definition
FROM pg_views
WHERE schemaname='public'
  AND viewname IN ('view_financial_ledger','view_finance_balance','view_monthly_report')
ORDER BY viewname;

-- 5) Grants em views financeiras
SELECT
  table_schema,
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name IN ('view_financial_ledger','view_finance_balance','view_monthly_report')
ORDER BY table_name, grantee, privilege_type;
