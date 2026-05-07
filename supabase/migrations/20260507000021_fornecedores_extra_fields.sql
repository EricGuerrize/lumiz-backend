-- Onda 2.A — Campos extras em fornecedores
-- Adiciona CNPJ (única parcial por user), email e whatsapp para enriquecer
-- o cadastro de fornecedor a partir dos documentos OCR.

ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS cnpj varchar(20),
  ADD COLUMN IF NOT EXISTS email varchar(255),
  ADD COLUMN IF NOT EXISTS whatsapp varchar(32);

-- CNPJ é único por user_id (mesmo CNPJ pode aparecer em clínicas diferentes do
-- usuário, mas dentro de um user é o mesmo fornecedor).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fornecedores_user_cnpj
  ON public.fornecedores(user_id, cnpj)
  WHERE cnpj IS NOT NULL AND length(cnpj) > 0;

COMMENT ON COLUMN public.fornecedores.cnpj IS
  'Onda 2.A — CNPJ do fornecedor (somente dígitos, 14 chars). Único por user_id quando preenchido.';
COMMENT ON COLUMN public.fornecedores.email IS 'E-mail do fornecedor (extraído de NF ou cadastro manual).';
COMMENT ON COLUMN public.fornecedores.whatsapp IS 'WhatsApp do fornecedor (extraído de NF/boleto ou cadastro manual).';
