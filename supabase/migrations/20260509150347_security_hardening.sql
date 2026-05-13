-- Security hardening (Supabase Advisor — 4 ERRORS + 3 WARNs).
--
-- Endereçamos:
--   1. RLS desabilitada em `subscriptions` (qualquer authenticated podia ler/
--      modificar assinaturas alheias).
--   2. 3 views (`view_financial_ledger`, `view_finance_balance`,
--      `view_monthly_report`) usando SECURITY DEFINER — bypassa RLS de
--      atendimentos/contas_pagar.
--   3. `exec_sql_readonly` exposta a `anon` — executa SQL arbitrário
--      (filtros regex são burláveis). Risco enorme para um endpoint público.
--   4. `admin_get_subscription_stats` exposta a `anon`/`authenticated` —
--      vaza dados de TODAS as clínicas.
--   5. `is_user_admin` / `generate_orcamento_numero` expostas a `anon` sem
--      necessidade.
--   6. `match_learned_knowledge` com search_path mutável.
--
-- O backend (`db/supabase.js`) usa service-role key; service_role bypassa
-- RLS e mantém EXECUTE em todas as funções. Nada operacional quebra.

-- ---------------------------------------------------------------------------
-- 1. subscriptions: RLS + policy
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own subscription" ON public.subscriptions;
CREATE POLICY "users read own subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (clinic_id = (SELECT auth.uid()));

-- Mutações (insert/update/delete) ficam restritas a service_role
-- (backend). Não criamos policies WITH CHECK para usuário comum.

COMMENT ON TABLE public.subscriptions IS
  'RLS: usuário lê apenas o próprio (clinic_id = auth.uid()). Mutações via service-role apenas.';

-- ---------------------------------------------------------------------------
-- 2. Views: SECURITY INVOKER em vez de SECURITY DEFINER
-- ---------------------------------------------------------------------------
-- Com security_invoker=on, a view passa a respeitar a RLS das tabelas-base
-- (atendimentos, contas_pagar — ambas com RLS habilitada). O usuário só
-- enxerga as próprias linhas.
ALTER VIEW public.view_financial_ledger SET (security_invoker = on);
ALTER VIEW public.view_finance_balance SET (security_invoker = on);
ALTER VIEW public.view_monthly_report SET (security_invoker = on);

COMMENT ON VIEW public.view_financial_ledger IS
  'security_invoker=on: respeita RLS de atendimentos/contas_pagar; usuário só vê próprias linhas.';

-- ---------------------------------------------------------------------------
-- 3. exec_sql_readonly: REVOKE de anon/authenticated
-- ---------------------------------------------------------------------------
-- Função executa SELECT arbitrário. Os filtros regex são burláveis
-- (obfuscação, comentários, etc.) e abrem acesso a auth.users, secrets,
-- etc. Mantemos só para service-role.
REVOKE EXECUTE ON FUNCTION public.exec_sql_readonly(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.exec_sql_readonly(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.exec_sql_readonly(text) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. admin_get_subscription_stats: REVOKE
-- ---------------------------------------------------------------------------
-- Lista clínicas e assinaturas de TODOS os usuários. Backend chama via
-- service-role na rota admin protegida.
REVOKE EXECUTE ON FUNCTION public.admin_get_subscription_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_subscription_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_subscription_stats() FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5. is_user_admin: REVOKE de anon (mantém em authenticated por
--    compatibilidade — backend usa via service-role mesmo)
-- ---------------------------------------------------------------------------
-- A função consulta `user_roles`. Não há razão para `anon` consultá-la.
REVOKE EXECUTE ON FUNCTION public.is_user_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_user_admin(uuid) FROM anon;

-- ---------------------------------------------------------------------------
-- 6. generate_orcamento_numero: REVOKE de anon
-- ---------------------------------------------------------------------------
-- Usa auth.uid() — só faz sentido para authenticated. Anon não deve chamar.
REVOKE EXECUTE ON FUNCTION public.generate_orcamento_numero() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_orcamento_numero() FROM anon;

-- ---------------------------------------------------------------------------
-- 7. match_learned_knowledge: fixar search_path
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.match_learned_knowledge(vector, double precision, integer, uuid)
  SET search_path = public, pg_catalog;
