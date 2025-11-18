-- Adiciona campos de meta mensal na tabela profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS meta_mensal DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS meta_atualizada_em TIMESTAMP;

-- Comentários
COMMENT ON COLUMN profiles.meta_mensal IS 'Meta de faturamento mensal configurada pelo usuário';
COMMENT ON COLUMN profiles.meta_atualizada_em IS 'Data da última atualização da meta';

