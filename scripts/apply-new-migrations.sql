-- Script para aplicar as novas migrations de segurança
-- Execute este script no Supabase SQL Editor

-- ============================================
-- Migration 1: Enable RLS Security
-- ============================================

-- 1. Enable RLS on onboarding_progress
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own onboarding progress
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'onboarding_progress' 
        AND policyname = 'users_select_own_onboarding'
    ) THEN
        CREATE POLICY users_select_own_onboarding
          ON onboarding_progress
          FOR SELECT
          USING (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'onboarding_progress' 
        AND policyname = 'users_insert_own_onboarding'
    ) THEN
        CREATE POLICY users_insert_own_onboarding
          ON onboarding_progress
          FOR INSERT
          WITH CHECK (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'onboarding_progress' 
        AND policyname = 'users_update_own_onboarding'
    ) THEN
        CREATE POLICY users_update_own_onboarding
          ON onboarding_progress
          FOR UPDATE
          USING (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          )
          WITH CHECK (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          );
    END IF;
END $$;

-- 2. Enable RLS on mdr_configs
ALTER TABLE mdr_configs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'mdr_configs' 
        AND policyname = 'users_select_own_mdr_configs'
    ) THEN
        CREATE POLICY users_select_own_mdr_configs
          ON mdr_configs
          FOR SELECT
          USING (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'mdr_configs' 
        AND policyname = 'users_insert_own_mdr_configs'
    ) THEN
        CREATE POLICY users_insert_own_mdr_configs
          ON mdr_configs
          FOR INSERT
          WITH CHECK (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'mdr_configs' 
        AND policyname = 'users_update_own_mdr_configs'
    ) THEN
        CREATE POLICY users_update_own_mdr_configs
          ON mdr_configs
          FOR UPDATE
          USING (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          )
          WITH CHECK (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          );
    END IF;
END $$;

-- 3. Enable RLS on ocr_jobs
ALTER TABLE ocr_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'ocr_jobs' 
        AND policyname = 'users_select_own_ocr_jobs'
    ) THEN
        CREATE POLICY users_select_own_ocr_jobs
          ON ocr_jobs
          FOR SELECT
          USING (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'ocr_jobs' 
        AND policyname = 'users_insert_own_ocr_jobs'
    ) THEN
        CREATE POLICY users_insert_own_ocr_jobs
          ON ocr_jobs
          FOR INSERT
          WITH CHECK (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'ocr_jobs' 
        AND policyname = 'users_update_own_ocr_jobs'
    ) THEN
        CREATE POLICY users_update_own_ocr_jobs
          ON ocr_jobs
          FOR UPDATE
          USING (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          )
          WITH CHECK (
            user_id = auth.uid() 
            OR phone = (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1)
          );
    END IF;
END $$;

-- 4. Enable RLS on setup_tokens
ALTER TABLE setup_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'setup_tokens' 
        AND policyname = 'users_select_own_setup_tokens'
    ) THEN
        CREATE POLICY users_select_own_setup_tokens
          ON setup_tokens
          FOR SELECT
          USING (
            email = (SELECT email FROM profiles WHERE id = auth.uid() LIMIT 1)
            OR email LIKE 'phone_' || (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1) || '%'
          );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'setup_tokens' 
        AND policyname = 'users_insert_own_setup_tokens'
    ) THEN
        CREATE POLICY users_insert_own_setup_tokens
          ON setup_tokens
          FOR INSERT
          WITH CHECK (
            email = (SELECT email FROM profiles WHERE id = auth.uid() LIMIT 1)
            OR email LIKE 'phone_' || (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1) || '%'
          );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'setup_tokens' 
        AND policyname = 'users_update_own_setup_tokens'
    ) THEN
        CREATE POLICY users_update_own_setup_tokens
          ON setup_tokens
          FOR UPDATE
          USING (
            email = (SELECT email FROM profiles WHERE id = auth.uid() LIMIT 1)
            OR email LIKE 'phone_' || (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1) || '%'
          )
          WITH CHECK (
            email = (SELECT email FROM profiles WHERE id = auth.uid() LIMIT 1)
            OR email LIKE 'phone_' || (SELECT telefone FROM profiles WHERE id = auth.uid() LIMIT 1) || '%'
          );
    END IF;
END $$;

-- ============================================
-- Migration 2: Fix SQL Functions Security
-- ============================================

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

-- Verificação
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'limpar_tokens_expirados'
    ) THEN
        RAISE NOTICE 'Function limpar_tokens_expirados updated with SET search_path = public';
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'update_updated_at_column'
    ) THEN
        RAISE NOTICE 'Function update_updated_at_column updated with SET search_path = public';
    END IF;
END $$;
