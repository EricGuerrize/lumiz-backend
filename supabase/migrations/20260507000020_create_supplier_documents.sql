-- Onda 2.A — Supplier Documents
-- Tabela que guarda documentos de fornecedor (NF, boleto, comprovante)
-- extraídos via OCR antes de virarem contas_pagar.

CREATE TABLE IF NOT EXISTS public.supplier_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fornecedor_id uuid REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  tipo varchar(20) NOT NULL CHECK (tipo IN ('nf', 'boleto', 'comprovante', 'outro')),
  raw_text text,
  parsed_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'linked', 'failed', 'cancelled')),
  conta_pagar_id uuid REFERENCES public.contas_pagar(id) ON DELETE SET NULL,
  source_phone varchar(32),
  file_hash varchar(128),
  confidence_score numeric(4,3),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_documents_user_hash
  ON public.supplier_documents(user_id, file_hash)
  WHERE file_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_documents_user_status
  ON public.supplier_documents(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_documents_fornecedor
  ON public.supplier_documents(fornecedor_id)
  WHERE fornecedor_id IS NOT NULL;

ALTER TABLE public.supplier_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can manage own supplier documents" ON public.supplier_documents;
CREATE POLICY "users can manage own supplier documents"
  ON public.supplier_documents FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.supplier_documents IS
  'Onda 2.A — Documentos de fornecedor extraídos via OCR (NF, boleto, comprovante) antes de virarem contas_pagar.';
COMMENT ON COLUMN public.supplier_documents.parsed_json IS
  'Output estruturado da extração: {fornecedor, valor_total, vencimentos[], itens[], confidence_score}.';
COMMENT ON COLUMN public.supplier_documents.status IS
  'pending = aguardando confirmação; linked = virou contas_pagar; failed = parsing falhou; cancelled = usuário cancelou.';
