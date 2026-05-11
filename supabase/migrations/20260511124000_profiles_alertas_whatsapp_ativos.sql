-- Opt-in para mensagens automáticas do dashboard via WhatsApp.
-- Default false: nenhum usuário recebe alertas automáticos até ativar na tela de Configurações.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS alertas_whatsapp_ativos boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.alertas_whatsapp_ativos IS
  'Se true, envia mensagens automáticas do dashboard via WhatsApp (alertas, lembretes e insights).';
