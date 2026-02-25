-- =============================================================================
-- Beta period fields (nullable — não ativados ainda)
-- =============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS beta_started_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS beta_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS beta_blocked_at  TIMESTAMPTZ;

-- =============================================================================
-- Tabela de feedback beta (captura passiva + explícita)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.beta_feedback (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  phone       TEXT,
  type        TEXT        NOT NULL CHECK (type IN ('explicit', 'failed_intent', 'repeated_message')),
  message     TEXT,
  intent      TEXT,
  bot_response TEXT,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS beta_feedback_user_idx    ON public.beta_feedback (user_id);
CREATE INDEX IF NOT EXISTS beta_feedback_type_idx    ON public.beta_feedback (type);
CREATE INDEX IF NOT EXISTS beta_feedback_created_idx ON public.beta_feedback (created_at DESC);

-- RLS: só service_role acessa (backend) — nunca expõe para usuários
ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'beta_feedback'
      AND policyname = 'service role only'
  ) THEN
    CREATE POLICY "service role only" ON public.beta_feedback
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
