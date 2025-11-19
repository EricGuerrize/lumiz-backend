-- Tabela para armazenar histórico de conversas (para RAG)
CREATE TABLE IF NOT EXISTS public.conversation_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  user_message TEXT NOT NULL,
  bot_response TEXT NOT NULL,
  intent VARCHAR(50),
  feedback VARCHAR(10) CHECK (feedback IN ('positive', 'negative', 'neutral', NULL)),
  context JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_conversation_history_user_id ON public.conversation_history(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_history_feedback ON public.conversation_history(feedback) WHERE feedback = 'positive';
CREATE INDEX IF NOT EXISTS idx_conversation_history_intent ON public.conversation_history(intent);
CREATE INDEX IF NOT EXISTS idx_conversation_history_created_at ON public.conversation_history(created_at DESC);

-- Índice GIN para busca de texto (PostgreSQL full-text search)
CREATE INDEX IF NOT EXISTS idx_conversation_history_message_gin ON public.conversation_history USING gin(to_tsvector('portuguese', user_message));

-- RLS (Row Level Security)
ALTER TABLE public.conversation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS users_select_conversation_history
  ON public.conversation_history
  FOR SELECT
  USING (user_id = auth.uid());

-- Comentários
COMMENT ON TABLE public.conversation_history IS 'Armazena histórico de conversas para RAG (Retrieval-Augmented Generation)';
COMMENT ON COLUMN public.conversation_history.feedback IS 'Feedback do usuário: positive, negative, neutral ou NULL';
COMMENT ON COLUMN public.conversation_history.context IS 'Contexto adicional da conversa (intent, dados extraídos, etc)';

