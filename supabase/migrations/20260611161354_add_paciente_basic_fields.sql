-- Item #36 — Cadastro básico de paciente via WhatsApp.
-- Adiciona campos opcionais de contato/identificação à tabela clientes (pacientes).
-- Aditiva e não-destrutiva: usa ADD COLUMN IF NOT EXISTS. A coluna nome e o
-- UNIQUE(user_id, nome) já existem (ver 20251222221445_add_unique_constraints_upsert.sql).

ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS telefone text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS cpf text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS data_nascimento date;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS observacoes text;

-- RLS: garante que a tabela está protegida e que o usuário só acessa seus próprios
-- pacientes, seguindo o mesmo padrão das tabelas vizinhas (ex.: monthly_goals).
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own clientes" ON public.clientes;
CREATE POLICY "users manage own clientes"
  ON public.clientes
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON COLUMN public.clientes.telefone IS 'Telefone de contato do paciente (cadastro básico, item #36).';
COMMENT ON COLUMN public.clientes.cpf IS 'CPF do paciente (apenas dígitos, opcional).';
COMMENT ON COLUMN public.clientes.data_nascimento IS 'Data de nascimento do paciente (opcional).';
COMMENT ON COLUMN public.clientes.email IS 'E-mail de contato do paciente (opcional).';
COMMENT ON COLUMN public.clientes.observacoes IS 'Observações livres sobre o paciente (opcional).';
