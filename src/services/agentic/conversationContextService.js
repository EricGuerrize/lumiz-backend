/**
 * Fase Agentic 1.4 — Conversation Context Service
 * 
 * Monta o contexto unificado para o LLM a cada turno.
 * Agrega: perfil da clínica, histórico recente, fatos aprendidos,
 * estado da conversa, flags e capacidades disponíveis.
 */

const supabase = require('../../db/supabase');
const conversationHistoryService = require('../conversationHistoryService');
const conversationRuntimeStateService = require('../conversationRuntimeStateService');
const featureFlagService = require('../featureFlagService');
const clinicProfileService = require('./clinicProfileService');
const learnedFactsService = require('./learnedFactsService');
const domainProcedureBenchmarkService = require('./domainProcedureBenchmarkService');
  constructor() {
    this.contextCache = new Map();
    this.CACHE_TTL_MS = 30_000;
  }

  /**
   * Monta o contexto completo para um turno de conversa.
   * 
   * @param {object} params
   * @param {string} params.phone - Telefone normalizado
   * @param {object} params.user - Dados do usuário
   * @param {string} params.message - Mensagem atual
   * @param {object} [params.intent] - Intent detectado (se disponível)
   * @returns {Promise<object>} Contexto unificado
   */
  async buildContext(params) {
    const { phone, user, message, intent } = params;
    const userId = user?.id;
    
    const cacheKey = `${phone}:${userId || 'anon'}`;
    const cached = this.contextCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && !params.forceRefresh) {
      return {
        ...cached.context,
        currentMessage: message,
        currentIntent: intent,
        timestamp: new Date().toISOString()
      };
    }

    const clinicProfile = await this._getClinicProfile(userId);

    const [
      recentHistory,
      runtimeStates,
      userFlags,
      learnedFacts,
      domainBenchmarkRows
    ] = await Promise.all([
      this._getRecentHistory(userId, phone),
      this._getRuntimeStates(phone),
      this._getUserFlags(userId),
      this._getLearnedFacts({
        userId,
        clinicId: clinicProfile?.id,
        query: message
      }),
      domainProcedureBenchmarkService.listActiveForPrompt()
    ]);

    const domainBenchmarksText = domainProcedureBenchmarkService.formatBenchmarkBlock(domainBenchmarkRows);

    const context = {
      user: this._buildUserContext(user),
      clinic: clinicProfile,
      conversation: {
        recentHistory,
        runtimeStates,
        pendingActions: this._extractPendingActions(runtimeStates),
        turnCount: recentHistory.length
      },
      knowledge: {
        learnedFacts,
        factCount: learnedFacts.length,
        domainBenchmarksText
      },
      capabilities: {
        flags: userFlags,
        availableTools: this._getAvailableTools(userFlags)
      },
      meta: {
        builtAt: new Date().toISOString(),
        contextVersion: '1.0'
      }
    };

    this.contextCache.set(cacheKey, {
      context,
      expiresAt: Date.now() + this.CACHE_TTL_MS
    });

    return {
      ...context,
      currentMessage: message,
      currentIntent: intent,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Constrói contexto do usuário.
   */
  _buildUserContext(user) {
    if (!user) return null;
    return {
      id: user.id,
      nome: user.nome_completo || user.nome,
      clinica: user.nome_clinica,
      telefone: user.telefone,
      tipoClinica: user.tipo_clinica,
      ticketMedio: user.ticket_medio,
      procedimentosMes: user.procedimentos_mes,
      cidade: user.cidade,
      isActive: user.is_active,
      alertasAtivos: user.alertas_whatsapp_ativos,
      createdAt: user.created_at
    };
  }

  /**
   * Busca o perfil rico da clínica.
   */
  async _getClinicProfile(userId) {
    if (!userId) return null;
    try {
      return await clinicProfileService.getByUserId(userId);
    } catch (err) {
      console.warn('[ContextService] Erro ao buscar clinic profile:', err.message);
      return null;
    }
  }

  /**
   * Busca histórico recente da conversa.
   */
  async _getRecentHistory(userId, phone) {
    try {
      if (userId) {
        const history = await conversationHistoryService.getRecentHistory(userId, 10);
        return history.map(h => ({
          role: 'user',
          content: h.user_message,
          intent: h.intent,
          botResponse: h.bot_response,
          timestamp: h.created_at
        }));
      }
      return [];
    } catch (err) {
      console.warn('[ContextService] Erro ao buscar histórico:', err.message);
      return [];
    }
  }

  /**
   * Busca estados de runtime ativos.
   */
  async _getRuntimeStates(phone) {
    try {
      const states = await conversationRuntimeStateService.getAllActive(phone);
      const statesMap = {};
      (states || []).forEach(s => {
        statesMap[s.flow] = s.payload;
      });
      return statesMap;
    } catch (err) {
      console.warn('[ContextService] Erro ao buscar runtime states:', err.message);
      return {};
    }
  }

  /**
   * Extrai ações pendentes dos estados de runtime.
   */
  _extractPendingActions(runtimeStates) {
    const pending = [];
    
    if (runtimeStates.awaiting_payment_method) {
      pending.push({ type: 'awaiting_input', field: 'payment_method' });
    }
    if (runtimeStates.awaiting_installments) {
      pending.push({ type: 'awaiting_input', field: 'installments' });
    }
    if (runtimeStates.pending_transaction_confirmation) {
      pending.push({ type: 'awaiting_confirmation', entity: 'transaction' });
    }
    if (runtimeStates.pending_document_confirmation) {
      pending.push({ type: 'awaiting_confirmation', entity: 'document' });
    }
    if (runtimeStates.agentic_confirm) {
      pending.push({ type: 'awaiting_confirmation', entity: 'agentic_tool' });
    }
    if (runtimeStates.mdr_setup) {
      pending.push({ type: 'specialized_flow', flow: 'mdr_setup' });
    }

    return pending;
  }
  async _getUserFlags(userId) {
    try {
      const flags = await featureFlagService.listForUser(userId);
      return {
        agenticEnabled: flags.agentic_router_enabled || false,
        alterEnabled: flags.alter_enabled || false,
        excelImport: flags.excel_import || false
      };
    } catch (err) {
      console.warn('[ContextService] Erro ao buscar flags:', err.message);
      return {};
    }
  }

  /**
   * Busca fatos aprendidos da clínica.
   */
  async _getLearnedFacts({ userId, clinicId, query }) {
    if (!userId) return [];
    
    try {
      if (clinicId && query) {
        const semanticMatches = await learnedFactsService.searchFacts({
          clinicId,
          query,
          matchThreshold: 0.72,
          matchCount: 5
        });

        if (semanticMatches.length > 0) {
          return semanticMatches;
        }
      }

      let factsQuery = supabase
        .from('learned_facts_agentic')
        .select('id, fact, fact_type, confidence')
        .eq('is_active', true)
        .order('confidence', { ascending: false })
        .limit(10);

      factsQuery = clinicId
        ? factsQuery.eq('clinic_id', clinicId)
        : factsQuery.eq('user_id', userId);

      const { data, error } = await factsQuery;

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.warn('[ContextService] Erro ao buscar learned facts:', err.message);
      return [];
    }
  }

  /**
   * Retorna tools disponíveis com base nas flags.
   */
  _getAvailableTools(flags) {
    const tools = [
      'register_sale',
      'register_cost',
      'register_acquirer_fees',
      'get_clinic_profile',
      'update_clinic_profile',
      'project_cashflow_30d',
      'calculate_net_value',
      'calculate_margin',
      'compare_machine_fees',
      'get_benchmark',
      'search_clinic_history'
    ];

    return tools;
  }

  /**
   * Formata o contexto para injeção no prompt do LLM.
   */
  formatForPrompt(context) {
    const parts = [];

    if (context.user) {
      parts.push(`## Usuário
- Nome: ${context.user.nome || 'Não informado'}
- Clínica: ${context.user.clinica || 'Não informada'}
- Tipo: ${context.user.tipoClinica || 'Não informado'}
- Cidade: ${context.user.cidade || 'Não informada'}`);
    }

    if (context.clinic?.patterns) {
      const p = context.clinic.patterns;
      parts.push(`## Perfil da Clínica
- Ticket médio: R$ ${p.ticket_medio_general || 'N/A'}
- Volume mensal: ${p.monthly_volume_avg || 'N/A'} atendimentos
- Mix pagamento: ${this._formatPaymentMix(p.payment_mix_observed)}
- Adquirente padrão: ${p.default_acquirer || 'N/A'}`);
    }

    if (context.knowledge?.learnedFacts?.length > 0) {
      parts.push(`## Fatos Aprendidos`);
      context.knowledge.learnedFacts.slice(0, 5).forEach(f => {
        parts.push(`- ${f.fact} (confiança: ${(f.confidence * 100).toFixed(0)}%)`);
      });
    }

    if (context.knowledge?.domainBenchmarksText) {
      parts.push(context.knowledge.domainBenchmarksText);
    }

    if (context.conversation?.pendingActions?.length > 0) {
      parts.push(`## Ações Pendentes`);
      context.conversation.pendingActions.forEach(a => {
        parts.push(`- ${a.type}: ${a.field || a.entity || a.flow}`);
      });
    }

    return parts.join('\n\n');
  }

  /**
   * Formata mix de pagamento para exibição.
   */
  _formatPaymentMix(mix) {
    if (!mix) return 'N/A';
    const parts = [];
    if (mix.pix) parts.push(`PIX ${(mix.pix * 100).toFixed(0)}%`);
    if (mix.credit_installment) parts.push(`Crédito parcelado ${(mix.credit_installment * 100).toFixed(0)}%`);
    if (mix.debit) parts.push(`Débito ${(mix.debit * 100).toFixed(0)}%`);
    return parts.join(', ') || 'N/A';
  }

  /**
   * Invalida o cache para um usuário/telefone.
   */
  invalidateCache(phone, userId) {
    const cacheKey = `${phone}:${userId || 'anon'}`;
    this.contextCache.delete(cacheKey);
  }

  /**
   * Limpa todo o cache.
   */
  clearCache() {
    this.contextCache.clear();
  }
}

module.exports = new ConversationContextService();
