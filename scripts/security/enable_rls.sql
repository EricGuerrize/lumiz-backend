-- =============================================================================
-- SUPABASE SECURITY HARDENING - PHASE 1 (SAFE / IDEMPOTENT)
-- =============================================================================
-- Objetivo:
-- 1) Reativar RLS nas tabelas que ficaram UNRESTRICTED
-- 2) Garantir políticas mínimas por usuário (auth.uid())
-- 3) Não remover políticas existentes (evita quebrar regras de admin já criadas)
-- 4) Endurecer views financeiras para usar permissões do usuário autenticado
--
-- Como usar:
-- - Execute no Supabase SQL Editor (produção) em uma janela de manutenção curta.
-- - É seguro rodar múltiplas vezes.
--
-- Observação importante:
-- - setup_tokens e users ficam com RLS ativo e sem policy para usuários autenticados.
--   O backend usa service_role e continua funcionando.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Reativar RLS nas tabelas de domínio
-- -----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.atendimento_procedimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.atendimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.contas_pagar ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.learned_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.mdr_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ocr_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.procedimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.setup_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2) Policies helper (não sobrescreve políticas existentes)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- agendamentos (user_id)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agendamentos' AND policyname='rls_agendamentos_select_own') THEN
    CREATE POLICY rls_agendamentos_select_own ON public.agendamentos FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agendamentos' AND policyname='rls_agendamentos_insert_own') THEN
    CREATE POLICY rls_agendamentos_insert_own ON public.agendamentos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agendamentos' AND policyname='rls_agendamentos_update_own') THEN
    CREATE POLICY rls_agendamentos_update_own ON public.agendamentos FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agendamentos' AND policyname='rls_agendamentos_delete_own') THEN
    CREATE POLICY rls_agendamentos_delete_own ON public.agendamentos FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- atendimentos (user_id)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='atendimentos' AND policyname='rls_atendimentos_select_own') THEN
    CREATE POLICY rls_atendimentos_select_own ON public.atendimentos FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='atendimentos' AND policyname='rls_atendimentos_insert_own') THEN
    CREATE POLICY rls_atendimentos_insert_own ON public.atendimentos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='atendimentos' AND policyname='rls_atendimentos_update_own') THEN
    CREATE POLICY rls_atendimentos_update_own ON public.atendimentos FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='atendimentos' AND policyname='rls_atendimentos_delete_own') THEN
    CREATE POLICY rls_atendimentos_delete_own ON public.atendimentos FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- clientes (user_id)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clientes' AND policyname='rls_clientes_select_own') THEN
    CREATE POLICY rls_clientes_select_own ON public.clientes FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clientes' AND policyname='rls_clientes_insert_own') THEN
    CREATE POLICY rls_clientes_insert_own ON public.clientes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clientes' AND policyname='rls_clientes_update_own') THEN
    CREATE POLICY rls_clientes_update_own ON public.clientes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clientes' AND policyname='rls_clientes_delete_own') THEN
    CREATE POLICY rls_clientes_delete_own ON public.clientes FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- contas_pagar (user_id)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contas_pagar' AND policyname='rls_contas_select_own') THEN
    CREATE POLICY rls_contas_select_own ON public.contas_pagar FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contas_pagar' AND policyname='rls_contas_insert_own') THEN
    CREATE POLICY rls_contas_insert_own ON public.contas_pagar FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contas_pagar' AND policyname='rls_contas_update_own') THEN
    CREATE POLICY rls_contas_update_own ON public.contas_pagar FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contas_pagar' AND policyname='rls_contas_delete_own') THEN
    CREATE POLICY rls_contas_delete_own ON public.contas_pagar FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- procedimentos (user_id)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='procedimentos' AND policyname='rls_procedimentos_select_own') THEN
    CREATE POLICY rls_procedimentos_select_own ON public.procedimentos FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='procedimentos' AND policyname='rls_procedimentos_insert_own') THEN
    CREATE POLICY rls_procedimentos_insert_own ON public.procedimentos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='procedimentos' AND policyname='rls_procedimentos_update_own') THEN
    CREATE POLICY rls_procedimentos_update_own ON public.procedimentos FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='procedimentos' AND policyname='rls_procedimentos_delete_own') THEN
    CREATE POLICY rls_procedimentos_delete_own ON public.procedimentos FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- onboarding_progress, mdr_configs, ocr_jobs, learned_knowledge (user_id)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='onboarding_progress' AND policyname='rls_onboarding_select_own') THEN
    CREATE POLICY rls_onboarding_select_own ON public.onboarding_progress FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='onboarding_progress' AND policyname='rls_onboarding_insert_own') THEN
    CREATE POLICY rls_onboarding_insert_own ON public.onboarding_progress FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='onboarding_progress' AND policyname='rls_onboarding_update_own') THEN
    CREATE POLICY rls_onboarding_update_own ON public.onboarding_progress FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mdr_configs' AND policyname='rls_mdr_select_own') THEN
    CREATE POLICY rls_mdr_select_own ON public.mdr_configs FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mdr_configs' AND policyname='rls_mdr_insert_own') THEN
    CREATE POLICY rls_mdr_insert_own ON public.mdr_configs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mdr_configs' AND policyname='rls_mdr_update_own') THEN
    CREATE POLICY rls_mdr_update_own ON public.mdr_configs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ocr_jobs' AND policyname='rls_ocr_select_own') THEN
    CREATE POLICY rls_ocr_select_own ON public.ocr_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ocr_jobs' AND policyname='rls_ocr_insert_own') THEN
    CREATE POLICY rls_ocr_insert_own ON public.ocr_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ocr_jobs' AND policyname='rls_ocr_update_own') THEN
    CREATE POLICY rls_ocr_update_own ON public.ocr_jobs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='learned_knowledge' AND policyname='rls_knowledge_select_own') THEN
    CREATE POLICY rls_knowledge_select_own ON public.learned_knowledge FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- categories (legado; só se existir com user_id)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='categories' AND column_name='user_id'
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categories' AND policyname='rls_categories_select_own') THEN
      CREATE POLICY rls_categories_select_own ON public.categories FOR SELECT TO authenticated USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categories' AND policyname='rls_categories_insert_own') THEN
      CREATE POLICY rls_categories_insert_own ON public.categories FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categories' AND policyname='rls_categories_update_own') THEN
      CREATE POLICY rls_categories_update_own ON public.categories FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categories' AND policyname='rls_categories_delete_own') THEN
      CREATE POLICY rls_categories_delete_own ON public.categories FOR DELETE TO authenticated USING (auth.uid() = user_id);
    END IF;
  END IF;

  -- atendimento_procedimentos (herda ownership via atendimentos.user_id)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='atendimento_procedimentos' AND policyname='rls_atp_select_own') THEN
    CREATE POLICY rls_atp_select_own ON public.atendimento_procedimentos FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.atendimentos a WHERE a.id = atendimento_procedimentos.atendimento_id AND a.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='atendimento_procedimentos' AND policyname='rls_atp_insert_own') THEN
    CREATE POLICY rls_atp_insert_own ON public.atendimento_procedimentos FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.atendimentos a WHERE a.id = atendimento_procedimentos.atendimento_id AND a.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='atendimento_procedimentos' AND policyname='rls_atp_update_own') THEN
    CREATE POLICY rls_atp_update_own ON public.atendimento_procedimentos FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.atendimentos a WHERE a.id = atendimento_procedimentos.atendimento_id AND a.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.atendimentos a WHERE a.id = atendimento_procedimentos.atendimento_id AND a.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='atendimento_procedimentos' AND policyname='rls_atp_delete_own') THEN
    CREATE POLICY rls_atp_delete_own ON public.atendimento_procedimentos FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.atendimentos a WHERE a.id = atendimento_procedimentos.atendimento_id AND a.user_id = auth.uid()));
  END IF;

  -- parcelas (herda ownership via atendimentos.user_id)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='parcelas' AND policyname='rls_parcelas_select_own') THEN
    CREATE POLICY rls_parcelas_select_own ON public.parcelas FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.atendimentos a WHERE a.id = parcelas.atendimento_id AND a.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='parcelas' AND policyname='rls_parcelas_insert_own') THEN
    CREATE POLICY rls_parcelas_insert_own ON public.parcelas FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.atendimentos a WHERE a.id = parcelas.atendimento_id AND a.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='parcelas' AND policyname='rls_parcelas_update_own') THEN
    CREATE POLICY rls_parcelas_update_own ON public.parcelas FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.atendimentos a WHERE a.id = parcelas.atendimento_id AND a.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.atendimentos a WHERE a.id = parcelas.atendimento_id AND a.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='parcelas' AND policyname='rls_parcelas_delete_own') THEN
    CREATE POLICY rls_parcelas_delete_own ON public.parcelas FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.atendimentos a WHERE a.id = parcelas.atendimento_id AND a.user_id = auth.uid()));
  END IF;

  -- profiles (own + admin)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='rls_profiles_select_own') THEN
    CREATE POLICY rls_profiles_select_own ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='rls_profiles_update_own') THEN
    CREATE POLICY rls_profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'is_admin'
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='rls_profiles_select_admin') THEN
      CREATE POLICY rls_profiles_select_admin ON public.profiles FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='rls_profiles_update_admin') THEN
      CREATE POLICY rls_profiles_update_admin ON public.profiles FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (true);
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) Views financeiras: forçar security invoker
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  BEGIN
    ALTER VIEW public.view_financial_ledger SET (security_invoker = true);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    ALTER VIEW public.view_finance_balance SET (security_invoker = true);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    ALTER VIEW public.view_monthly_report SET (security_invoker = true);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END $$;

