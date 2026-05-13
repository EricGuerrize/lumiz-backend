/**
 * Fase Agentic 1.2 — Agent Router Service
 * 
 * Decide se uma mensagem deve ser processada pela rota agentic (LLM + tools)
 * ou pela rota determinística atual (heurística + switch/case).
 * 
 * Suporta shadow mode: faz a decisão agentic mas não executa,
 * apenas loga para comparação com a rota tradicional.
 */

const featureFlagService = require('../featureFlagService');

/** Alinhado a `buildIntentClassificationPrompt` + `routeIntent` em messageController.js */
const AGENTIC_CAPABLE_INTENTS = new Set([
  'registrar_entrada',
  'registrar_saida',
  'consultar_saldo',
  'consultar_historico',
  'relatorio_mensal',
  'comparar_meses',
  'consultar_parcelas',
  'stats_hoje',
  'ranking_procedimentos',
  'marcar_parcela_paga',
  'exportar_dados',
  'consultar_agenda',
  'consultar_meta',
  'insights',
  'buscar_transacao',
  'definir_meta',
  'estoque_entrada',
  'consultar_estoque',
  'mensagem_ambigua'
]);

const DETERMINISTIC_ONLY_INTENTS = new Set([
  'onboarding',
  'mdr_setup',
  'editar_transacao',
  'desfazer',
  'ajuda',
  'exportar',
  'agenda',
  'meta',
  'membro',
  // Fluxos estruturados de membro (não delegar ao LLM)
  'adicionar_numero',
  'listar_numeros',
  'remover_numero',
  // Fluxos sensíveis / pipeline existente (documento, boleto, saudação, prompts de valor isolado)
  'enviar_documento',
  'codigo_boleto',
  'erro',
  'saudacao',
  'ver_dashboard',
  'apenas_valor',
  'apenas_procedimento'
]);

class AgentRouterService {
  constructor() {
    this.shadowMode = true;
    this.decisionLog = [];
  }

  /**
   * Decide qual rota usar para processar a mensagem.
   * 
   * @param {object} params
   * @param {string} params.message - Mensagem do usuário
   * @param {object} params.intent - Intent detectado (heurística ou Gemini)
   * @param {object} params.user - Dados do usuário
   * @param {string} params.phone - Telefone normalizado
   * @param {object} params.context - Contexto adicional
   * @returns {Promise<{route: 'agentic'|'deterministic', reason: string, shadowDecision?: object}>}
   */
  async decide(params) {
    const { message, intent, user, phone, context = {} } = params;
    
    const isAgenticEnabled = await this._isAgenticEnabled(user?.id);
    const decision = {
      timestamp: new Date().toISOString(),
      phone,
      userId: user?.id,
      message: message?.substring(0, 100),
      intentName: intent?.intencao || intent?.intent,
      confidence: intent?.confidence,
      route: 'deterministic',
      reason: '',
      factors: {}
    };

    if (!isAgenticEnabled) {
      decision.reason = 'feature_flag_disabled';
      return this._finalizeDecision(decision);
    }

    if (context.isOnboarding) {
      decision.reason = 'onboarding_active';
      return this._finalizeDecision(decision);
    }

    if (context.hasPendingConfirmation) {
      decision.reason = 'pending_confirmation';
      return this._finalizeDecision(decision);
    }

    if (context.inSpecializedFlow) {
      decision.reason = 'specialized_flow_active';
      decision.factors.flow = context.flowName;
      return this._finalizeDecision(decision);
    }

    const intentName = intent?.intencao || intent?.intent || 'unknown';
    const confidence = Number(
      intent?.confidence ?? intent?.confidence_score ?? intent?.confianca ?? 0
    );
    decision.intentName = intentName;
    decision.confidence = confidence;

    if (DETERMINISTIC_ONLY_INTENTS.has(intentName)) {
      decision.reason = 'deterministic_only_intent';
      return this._finalizeDecision(decision);
    }

    if (AGENTIC_CAPABLE_INTENTS.has(intentName)) {
      decision.route = 'agentic';
      decision.reason = 'agentic_capable_intent';
      return this._finalizeDecision(decision);
    }

    if (this._isComplexQuery(message)) {
      decision.route = 'agentic';
      decision.reason = 'complex_query_detected';
      decision.factors.complexity = this._analyzeComplexity(message);
      return this._finalizeDecision(decision);
    }

    if (confidence < 0.6) {
      decision.route = 'agentic';
      decision.reason = 'low_confidence_intent';
      return this._finalizeDecision(decision);
    }

    // Com flags ativas (fora de shadow): intenções fora da lista exclusiva vão para LLM+tools —
    // comportamento de "agente" padrão; kill switch = desligar `agentic_router_enabled` / `agentic_tools_enabled`.
    decision.route = 'agentic';
    decision.reason = 'default_agentic_preferred';
    return this._finalizeDecision(decision);
  }

