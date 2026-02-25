-- Cria tabela setup_tokens se não existir
-- Usada para gerar links únicos de acesso ao dashboard no final do onboarding

CREATE TABLE IF NOT EXISTS public.setup_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,          -- marcador interno: "phone_5511..."|"phone_...|clinic_..."
  token      uuid NOT NULL UNIQUE,
  expira_em  timestamptz NOT NULL,
  usado      boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.setup_tokens ENABLE ROW LEVEL SECURITY;

-- service_role pode fazer tudo (backend usa service_role)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'setup_tokens' AND policyname = 'service role full access'
  ) THEN
    CREATE POLICY "service role full access"
      ON public.setup_tokens
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
