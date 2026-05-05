DROP FUNCTION IF EXISTS public.admin_get_subscription_stats();

CREATE OR REPLACE FUNCTION public.admin_get_subscription_stats()
 RETURNS TABLE(id uuid, nome_clinica character varying, nome_completo text, email character varying, telefone character varying, created_at timestamp with time zone, is_active boolean, status character varying, trial_ends_at timestamp with time zone, plan_expires_at timestamp with time zone, days_remaining integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.nome_clinica,
    p.nome_completo,
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
$function$;;
