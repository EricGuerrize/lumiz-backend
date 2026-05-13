-- NPS conversacional (cap. 13.4 lumizchatbotdesign.md) — respostas explícitas via WhatsApp.

CREATE TABLE IF NOT EXISTS public.conversational_nps_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  phone text NOT NULL,
  score integer NOT NULL CHECK (score >= 0 AND score <= 10),
  comment text,
  raw_message text,
  source text NOT NULL DEFAULT 'whatsapp',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.conversational_nps_responses IS 'NPS 0–10 coletado no WhatsApp (ex.: mensagem "nps: 9 comentário...").';

CREATE INDEX IF NOT EXISTS idx_conversational_nps_created ON public.conversational_nps_responses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversational_nps_user ON public.conversational_nps_responses (user_id);

ALTER TABLE public.conversational_nps_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversational_nps_owner_select
  ON public.conversational_nps_responses
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Inserções partem do backend com service_role (bypass RLS). Sem policy de INSERT para roles JWT.