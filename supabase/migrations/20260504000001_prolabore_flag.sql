-- Adiciona flag de pró-labore em contas_pagar
ALTER TABLE contas_pagar
  ADD COLUMN IF NOT EXISTS is_pro_labore boolean NOT NULL DEFAULT false;

-- Índice para filtros eficientes
CREATE INDEX IF NOT EXISTS idx_contas_pagar_prolabore
  ON contas_pagar(user_id, is_pro_labore)
  WHERE is_pro_labore = true;

COMMENT ON COLUMN contas_pagar.is_pro_labore IS
  'Indica que esta conta é pró-labore do sócio (separado de despesa operacional)';
