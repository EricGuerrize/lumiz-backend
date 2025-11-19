-- Criar tabela de tokens de setup
CREATE TABLE IF NOT EXISTS public.setup_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  token UUID DEFAULT gen_random_uuid() NOT NULL UNIQUE,
  expira_em TIMESTAMP WITH TIME ZONE NOT NULL,
  usado BOOLEAN DEFAULT FALSE,
  criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_setup_tokens_email ON public.setup_tokens(email);
CREATE INDEX IF NOT EXISTS idx_setup_tokens_token ON public.setup_tokens(token);

-- RLS desabilitado (acesso via service role)
ALTER TABLE public.setup_tokens DISABLE ROW LEVEL SECURITY;

-- Limpar tokens expirados automaticamente (opcional)
CREATE OR REPLACE FUNCTION limpar_tokens_expirados()
RETURNS void AS $$
BEGIN
  DELETE FROM public.setup_tokens 
  WHERE expira_em < NOW() OR usado = TRUE;
END;
$$ LANGUAGE plpgsql;

