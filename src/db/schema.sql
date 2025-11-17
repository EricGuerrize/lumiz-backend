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
