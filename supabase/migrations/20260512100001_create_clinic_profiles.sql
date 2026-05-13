-- Fase Agentic 1.2 — Perfil rico da clínica
-- Schema baseado no Anexo C do documento de design.
-- Contém patterns, preferences e learned_facts injetados no contexto LLM a cada turno.

CREATE TABLE IF NOT EXISTS public.clinic_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Vínculo com profiles (usuário principal da clínica)
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Dados básicos da clínica
  clinic_name varchar(255),
  clinic_type varchar(64) DEFAULT 'harmonizacao_facial',
  -- clinic_type: harmonizacao_facial, estetica_geral, odontologia_estetica, dermatologia, outro
  tier varchar(32) DEFAULT 'standard',
  -- tier: standard, premium, enterprise
  city varchar(128),
  
  -- Profissionais (array de objetos)
  professionals jsonb DEFAULT '[]'::jsonb,
  -- [{ "name": "Eric", "type": "dentista", "council": "CRO-SP" }]
  
  -- Regime tributário
  tax_regime varchar(32),
  -- tax_regime: simples_nacional, lucro_presumido, lucro_real, mei
  tax_bracket int,
  
  -- Padrões observados (atualizado pelo profile builder)
  patterns jsonb DEFAULT '{}'::jsonb,
  /*
  {
    "ticket_medio_general": 4500,
    "ticket_medio_by_procedure": { "full_face": 15000, "botox": 1200 },
    "top_procedures_3m": [{ "procedure": "Full Face", "count": 8, "revenue_share": 0.42 }],
    "seasonality_observed": { "jan": 0.7, "set": 1.3 },
    "monthly_volume_avg": 35,
    "payment_mix_observed": { "pix": 0.34, "credit_installment": 0.47 },
    "credit_installment_avg": 8.5,
    "default_acquirer": "Itau",
    "acquirer_fees": {
      "confidence": "estimate",
      "source": "market_average",
      "last_updated": "2026-05-11",
      "by_modality": { "pix": 0.0, "debit": 0.018, "credit_12x": 0.049 }
    },
    "recurring_costs": [{ "vendor": "Biogelis", "frequency": "monthly", "amount_avg": 16500 }],
    "payroll_cycle": { "type": "mixed_pj_clt", "payment_day": 5, "monthly_total_avg": 12000 },
    "default_delinquency_rate": 0.08
  }
  */
  
  -- Preferências do usuário
  preferences jsonb DEFAULT '{}'::jsonb,
  /*
  {
    "communication_style": "informal",
    "preferred_notification_time": "08:30",
    "notify_about": ["cashflow_gap", "high_payable_due", "new_top_client"]
  }
  */
  
  -- Fatos aprendidos inline (resumo; detalhes em learned_facts_agentic)
  learned_facts_summary jsonb DEFAULT '[]'::jsonb,
  /*
  [
    { "fact": "Biogelis sempre é boleto 4x (30/60/90/120d)", "confidence": 0.95 },
    { "fact": "Setembro é pico de vendas - 30% acima da média", "confidence": 0.7 }
  ]
  */
  
  -- Metadata do perfil
  profile_version int DEFAULT 1,
  data_points_total int DEFAULT 0,
  last_builder_run_at timestamptz,
  
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Constraint de unicidade por usuário
  UNIQUE(user_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_clinic_profiles_user_id 
  ON public.clinic_profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_clinic_profiles_clinic_type 
  ON public.clinic_profiles(clinic_type);

-- RLS
ALTER TABLE public.clinic_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own clinic profile" ON public.clinic_profiles;
CREATE POLICY "users can read own clinic profile"
  ON public.clinic_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users can update own clinic profile" ON public.clinic_profiles;
CREATE POLICY "users can update own clinic profile"
  ON public.clinic_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_clinic_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clinic_profiles_updated_at ON public.clinic_profiles;
CREATE TRIGGER clinic_profiles_updated_at
  BEFORE UPDATE ON public.clinic_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_clinic_profiles_updated_at();

COMMENT ON TABLE public.clinic_profiles IS
  'Fase Agentic 1.2 — Perfil rico da clínica com patterns, preferences e learned_facts. Injetado no contexto LLM a cada turno.';
