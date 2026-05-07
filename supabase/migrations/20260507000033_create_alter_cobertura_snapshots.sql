-- Onda 3.A — Snapshots diários de cobertura por fornecedor
-- Para cada fornecedor com contas_pagar futuras, registra um snapshot da
-- cobertura a partir dos recebíveis livres. Cron semanal alimenta esta tabela.

CREATE TABLE IF NOT EXISTS public.alter_cobertura_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fornecedor_id uuid REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  data_snapshot date NOT NULL DEFAULT CURRENT_DATE,
  total_a_pagar numeric(12,2) NOT NULL DEFAULT 0,
  total_recebivel_disponivel numeric(12,2) NOT NULL DEFAULT 0,
  cobertura_pct numeric(6,4) NOT NULL DEFAULT 0,
  gap_dias integer,
  payload jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, fornecedor_id, data_snapshot)
);

CREATE INDEX IF NOT EXISTS idx_alter_cobertura_user_date
  ON public.alter_cobertura_snapshots(user_id, data_snapshot DESC);

ALTER TABLE public.alter_cobertura_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can manage own alter_cobertura_snapshots" ON public.alter_cobertura_snapshots;
CREATE POLICY "users can manage own alter_cobertura_snapshots"
  ON public.alter_cobertura_snapshots FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.alter_cobertura_snapshots IS
  'Onda 3.A — Snapshots diários de cobertura recebível vs contas a pagar por fornecedor.';
