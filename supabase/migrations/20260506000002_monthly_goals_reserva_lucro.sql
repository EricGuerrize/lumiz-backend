-- Metas opcionais de reserva e lucro por mês (PDF §10 Lumiz-only)

ALTER TABLE public.monthly_goals
  ADD COLUMN IF NOT EXISTS meta_reserva numeric(12, 2),
  ADD COLUMN IF NOT EXISTS meta_lucro numeric(12, 2);

COMMENT ON COLUMN public.monthly_goals.meta_reserva IS 'Meta mensal de poupança/reserva (opcional; null = não definida).';
COMMENT ON COLUMN public.monthly_goals.meta_lucro IS 'Meta mensal de lucro líquido indicativo (opcional; null = não definida).';
