-- ========================================
-- LUMIZ - SQL Migration para Lovable Cloud
-- Execute este script no SQL Editor do Supabase
-- ========================================

-- 1. Verifica se a tabela whatsapp_users existe
-- (Lovable já criou essa tabela)

-- 2. Criar tabela de transações do WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES whatsapp_users(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL CHECK (type IN ('entrada', 'saida')),
  amount DECIMAL(10,2) NOT NULL,
  category VARCHAR(100) DEFAULT 'Sem categoria',
  description TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Criar tabela de categorias do WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES whatsapp_users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('entrada', 'saida')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_transactions_user_id
  ON whatsapp_transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_transactions_date
  ON whatsapp_transactions(date);

CREATE INDEX IF NOT EXISTS idx_whatsapp_transactions_type
  ON whatsapp_transactions(type);

CREATE INDEX IF NOT EXISTS idx_whatsapp_categories_user_id
  ON whatsapp_categories(user_id);

-- 5. Habilitar Row Level Security (RLS)
ALTER TABLE whatsapp_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_categories ENABLE ROW LEVEL SECURITY;

-- 6. Criar políticas de segurança
-- Permite que o service_role acesse tudo (para o backend)
CREATE POLICY "Service role full access transactions"
  ON whatsapp_transactions
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access categories"
  ON whatsapp_categories
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 7. Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_whatsapp_transactions_updated_at
  BEFORE UPDATE ON whatsapp_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 8. Verificar se whatsapp_users tem a coluna phone
-- Se não existir, adiciona
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_users' AND column_name = 'phone'
  ) THEN
    ALTER TABLE whatsapp_users ADD COLUMN phone VARCHAR(20) UNIQUE;
  END IF;
END $$;

-- ========================================
-- VERIFICAÇÃO
-- ========================================

-- Para verificar se as tabelas foram criadas:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- Para ver a estrutura:
-- \d whatsapp_transactions
-- \d whatsapp_categories

-- ========================================
-- IMPORTANTE
-- ========================================
-- Após executar este script:
-- 1. Vá em Settings > API > Service Role Key
-- 2. Copie a chave
-- 3. Configure no Railway:
--    SUPABASE_URL=https://kzaedkuolcevdjdugtfn.supabase.co
--    SUPABASE_SERVICE_ROLE_KEY=sua_chave_aqui
