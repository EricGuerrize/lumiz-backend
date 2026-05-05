CREATE TABLE IF NOT EXISTS reminders_sent (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  referencia_id UUID NOT NULL,
  tipo_lembrete VARCHAR(30) NOT NULL,
  enviado_em    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referencia_id, tipo_lembrete)
);

CREATE INDEX IF NOT EXISTS idx_reminders_sent_ref ON reminders_sent(referencia_id, tipo_lembrete);;
