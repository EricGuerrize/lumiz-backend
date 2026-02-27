-- RLS Regression Smoke Test
-- Objetivo: garantir que políticas RLS continuam isolando dados entre usuários.
--
-- Uso recomendado (ambiente staging):
--   psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/security/rls-regression.sql
--
-- Pré-requisitos:
-- 1) Substitua os placeholders abaixo por UUIDs reais de usuários de teste.
-- 2) Execute em ambiente com dados de teste, nunca em produção sem validação.

\set user_a '00000000-0000-0000-0000-000000000001'
\set user_b '00000000-0000-0000-0000-000000000002'

-- Simula auth.uid() no contexto SQL para políticas que dependem de JWT claims.
-- (Supabase respeita request.jwt.claim.sub em RLS.)

-- Usuário A: deve ver apenas seus próprios dados.
select set_config('request.jwt.claim.sub', :'user_a', true);

-- Esperado: zero linhas de user_b
select count(*) as should_be_zero_from_profiles
from public.profiles
where id = :'user_b';

select count(*) as should_be_zero_from_transactions
from public.transactions
where user_id = :'user_b';

select count(*) as should_be_zero_from_onboarding
from public.onboarding_progress
where user_id = :'user_b';

-- Usuário B: deve ver apenas seus próprios dados.
select set_config('request.jwt.claim.sub', :'user_b', true);

select count(*) as should_be_zero_from_profiles
from public.profiles
where id = :'user_a';

select count(*) as should_be_zero_from_transactions
from public.transactions
where user_id = :'user_a';

select count(*) as should_be_zero_from_onboarding
from public.onboarding_progress
where user_id = :'user_a';

-- Reset explícito do claim.
select set_config('request.jwt.claim.sub', '', true);
