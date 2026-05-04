-- Phase 4 — Fornecedores (estoque)

CREATE TABLE IF NOT EXISTS public.fornecedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome varchar(255) NOT NULL,
  contato varchar(255),
  prazo_medio_dias integer DEFAULT 7,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fornecedores_user_id ON public.fornecedores(user_id);

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can manage own fornecedores" ON public.fornecedores;
CREATE POLICY "users can manage own fornecedores"
  ON public.fornecedores FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.fornecedores IS 'Fornecedores de insumos (Phase 4 estoque).';
