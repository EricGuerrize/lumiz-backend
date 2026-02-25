-- Fix Supabase security advisor warnings/errors

-- 1. Enable RLS on conversation_runtime_states (ERROR level)
ALTER TABLE public.conversation_runtime_states ENABLE ROW LEVEL SECURITY;

-- Only the service role (backend) accesses this table
CREATE POLICY "service_role_full_access" ON public.conversation_runtime_states
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 2. Fix mutable search_path on trigger/utility functions (WARN level)

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_clinic_members_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_user_insights_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.limpar_tokens_expirados()
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
AS $function$
BEGIN
  DELETE FROM public.setup_tokens
  WHERE expira_em < NOW() OR usado = TRUE;
END;
$function$;

-- match_learned_knowledge needs 'public' in search_path because the vector
-- extension (<=> operator) is installed in the public schema.
CREATE OR REPLACE FUNCTION public.match_learned_knowledge(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  p_clinic_id uuid DEFAULT NULL::uuid
)
  RETURNS TABLE(id uuid, content text, intent_name text, metadata jsonb, similarity double precision)
  LANGUAGE sql
  STABLE
  SET search_path = 'public'
AS $function$
  SELECT
    lk.id,
    lk.content,
    lk.intent_name,
    lk.metadata,
    1 - (lk.embedding <=> query_embedding) AS similarity
  FROM public.learned_knowledge lk
  WHERE
    (lk.is_global = true OR (p_clinic_id IS NOT NULL AND lk.clinic_id = p_clinic_id))
    AND 1 - (lk.embedding <=> query_embedding) > match_threshold
  ORDER BY lk.embedding <=> query_embedding
  LIMIT match_count;
$function$;
