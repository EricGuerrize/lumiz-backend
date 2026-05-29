-- Hardening seguro do banco: rastreabilidade de lançamentos financeiros e índices operacionais.

ALTER TABLE public.atendimentos
  ADD COLUMN IF NOT EXISTS origem varchar(30)
    DEFAULT 'manual'
    CHECK (origem IN ('manual', 'whatsapp_text', 'dashboard', 'import', 'nf_ocr', 'document_ocr', 'agentic')),
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_phone varchar(32),
  ADD COLUMN IF NOT EXISTS source_message_id varchar(128),
  ADD COLUMN IF NOT EXISTS raw_message text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_phone varchar(32),
  ADD COLUMN IF NOT EXISTS source_message_id varchar(128),
  ADD COLUMN IF NOT EXISTS raw_message text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_atendimentos_user_data
  ON public.atendimentos(user_id, data DESC);

CREATE INDEX IF NOT EXISTS idx_atendimentos_user_created
  ON public.atendimentos(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atendimentos_user_recebimento_previsto
  ON public.atendimentos(user_id, recebimento_previsto)
  WHERE recebimento_previsto IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_atendimentos_source_message
  ON public.atendimentos(source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contas_pagar_user_data
  ON public.contas_pagar(user_id, data DESC);

CREATE INDEX IF NOT EXISTS idx_contas_pagar_user_created
  ON public.contas_pagar(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contas_pagar_user_vencimento
  ON public.contas_pagar(user_id, data_vencimento)
  WHERE data_vencimento IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contas_pagar_source_message
  ON public.contas_pagar(source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_runtime_states_flow_expires
  ON public.conversation_runtime_states(flow, expires_at);

COMMENT ON COLUMN public.atendimentos.origem IS
  'Origem do lançamento de receita: manual, whatsapp_text, dashboard, import, OCR ou agentic.';
COMMENT ON COLUMN public.atendimentos.is_test IS
  'Quando true, indica lançamento de teste/simulação. Default false preserva dados existentes como reais.';
COMMENT ON COLUMN public.atendimentos.source_phone IS
  'Telefone normalizado que originou o lançamento, quando criado via WhatsApp.';
COMMENT ON COLUMN public.atendimentos.source_message_id IS
  'ID externo da mensagem/evento do provider, quando disponível.';
COMMENT ON COLUMN public.atendimentos.raw_message IS
  'Mensagem original usada para criar o lançamento.';
COMMENT ON COLUMN public.atendimentos.metadata IS
  'Metadados operacionais da captura, como confidence_score, split e origem de intent.';

COMMENT ON COLUMN public.contas_pagar.is_test IS
  'Quando true, indica lançamento de teste/simulação. Default false preserva dados existentes como reais.';
COMMENT ON COLUMN public.contas_pagar.source_phone IS
  'Telefone normalizado que originou o lançamento, quando criado via WhatsApp.';
COMMENT ON COLUMN public.contas_pagar.source_message_id IS
  'ID externo da mensagem/evento do provider, quando disponível.';
COMMENT ON COLUMN public.contas_pagar.raw_message IS
  'Mensagem original usada para criar o lançamento.';
COMMENT ON COLUMN public.contas_pagar.metadata IS
  'Metadados operacionais da captura, como confidence_score, parcelas e origem de intent.';
