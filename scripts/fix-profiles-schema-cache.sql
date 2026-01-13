-- ============================================================================
-- Script para Corrigir Schema Cache do Supabase
-- Problema: "Could not find the table 'public.profiles' in the schema cache"
-- ============================================================================
-- 
-- INSTRUÇÕES:
-- 1. Acesse: https://supabase.com/dashboard/project/[SEU_PROJECT_ID]/sql/new
-- 2. Cole este script completo
-- 3. Clique em "Run"
--
-- ============================================================================

-- 1. Verificar se a tabela profiles existe e está no schema public
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'profiles'
    ) THEN
        RAISE NOTICE '✅ Tabela profiles existe no schema public';
    ELSE
        RAISE EXCEPTION '❌ Tabela profiles NÃO encontrada no schema public';
    END IF;
END $$;

-- 2. Verificar permissões da tabela
SELECT 
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' 
AND table_name = 'profiles';

-- 3. Garantir que a tabela está acessível para authenticated e service_role
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT ALL ON TABLE public.profiles TO anon;

-- 4. Verificar se há RLS habilitado (pode causar problemas se mal configurado)
DO $$
DECLARE
    rls_enabled BOOLEAN;
BEGIN
    SELECT relrowsecurity INTO rls_enabled
    FROM pg_class
    WHERE relname = 'profiles' AND relnamespace = 'public'::regnamespace;
    
    IF rls_enabled THEN
        RAISE NOTICE '⚠️  RLS está habilitado na tabela profiles';
        RAISE NOTICE '   Se estiver usando service_role, RLS não deve bloquear';
    ELSE
        RAISE NOTICE '✅ RLS não está habilitado (OK para service_role)';
    END IF;
END $$;

-- 5. Forçar refresh do schema cache (via NOTIFY)
-- Nota: O Supabase atualiza o cache automaticamente, mas podemos tentar forçar
NOTIFY pgrst, 'reload schema';

-- 6. Verificar estrutura da tabela
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'profiles'
ORDER BY ordinal_position;

-- ============================================================================
-- SOLUÇÃO ALTERNATIVA: Se o problema persistir
-- ============================================================================
-- 
-- Se após executar este script o erro continuar, tente:
--
-- 1. Reiniciar o PostgREST (via Supabase Dashboard):
--    - Settings > API > Restart API
--
-- 2. Aguardar 2-3 minutos para o cache atualizar automaticamente
--
-- 3. Verificar se está usando o schema correto:
--    - O código deve usar: supabase.from('profiles')
--    - Não deve especificar schema: supabase.from('public.profiles')
--
-- ============================================================================
