-- Referência de mercado (Anexo A do lumizchatbotdesign.md) — catálogo global read-only para contexto do agente.
-- Distinto de `procedimentos` (por user_id / estoque da clínica).

CREATE TABLE IF NOT EXISTS public.domain_procedure_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  nome text NOT NULL,
  categoria text,
  preco_min_brl numeric,
  preco_max_brl numeric,
  insumo_pct_min numeric,
  insumo_pct_max numeric,
  margem_tipica text,
  tempo_medio_min integer,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.domain_procedure_benchmarks IS 'Benchmarks de procedimentos estéticos (faixa de preço, insumo, margem) — domínio Lumiz; usado no prompt do agente.';

CREATE INDEX IF NOT EXISTS idx_domain_procedure_benchmarks_active_sort
  ON public.domain_procedure_benchmarks (active, sort_order);

ALTER TABLE public.domain_procedure_benchmarks ENABLE ROW LEVEL SECURITY;

-- Leitura pública anônima: apenas linhas ativas (catálogo de referência não sensível)
CREATE POLICY domain_procedure_benchmarks_select_active
  ON public.domain_procedure_benchmarks
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- Service role bypassa RLS no backend; política acima cobre clientes diretos se necessário.

INSERT INTO public.domain_procedure_benchmarks (slug, nome, categoria, preco_min_brl, preco_max_brl, insumo_pct_min, insumo_pct_max, margem_tipica, tempo_medio_min, sort_order)
VALUES
  ('botox_testa', 'Botox testa', 'Toxina', 800, 1500, 0.25, 0.35, '50-60%', 30, 10),
  ('botox_completa', 'Botox completa (testa+glabella+pés de galinha)', 'Toxina', 1200, 2500, 0.28, 0.32, '55-65%', 45, 20),
  ('preenchimento_labial', 'Preenchimento labial', 'AH', 1500, 3500, 0.35, 0.45, '45-55%', 60, 30),
  ('preenchimento_malar', 'Preenchimento malar', 'AH', 2000, 4000, 0.35, 0.45, '45-55%', 60, 40),
  ('full_face', 'Full Face / Face Frame', 'Combo', 8000, 25000, 0.32, 0.38, '55-65%', 180, 50),
  ('hof_combo', 'HOF (combo harmonização orofacial)', 'Combo', 4500, 15000, 0.35, 0.42, '50-60%', 120, 60),
  ('sculptra', 'Sculptra (bioestimulador)', 'Bioestimulador', 2500, 5000, 0.38, 0.42, '50-55%', 90, 70),
  ('fios_pdo', 'Fios PDO', 'Fios', 1500, 4000, 0.22, 0.28, '60-70%', 60, 80),
  ('laser_co2', 'Laser CO2 fracionado', 'Laser', 1500, 3500, 0.08, 0.12, '75-85%', 60, 90),
  ('microagulhamento', 'Microagulhamento', 'Procedimento', 400, 1500, 0.12, 0.18, '70-80%', 60, 100),
  ('limpeza_pele', 'Limpeza de pele profunda', 'Procedimento', 200, 500, 0.08, 0.12, '80-90%', 60, 110),
  ('criolipo', 'Criolipo / Coolsculpting', 'Aparelho', 1500, 4000, 0.04, 0.08, '80-90%', 60, 120)
ON CONFLICT (slug) DO NOTHING;
