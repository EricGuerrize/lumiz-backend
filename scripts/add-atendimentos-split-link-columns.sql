-- ==============================================================
-- Add linked split metadata for mixed-payment sales
-- ==============================================================
-- Safe to run multiple times.

ALTER TABLE IF EXISTS public.atendimentos
  ADD COLUMN IF NOT EXISTS split_group_id uuid,
  ADD COLUMN IF NOT EXISTS split_part smallint,
  ADD COLUMN IF NOT EXISTS split_total_parts smallint;

CREATE INDEX IF NOT EXISTS idx_atendimentos_split_group_id
  ON public.atendimentos(split_group_id);

