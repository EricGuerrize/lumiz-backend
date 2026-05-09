-- Fase 12 — Importador de planilha Excel.
--
-- O preview salva o parsing normalizado em `excel_import_batches` antes de
-- criar lançamentos financeiros. A confirmação materializa linhas em
-- `atendimentos` e `contas_pagar`, todas marcadas com `import_batch_id` para
-- permitir desfazer o lote inteiro.

CREATE TABLE IF NOT EXISTS public.excel_import_batches (
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

ALTER TABLE public.excel_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own excel imports" ON public.excel_import_batches;
CREATE POLICY "users read own excel imports"
  ON public.excel_import_batches FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE INDEX IF NOT EXISTS idx_excel_import_batches_user_created
  ON public.excel_import_batches(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_excel_import_batches_user_status
  ON public.excel_import_batches(user_id, status, created_at DESC);

ALTER TABLE public.atendimentos
  ADD COLUMN IF NOT EXISTS import_batch_id uuid
    REFERENCES public.excel_import_batches(id) ON DELETE SET NULL;

ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS import_batch_id uuid
    REFERENCES public.excel_import_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_atendimentos_import_batch
  ON public.atendimentos(import_batch_id)
  WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contas_pagar_import_batch
  ON public.contas_pagar(import_batch_id)
  WHERE import_batch_id IS NOT NULL;

COMMENT ON TABLE public.excel_import_batches IS
  'Fase 12 — preview/confirm/undo de importacao Excel. Escrita via backend service-role; usuario autenticado so le historico proprio.';

COMMENT ON COLUMN public.atendimentos.import_batch_id IS
  'Fase 12 — lote Excel que criou este atendimento; usado para desfazer import.';

COMMENT ON COLUMN public.contas_pagar.import_batch_id IS
  'Fase 12 — lote Excel que criou esta conta; usado para desfazer import.';
