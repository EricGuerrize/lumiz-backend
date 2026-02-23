-- Tabela de conhecimento aprendido pelo bot (RAG)
-- Requer extensão pgvector (disponível no Supabase por padrão)

create extension if not exists vector;

create table if not exists learned_knowledge (
  id          uuid primary key default gen_random_uuid(),
  content     text not null,
  embedding   vector(1536),
  intent_name text not null,
  metadata    jsonb not null default '{}',
  clinic_id   uuid references auth.users(id) on delete cascade,
  is_global   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Índice vetorial para busca de similaridade (IVFFlat)
create index if not exists learned_knowledge_embedding_idx
  on learned_knowledge using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Índice para filtro por clínica
create index if not exists learned_knowledge_clinic_idx
  on learned_knowledge (clinic_id);

-- Habilita RLS
alter table learned_knowledge enable row level security;

-- Apenas o serviço backend (service_role) pode ler/escrever
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'learned_knowledge'
      and policyname = 'service role full access'
  ) then
    create policy "service role full access" on learned_knowledge
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

-- Função RPC para busca por similaridade
create or replace function match_learned_knowledge(
  query_embedding vector(1536),
  match_threshold float,
  match_count     int,
  p_clinic_id     uuid default null
)
returns table (
  id          uuid,
  content     text,
  intent_name text,
  metadata    jsonb,
  similarity  float
)
language sql stable
as $$
  select
    lk.id,
    lk.content,
    lk.intent_name,
    lk.metadata,
    1 - (lk.embedding <=> query_embedding) as similarity
  from learned_knowledge lk
  where
    (lk.is_global = true or lk.clinic_id = p_clinic_id)
    and 1 - (lk.embedding <=> query_embedding) > match_threshold
  order by lk.embedding <=> query_embedding
  limit match_count;
$$;
