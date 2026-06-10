-- Corrige hardening anterior: backend chama is_user_admin via service_role.
-- Mantem anon/authenticated sem acesso direto; apenas service_role pode executar.
GRANT EXECUTE ON FUNCTION public.is_user_admin(uuid) TO service_role;
