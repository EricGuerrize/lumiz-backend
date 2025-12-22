-- Migration: Adiciona constraints UNIQUE para permitir UPSERT eficiente
-- Descrição: Adiciona constraints UNIQUE em (user_id, nome) para clientes e procedimentos
-- Isso permite usar UPSERT ao invés de SELECT + INSERT (reduz queries em 50%)

-- Adiciona constraint UNIQUE para clientes (se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'clientes_user_id_nome_unique'
  ) THEN
    ALTER TABLE clientes
    ADD CONSTRAINT clientes_user_id_nome_unique UNIQUE (user_id, nome);
    
    -- Cria índice para performance
    CREATE INDEX IF NOT EXISTS idx_clientes_user_id_nome 
    ON clientes(user_id, nome);
  END IF;
END $$;

-- Adiciona constraint UNIQUE para procedimentos (se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'procedimentos_user_id_nome_unique'
  ) THEN
    ALTER TABLE procedimentos
    ADD CONSTRAINT procedimentos_user_id_nome_unique UNIQUE (user_id, nome);
    
    -- Cria índice para performance
    CREATE INDEX IF NOT EXISTS idx_procedimentos_user_id_nome 
    ON procedimentos(user_id, nome);
  END IF;
END $$;

-- Comentários para documentação
COMMENT ON CONSTRAINT clientes_user_id_nome_unique ON clientes IS 
'Garante que cada usuário não pode ter clientes duplicados com mesmo nome. Permite UPSERT eficiente.';

COMMENT ON CONSTRAINT procedimentos_user_id_nome_unique ON procedimentos IS 
'Garante que cada usuário não pode ter procedimentos duplicados com mesmo nome. Permite UPSERT eficiente.';
