-- Onda 3.A — Feature Flags (pré-Fase 16 do ROADMAP)
-- Tabela leve de flags por usuário (ou globais quando user_id IS NULL).
-- Inicialmente alimentada por env (FEATURE_FLAGS) com fallback para esta tabela.

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name varchar(64) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_name
  ON public.feature_flags(name)
  WHERE enabled = true;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own feature flags" ON public.feature_flags;
CREATE POLICY "users can read own feature flags"
  ON public.feature_flags FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Mutations apenas pelo service-role (admin). Não criamos policy de INSERT/UPDATE para
-- usuários autenticados — flags são gerenciadas pelo backend.

COMMENT ON TABLE public.feature_flags IS
  'Onda 3.A — Feature flags por usuário ou globais (user_id NULL). Backend lê via service-role; frontend lê via select-only.';
