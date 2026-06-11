-- Importador de planilha de estoque (CSV/XLSX).
--
-- O preview salva o parsing normalizado em `estoque_import_batches` antes de
-- materializar o inventário inicial. A confirmação chama configureInitialInventory
-- e marca movimentos com `import_batch_id` para permitir desfazer o lote.

CREATE TABLE IF NOT EXISTS public.estoque_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview', 'confirmed', 'undone', 'expired')),
  filename text,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview jsonb NOT NULL DEFAULT '[]'::jsonb,
  inconsistencias jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  original_row_count integer NOT NULL DEFAULT 0,
  valid_row_count integer NOT NULL DEFAULT 0,
  invalid_row_count integer NOT NULL DEFAULT 0,
  confirmed_at timestamptz,
  undone_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.estoque_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own estoque imports" ON public.estoque_import_batches;
CREATE POLICY "users read own estoque imports"
  ON public.estoque_import_batches FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE INDEX IF NOT EXISTS idx_estoque_import_batches_user_created
  ON public.estoque_import_batches(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_estoque_import_batches_user_status
  ON public.estoque_import_batches(user_id, status, created_at DESC);

ALTER TABLE public.estoque_movimentos_reais
  ADD COLUMN IF NOT EXISTS import_batch_id uuid
    REFERENCES public.estoque_import_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_estoque_movimentos_import_batch
  ON public.estoque_movimentos_reais(import_batch_id)
  WHERE import_batch_id IS NOT NULL;

COMMENT ON TABLE public.estoque_import_batches IS
  'Preview/confirm/undo de importação de estoque via CSV/XLSX. Escrita via backend service-role; usuário autenticado só lê histórico próprio.';

COMMENT ON COLUMN public.estoque_movimentos_reais.import_batch_id IS
  'Lote de importação de estoque que criou este movimento; usado para desfazer import.';
