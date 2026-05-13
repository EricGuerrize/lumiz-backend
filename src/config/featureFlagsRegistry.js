/**
 * Fase 16 — Registry central de feature flags conhecidas.
 *
 * Define a whitelist de flags expostas pelo endpoint `GET /api/config/features`.
 * Flags fora desta lista NÃO são devolvidas ao frontend, mesmo que existam
 * registradas em `feature_flags` ou em env (`FEATURE_FLAGS`/`*_ENABLED`).
 *
 * Para introduzir uma nova flag exposta ao front:
 *   1. adicione a entrada aqui com `default` e `description`;
 *   2. atualize `HANDOFF_BACKEND.md` (matriz feature × endpoint × empty state);
 *   3. quando aplicável, proteja a rota com `featureFlagService.requireFeature(flag)`.
 */

const KNOWN_FLAGS = Object.freeze({
  agentic_router_enabled: {
    default: false,
    description:
      'Fase Agentic: ativa roteamento para LLM+tools; com `agentic_tools_enabled`, intenções fora da lista exclusiva usam `default_agentic_preferred` (ver agentRouterService).'
  },
  agentic_shadow_mode: {
    default: false,
    description: 'Fase Agentic: modo shadow - decide agentic mas executa determinístico (para comparação).'
  },
  agentic_tools_enabled: {
    default: false,
    description: 'Fase Agentic: permite execução de tools pelo agente.'
  },
  agentic_onboarding_enabled: {
    default: false,
    description:
      'Fase Agentic: assistência LLM híbrida no onboarding (ex.: extração JSON da primeira venda em texto livre via `onboardingAgenticAssistService`).'
  },
  profile_builder_enabled: {
    default: false,
    description: 'Fase Agentic: job assíncrono de profile builder.'
  },
  alter_enabled: {
    default: false,
    description: 'Roteamento Alter (recebíveis, antecipação, cobertura, pagar fornecedor com recebível).'
  },
  excel_import: {
    default: false,
    description: 'Importador de planilha Excel (Fase 12 — disponível). Ativada globalmente em 2026-05-09.'
  },
  ofx_export: {
    default: false,
    description: 'Export OFX para contador (Fase 13 — em planejamento).'
  },
  multi_tenant: {
    default: false,
    description: 'Switch de clínica para sócias com múltiplas operações (Fase 14).'
  },
  audit_log: {
    default: false,
    description: 'Histórico de alterações de mutations críticas (Fase 15).'
  },
  posthog_enabled: {
    default: false,
    description: 'Analytics de produto via PostHog (Fase 17).'
  },
  mfa_required: {
    default: false,
    description: 'MFA obrigatório para usuários owner (Fase 18).'
  },
  lgpd_self_service: {
    default: false,
    description: 'Export e exclusão de dados pelo próprio usuário (Fase 19).'
  }
});

function listKnownFlagNames() {
  return Object.keys(KNOWN_FLAGS);
}

function getDefaultsObject() {
  return Object.fromEntries(
    Object.entries(KNOWN_FLAGS).map(([name, meta]) => [name, Boolean(meta.default)])
  );
}

function getDescriptions() {
  return Object.fromEntries(
    Object.entries(KNOWN_FLAGS).map(([name, meta]) => [name, meta.description])
  );
}

module.exports = {
  KNOWN_FLAGS,
  listKnownFlagNames,
  getDefaultsObject,
  getDescriptions
};
