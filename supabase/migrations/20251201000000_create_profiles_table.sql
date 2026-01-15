-- Migration: Create profiles table
-- Description: Creates the profiles table that stores user/clinic data. This is the core user table linked to Supabase Auth.

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  nome_completo VARCHAR(255),
  nome_clinica VARCHAR(255),
  telefone VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255),
  whatsapp_contato VARCHAR(20),
  cidade VARCHAR(100),
  tipo_clinica VARCHAR(50),
  ticket_medio DECIMAL(10,2),
  procedimentos_mes INTEGER,
  responsavel_info VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_telefone ON profiles(telefone);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_cidade ON profiles(cidade);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active);

-- Add comment for documentation
COMMENT ON TABLE profiles IS 'Armazena os dados dos usuários (clínicas) do sistema. Vinculado ao Supabase Auth.';
