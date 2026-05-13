-- Fase Agentic — hardening de funções para satisfazer advisor do Supabase
-- Evita search_path mutável em funções criadas pelas migrations agentic.

ALTER FUNCTION public.update_clinic_profiles_updated_at()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.increment_clinic_data_points(uuid, int)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.match_learned_facts_agentic(vector, float, int, uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_learned_facts_agentic_updated_at()
  SET search_path = public, pg_catalog;
