CREATE TABLE IF NOT EXISTS public.trial_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(30) NOT NULL UNIQUE,
  clinic_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  owner_name TEXT,
  clinic_name TEXT,
  role VARCHAR(30) CHECK (role IN ('dona_gestora', 'adm_financeiro', 'secretaria', 'profissional')),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'converted', 'discarded')),
  snapshot JSONB NOT NULL DEFAULT '{
    "sales": [],
    "costs": [],
    "initial_balance": null,
    "totals": {
      "entradas": 0,
      "custosFixos": 0,
      "custosVariaveis": 0,
      "saldoParcial": 0
    }
  }'::jsonb,
  referral_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trial_accounts_clinic_id ON public.trial_accounts(clinic_id);
CREATE INDEX IF NOT EXISTS idx_trial_accounts_status ON public.trial_accounts(status);

ALTER TABLE public.trial_accounts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trial_accounts'
      AND policyname = 'trial_accounts_select_own'
  ) THEN
    CREATE POLICY trial_accounts_select_own
      ON public.trial_accounts
      FOR SELECT
      TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = clinic_id);
  END IF;
END $$;

COMMENT ON TABLE public.trial_accounts IS
  'Fase Agentic 5 — Conta-fantasma do onboarding para armazenar lançamentos do trial antes da conversão em conta real.';
