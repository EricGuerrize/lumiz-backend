-- Itens com data de validade ou lembrete NF (pipeline mínimo Lumiz; entrada manual ou futura integração)

CREATE TABLE IF NOT EXISTS public.nf_validade_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  descricao text NOT NULL,
  data_validade date NOT NULL,
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'import', 'api')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nf_validade_user_data ON public.nf_validade_itens(user_id, data_validade);

ALTER TABLE public.nf_validade_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own nf_validade_itens" ON public.nf_validade_itens;
CREATE POLICY "users manage own nf_validade_itens"
  ON public.nf_validade_itens FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.nf_validade_itens IS 'Validade de produtos/lotes ou lembretes NF; base para alertas e relatórios.';
