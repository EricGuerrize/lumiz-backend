-- ========================================
-- LUMIZ - Schema Completo para Dashboard
-- Execute no SQL Editor do Supabase
-- ========================================

-- 1. TIPOS ENUMERADOS
CREATE TYPE forma_pagamento AS ENUM ('avista', 'parcelado');
CREATE TYPE status_pagamento AS ENUM ('pago', 'pendente', 'agendado');
CREATE TYPE procedimento_tipo AS ENUM ('acido', 'botox', 'outros');
CREATE TYPE app_role AS ENUM ('admin', 'funcionario');

-- 2. PROFILES (Usuários do Sistema)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_completo VARCHAR(255) NOT NULL,
  nome_clinica VARCHAR(255),
  telefone VARCHAR(20) UNIQUE,
  is_active BOOLEAN DEFAULT true,
  deactivated_at TIMESTAMP WITH TIME ZONE,
  deactivated_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. USER ROLES (Permissões)
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role app_role DEFAULT 'admin',
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. CLIENTES (Pacientes da Clínica)
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nome VARCHAR(255) NOT NULL,
  apelido VARCHAR(100),
  email VARCHAR(255),
  telefone VARCHAR(20),
  cpf VARCHAR(14),
  rg VARCHAR(20),
  data_nascimento DATE,
  sexo VARCHAR(20),
  estado_civil VARCHAR(50),
  escolaridade VARCHAR(100),
  como_conheceu VARCHAR(255),
  observacoes_adicionais TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. PROCEDIMENTOS (Serviços Oferecidos)
CREATE TABLE IF NOT EXISTS procedimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nome VARCHAR(255) NOT NULL,
  tipo procedimento_tipo NOT NULL,
  custo_material_ml DECIMAL(10,2) NOT NULL DEFAULT 0,
  valor_sugerido DECIMAL(10,2),
  estoque_ml DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. ATENDIMENTOS (Receitas)
CREATE TABLE IF NOT EXISTS atendimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  valor_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  custo_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  forma_pagamento forma_pagamento DEFAULT 'avista',
  status_pagamento status_pagamento DEFAULT 'pago',
  parcelas INTEGER,
  bandeira_cartao VARCHAR(50),
  observacoes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. ATENDIMENTO_PROCEDIMENTOS (Procedimentos por Atendimento)
CREATE TABLE IF NOT EXISTS atendimento_procedimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id UUID NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
  procedimento_id UUID NOT NULL REFERENCES procedimentos(id) ON DELETE CASCADE,
  valor_cobrado DECIMAL(10,2) NOT NULL,
  custo_material DECIMAL(10,2) NOT NULL,
  ml_utilizado DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. CONTAS_PAGAR (Despesas)
CREATE TABLE IF NOT EXISTS contas_pagar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  descricao VARCHAR(255) NOT NULL,
  valor DECIMAL(10,2) NOT NULL,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo VARCHAR(50) NOT NULL,
  categoria VARCHAR(100),
  forma_pagamento VARCHAR(50),
  status_pagamento VARCHAR(20) DEFAULT 'pendente',
  observacoes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. AGENDAMENTOS
CREATE TABLE IF NOT EXISTS agendamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  procedimento_id UUID NOT NULL REFERENCES procedimentos(id) ON DELETE CASCADE,
  data_agendamento TIMESTAMP WITH TIME ZONE NOT NULL,
  status VARCHAR(20) DEFAULT 'agendado',
  observacoes TEXT,
  notificado BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. ÍNDICES PARA PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_profiles_telefone ON profiles(telefone);
CREATE INDEX IF NOT EXISTS idx_clientes_user_id ON clientes(user_id);
CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome);
CREATE INDEX IF NOT EXISTS idx_procedimentos_user_id ON procedimentos(user_id);
CREATE INDEX IF NOT EXISTS idx_atendimentos_user_id ON atendimentos(user_id);
CREATE INDEX IF NOT EXISTS idx_atendimentos_cliente_id ON atendimentos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_atendimentos_data ON atendimentos(data);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_user_id ON contas_pagar(user_id);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_data ON contas_pagar(data);
CREATE INDEX IF NOT EXISTS idx_agendamentos_user_id ON agendamentos(user_id);
CREATE INDEX IF NOT EXISTS idx_agendamentos_data ON agendamentos(data_agendamento);

-- 11. TRIGGER PARA ATUALIZAR updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clientes_updated_at BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_procedimentos_updated_at BEFORE UPDATE ON procedimentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_atendimentos_updated_at BEFORE UPDATE ON atendimentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contas_pagar_updated_at BEFORE UPDATE ON contas_pagar
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agendamentos_updated_at BEFORE UPDATE ON agendamentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- VERIFICAÇÃO
-- ========================================
-- Execute para verificar se todas as tabelas foram criadas:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;

-- ========================================
-- NOTA IMPORTANTE
-- ========================================
-- Após executar este SQL:
-- 1. O bot vai poder criar usuários via onboarding
-- 2. Atendimentos serão salvos na tabela correta
-- 3. Dashboard poderá ler os dados

-- Para testar:
-- 1. Envie "oi" no WhatsApp
-- 2. Bot vai pedir seus dados (onboarding)
-- 3. Depois registre: "Botox 2800 paciente Maria"
-- 4. Confira no dashboard
