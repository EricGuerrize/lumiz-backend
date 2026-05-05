-- Função segura para verificar se um user_id é admin
-- Roda com SECURITY DEFINER, bypassa RLS independente do key do cliente
CREATE OR REPLACE FUNCTION is_user_admin(p_user_id uuid)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = p_user_id AND role = 'admin'
  );
$$;;
