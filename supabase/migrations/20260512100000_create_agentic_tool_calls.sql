-- Fase Agentic 1.1 — Log de chamadas de tools do agente
-- Registra cada tool call para auditoria, debugging e métricas de qualidade.

CREATE TABLE IF NOT EXISTS public.agentic_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  clinic_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  phone varchar(20),
  
  -- Identificação da tool
  tool_name varchar(64) NOT NULL,
  tool_version varchar(16) DEFAULT '1.0',
  
  -- Input/Output
  input_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_result jsonb DEFAULT NULL,
  
  -- Execução
  status varchar(20) NOT NULL DEFAULT 'pending',
  -- status: pending, executing, success, failed, cancelled, requires_confirmation
  
  error_message text,
  error_code varchar(32),
  
  -- Contexto
  conversation_turn_id uuid,
  triggered_by varchar(32) DEFAULT 'llm',
  -- triggered_by: llm, user_explicit, system, fallback
  
  confidence_score float,
  required_confirmation boolean DEFAULT false,
  user_confirmed boolean,
  confirmed_at timestamptz,
  
  -- Métricas
  execution_time_ms int,
  tokens_used int,
  
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  
  -- Índices para queries comuns
  CONSTRAINT valid_status CHECK (status IN ('pending', 'executing', 'success', 'failed', 'cancelled', 'requires_confirmation'))
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_agentic_tool_calls_user_id 
  ON public.agentic_tool_calls(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agentic_tool_calls_phone 
  ON public.agentic_tool_calls(phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agentic_tool_calls_tool_name 
  ON public.agentic_tool_calls(tool_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agentic_tool_calls_status 
  ON public.agentic_tool_calls(status) 
  WHERE status IN ('pending', 'executing', 'requires_confirmation');

-- RLS
ALTER TABLE public.agentic_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own tool calls" ON public.agentic_tool_calls;
CREATE POLICY "users can read own tool calls"
  ON public.agentic_tool_calls FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.agentic_tool_calls IS
  'Fase Agentic 1.1 — Log de todas as chamadas de tools do agente para auditoria, debugging e métricas.';
