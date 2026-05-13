-- Fase 15 — Tabela de reconhecimento de fornecedores
-- Permite classificação automática por nome de fornecedor, com seed global
-- e aprendizado por usuário.

CREATE TABLE IF NOT EXISTS vendor_classifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_name TEXT NOT NULL,
  vendor_name_normalized TEXT GENERATED ALWAYS AS (lower(trim(vendor_name))) STORED,
  category TEXT NOT NULL CHECK (category IN ('insumos', 'aluguel', 'pessoal', 'marketing', 'cartao', 'imposto', 'estrutura', 'outro')),
  is_global BOOLEAN DEFAULT TRUE,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique: global entries by name, per-user entries by name+user
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_classifications_global_unique
  ON vendor_classifications(vendor_name_normalized)
  WHERE user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_classifications_user_unique
  ON vendor_classifications(vendor_name_normalized, user_id)
  WHERE user_id IS NOT NULL;

-- Seed com fornecedores conhecidos do setor estético
INSERT INTO vendor_classifications (vendor_name, category, is_global) VALUES
  ('Biogelis', 'insumos', true),
  ('Allergan', 'insumos', true),
  ('Galderma', 'insumos', true),
  ('Merz', 'insumos', true),
  ('Elfa Medicamentos', 'insumos', true),
  ('PharmaPele', 'insumos', true),
  ('GMC', 'insumos', true),
  ('Velladerm', 'insumos', true),
  ('Mediq', 'insumos', true),
  ('ZenScience', 'insumos', true),
  ('Prollenium', 'insumos', true),
  ('Hans Biomed', 'insumos', true),
  ('Sinclair', 'insumos', true),
  ('Stone', 'cartao', true),
  ('Cielo', 'cartao', true),
  ('Rede', 'cartao', true),
  ('GetNet', 'cartao', true),
  ('PagSeguro', 'cartao', true),
  ('SumUp', 'cartao', true),
  ('Mercado Pago', 'cartao', true),
  ('SafraPay', 'cartao', true),
  ('InfinitePay', 'cartao', true),
  ('Ton', 'cartao', true)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_vendor_classifications_normalized ON vendor_classifications(vendor_name_normalized);
CREATE INDEX IF NOT EXISTS idx_vendor_classifications_user ON vendor_classifications(user_id) WHERE user_id IS NOT NULL;

-- RLS
ALTER TABLE vendor_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuário vê registros globais e os seus próprios"
  ON vendor_classifications FOR SELECT
  USING (is_global = true OR user_id = auth.uid());

CREATE POLICY "Usuário insere apenas os seus próprios"
  ON vendor_classifications FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_global = false);

CREATE POLICY "Usuário atualiza apenas os seus próprios"
  ON vendor_classifications FOR UPDATE
  USING (user_id = auth.uid() AND is_global = false);
