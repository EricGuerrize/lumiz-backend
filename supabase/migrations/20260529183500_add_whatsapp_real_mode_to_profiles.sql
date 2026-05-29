-- Confirmação explícita antes de salvar lançamentos reais via WhatsApp.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS whatsapp_real_mode_confirmed_at timestamptz;

COMMENT ON COLUMN public.profiles.whatsapp_real_mode_confirmed_at IS
  'Quando preenchido, autoriza o bot do WhatsApp a salvar lançamentos financeiros reais depois do onboarding.';
