-- Fase 15 — Audit log de mutações críticas
-- Captura quem alterou o quê, quando, e qual o valor antes/depois.
-- Backend escreve via service-role-key (RLS bypass). Usuários autenticados
-- só leem seus próprios registros via RLS.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  clinic_id uuid,
  action varchar(100) NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  ip_address varchar(45),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_created
  ON public.audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON public.audit_log(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_action_created
  ON public.audit_log(action, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own audit log" ON public.audit_log;
CREATE POLICY "users can read own audit log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Mutações apenas pelo service-role (backend). Não criamos policy de
-- INSERT/UPDATE/DELETE para usuários autenticados — audit log é
-- append-only e gerenciado exclusivamente pelo backend.

COMMENT ON TABLE public.audit_log IS
  'Fase 15 — Append-only log de mutações críticas. Escrita via service-role pelo backend (auditLogService). Leitura por usuário autenticado restrita aos próprios registros via RLS.';

COMMENT ON COLUMN public.audit_log.entity_id IS
  'ID da entidade afetada como TEXT (suporta UUIDs e chaves compostas como "goal:2026:5").';

COMMENT ON COLUMN public.audit_log.old_value IS
  'Snapshot do estado anterior (JSONB). NULL em criação. Campos sensíveis mascarados pelo service.';

COMMENT ON COLUMN public.audit_log.new_value IS
  'Snapshot do estado novo (JSONB). NULL em deleção. Campos sensíveis mascarados pelo service.';