  /**
   * Verifica se a feature agentic está habilitada.
   */
  async _isAgenticEnabled(userId) {
    try {
      const shadowEnabled = await featureFlagService.isEnabled('agentic_shadow_mode', userId);
      if (shadowEnabled) {
        this.shadowMode = true;
        return true;
      }
      
      const fullEnabled = await featureFlagService.isEnabled('agentic_router_enabled', userId);
      if (fullEnabled) {
        this.shadowMode = false;
        return true;
      }
      
      return false;
    } catch (err) {
      console.warn('[AgentRouter] Erro ao verificar feature flags:', err.message);
      return false;
    }
  }

  /**
   * Detecta se a query é complexa (compostas, múltiplas perguntas, etc.)
   */
  _isComplexQuery(message) {
    if (!message) return false;
    const text = message.toLowerCase();
    
    const compositeIndicators = [
      /\be\s+(também|depois|ainda)\b/,
      /\bquero\s+.+\s+e\s+.+/,
      /\bmostra\s+.+\s+e\s+.+/,
      /\bcompara/,
      /\bno\s+mês\s+passado/,
      /\bdesde\s+quando/,
      /\bpor\s+que\s+.+\?\s*.+\?/,
      /\?\s*e\s+/
    ];

    for (const pattern of compositeIndicators) {
      if (pattern.test(text)) return true;
    }

    const questionCount = (text.match(/\?/g) || []).length;
    if (questionCount >= 2) return true;

    return false;
  }

  /**
   * Analisa a complexidade da mensagem.
   */
  _analyzeComplexity(message) {
    const factors = {
      questionCount: (message.match(/\?/g) || []).length,
      wordCount: message.split(/\s+/).length,
      hasComparison: /compar|diferença|versus|vs|melhor|pior/i.test(message),
      hasTimeReference: /mês|semana|ano|ontem|hoje|passado|anterior/i.test(message),
      hasMultipleEntities: /e\s+(também|depois|ainda)|,\s*e\s+/i.test(message)
    };
    
    factors.score = 
      factors.questionCount * 2 +
      (factors.hasComparison ? 3 : 0) +
      (factors.hasTimeReference ? 2 : 0) +
      (factors.hasMultipleEntities ? 3 : 0);
    
    return factors;
  }

  /**
   * Finaliza a decisão, logando e retornando o resultado.
   */
  _finalizeDecision(decision) {
    if (this.shadowMode && decision.route === 'agentic') {
      const shadowDecision = { ...decision };
      decision.route = 'deterministic';
      decision.shadowDecision = shadowDecision;
      decision.reason = `shadow_mode:${shadowDecision.reason}`;
    }

    this._logDecision(decision);

    return {
      route: decision.route,
      reason: decision.reason,
      shadowDecision: decision.shadowDecision,
      factors: decision.factors
    };
  }

  /**
   * Loga a decisão para análise posterior.
   */
  _logDecision(decision) {
    this.decisionLog.push(decision);
    
    if (this.decisionLog.length > 1000) {
      this.decisionLog = this.decisionLog.slice(-500);
    }

    if (decision.shadowDecision) {
      console.log('[AgentRouter] Shadow decision:', {
        phone: decision.phone?.slice(-4),
        intent: decision.intentName,
        wouldRoute: decision.shadowDecision.route,
        reason: decision.shadowDecision.reason
      });
    }
  }

  /**
   * Retorna estatísticas das decisões recentes.
   */
  getStats() {
    const total = this.decisionLog.length;
    if (total === 0) return { total: 0 };

    const agentic = this.decisionLog.filter(d => 
      d.route === 'agentic' || d.shadowDecision?.route === 'agentic'
    ).length;

    const reasons = {};
    this.decisionLog.forEach(d => {
      const reason = d.shadowDecision?.reason || d.reason;
      reasons[reason] = (reasons[reason] || 0) + 1;
    });

    return {
      total,
      agentic,
      deterministic: total - agentic,
      agenticPercent: ((agentic / total) * 100).toFixed(1),
      reasons,
      shadowMode: this.shadowMode
    };
  }

  /**
   * Limpa o log de decisões.
   */
  clearLog() {
    this.decisionLog = [];
  }
}

module.exports = new AgentRouterService();
