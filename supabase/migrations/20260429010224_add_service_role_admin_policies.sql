-- Permite que service_role leia todos os profiles (para endpoints admin do backend)
CREATE POLICY "service_role_select_profiles"
  ON profiles FOR SELECT TO service_role USING (true);

-- Permite que service_role leia todos os user_roles (para requireAdmin middleware)
CREATE POLICY "service_role_select_user_roles"
  ON user_roles FOR SELECT TO service_role USING (true);

-- Função segura para admin buscar todas as clínicas com status de assinatura
CREATE OR REPLACE FUNCTION admin_get_subscription_stats()
RETURNS TABLE (
  id              uuid,
  nome_clinica    varchar,
  email           varchar,
  telefone        varchar,
  created_at      timestamptz,
  is_active       boolean,
  status          varchar,
  trial_ends_at   timestamptz,
  plan_expires_at timestamptz,
  days_remaining  int
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT
    p.id,
    p.nome_clinica,
    p.email,
    p.telefone,
    p.created_at,
    p.is_active,
    s.status,
    s.trial_ends_at,
    s.plan_expires_at,
    GREATEST(0, EXTRACT(DAY FROM (s.trial_ends_at - NOW()))::int) AS days_remaining
  FROM profiles p
  LEFT JOIN subscriptions s ON s.clinic_id = p.id
  ORDER BY p.created_at DESC
  LIMIT 500;
$$;;
