-- LGPD compliance: prova de consentimento persistida em profiles.
--
-- Antes desta migration, o "Autorizo" do onboarding via WhatsApp só era
-- registrado em analytics_events. LGPD Art. 8º §1º exige que o controlador
-- mantenha PROVA do consentimento com timestamp e versão dos termos vigentes.
--
-- Esta migration adiciona 5 colunas em profiles:
--   - consent_given_at: timestamp do "Autorizo" mais recente.
--   - terms_version: versão dos Termos de Uso aceita (string semver-like ou data).
--   - privacy_version: versão da Política de Privacidade aceita.
--   - consent_ip: IP de origem (best-effort, x-forwarded-for honored).
--   - consent_user_agent: user-agent (truncado a 500 chars no service layer).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS consent_given_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version    text,
  ADD COLUMN IF NOT EXISTS privacy_version  text,
  ADD COLUMN IF NOT EXISTS consent_ip       text,
  ADD COLUMN IF NOT EXISTS consent_user_agent text;

-- Índice parcial: consultas frequentes do tipo "tem consent ativo?" filtram
-- por terms_version atual. Mantém índice pequeno excluindo perfis sem consent.
CREATE INDEX IF NOT EXISTS idx_profiles_consent_versions
  ON public.profiles(terms_version, privacy_version)
  WHERE consent_given_at IS NOT NULL;

COMMENT ON COLUMN public.profiles.consent_given_at IS
  'LGPD — timestamp do consentimento mais recente. Atualizado quando termos/privacidade mudam de versão.';
COMMENT ON COLUMN public.profiles.terms_version IS
  'LGPD — versão dos Termos de Uso aceita (env LUMIZ_TERMS_VERSION).';
COMMENT ON COLUMN public.profiles.privacy_version IS
  'LGPD — versão da Política de Privacidade aceita (env LUMIZ_PRIVACY_VERSION).';
COMMENT ON COLUMN public.profiles.consent_ip IS
  'LGPD — IP de origem do consentimento (x-forwarded-for honored).';
COMMENT ON COLUMN public.profiles.consent_user_agent IS
  'LGPD — user-agent do consentimento (truncado a 500 chars).';
