-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de categorias
CREATE TABLE IF NOT EXISTS categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  type VARCHAR(10) CHECK (type IN ('entrada', 'saida')),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Tabela de transações
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('entrada', 'saida')),
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_categories_user_id ON categories(user_id);

-- Progresso do onboarding
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  user_id UUID,
  stage VARCHAR(50) DEFAULT 'phase1',
  phase SMALLINT DEFAULT 1,
  steps JSONB DEFAULT '[]'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  progress_percent INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP,
  ab_variant VARCHAR(30),
  resume_token UUID DEFAULT gen_random_uuid(),
  meta JSONB DEFAULT '{}'::jsonb,
  nps_score NUMERIC,
  nps_feedback TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_progress_phone
  ON onboarding_progress(phone);
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_stage
  ON onboarding_progress(stage);

-- Configurações de MDR
CREATE TABLE IF NOT EXISTS mdr_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  phone VARCHAR(20),
  source VARCHAR(20) DEFAULT 'manual',
  provider VARCHAR(50),
  bandeiras JSONB DEFAULT '[]'::jsonb,
  tipos_venda JSONB DEFAULT '{}'::jsonb,
  parcelas JSONB DEFAULT '{}'::jsonb,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(30) DEFAULT 'pending_confirmation',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdr_configs_user
  ON mdr_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_mdr_configs_phone
  ON mdr_configs(phone);

-- Jobs de OCR para taxas de cartão
CREATE TABLE IF NOT EXISTS ocr_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  phone VARCHAR(20),
  provider VARCHAR(50),
  source_url TEXT,
  status VARCHAR(30) DEFAULT 'pending',
  extracted_data JSONB,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status
  ON ocr_jobs(status);

-- Nudges e lembretes inteligentes do onboarding
CREATE TABLE IF NOT EXISTS onboarding_nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  metadata JSONB DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMP DEFAULT NOW(),
  last_attempt_at TIMESTAMP,
  sent_at TIMESTAMP,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (phone, type)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_nudges_status
  ON onboarding_nudges(status);

-- Insights automatizados
CREATE TABLE IF NOT EXISTS user_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  phone VARCHAR(20),
  title VARCHAR(120),
  summary TEXT,
  insights JSONB DEFAULT '[]'::jsonb,
  sent_via VARCHAR(30),
  sent_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_insights_user
  ON user_insights(user_id);

-- ===================================================================
-- Row Level Security policies (Dashboard direto via Supabase)
-- ===================================================================

ALTER TABLE IF NOT EXISTS transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS mdr_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS ocr_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS user_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS users_select_transactions
  ON transactions
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS users_select_categories
  ON categories
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS users_select_onboarding_progress
  ON onboarding_progress
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS users_select_mdr_configs
  ON mdr_configs
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS users_select_ocr_jobs
  ON ocr_jobs
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS users_select_insights
  ON user_insights
  FOR SELECT
  USING (user_id = auth.uid());
