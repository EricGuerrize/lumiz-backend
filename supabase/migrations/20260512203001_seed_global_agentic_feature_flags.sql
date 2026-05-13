-- Fase Agentic — seed global: agente WhatsApp ligado para todos (precedência DB global antes do env vazio).
-- Idempotente: insere linhas ausentes; em seguida força valores desejados em user_id IS NULL.
-- Override por usuário (user_id preenchido) continua com precedência no backend (featureFlagService).

INSERT INTO public.feature_flags (user_id, name, enabled, updated_at)
SELECT NULL, v.name, v.enabled, now()
FROM (
  VALUES
    ('agentic_tools_enabled', true),
    ('agentic_router_enabled', true),
    ('agentic_shadow_mode', false)
) AS v(name, enabled)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.feature_flags f
  WHERE f.user_id IS NULL
    AND f.name = v.name
);

UPDATE public.feature_flags
SET
  enabled = (name <> 'agentic_shadow_mode'),
  updated_at = now()
WHERE user_id IS NULL
  AND name IN (
    'agentic_tools_enabled',
    'agentic_router_enabled',
    'agentic_shadow_mode'
  );
