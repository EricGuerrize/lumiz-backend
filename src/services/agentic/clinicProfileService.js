/**
 * Fase Agentic 1.5 — Clinic Profile Service
 * 
 * CRUD do perfil rico da clínica.
 * O perfil contém patterns, preferences e learned_facts
 * que são injetados no contexto do LLM a cada turno.
 */

const supabase = require('../../db/supabase');

const DEFAULT_PATTERNS = Object.freeze({
  ticket_medio_general: 0,
  ticket_medio_by_procedure: {},
  top_procedures_3m: [],
  seasonality_observed: {},
  monthly_volume_avg: 0,
  payment_mix_observed: {
    pix: 0,
    credit_full: 0,
    credit_installment: 0,
    debit: 0,
    cash: 0
  },
  credit_installment_avg: null,
  default_acquirer: null,
  acquirer_fees: {
    confidence: 'estimate',
    source: 'market_average',
    last_updated: null,
    by_modality: {}
  },
  recurring_costs: [],
  payroll_cycle: null,
  default_delinquency_rate: 0,
  builder_meta: {
    last_data_points_total: 0,
    last_run_reason: null,
    built_at: null
  }
});

const DEFAULT_PREFERENCES = Object.freeze({
  communication_style: 'informal',
  preferred_notification_time: '08:30',
  notify_about: ['cashflow_gap', 'high_payable_due', 'new_top_client']
});

