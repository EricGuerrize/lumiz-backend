-- Onda 3.A — Alter Recebíveis
-- Snapshot dos recebíveis da clínica (parcelas brutas/liquidas, com data disponível).
-- Quando ALTER_ENABLED=false (default), o mockAlterAdapter deriva esta tabela
-- a partir de `parcelas` + `mdr_configs`. Quando real, é alimentada pela API Alter.

CREATE TABLE IF NOT EXISTS public.alter_recebiveis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  adquirente varchar(50),
  bandeira varchar(50),
  parcelas_total integer DEFAULT 1,
  parcela_numero integer DEFAULT 1,
  valor_bruto numeric(12,2) NOT NULL,
  valor_liquido numeric(12,2) NOT NULL,
  mdr numeric(6,4),
  data_venda date,
  data_disponivel date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'livre'
    CHECK (status IN ('livre', 'comprometido', 'antecipado', 'liquidado', 'cancelado')),
  source varchar(20) NOT NULL DEFAULT 'mock'
    CHECK (source IN ('mock', 'alter_api', 'manual')),
  external_id varchar(128),
  parcela_id uuid REFERENCES public.parcelas(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alter_recebiveis_user_data
  ON public.alter_recebiveis(user_id, data_disponivel);

CREATE INDEX IF NOT EXISTS idx_alter_recebiveis_status
  ON public.alter_recebiveis(user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alter_recebiveis_external
  ON public.alter_recebiveis(user_id, source, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.alter_recebiveis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can manage own alter_recebiveis" ON public.alter_recebiveis;
CREATE POLICY "users can manage own alter_recebiveis"
  ON public.alter_recebiveis FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.alter_recebiveis IS
  'Onda 3.A — Snapshot de recebíveis (D+N por adquirente). source=mock derivado de parcelas+MDR; source=alter_api alimentado por sync futuro.';
