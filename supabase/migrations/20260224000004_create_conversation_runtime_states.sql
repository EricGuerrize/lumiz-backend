CREATE TABLE IF NOT EXISTS conversation_runtime_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  flow VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (phone, flow)
);

CREATE INDEX IF NOT EXISTS idx_conversation_runtime_states_phone
  ON conversation_runtime_states(phone);

CREATE INDEX IF NOT EXISTS idx_conversation_runtime_states_expires_at
  ON conversation_runtime_states(expires_at);
