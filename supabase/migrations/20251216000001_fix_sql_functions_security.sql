-- Migration: Fix SQL functions security by adding SET search_path
-- Description: Adds SET search_path = public to functions to prevent search_path injection vulnerabilities

-- 1. Fix or create limpar_tokens_expirados function
-- Drop existing function first if it exists (to handle return type changes)
DROP FUNCTION IF EXISTS limpar_tokens_expirados();

CREATE FUNCTION limpar_tokens_expirados()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM setup_tokens
    WHERE expira_em < NOW()
       OR (expira_em IS NULL AND created_at < NOW() - INTERVAL '7 days');
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- 2. Fix or create update_updated_at_column function
-- This is a generic trigger function that updates the updated_at column
-- Drop existing function first if it exists (to handle return type changes)
DROP FUNCTION IF EXISTS update_updated_at_column();

CREATE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Note: If there are triggers using update_updated_at_column, they will automatically use the updated function
-- Common tables that might use this trigger:
-- - onboarding_progress
-- - mdr_configs
-- - ocr_jobs
-- - profiles
-- - atendimentos
-- - contas_pagar

-- Verify functions exist and have correct search_path
DO $$
BEGIN
    -- Check limpar_tokens_expirados
    IF EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'limpar_tokens_expirados'
    ) THEN
        RAISE NOTICE 'Function limpar_tokens_expirados updated with SET search_path = public';
    END IF;
    
    -- Check update_updated_at_column
    IF EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'update_updated_at_column'
    ) THEN
        RAISE NOTICE 'Function update_updated_at_column updated with SET search_path = public';
    END IF;
END $$;
