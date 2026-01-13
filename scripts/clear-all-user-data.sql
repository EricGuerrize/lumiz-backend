-- ============================================================================
-- Script para LIMPAR TODOS OS DADOS DE USUÁRIOS do banco
-- ⚠️ ATENÇÃO: Este script apaga TODOS os dados de usuários!
-- Use apenas em ambiente de desenvolvimento/teste
-- ============================================================================

-- Desabilita temporariamente as triggers e constraints para evitar erros
SET session_replication_role = 'replica';

BEGIN;

-- Mostra quantos registros serão apagados
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    RAISE NOTICE '=== INICIANDO LIMPEZA DE DADOS DE USUÁRIOS ===';
    
    -- Conta registros antes de apagar
    SELECT COUNT(*) INTO v_count FROM profiles;
    RAISE NOTICE 'Usuários encontrados: %', v_count;
    
    SELECT COUNT(*) INTO v_count FROM atendimentos;
    RAISE NOTICE 'Atendimentos encontrados: %', v_count;
    
    SELECT COUNT(*) INTO v_count FROM contas_pagar;
    RAISE NOTICE 'Contas a pagar encontradas: %', v_count;
    
    SELECT COUNT(*) INTO v_count FROM clientes;
    RAISE NOTICE 'Clientes encontrados: %', v_count;
END $$;

-- ============================================================================
-- APAGAR DADOS DAS TABELAS FILHAS (na ordem correta)
-- ============================================================================

-- 1. Parcelas (depende de atendimentos)
DELETE FROM parcelas;
RAISE NOTICE 'Parcelas apagadas';

-- 2. Atendimento procedimentos (depende de atendimentos e procedimentos)
DELETE FROM atendimento_procedimentos;
RAISE NOTICE 'Atendimento procedimentos apagados';

-- 3. Atendimentos (depende de profiles e clientes)
DELETE FROM atendimentos;
RAISE NOTICE 'Atendimentos apagados';

-- 4. Contas a pagar (depende de profiles)
DELETE FROM contas_pagar;
RAISE NOTICE 'Contas a pagar apagadas';

-- 5. Agendamentos (depende de profiles e clientes)
DELETE FROM agendamentos;
RAISE NOTICE 'Agendamentos apagados';

-- 6. Procedimentos (depende de profiles)
DELETE FROM procedimentos;
RAISE NOTICE 'Procedimentos apagados';

-- 7. Clientes (depende de profiles)
DELETE FROM clientes;
RAISE NOTICE 'Clientes apagados';

-- 8. User roles (depende de profiles)
DELETE FROM user_roles;
RAISE NOTICE 'User roles apagados';

-- 9. Onboarding progress (depende de profiles)
DELETE FROM onboarding_progress;
RAISE NOTICE 'Onboarding progress apagado';

-- 10. MDR configs (depende de profiles)
DELETE FROM mdr_configs;
RAISE NOTICE 'MDR configs apagados';

-- 11. OCR jobs (depende de profiles)
DELETE FROM ocr_jobs;
RAISE NOTICE 'OCR jobs apagados';

-- 12. User insights (depende de profiles)
DELETE FROM user_insights;
RAISE NOTICE 'User insights apagados';

-- 13. Conversation history (depende de profiles)
DELETE FROM conversation_history;
RAISE NOTICE 'Conversation history apagado';

-- 14. WhatsApp states (estado do onboarding via WhatsApp)
DELETE FROM whatsapp_states;
RAISE NOTICE 'WhatsApp states apagados';

-- 15. Analytics events (se existir e tiver user_id)
-- DELETE FROM analytics_events WHERE user_id IS NOT NULL;
-- RAISE NOTICE 'Analytics events apagados';

-- ============================================================================
-- APAGAR DADOS DA TABELA PRINCIPAL
-- ============================================================================

-- 16. Profiles (tabela principal de usuários)
DELETE FROM profiles;
RAISE NOTICE 'Profiles apagados';

-- ============================================================================
-- RESETAR SEQUENCES (se houver)
-- ============================================================================

-- Resetar sequences para começar do 1 novamente (opcional)
-- ALTER SEQUENCE IF EXISTS profiles_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS atendimentos_id_seq RESTART WITH 1;
-- etc...

COMMIT;

-- Reabilita triggers e constraints
SET session_replication_role = 'origin';

-- Mostra resultado final
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    RAISE NOTICE '=== LIMPEZA CONCLUÍDA ===';
    
    SELECT COUNT(*) INTO v_count FROM profiles;
    RAISE NOTICE 'Usuários restantes: %', v_count;
    
    SELECT COUNT(*) INTO v_count FROM atendimentos;
    RAISE NOTICE 'Atendimentos restantes: %', v_count;
    
    SELECT COUNT(*) INTO v_count FROM contas_pagar;
    RAISE NOTICE 'Contas a pagar restantes: %', v_count;
    
    RAISE NOTICE '✅ Todos os dados de usuários foram apagados!';
    RAISE NOTICE 'Agora você pode testar o onboarding como um usuário novo.';
END $$;

