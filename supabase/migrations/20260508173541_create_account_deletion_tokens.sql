-- Fase 19 — LGPD: tokens de confirmação para exclusão de conta.
-- Fluxo: DELETE /api/user/account → gera token TTL 24h, manda email com link.
-- Usuário clica no link → POST /api/user/account/confirm-delete com o token →
-- backend valida (não expirado, não usado) → executa anonimização + soft-delete.
--
-- Confirmação dupla evita exclusão acidental e atende boa prática LGPD.

CREATE TABLE IF NOT EXISTS public.account_deletion_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  requested_ip varchar(45),
  requested_user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_tokens_user
  ON public.account_deletion_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_deletion_tokens_active
  ON public.account_deletion_tokens(token)
  WHERE usado_em IS NULL;

ALTER TABLE public.account_deletion_tokens ENABLE ROW LEVEL SECURITY;

-- Token só pode ser lido pelo dono (segurança extra além do filtro do backend).
DROP POLICY IF EXISTS "users can read own deletion tokens" ON public.account_deletion_tokens;
CREATE POLICY "users can read own deletion tokens"
  ON public.account_deletion_tokens FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Mutações apenas pelo service-role (backend) — usuário não pode criar/deletar
-- token diretamente.

COMMENT ON TABLE public.account_deletion_tokens IS
  'Fase 19 — Tokens de confirmação para exclusão de conta (TTL 24h). Backend cria via service-role após DELETE /api/user/account; usuário confirma via POST /api/user/account/confirm-delete.';
