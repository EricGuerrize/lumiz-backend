-- Pre-check de produção para learned_knowledge
-- Rode no Supabase SQL Editor antes do rollout

-- 1) Existe tabela e quantas linhas
select
  to_regclass('public.learned_knowledge') as table_name,
  count(*) as total_rows
from public.learned_knowledge;

-- 2) Dimensões existentes no embedding
select
  vector_dims(embedding) as embedding_dims,
  count(*) as rows
from public.learned_knowledge
where embedding is not null
group by vector_dims(embedding)
order by embedding_dims;

-- 3) FK atual de clinic_id
select
  con.conname as constraint_name,
  n.nspname as table_schema,
  rel.relname as table_name,
  pg_get_constraintdef(con.oid) as constraint_def
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where con.contype = 'f'
  and n.nspname = 'public'
  and rel.relname = 'learned_knowledge';

-- 4) Políticas RLS atuais
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'learned_knowledge'
order by policyname;

-- 5) Assinatura da função RPC
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as returns,
  pg_get_functiondef(p.oid) as function_ddl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'match_learned_knowledge';
