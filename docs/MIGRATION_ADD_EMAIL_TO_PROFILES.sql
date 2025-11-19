-- Adicionar coluna email na tabela profiles
-- Esta coluna será preenchida quando o usuário se cadastrar no frontend

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS email TEXT;

-- Adiciona índice para busca rápida por email (opcional, mas recomendado)
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email) WHERE email IS NOT NULL;

-- Comentário na coluna
COMMENT ON COLUMN public.profiles.email IS 'Email do usuário, preenchido quando se cadastra no dashboard';
