-- Metas de receita por mês (Phase 5 dashboard). Usado em dashboard.routes.js (GET/PUT/POST goals/monthly) e metaCaminhoService.

CREATE TABLE IF NOT EXISTS public.monthly_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  meta_receita decimal(12, 2) NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_goals_user_id ON public.monthly_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_goals_user_year_month ON public.monthly_goals(user_id, year, month);

ALTER TABLE public.monthly_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own monthly_goals" ON public.monthly_goals;
CREATE POLICY "users manage own monthly_goals"
  ON public.monthly_goals
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.monthly_goals IS 'Meta de receita mensal por utilizador (dashboard); upsert onConflict user_id,year,month.';
