-- Analytics events for funnel/telemetry
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20),
  user_id UUID,
  source VARCHAR(30) DEFAULT 'backend',
  event VARCHAR(80) NOT NULL,
  properties JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at
  ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event
  ON analytics_events(event);
CREATE INDEX IF NOT EXISTS idx_analytics_events_phone
  ON analytics_events(phone);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id
  ON analytics_events(user_id);

ALTER TABLE IF NOT EXISTS analytics_events ENABLE ROW LEVEL SECURITY;

-- Allow dashboard users to select their own analytics (optional)
CREATE POLICY IF NOT EXISTS users_select_analytics_events
  ON analytics_events
  FOR SELECT
  USING (user_id = auth.uid());

