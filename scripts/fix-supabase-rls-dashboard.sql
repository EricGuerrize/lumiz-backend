-- =============================================================================
-- FIX RLS PARA DASHBOARD (ACESSO VIA FRONTEND SUPABASE)
-- =============================================================================
-- Execute no Supabase SQL Editor (projeto de producao).
-- Este script desabilita RLS somente nas tabelas usadas pelo dashboard atual.
-- Uso: para destravar rapidamente erros 403 no frontend.

DO $$
DECLARE
  table_name text;
  tables text[] := ARRAY[
    'agendamentos',
    'atendimento_procedimentos',
    'atendimentos',
    'categories',
    'clientes',
    'contas_pagar',
    'mdr_configs',
    'ocr_jobs',
    'onboarding_progress',
    'parcelas',
    'procedimentos',
    'profiles',
    'setup_tokens',
    'user_roles',
    'users'
  ];
BEGIN
  FOREACH table_name IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', table_name);
      RAISE NOTICE 'RLS desabilitado: %', table_name;
    EXCEPTION
      WHEN undefined_table THEN
        RAISE NOTICE 'Tabela inexistente (ignorada): %', table_name;
    END;
  END LOOP;
END $$;

SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'agendamentos',
    'atendimento_procedimentos',
    'atendimentos',
    'categories',
    'clientes',
    'contas_pagar',
    'mdr_configs',
    'ocr_jobs',
    'onboarding_progress',
    'parcelas',
    'procedimentos',
    'profiles',
    'setup_tokens',
    'user_roles',
    'users'
  )
ORDER BY tablename;
