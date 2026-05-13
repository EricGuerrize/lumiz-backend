-- Onda 2.A — Origem e metadados de parcelas em contas_pagar
-- Permite rastrear se a conta veio de OCR de NF/boleto, link a fornecedor e
-- numeração de parcelas (parcela X de Y) consistente entre múltiplas linhas.

ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS origem varchar(20)
    DEFAULT 'manual'
    CHECK (origem IN ('manual', 'whatsapp_text', 'nf_ocr', 'boleto_ocr', 'comprovante_ocr', 'import')),
  ADD COLUMN IF NOT EXISTS supplier_document_id uuid
    REFERENCES public.supplier_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fornecedor_id uuid
    REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parcela_numero integer,
  ADD COLUMN IF NOT EXISTS parcela_total integer;

CREATE INDEX IF NOT EXISTS idx_contas_pagar_supplier_document
  ON public.contas_pagar(supplier_document_id)
  WHERE supplier_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contas_pagar_fornecedor
  ON public.contas_pagar(fornecedor_id)
  WHERE fornecedor_id IS NOT NULL;

COMMENT ON COLUMN public.contas_pagar.origem IS
  'Onda 2.A — Como a conta foi criada: manual | whatsapp_text | nf_ocr | boleto_ocr | comprovante_ocr | import.';
COMMENT ON COLUMN public.contas_pagar.supplier_document_id IS
  'FK para supplier_documents quando origem é OCR.';
COMMENT ON COLUMN public.contas_pagar.fornecedor_id IS
  'FK para fornecedores (preferido sobre tentar fazer match por nome).';
COMMENT ON COLUMN public.contas_pagar.parcela_numero IS 'Número desta parcela (1..N).';
COMMENT ON COLUMN public.contas_pagar.parcela_total IS 'Total de parcelas do mesmo documento.';
