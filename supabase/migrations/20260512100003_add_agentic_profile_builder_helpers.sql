-- Fase Agentic 3.1 — Helpers do profile builder
-- Observação: o CLI `supabase migration new` travou localmente nesta máquina;
-- este arquivo segue o próximo timestamp sequencial já existente no projeto.

CREATE OR REPLACE FUNCTION public.increment_clinic_data_points(
  p_user_id uuid,
  p_count int DEFAULT 1
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.clinic_profiles
  SET
    data_points_total = COALESCE(data_points_total, 0) + GREATEST(COALESCE(p_count, 1), 0),
    updated_at = now()
  WHERE user_id = p_user_id;
$$;

COMMENT ON FUNCTION public.increment_clinic_data_points(uuid, int) IS
  'Fase Agentic 3.1 — Incrementa data_points_total do perfil rico da clínica.';
