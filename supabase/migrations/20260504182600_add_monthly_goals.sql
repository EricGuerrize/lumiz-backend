
CREATE TABLE IF NOT EXISTS monthly_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  meta_receita NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, year, month)
);
ALTER TABLE monthly_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own goals" ON monthly_goals
  FOR ALL USING (auth.uid() = user_id);
;
