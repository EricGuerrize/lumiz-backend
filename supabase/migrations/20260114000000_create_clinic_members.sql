-- ============================================================================
-- Migration: Create clinic_members table
-- Description: Allows multiple WhatsApp numbers to be linked to a single clinic
-- Each member has a role and can access the clinic's financial data
-- ============================================================================

-- Create clinic_members table
CREATE TABLE IF NOT EXISTS clinic_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  telefone VARCHAR(20) NOT NULL,
  nome VARCHAR(255) NOT NULL,
  funcao VARCHAR(50) NOT NULL CHECK (funcao IN ('dona', 'gestora', 'adm', 'financeiro', 'secretaria', 'profissional')),
  is_primary BOOLEAN DEFAULT FALSE, -- número que fez onboarding original
  is_active BOOLEAN DEFAULT TRUE,
  confirmed BOOLEAN DEFAULT FALSE, -- confirmado pelo próprio número
  confirmed_at TIMESTAMP,
  created_by UUID REFERENCES profiles(id), -- quem cadastrou este membro
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Unique constraint: um telefone só pode estar vinculado a uma clínica por vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_members_telefone_unique 
  ON clinic_members(telefone) WHERE is_active = TRUE;

-- Index for fast lookup by phone
CREATE INDEX IF NOT EXISTS idx_clinic_members_telefone 
  ON clinic_members(telefone);

-- Index for listing members by clinic
CREATE INDEX IF NOT EXISTS idx_clinic_members_clinic_id 
  ON clinic_members(clinic_id);

-- Partial index for active members only
CREATE INDEX IF NOT EXISTS idx_clinic_members_active 
  ON clinic_members(clinic_id, is_active) WHERE is_active = TRUE;

-- Index for finding primary member
CREATE INDEX IF NOT EXISTS idx_clinic_members_primary 
  ON clinic_members(clinic_id) WHERE is_primary = TRUE;

-- Add comment for documentation
COMMENT ON TABLE clinic_members IS 'Membros vinculados a cada clínica. Permite múltiplos números WhatsApp por clínica.';
COMMENT ON COLUMN clinic_members.funcao IS 'Função do membro: dona, gestora, adm, financeiro, secretaria, profissional';
COMMENT ON COLUMN clinic_members.is_primary IS 'Indica se é o número que fez o onboarding original';
COMMENT ON COLUMN clinic_members.confirmed IS 'Se o próprio número já confirmou o vínculo';

-- Enable RLS
ALTER TABLE clinic_members ENABLE ROW LEVEL SECURITY;

-- Policy: usuários podem ver membros da sua clínica
CREATE POLICY clinic_members_select_policy ON clinic_members
  FOR SELECT
  USING (
    clinic_id IN (
      SELECT id FROM profiles WHERE telefone = current_setting('app.current_phone', true)
    )
    OR
    clinic_id IN (
      SELECT clinic_id FROM clinic_members WHERE telefone = current_setting('app.current_phone', true) AND is_active = TRUE
    )
  );

-- Policy: apenas donos/gestoras podem inserir membros
CREATE POLICY clinic_members_insert_policy ON clinic_members
  FOR INSERT
  WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM clinic_members 
      WHERE telefone = current_setting('app.current_phone', true) 
      AND funcao IN ('dona', 'gestora')
      AND is_active = TRUE
    )
    OR
    clinic_id IN (
      SELECT id FROM profiles WHERE telefone = current_setting('app.current_phone', true)
    )
  );

-- Policy: apenas donos/gestoras podem atualizar membros
CREATE POLICY clinic_members_update_policy ON clinic_members
  FOR UPDATE
  USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_members 
      WHERE telefone = current_setting('app.current_phone', true) 
      AND funcao IN ('dona', 'gestora')
      AND is_active = TRUE
    )
    OR
    -- Membros podem atualizar apenas seu próprio registro (para confirmar)
    telefone = current_setting('app.current_phone', true)
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_clinic_members_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_clinic_members_updated_at ON clinic_members;
CREATE TRIGGER trigger_clinic_members_updated_at
  BEFORE UPDATE ON clinic_members
  FOR EACH ROW
  EXECUTE FUNCTION update_clinic_members_updated_at();
