CREATE TABLE IF NOT EXISTS comissoes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  atendimento_id UUID NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
  colaborador_id UUID NOT NULL REFERENCES colaboradores(id),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  valor NUMERIC(10,2) NOT NULL,
  pct_aplicado NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comissoes_user_id ON comissoes(user_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_atendimento_id ON comissoes(atendimento_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_colaborador_id ON comissoes(colaborador_id);

ALTER TABLE comissoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own comissoes" ON comissoes;
CREATE POLICY "users manage own comissoes"
  ON comissoes FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
