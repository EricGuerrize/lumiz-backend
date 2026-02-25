-- Alinha schema de learned_knowledge com o backend atual
-- - embedding oficial em 768 dimensoes
-- - clinic_id referenciando public.profiles(id)
-- - RLS exclusivo para service_role

create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists public.learned_knowledge (
  id          uuid primary key default gen_random_uuid(),
  content     text not null,
  embedding   vector(768),
  intent_name text not null,
  metadata    jsonb not null default '{}'::jsonb,
  clinic_id   uuid references public.profiles(id) on delete cascade,
  is_global   boolean not null default false,
  created_at  timestamptz not null default now()
);

do $$
declare
  fk record;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'learned_knowledge' and column_name = 'metadata'
  ) then
    alter table public.learned_knowledge add column metadata jsonb;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'learned_knowledge' and column_name = 'metadata'
  ) then
    update public.learned_knowledge
      set metadata = '{}'::jsonb
      where metadata is null;

    alter table public.learned_knowledge
      alter column metadata set default '{}'::jsonb,
      alter column metadata set not null;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'learned_knowledge' and column_name = 'is_global'
  ) then
    alter table public.learned_knowledge add column is_global boolean;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'learned_knowledge' and column_name = 'is_global'
  ) then
    update public.learned_knowledge
      set is_global = false
      where is_global is null;

    alter table public.learned_knowledge
      alter column is_global set default false,
      alter column is_global set not null;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'learned_knowledge' and column_name = 'created_at'
  ) then
    alter table public.learned_knowledge add column created_at timestamptz;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'learned_knowledge' and column_name = 'created_at'
  ) then
    update public.learned_knowledge
      set created_at = now()
      where created_at is null;

    alter table public.learned_knowledge
      alter column created_at set default now(),
      alter column created_at set not null;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'learned_knowledge' and column_name = 'clinic_id'
  ) then
    alter table public.learned_knowledge add column clinic_id uuid;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'learned_knowledge' and column_name = 'embedding'
  ) then
    alter table public.learned_knowledge add column embedding vector(768);
  else
    if exists (
      select 1
      from public.learned_knowledge
      where embedding is not null
        and vector_dims(embedding) <> 768
      limit 1
    ) then
      raise exception 'learned_knowledge.embedding possui vetores com dimensao diferente de 768. Refaça os embeddings antes de aplicar esta migration.';
    end if;

    alter table public.learned_knowledge
      alter column embedding type vector(768)
      using embedding::vector(768);
  end if;

  for fk in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join unnest(con.conkey) as cols(attnum) on true
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = cols.attnum
    where con.contype = 'f'
      and nsp.nspname = 'public'
      and rel.relname = 'learned_knowledge'
      and att.attname = 'clinic_id'
  loop
    execute format('alter table public.learned_knowledge drop constraint if exists %I', fk.conname);
  end loop;

  alter table public.learned_knowledge
    add constraint learned_knowledge_clinic_id_fkey
    foreign key (clinic_id) references public.profiles(id) on delete cascade;
exception
  when duplicate_object then
    null;
end $$;

create index if not exists learned_knowledge_embedding_idx
  on public.learned_knowledge using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists learned_knowledge_clinic_idx
  on public.learned_knowledge (clinic_id);

alter table public.learned_knowledge enable row level security;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'learned_knowledge'
      and policyname = 'rls_knowledge_select_own'
  ) then
    drop policy rls_knowledge_select_own on public.learned_knowledge;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'learned_knowledge'
      and policyname = 'service role full access'
  ) then
    create policy "service role full access" on public.learned_knowledge
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

drop function if exists public.match_learned_knowledge(vector, float, int, uuid);

create or replace function public.match_learned_knowledge(
  query_embedding vector(768),
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
  from public.learned_knowledge lk
  where
    (lk.is_global = true or (p_clinic_id is not null and lk.clinic_id = p_clinic_id))
    and 1 - (lk.embedding <=> query_embedding) > match_threshold
  order by lk.embedding <=> query_embedding
  limit match_count;
$$;
