-- Enable RLS on all tables
-- This script enables Row Level Security on all tables and creates policies to restrict access to the owner of the data.

-- IMPORTANT: This assumes that 'auth.uid()' returns the current user's ID.
-- AND that most tables have a 'user_id' column linked to 'auth.users.id'.

BEGIN;

-- 1. Enable RLS on tables
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atendimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contas_pagar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learned_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdr_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY; -- Assuming there is a public.users table mirroring auth.users, or this might be redundant if it's the view. If it's a table, enable it.

-- 2. Create Policies (Drop existing first to be safe/idempotent)

-- Helper function to drop policies if they exist (Postgres 14+ has IF EXISTS, but this is safer for older versions)
create or replace function drop_all_policies(table_name text) returns void as $$
declare
    policy_record record;
begin
    for policy_record in select policyname from pg_policies where tablename = table_name loop
        execute format('drop policy if exists %I on %I', policy_record.policyname, table_name);
    end loop;
end;
$$ language plpgsql;

-- Apply drop policies
select drop_all_policies('agendamentos');
select drop_all_policies('atendimentos');
select drop_all_policies('clientes');
select drop_all_policies('clinic_members');
select drop_all_policies('contas_pagar');
select drop_all_policies('conversation_history');
select drop_all_policies('learned_knowledge');
select drop_all_policies('mdr_configs');
select drop_all_policies('ocr_jobs');
select drop_all_policies('onboarding_progress');
select drop_all_policies('parcelas');
select drop_all_policies('procedimentos');
select drop_all_policies('profiles');
select drop_all_policies('setup_tokens');
select drop_all_policies('user_roles');
select drop_all_policies('users');

-- 3. Define Standard Policy: "Users can allow own data"
-- For tables with 'user_id'

CREATE POLICY "Users can view own agendamentos" ON public.agendamentos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own agendamentos" ON public.agendamentos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own agendamentos" ON public.agendamentos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own agendamentos" ON public.agendamentos FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own atendimentos" ON public.atendimentos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own atendimentos" ON public.atendimentos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own atendimentos" ON public.atendimentos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own atendimentos" ON public.atendimentos FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own clientes" ON public.clientes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own clientes" ON public.clientes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own clientes" ON public.clientes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own clientes" ON public.clientes FOR DELETE USING (auth.uid() = user_id);

-- clinic_members uses 'clinic_id' as owner
CREATE POLICY "Users can view own clinic_members" ON public.clinic_members FOR SELECT USING (auth.uid() = clinic_id);
CREATE POLICY "Users can insert own clinic_members" ON public.clinic_members FOR INSERT WITH CHECK (auth.uid() = clinic_id);
CREATE POLICY "Users can update own clinic_members" ON public.clinic_members FOR UPDATE USING (auth.uid() = clinic_id);
CREATE POLICY "Users can delete own clinic_members" ON public.clinic_members FOR DELETE USING (auth.uid() = clinic_id);

CREATE POLICY "Users can view own contas_pagar" ON public.contas_pagar FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own contas_pagar" ON public.contas_pagar FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contas_pagar" ON public.contas_pagar FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contas_pagar" ON public.contas_pagar FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own conversation_history" ON public.conversation_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own conversation_history" ON public.conversation_history FOR INSERT WITH CHECK (auth.uid() = user_id);
-- Usually logs are not updated/deleted by users, but we allow it for full ownership
CREATE POLICY "Users can update own conversation_history" ON public.conversation_history FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own learned_knowledge" ON public.learned_knowledge FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own learned_knowledge" ON public.learned_knowledge FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own learned_knowledge" ON public.learned_knowledge FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own learned_knowledge" ON public.learned_knowledge FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own mdr_configs" ON public.mdr_configs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own mdr_configs" ON public.mdr_configs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own mdr_configs" ON public.mdr_configs FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own ocr_jobs" ON public.ocr_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own ocr_jobs" ON public.ocr_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own onboarding_progress" ON public.onboarding_progress FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own onboarding_progress" ON public.onboarding_progress FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own onboarding_progress" ON public.onboarding_progress FOR UPDATE USING (auth.uid() = user_id);

-- parcelas linked via atendimentos
CREATE POLICY "Users can view own parcelas" ON public.parcelas FOR SELECT USING (
    exists (select 1 from public.atendimentos a where a.id = parcelas.atendimento_id and a.user_id = auth.uid())
);
CREATE POLICY "Users can insert own parcelas" ON public.parcelas FOR INSERT WITH CHECK (
    exists (select 1 from public.atendimentos a where a.id = parcelas.atendimento_id and a.user_id = auth.uid())
);
CREATE POLICY "Users can update own parcelas" ON public.parcelas FOR UPDATE USING (
    exists (select 1 from public.atendimentos a where a.id = parcelas.atendimento_id and a.user_id = auth.uid())
);
CREATE POLICY "Users can delete own parcelas" ON public.parcelas FOR DELETE USING (
    exists (select 1 from public.atendimentos a where a.id = parcelas.atendimento_id and a.user_id = auth.uid())
);

CREATE POLICY "Users can view own procedimentos" ON public.procedimentos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own procedimentos" ON public.procedimentos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own procedimentos" ON public.procedimentos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own procedimentos" ON public.procedimentos FOR DELETE USING (auth.uid() = user_id);

-- Profiles usually uses 'id' matching auth.uid()
CREATE POLICY "Users can view own profiles" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profiles" ON public.profiles FOR UPDATE USING (auth.uid() = id);
-- Insert is usually handled by triggers on auth.user creation, but if manual:
CREATE POLICY "Users can insert own profiles" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Setup tokens might be system managed or linked to user_id
CREATE POLICY "Users can view own setup_tokens" ON public.setup_tokens FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own user_roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);


COMMIT;
