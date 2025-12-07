-- Migration: Add missing onboarding fields to profiles
-- Description: Ensures all fields collected during onboarding can be stored.

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS whatsapp_contato VARCHAR(20),
ADD COLUMN IF NOT EXISTS cidade VARCHAR(100),
ADD COLUMN IF NOT EXISTS tipo_clinica VARCHAR(50),
ADD COLUMN IF NOT EXISTS ticket_medio DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS procedimentos_mes INTEGER,
ADD COLUMN IF NOT EXISTS responsavel_info VARCHAR(255);

-- Opcional: Adicionar índice para cidade se for usar em filtro
CREATE INDEX IF NOT EXISTS idx_profiles_cidade ON profiles(cidade);
