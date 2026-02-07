-- ==============================================================================
-- MDR PRICING ENGINE - SCHEMA UPDATE
-- ==============================================================================
-- Adds gross/net MDR fields and pricing snapshots to atendimentos + parcelas.
-- Includes backward-fill for existing rows.

BEGIN;

-- 1) atendimentos
ALTER TABLE IF EXISTS atendimentos
  ADD COLUMN IF NOT EXISTS valor_bruto numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_liquido numeric(14,2),
  ADD COLUMN IF NOT EXISTS mdr_percent_applied numeric(8,4),
  ADD COLUMN IF NOT EXISTS mdr_config_id uuid,
  ADD COLUMN IF NOT EXISTS settlement_mode_applied text,
  ADD COLUMN IF NOT EXISTS recebimento_previsto date,
  ADD COLUMN IF NOT EXISTS mdr_rule_snapshot jsonb DEFAULT '{}'::jsonb;

UPDATE atendimentos
SET
  valor_bruto = COALESCE(valor_bruto, valor_total, 0),
  valor_liquido = COALESCE(valor_liquido, valor_total, 0),
  mdr_rule_snapshot = COALESCE(mdr_rule_snapshot, '{}'::jsonb)
WHERE
  valor_bruto IS NULL
  OR valor_liquido IS NULL
  OR mdr_rule_snapshot IS NULL;

ALTER TABLE IF EXISTS atendimentos
  ALTER COLUMN valor_bruto SET DEFAULT 0,
  ALTER COLUMN valor_liquido SET DEFAULT 0,
  ALTER COLUMN mdr_rule_snapshot SET DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS atendimentos
  ALTER COLUMN valor_bruto SET NOT NULL,
  ALTER COLUMN valor_liquido SET NOT NULL,
  ALTER COLUMN mdr_rule_snapshot SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_atendimentos_mdr_config'
  ) THEN
    ALTER TABLE atendimentos
      ADD CONSTRAINT fk_atendimentos_mdr_config
      FOREIGN KEY (mdr_config_id) REFERENCES mdr_configs(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_atendimentos_recebimento_previsto
  ON atendimentos(recebimento_previsto);

CREATE INDEX IF NOT EXISTS idx_atendimentos_mdr_config
  ON atendimentos(mdr_config_id);

-- 2) parcelas
ALTER TABLE IF EXISTS parcelas
  ADD COLUMN IF NOT EXISTS valor_bruto numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_liquido numeric(14,2),
  ADD COLUMN IF NOT EXISTS mdr_percent_applied numeric(8,4),
  ADD COLUMN IF NOT EXISTS recebimento_previsto date,
  ADD COLUMN IF NOT EXISTS mdr_rule_snapshot jsonb DEFAULT '{}'::jsonb;

UPDATE parcelas
SET
  valor_bruto = COALESCE(valor_bruto, valor, 0),
  valor_liquido = COALESCE(valor_liquido, valor, 0),
  mdr_rule_snapshot = COALESCE(mdr_rule_snapshot, '{}'::jsonb),
  recebimento_previsto = COALESCE(recebimento_previsto, data_vencimento)
WHERE
  valor_bruto IS NULL
  OR valor_liquido IS NULL
  OR mdr_rule_snapshot IS NULL
  OR recebimento_previsto IS NULL;

ALTER TABLE IF EXISTS parcelas
  ALTER COLUMN valor_bruto SET DEFAULT 0,
  ALTER COLUMN valor_liquido SET DEFAULT 0,
  ALTER COLUMN mdr_rule_snapshot SET DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS parcelas
  ALTER COLUMN valor_bruto SET NOT NULL,
  ALTER COLUMN valor_liquido SET NOT NULL,
  ALTER COLUMN mdr_rule_snapshot SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parcelas_recebimento_previsto
  ON parcelas(recebimento_previsto);

COMMIT;
