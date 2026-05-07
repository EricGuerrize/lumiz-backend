-- Onda 3.A — Alter Antecipações
-- Histórico de antecipações spot (apenas spot, conforme decisão de negócio).
-- Cada linha = 1 antecipação aprovada/executada. Recebíveis envolvidos vão em
-- `recebiveis_ids` (uuid[]) para permitir rollback/auditoria.

CREATE TABLE IF NOT EXISTS public.alter_antecipacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo varchar(20) NOT NULL DEFAULT 'spot' CHECK (tipo IN ('spot')),
  valor_solicitado numeric(12,2) NOT NULL,
  valor_liquido_recebido numeric(12,2) NOT NULL,
  custo_antecipacao numeric(12,2) NOT NULL,
  taxa_efetiva_pct numeric(6,4),
  recebiveis_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  status varchar(20) NOT NULL DEFAULT 'simulada'
    CHECK (status IN ('simulada', 'executada', 'cancelada', 'falhou')),
  payload_simulacao jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alter_antecipacoes_user_status
  ON public.alter_antecipacoes(user_id, status, created_at DESC);

ALTER TABLE public.alter_antecipacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can manage own alter_antecipacoes" ON public.alter_antecipacoes;
CREATE POLICY "users can manage own alter_antecipacoes"
  ON public.alter_antecipacoes FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.alter_antecipacoes IS
  'Onda 3.A — Antecipações spot. Mock devolve simulação determinística; integração real preenche valor_liquido_recebido após execução pela Alter.';
