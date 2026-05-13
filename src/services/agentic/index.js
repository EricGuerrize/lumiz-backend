/**
 * Fase Agentic — Módulo principal de serviços agentic.
 * 
 * Exporta os serviços necessários para o comportamento de agente:
 * - agentRouterService: decide rota agentic vs determinística
 * - toolRegistry: registro e execução de tools
 * - conversationContextService: monta contexto unificado para LLM
 * - clinicProfileService: CRUD do perfil rico da clínica
 */

const agentRouterService = require('./agentRouterService');
const toolRegistry = require('./toolRegistry');
const conversationContextService = require('./conversationContextService');
const clinicProfileService = require('./clinicProfileService');
const learnedFactsService = require('./learnedFactsService');
const profileBuilderService = require('./profileBuilderService');
const registerCoreTools = require('./registerDefaultTools');

registerCoreTools(toolRegistry);

module.exports = {
  agentRouterService,
  toolRegistry,
  conversationContextService,
  clinicProfileService,
  learnedFactsService,
  profileBuilderService,
  registerCoreTools
};
