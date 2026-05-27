-- Adiciona campos de integração Alter na tabela profiles.
-- alter_bp_id: ID do Business Partner cadastrado na API Alter (ULID).
-- alter_opt_in_status: estado atual do opt-in Núclea, espelha nuclea_opt_in.status da Alter.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS alter_bp_id       TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS alter_opt_in_status TEXT   DEFAULT NULL
    CHECK (alter_opt_in_status IN ('none','pending','active','partial','failed','opted_out'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_alter_bp_id
  ON public.profiles (alter_bp_id)
  WHERE alter_bp_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.alter_bp_id
  IS 'ID do Business Partner na API Alter (ULID). Preenchido por realAlterAdapter.registerBusinessPartner().';

COMMENT ON COLUMN public.profiles.alter_opt_in_status
  IS 'Status do opt-in Núclea (none|pending|active|partial|failed|opted_out). Atualizado pelo webhook alter.';
