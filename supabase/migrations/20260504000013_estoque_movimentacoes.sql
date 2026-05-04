-- Phase 4 — Colunas de estoque em procedimentos + movimentações + tipo_lembrete longo para dedup WhatsApp

ALTER TABLE public.reminders_sent
  ALTER COLUMN tipo_lembrete TYPE varchar(80);

ALTER TABLE public.procedimentos
  ADD COLUMN IF NOT EXISTS estoque_ml numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estoque_minimo numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unidade varchar(50) DEFAULT 'ml',
  ADD COLUMN IF NOT EXISTS fornecedor_id uuid REFERENCES public.fornecedores(id) ON DELETE SET NULL;

-- Migra legado estoque_atual → estoque_ml e remove coluna antiga
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'procedimentos' AND column_name = 'estoque_atual'
  ) THEN
    UPDATE public.procedimentos
      SET estoque_ml = COALESCE(estoque_ml, 0) + COALESCE(estoque_atual, 0);
    ALTER TABLE public.procedimentos DROP COLUMN estoque_atual;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_procedimentos_fornecedor_id ON public.procedimentos(fornecedor_id)
  WHERE fornecedor_id IS NOT NULL;

DROP TABLE IF EXISTS public.movimentacoes_estoque CASCADE;

CREATE TABLE public.movimentacoes_estoque (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  procedimento_id uuid NOT NULL REFERENCES public.procedimentos(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('entrada', 'saida', 'ajuste')),
  quantidade numeric NOT NULL CHECK (quantidade > 0),
  custo_unitario numeric,
  fornecedor_id uuid REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  atendimento_id uuid REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  data timestamptz NOT NULL DEFAULT now(),
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_user ON public.movimentacoes_estoque(user_id);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_proc ON public.movimentacoes_estoque(procedimento_id);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_data ON public.movimentacoes_estoque(data DESC);

ALTER TABLE public.movimentacoes_estoque ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can manage own movimentacoes" ON public.movimentacoes_estoque;
CREATE POLICY "users can manage own movimentacoes"
  ON public.movimentacoes_estoque FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.movimentacoes_estoque IS 'Entrada/saída/ajuste de estoque por procedimento (Phase 4).';
COMMENT ON COLUMN public.procedimentos.estoque_ml IS 'Nível atual de estoque (unidade em procedimentos.unidade, tipicamente ml).';
