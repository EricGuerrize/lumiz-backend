CREATE TABLE IF NOT EXISTS colaboradores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nome VARCHAR(255) NOT NULL,
  funcao VARCHAR(100),
  comissao_pct NUMERIC(5,2) DEFAULT 0,
  comissao_fixa NUMERIC(10,2) DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_colaboradores_user_id ON colaboradores(user_id);

ALTER TABLE colaboradores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own colaboradores" ON colaboradores;
CREATE POLICY "users manage own colaboradores"
  ON colaboradores FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
