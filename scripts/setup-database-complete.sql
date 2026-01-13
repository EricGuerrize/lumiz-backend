-- ============================================================================
-- Script Completo de Setup do Banco de Dados - Lumiz
-- Execute este script no Supabase Dashboard (SQL Editor)
-- ============================================================================
-- 
-- INSTRUÇÕES:
-- 1. Acesse: https://supabase.com/dashboard/project/[SEU_PROJECT_ID]/sql/new
-- 2. Cole este script completo
-- 3. Clique em "Run"
-- 4. Aguarde a execução (pode levar alguns segundos)
--
-- ============================================================================

-- ============================================================================
-- PARTE 1: Criar tabela profiles (CRÍTICO - deve ser criada primeiro)
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  nome_completo VARCHAR(255),
  nome_clinica VARCHAR(255),
  telefone VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255),
  whatsapp_contato VARCHAR(20),
  cidade VARCHAR(100),
  tipo_clinica VARCHAR(50),
  ticket_medio DECIMAL(10,2),
  procedimentos_mes INTEGER,
  responsavel_info VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_profiles_telefone ON profiles(telefone);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_cidade ON profiles(cidade);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active);

COMMENT ON TABLE profiles IS 'Armazena os dados dos usuários (clínicas) do sistema. Vinculado ao Supabase Auth.';

-- ============================================================================
-- PARTE 2: Aplicar migration de campos de onboarding (se ainda não aplicada)
-- ============================================================================

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS whatsapp_contato VARCHAR(20),
ADD COLUMN IF NOT EXISTS cidade VARCHAR(100),
ADD COLUMN IF NOT EXISTS tipo_clinica VARCHAR(50),
ADD COLUMN IF NOT EXISTS ticket_medio DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS procedimentos_mes INTEGER,
ADD COLUMN IF NOT EXISTS responsavel_info VARCHAR(255);

-- ============================================================================
-- PARTE 3: Verificar se outras tabelas críticas existem
-- ============================================================================

-- Verifica se onboarding_progress existe (já deve existir pelo schema.sql)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'onboarding_progress') THEN
        RAISE NOTICE 'Tabela onboarding_progress não encontrada. Execute o schema.sql primeiro.';
    ELSE
        RAISE NOTICE '✅ Tabela onboarding_progress existe';
    END IF;
END $$;

-- Verifica se mdr_configs existe
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mdr_configs') THEN
        RAISE NOTICE 'Tabela mdr_configs não encontrada. Execute o schema.sql primeiro.';
    ELSE
        RAISE NOTICE '✅ Tabela mdr_configs existe';
    END IF;
END $$;

-- Verifica se ocr_jobs existe
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ocr_jobs') THEN
        RAISE NOTICE 'Tabela ocr_jobs não encontrada. Execute o schema.sql primeiro.';
    ELSE
        RAISE NOTICE '✅ Tabela ocr_jobs existe';
    END IF;
END $$;

-- ============================================================================
-- PARTE 4: Aplicar migration de user_insights (se ainda não aplicada)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_insights (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NULL,
    phone text NULL,
    title text NULL,
    summary text NULL,
    insights jsonb NULL,
    sent_via text NULL,
    sent_at timestamp with time zone NULL,
    metadata jsonb NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT user_insights_pkey PRIMARY KEY (id),
    CONSTRAINT user_insights_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_user_insights_user ON user_insights(user_id);

-- RLS
ALTER TABLE public.user_insights ENABLE ROW LEVEL SECURITY;

-- Policy (se não existir)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'user_insights' 
        AND policyname = 'Users can view their own insights'
    ) THEN
        CREATE POLICY "Users can view their own insights"
            ON public.user_insights
            FOR SELECT
            USING (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================================
-- PARTE 5: Verificação final
-- ============================================================================

DO $$
DECLARE
    profiles_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO profiles_count FROM information_schema.tables WHERE table_name = 'profiles';
    
    IF profiles_count > 0 THEN
        RAISE NOTICE '✅ Tabela profiles criada com sucesso!';
    ELSE
        RAISE EXCEPTION '❌ Erro: Tabela profiles não foi criada';
    END IF;
END $$;

-- ============================================================================
-- FIM DO SCRIPT
-- ============================================================================
-- 
-- Após executar este script:
-- 1. Verifique se a tabela profiles foi criada: SELECT * FROM profiles LIMIT 1;
-- 2. Teste o bot novamente
-- 3. Se houver outras tabelas faltando, execute o schema.sql completo
--
-- ============================================================================
