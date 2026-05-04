-- Opt-in WhatsApp para resumo financeiro do mês anterior (cron mensal)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reporte_mensal_whatsapp boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.reporte_mensal_whatsapp IS 'Se true, envia resumo do mês anterior via WhatsApp no cron mensal.';
