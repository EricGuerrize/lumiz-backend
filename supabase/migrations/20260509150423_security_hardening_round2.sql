-- Round 2 de hardening: tira `authenticated` das duas funções remanescentes.
--
--  - `is_user_admin(uuid)` é chamada no backend via service-role
--    (admin.routes.js → supabase.rpc(...)). service_role mantém EXECUTE.
--  - `generate_orcamento_numero()` não é chamada por backend nem frontend
--    hoje. Se a feature de orçamentos for ativada, reabilitar para
--    authenticated explicitamente ou trocar para SECURITY INVOKER.

REVOKE EXECUTE ON FUNCTION public.is_user_admin(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_orcamento_numero() FROM authenticated;
