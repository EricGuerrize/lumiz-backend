-- Migration: Enable RLS on sensitive tables
-- Description: Enables Row Level Security on onboarding_progress, mdr_configs, ocr_jobs, and setup_tokens
-- with appropriate policies to ensure users can only access their own data

-- 1. Enable RLS on onboarding_progress
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own onboarding progress
-- Uses phone or user_id to match authenticated user
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

-- Policy: Users can only see their own MDR configs
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

-- Policy: Users can only see their own OCR jobs
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

-- Policy: Users can only see their own setup tokens
-- Note: setup_tokens uses email field, so we need to match by email from profiles
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

-- Note: Service role can still access all records for backend operations
-- This is handled by using the service role key in the backend code