-- -----------------------------------------------------------------------------
-- 4) Garantir acesso de leitura às views só para usuários autenticados
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  BEGIN
    REVOKE ALL ON public.view_financial_ledger FROM anon;
    GRANT SELECT ON public.view_financial_ledger TO authenticated;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    REVOKE ALL ON public.view_finance_balance FROM anon;
    GRANT SELECT ON public.view_finance_balance TO authenticated;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    REVOKE ALL ON public.view_monthly_report FROM anon;
    GRANT SELECT ON public.view_monthly_report TO authenticated;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END $$;

COMMIT;

-- -----------------------------------------------------------------------------
-- 5) VERIFICAÇÃO RÁPIDA (rode separadamente após o COMMIT)
-- -----------------------------------------------------------------------------
-- Tabelas ainda sem RLS
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname='public'
--   AND tablename IN (
--     'agendamentos','atendimento_procedimentos','atendimentos','categories','clientes',
--     'contas_pagar','learned_knowledge','mdr_configs','ocr_jobs','onboarding_progress',
--     'parcelas','procedimentos','profiles','setup_tokens','user_roles','users'
--   )
-- ORDER BY tablename;
--
-- Políticas por tabela
-- SELECT tablename, count(*) AS policy_count
-- FROM pg_policies
-- WHERE schemaname='public'
-- GROUP BY tablename
-- ORDER BY tablename;