class ClinicProfileService {
  /**
   * Busca o perfil da clínica pelo user_id.
   * 
   * @param {string} userId - ID do usuário
   * @returns {Promise<object|null>} Perfil da clínica ou null
   */
  async getByUserId(userId) {
    if (!userId) return null;

    try {
      const { data, error } = await supabase
        .from('clinic_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return this._normalizeProfile(data);
    } catch (err) {
      console.error('[ClinicProfileService] Erro ao buscar perfil:', err.message);
      return null;
    }
  }

  /**
   * Cria um novo perfil de clínica.
   * 
   * @param {object} profileData
   * @returns {Promise<object>} Perfil criado
   */
  async create(profileData) {
    const {
      userId,
      clinicName,
      clinicType = 'harmonizacao_facial',
      tier = 'standard',
      city,
      professionals = [],
      taxRegime,
      taxBracket,
      patterns = {},
      preferences = {},
      learnedFactsSummary = []
    } = profileData;

    if (!userId) {
      throw new Error('userId is required');
    }

    try {
      const { data, error } = await supabase
        .from('clinic_profiles')
        .insert({
          user_id: userId,
          clinic_name: clinicName,
          clinic_type: clinicType,
          tier,
          city,
          professionals,
          tax_regime: taxRegime,
          tax_bracket: taxBracket,
          patterns: this._mergePatterns(patterns),
          preferences: this._mergePreferences(preferences),
          learned_facts_summary: learnedFactsSummary
        })
        .select()
        .single();

      if (error) throw error;
      return this._normalizeProfile(data);
    } catch (err) {
      console.error('[ClinicProfileService] Erro ao criar perfil:', err.message);
      throw err;
    }
  }

  /**
   * Cria perfil se não existir, ou retorna o existente.
   */
  async getOrCreate(userId, defaults = {}) {
    const existing = await this.getByUserId(userId);
    if (existing) return existing;

    return this.create({
      userId,
      ...defaults
    });
  }

  /**
   * Atualiza um campo específico do perfil.
   * 
   * @param {string} userId - ID do usuário
   * @param {string} field - Campo a atualizar (suporta dot notation: "patterns.ticket_medio")
   * @param {any} value - Novo valor
   * @param {string} [sourceFact] - Fato que originou a atualização
   * @returns {Promise<boolean>} Sucesso
   */
  async updateField(userId, field, value, sourceFact = null) {
    if (!userId || !field) return false;

    try {
      const profile = await this.getOrCreate(userId);
      
      if (field.includes('.')) {
        const [topLevel, ...rest] = field.split('.');
        const nestedKey = rest.join('.');
        
        const currentValue = profile[topLevel] || {};
        this._setNestedValue(currentValue, nestedKey, value);
        
        const { error } = await supabase
          .from('clinic_profiles')
          .update({
            [topLevel]: currentValue,
            profile_version: (profile.profile_version || 0) + 1
          })
          .eq('user_id', userId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('clinic_profiles')
          .update({
            [field]: value,
            profile_version: (profile.profile_version || 0) + 1
          })
          .eq('user_id', userId);

        if (error) throw error;
      }

      if (sourceFact) {
        await this._logFactUpdate(userId, field, value, sourceFact);
      }

      return true;
    } catch (err) {
      console.error('[ClinicProfileService] Erro ao atualizar campo:', err.message);
      return false;
    }
  }

  /**
   * Atualiza o objeto patterns inteiro.
   */
  async updatePatterns(userId, patterns) {
    if (!userId) return false;

    try {
      const profile = await this.getOrCreate(userId);
      const mergedPatterns = this._mergePatterns({
        ...(profile.patterns || {}),
        ...patterns
      });

      const { error } = await supabase
        .from('clinic_profiles')
        .update({
          patterns: mergedPatterns,
          profile_version: (profile.profile_version || 0) + 1
        })
        .eq('user_id', userId);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[ClinicProfileService] Erro ao atualizar patterns:', err.message);
      return false;
    }
  }

  /**
   * Atualiza preferências do usuário.
   */
  async updatePreferences(userId, preferences) {
    if (!userId) return false;

    try {
      const profile = await this.getOrCreate(userId);
      const mergedPreferences = this._mergePreferences({
        ...(profile.preferences || {}),
        ...preferences
      });

      const { error } = await supabase
        .from('clinic_profiles')
        .update({
          preferences: mergedPreferences,
          profile_version: (profile.profile_version || 0) + 1
        })
        .eq('user_id', userId);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[ClinicProfileService] Erro ao atualizar preferences:', err.message);
      return false;
    }
  }

  /**
   * Adiciona um fato aprendido ao resumo do perfil.
   */
  async addLearnedFact(userId, fact, confidence = 0.5) {
    if (!userId || !fact) return false;

    try {
      const profile = await this.getOrCreate(userId);
      const facts = [...(profile.learned_facts_summary || [])];
      
      const existingIndex = facts.findIndex(f => 
        f.fact.toLowerCase() === fact.toLowerCase()
      );

      if (existingIndex >= 0) {
        facts[existingIndex].confidence = Math.max(
          facts[existingIndex].confidence,
          confidence
        );
      } else {
        facts.push({
          fact,
          confidence,
          learned_at: new Date().toISOString()
        });
      }

      const topFacts = facts
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 20);

      const { error } = await supabase
        .from('clinic_profiles')
        .update({
          learned_facts_summary: topFacts,
          profile_version: (profile.profile_version || 0) + 1
        })
        .eq('user_id', userId);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[ClinicProfileService] Erro ao adicionar fato:', err.message);
      return false;
    }
  }

  /**
   * Incrementa contador de data points.
   */
  async incrementDataPoints(userId, count = 1) {
    if (!userId) return false;

    try {
      const { error } = await supabase.rpc('increment_clinic_data_points', {
        p_user_id: userId,
        p_count: count
      });

      if (error) {
        const profile = await this.getByUserId(userId);
        if (profile) {
          await supabase
            .from('clinic_profiles')
            .update({
              data_points_total: (profile.data_points_total || 0) + count
            })
            .eq('user_id', userId);
        }
      }

      return true;
    } catch (err) {
      console.warn('[ClinicProfileService] Erro ao incrementar data points:', err.message);
      return false;
    }
  }

  /**
   * Substitui o resumo de fatos aprendidos.
   *
   * @param {string} userId
   * @param {object[]} facts
   * @returns {Promise<boolean>}
   */
  async setLearnedFactsSummary(userId, facts) {
    if (!userId) return false;

    try {
      const profile = await this.getOrCreate(userId);
      const { error } = await supabase
        .from('clinic_profiles')
        .update({
          learned_facts_summary: Array.isArray(facts) ? facts : [],
          profile_version: (profile.profile_version || 0) + 1
        })
        .eq('user_id', userId);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[ClinicProfileService] Erro ao salvar resumo de fatos:', err.message);
      return false;
    }
  }

  /**
   * Atualiza taxas de adquirente.
   */
  async updateAcquirerFees(userId, acquirer, fees, confidence = 'clinic_reported') {
    if (!userId || !acquirer) return false;

    try {
      const profile = await this.getOrCreate(userId);
      const patterns = profile.patterns || {};
      
      patterns.default_acquirer = acquirer;
      patterns.acquirer_fees = {
        confidence,
        source: confidence === 'verified' ? 'alter_api' : 'user_input',
        last_updated: new Date().toISOString(),
        by_modality: {
          ...(patterns.acquirer_fees?.by_modality || {}),
          ...fees
        }
      };

      return await this.updatePatterns(userId, patterns);
    } catch (err) {
      console.error('[ClinicProfileService] Erro ao atualizar taxas:', err.message);
      return false;
    }
  }

  /**
   * Helper: define valor em objeto aninhado.
   */
  _setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  /**
   * Loga atualização de fato para auditoria.
   */
  async _logFactUpdate(userId, field, value, sourceFact) {
    try {
      console.log('[ClinicProfileService] Fact update:', {
        userId: userId?.slice(-8),
        field,
        sourceFact
      });
    } catch (err) {
    }
  }

  /**
   * Formata o perfil para injeção no prompt.
   */
  formatForPrompt(profile) {
    if (!profile) return 'Perfil da clínica não disponível.';

    const lines = [];
    
    if (profile.clinic_name) {
      lines.push(`Clínica: ${profile.clinic_name}`);
    }
    if (profile.clinic_type) {
      lines.push(`Tipo: ${profile.clinic_type}`);
    }
    if (profile.city) {
      lines.push(`Cidade: ${profile.city}`);
    }

    const p = this._mergePatterns(profile.patterns || {});
    
    if (p.ticket_medio_general) {
      lines.push(`Ticket médio: R$ ${p.ticket_medio_general.toLocaleString('pt-BR')}`);
    }
    if (p.monthly_volume_avg) {
      lines.push(`Volume mensal: ${p.monthly_volume_avg} atendimentos`);
    }
    if (p.default_acquirer) {
      lines.push(`Adquirente: ${p.default_acquirer}`);
      if (p.acquirer_fees?.confidence) {
        lines.push(`Confiança das taxas: ${p.acquirer_fees.confidence}`);
      }
    }

    if (p.top_procedures_3m?.length > 0) {
      const top = p.top_procedures_3m.slice(0, 3)
        .map(pr => pr.procedure)
        .join(', ');
      lines.push(`Top procedimentos: ${top}`);
    }

    if (p.recurring_costs?.length > 0) {
      const recurring = p.recurring_costs
        .slice(0, 2)
        .map(cost => `${cost.vendor} (${cost.payment_pattern})`)
        .join(', ');
      lines.push(`Custos recorrentes: ${recurring}`);
    }

    const strongestMonth = Object.entries(p.seasonality_observed || {})
      .sort((a, b) => b[1] - a[1])[0];
    if (strongestMonth) {
      lines.push(`Sazonalidade mais forte: ${strongestMonth[0]}`);
    }

    const facts = profile.learned_facts_summary || [];
    if (facts.length > 0) {
      lines.push('');
      lines.push('Fatos aprendidos:');
      facts.slice(0, 5).forEach(f => {
        lines.push(`- ${f.fact}`);
      });
    }

    return lines.join('\n');
  }

  _normalizeProfile(profile) {
    if (!profile) return null;

    return {
      ...profile,
      patterns: this._mergePatterns(profile.patterns || {}),
      preferences: this._mergePreferences(profile.preferences || {}),
      learned_facts_summary: Array.isArray(profile.learned_facts_summary)
        ? profile.learned_facts_summary
        : []
    };
  }

  _mergePatterns(patterns) {
    return {
      ...DEFAULT_PATTERNS,
      ...(patterns || {}),
      payment_mix_observed: {
        ...DEFAULT_PATTERNS.payment_mix_observed,
        ...(patterns?.payment_mix_observed || {})
      },
      acquirer_fees: {
        ...DEFAULT_PATTERNS.acquirer_fees,
        ...(patterns?.acquirer_fees || {}),
        by_modality: {
          ...DEFAULT_PATTERNS.acquirer_fees.by_modality,
          ...(patterns?.acquirer_fees?.by_modality || {})
        }
      },
      builder_meta: {
        ...DEFAULT_PATTERNS.builder_meta,
        ...(patterns?.builder_meta || {})
      }
    };
  }

  _mergePreferences(preferences) {
    return {
      ...DEFAULT_PREFERENCES,
      ...(preferences || {})
    };
  }
}

module.exports = new ClinicProfileService();
