-- Inventário real Lumiz — produtos físicos, lotes e movimentos.
-- Mantém compatibilidade com o estoque legado em procedimentos/movimentacoes_estoque.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS public.estoque_produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fornecedor_id uuid REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  nome text NOT NULL,
  categoria text,
  unidade text NOT NULL DEFAULT 'unidade',
  sku text,
  ean text,
  estoque_minimo numeric(14, 4) NOT NULL DEFAULT 0,
  estoque_maximo numeric(14, 4),
  custo_medio numeric(14, 4),
  ativo boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estoque_produtos_nome_user_unique UNIQUE (user_id, nome)
);

CREATE TABLE IF NOT EXISTS public.estoque_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.estoque_produtos(id) ON DELETE CASCADE,
  fornecedor_id uuid REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  lote text,
  validade date,
  quantidade_atual numeric(14, 4) NOT NULL DEFAULT 0,
  custo_unitario numeric(14, 4),
  supplier_document_id uuid REFERENCES public.supplier_documents(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estoque_lotes_quantidade_non_negative CHECK (quantidade_atual >= 0)
);

CREATE TABLE IF NOT EXISTS public.estoque_movimentos_reais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.estoque_produtos(id) ON DELETE CASCADE,
  lote_id uuid REFERENCES public.estoque_lotes(id) ON DELETE SET NULL,
  tipo text NOT NULL CHECK (tipo IN ('entrada', 'saida', 'ajuste', 'inventario')),
  quantidade numeric(14, 4) NOT NULL CHECK (quantidade > 0),
  custo_unitario numeric(14, 4),
  fornecedor_id uuid REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  origem text NOT NULL DEFAULT 'manual',
  source_phone text,
  source_message_id text,
  observacoes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  data timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.procedimento_consumos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  procedimento_id uuid NOT NULL REFERENCES public.procedimentos(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.estoque_produtos(id) ON DELETE CASCADE,
  quantidade_padrao numeric(14, 4) NOT NULL CHECK (quantidade_padrao > 0),
  unidade text,
  obrigatorio boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT procedimento_consumos_unique UNIQUE (user_id, procedimento_id, produto_id)
);

CREATE INDEX IF NOT EXISTS idx_estoque_produtos_user_ativo ON public.estoque_produtos(user_id, ativo, nome);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_nome_trgm ON public.estoque_produtos USING gin (nome gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_estoque_lotes_user_produto ON public.estoque_lotes(user_id, produto_id);
CREATE INDEX IF NOT EXISTS idx_estoque_lotes_validade ON public.estoque_lotes(user_id, validade) WHERE validade IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estoque_movimentos_reais_user_data ON public.estoque_movimentos_reais(user_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_estoque_movimentos_reais_produto ON public.estoque_movimentos_reais(produto_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_procedimento_consumos_user_proc ON public.procedimento_consumos(user_id, procedimento_id);

ALTER TABLE public.estoque_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_movimentos_reais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedimento_consumos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own estoque_produtos" ON public.estoque_produtos;
CREATE POLICY "users manage own estoque_produtos"
  ON public.estoque_produtos FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users manage own estoque_lotes" ON public.estoque_lotes;
CREATE POLICY "users manage own estoque_lotes"
  ON public.estoque_lotes FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users manage own estoque_movimentos_reais" ON public.estoque_movimentos_reais;
CREATE POLICY "users manage own estoque_movimentos_reais"
  ON public.estoque_movimentos_reais FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users manage own procedimento_consumos" ON public.procedimento_consumos;
CREATE POLICY "users manage own procedimento_consumos"
  ON public.procedimento_consumos FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.estoque_produtos IS 'Catálogo de produtos físicos em estoque, separado de procedimentos vendidos.';
COMMENT ON TABLE public.estoque_lotes IS 'Saldos por lote/validade dos produtos físicos.';
COMMENT ON TABLE public.estoque_movimentos_reais IS 'Ledger operacional do inventário real: entrada, saída, ajuste e inventário inicial.';
COMMENT ON TABLE public.procedimento_consumos IS 'Mapa de consumo padrão de produtos por procedimento; base para baixa automática futura.';
