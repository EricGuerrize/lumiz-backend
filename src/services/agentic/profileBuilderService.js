/**
 * Fase Agentic 3.3 — Profile Builder Service
 *
 * Responsabilidade:
 * - recalcular campos derivados do perfil rico da clínica;
 * - transformar lançamentos em padrões persistentes;
 * - gerar fatos aprendidos consumíveis pelo agente.
 */

const supabase = require('../../db/supabase');
const mdrService = require('../mdrService');
const sazonalidadeService = require('../sazonalidadeService');
const clientePerfilService = require('../clientePerfilService');
const clinicProfileService = require('./clinicProfileService');
const learnedFactsService = require('./learnedFactsService');

function monthKeyToLabel(monthKey) {
  const month = String(monthKey || '').slice(5, 7);
  const labels = {
    '01': 'jan',
    '02': 'fev',
    '03': 'mar',
    '04': 'abr',
    '05': 'mai',
    '06': 'jun',
    '07': 'jul',
    '08': 'ago',
    '09': 'set',
    '10': 'out',
    '11': 'nov',
    '12': 'dez'
  };
  return labels[month] || monthKey;
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function normalizeClinicType(profileRow) {
  const raw = String(profileRow?.tipo_clinica || '').toLowerCase();
  if (raw.includes('odonto')) return 'odontologia_estetica';
  if (raw.includes('dermato')) return 'dermatologia';
  if (raw.includes('harmon')) return 'harmonizacao_facial';
  if (raw.includes('estet')) return 'estetica_geral';
  return 'harmonizacao_facial';
}

function buildPaymentMix(atendimentos) {
  const total = (atendimentos || []).length;
  if (!total) {
    return {
      pix: 0,
      credit_full: 0,
      credit_installment: 0,
      debit: 0,
      cash: 0
    };
  }

  const counters = {
    pix: 0,
    credit_full: 0,
    credit_installment: 0,
    debit: 0,
    cash: 0
  };

  for (const item of atendimentos || []) {
    const method = String(item.forma_pagamento || '').toLowerCase();
    if (method === 'pix') counters.pix += 1;
    else if (method === 'parcelado') counters.credit_installment += 1;
    else if (method === 'debito') counters.debit += 1;
    else if (method === 'dinheiro') counters.cash += 1;
    else counters.credit_full += 1;
  }

  return Object.fromEntries(
    Object.entries(counters).map(([key, value]) => [key, round(value / total, 4)])
  );
}

function normalizeSeasonality(meses) {
  if (!Array.isArray(meses) || meses.length === 0) return {};
  const average = meses.reduce((sum, item) => sum + Number(item.receita || 0), 0) / meses.length;
  if (!average) return {};

  const result = {};
  for (const item of meses) {
    result[monthKeyToLabel(item.mes)] = round((Number(item.receita || 0) / average), 2);
  }
  return result;
}

function inferRecurringCosts(contas) {
  const grouped = new Map();

  for (const conta of contas || []) {
    const rawDescription = String(conta.descricao || conta.categoria || 'Custo recorrente').trim();
    const vendor = rawDescription.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
    const month = String(conta.data_vencimento || conta.data || '').slice(0, 7);
    const day = String(conta.data_vencimento || conta.data || '').slice(8, 10);
    const key = `${vendor}::${conta.categoria || 'Outros'}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        vendor,
        category: conta.categoria || 'Outros',
        amounts: [],
        months: new Set(),
        dueDays: new Map(),
        ids: []
      });
    }

    const item = grouped.get(key);
    item.amounts.push(Number(conta.valor) || 0);
    if (month) item.months.add(month);
    if (day) item.dueDays.set(day, (item.dueDays.get(day) || 0) + 1);
    if (conta.id) item.ids.push(conta.id);
  }

  return [...grouped.values()]
    .filter((item) => item.months.size >= 2)
    .map((item) => {
      const bestDay = [...item.dueDays.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      return {
        vendor: item.vendor,
        frequency: 'monthly',
        amount_avg: round(item.amounts.reduce((sum, value) => sum + value, 0) / item.amounts.length, 2),
        payment_pattern: bestDay ? `mensal_dia_${Number(bestDay)}` : 'monthly',
        category: item.category,
        supporting_records: item.ids
      };
    })
    .sort((a, b) => b.amount_avg - a.amount_avg)
    .slice(0, 10);
}

function inferPayrollCycle(contas) {
  const payrollRows = (contas || []).filter((conta) => {
    const text = `${conta.categoria || ''} ${conta.descricao || ''}`.toLowerCase();
    return conta.is_pro_labore || /sal[aá]r|folha|pro.?labore|pessoal/.test(text);
  });

  if (!payrollRows.length) return null;

  const dayCounter = new Map();
  const values = [];

  for (const row of payrollRows) {
    const day = Number(String(row.data_vencimento || row.data || '').slice(8, 10)) || null;
    if (day) dayCounter.set(day, (dayCounter.get(day) || 0) + 1);
    values.push(Number(row.valor) || 0);
  }

  const paymentDay = [...dayCounter.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    type: payrollRows.some((row) => row.is_pro_labore) ? 'mixed_pj_clt' : 'folha',
    payment_day: paymentDay,
    monthly_total_avg: round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, payrollRows.length), 2)
  };
}

function inferDefaultDelinquencyRate(parcelas) {
  const total = (parcelas || []).length;
  if (!total) return 0;
  const overdue = (parcelas || []).filter((item) => item.paga === false && item.data_vencimento && item.data_vencimento < new Date().toISOString().split('T')[0]).length;
  return round(overdue / total, 4);
}

function buildAcquirerFeePattern(config, fallback) {
  if (!config) return fallback || null;
  const payload = config.raw_payload || {};
  const parcelas = config.parcelas || payload.parcelas || {};
  const tiposVenda = config.tipos_venda || payload.tiposVenda || {};

  return {
    confidence: 'clinic_reported',
    source: config.source || 'manual',
    last_updated: config.updated_at || config.created_at || new Date().toISOString(),
    by_modality: {
      pix: fallback?.by_modality?.pix || 0,
      debit: tiposVenda.debito ?? fallback?.by_modality?.debit ?? null,
      credit_1x: tiposVenda.credito_avista ?? fallback?.by_modality?.credit_1x ?? null,
      credit_2x: parcelas['2'] ?? fallback?.by_modality?.credit_2x ?? null,
      credit_3x: parcelas['3'] ?? fallback?.by_modality?.credit_3x ?? null,
      credit_4x: parcelas['4'] ?? fallback?.by_modality?.credit_4x ?? null,
      credit_6x: parcelas['6'] ?? fallback?.by_modality?.credit_6x ?? null,
      credit_10x: parcelas['10'] ?? fallback?.by_modality?.credit_10x ?? null,
      credit_12x: parcelas['12'] ?? fallback?.by_modality?.credit_12x ?? null
    }
  };
}

function deriveLearnedFacts(patterns, clinicName) {
  const facts = [];

  for (const item of patterns.recurring_costs || []) {
    if (/biogelis/i.test(item.vendor)) {
      facts.push({
        fact: `${item.vendor} aparece como custo recorrente da ${clinicName || 'clínica'} (${item.payment_pattern})`,
        factType: 'vendor_pattern',
        confidence: 0.9,
        supportingRecords: item.supporting_records || []
      });
    }

    if (/aluguel/i.test(item.vendor) && item.payment_pattern) {
      facts.push({
        fact: `${item.vendor} costuma vencer ${item.payment_pattern.replace(/_/g, ' ')}`,
        factType: 'payment_pattern',
        confidence: 0.85,
        supportingRecords: item.supporting_records || []
      });
    }
  }

  const strongestMonth = Object.entries(patterns.seasonality_observed || {})
    .sort((a, b) => b[1] - a[1])[0];
  if (strongestMonth && strongestMonth[1] >= 1.2) {
    facts.push({
      fact: `${strongestMonth[0]} tende a ser um pico de vendas da clínica`,
      factType: 'seasonality',
      confidence: 0.7,
      supportingRecords: [`seasonality:${strongestMonth[0]}`]
    });
  }

  const topProcedure = patterns.top_procedures_3m?.[0];
  if (topProcedure && topProcedure.revenue_share >= 0.25) {
    facts.push({
      fact: `${topProcedure.procedure} concentra ${Math.round(topProcedure.revenue_share * 100)}% da receita recente`,
      factType: 'procedure_pattern',
      confidence: 0.75,
      supportingRecords: [`procedure:${topProcedure.procedure}`]
    });
  }

  return facts;
}

class ProfileBuilderService {
  constructor() {
    this.MIN_DATA_POINTS_DELTA = 3;
  }

  /**
   * Recalcula o perfil rico de um usuário.
   *
   * @param {string} userId
   * @param {object} [options]
   * @param {boolean} [options.force]
   * @returns {Promise<object>}
   */
  async runForUser(userId, options = {}) {
    if (!userId) {
      throw new Error('userId is required');
    }

    const { force = false } = options;
    const [sourceProfile, clinicProfile] = await Promise.all([
      this._getSourceProfile(userId),
      clinicProfileService.getOrCreate(userId, {})
    ]);

    if (!force && !this.shouldRun(clinicProfile)) {
      return {
        skipped: true,
        reason: 'threshold_not_reached',
        clinicProfile
      };
    }

    const datasets = await this._loadDatasets(userId);
    const patterns = await this._buildPatterns(userId, clinicProfile, datasets);
    const preferences = this._buildPreferences(clinicProfile.preferences || {});
    const clinicFields = this._buildClinicFields(sourceProfile, clinicProfile);

    await clinicProfileService.updatePatterns(userId, patterns);
    await clinicProfileService.updatePreferences(userId, preferences);
    await clinicProfileService.updateField(userId, 'last_builder_run_at', new Date().toISOString());

    for (const [field, value] of Object.entries(clinicFields)) {
      if (value !== undefined && value !== null && value !== '') {
        await clinicProfileService.updateField(userId, field, value);
      }
    }

    const latestProfile = await clinicProfileService.getByUserId(userId);
    const facts = deriveLearnedFacts(patterns, latestProfile?.clinic_name || sourceProfile?.nome_clinica);
    for (const fact of facts) {
      await learnedFactsService.upsertFact({
        clinicId: latestProfile.id,
        userId,
        fact: fact.fact,
        factType: fact.factType,
        confidence: fact.confidence,
        supportingRecords: fact.supportingRecords,
        source: 'profile_builder'
      });
    }

    await clinicProfileService.updateField(
      userId,
      'patterns.builder_meta',
      {
        last_data_points_total: latestProfile.data_points_total || clinicProfile.data_points_total || 0,
        last_run_reason: force ? 'forced' : 'threshold',
        built_at: new Date().toISOString()
      }
    );

    const finalProfile = await clinicProfileService.getByUserId(userId);
    await learnedFactsService.syncProfileSummary(userId, finalProfile.id);

    return {
      skipped: false,
      profile: finalProfile,
      patterns,
      facts_created: facts.length
    };
  }

  shouldRun(profile) {
    if (!profile) return true;
    if (!profile.last_builder_run_at) return true;

    const lastPoints = Number(profile.patterns?.builder_meta?.last_data_points_total || 0);
    const currentPoints = Number(profile.data_points_total || 0);
    return currentPoints - lastPoints >= this.MIN_DATA_POINTS_DELTA;
  }

  async _getSourceProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, nome_clinica, cidade, tipo_clinica, nome_completo')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  async _loadDatasets(userId) {
    const since3m = new Date();
    since3m.setMonth(since3m.getMonth() - 3);
    const since6m = new Date();
    since6m.setMonth(since6m.getMonth() - 6);
    const sinceStr3m = since3m.toISOString().split('T')[0];
    const sinceStr6m = since6m.toISOString().split('T')[0];

    const [
      atendimentos6m,
      procedureRows3m,
      contas6m,
      parcelasAll,
      latestMdrConfig,
      sazonalidade,
      clientePerfil
    ] = await Promise.all([
      supabase
        .from('atendimentos')
        .select('id, data, valor_total, forma_pagamento, parcelas, bandeira_cartao')
        .eq('user_id', userId)
        .gte('data', sinceStr6m),
      supabase
        .from('atendimento_procedimentos')
        .select(`
          atendimento_id,
          valor_cobrado,
          procedimentos (nome),
          atendimentos!inner (user_id, data)
        `)
        .eq('atendimentos.user_id', userId)
        .gte('atendimentos.data', sinceStr3m),
      supabase
        .from('contas_pagar')
        .select('id, descricao, categoria, valor, data, data_vencimento, status_pagamento, is_pro_labore')
        .eq('user_id', userId)
        .gte('data', sinceStr6m),
      supabase
        .from('parcelas')
        .select(`
          id,
          paga,
          data_vencimento,
          atendimentos!inner (user_id)
        `)
        .eq('atendimentos.user_id', userId),
      mdrService.getLatestConfig(null, userId),
      sazonalidadeService.getSazonalidade(userId, 12),
      clientePerfilService.getPerfilPagamento(userId)
    ]);

    if (atendimentos6m.error) throw atendimentos6m.error;
    if (procedureRows3m.error) throw procedureRows3m.error;
    if (contas6m.error) throw contas6m.error;
    if (parcelasAll.error) throw parcelasAll.error;

    return {
      atendimentos6m: atendimentos6m.data || [],
      procedureRows3m: procedureRows3m.data || [],
      contas6m: contas6m.data || [],
      parcelasAll: parcelasAll.data || [],
      latestMdrConfig,
      sazonalidade,
      clientePerfil
    };
  }

  async _buildPatterns(userId, clinicProfile, datasets) {
    const { atendimentos6m, procedureRows3m, contas6m, parcelasAll, latestMdrConfig, sazonalidade } = datasets;
    const existingPatterns = clinicProfile.patterns || {};

    const ticketMedioGeneral = atendimentos6m.length
      ? round(atendimentos6m.reduce((sum, item) => sum + (Number(item.valor_total) || 0), 0) / atendimentos6m.length, 2)
      : (existingPatterns.ticket_medio_general || 0);

    const monthsCovered = new Set(atendimentos6m.map((item) => String(item.data || '').slice(0, 7)).filter(Boolean)).size || 1;
    const monthlyVolumeAvg = atendimentos6m.length ? round(atendimentos6m.length / monthsCovered, 2) : 0;

    const procedureMap = new Map();
    let procedureRevenueTotal = 0;
    for (const row of procedureRows3m) {
      const procedure = row.procedimentos?.nome || 'Procedimento';
      if (!procedureMap.has(procedure)) {
        procedureMap.set(procedure, { procedure, count: 0, total: 0 });
      }
      const item = procedureMap.get(procedure);
      item.count += 1;
      item.total += Number(row.valor_cobrado) || 0;
      procedureRevenueTotal += Number(row.valor_cobrado) || 0;
    }

    const topProcedures3m = [...procedureMap.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((item) => ({
        procedure: item.procedure,
        count: item.count,
        revenue_share: procedureRevenueTotal > 0 ? round(item.total / procedureRevenueTotal, 4) : 0
      }));

    const ticketByProcedure = Object.fromEntries(
      [...procedureMap.entries()].map(([procedure, item]) => [procedure.toLowerCase().replace(/\s+/g, '_'), round(item.total / item.count, 2)])
    );

    const paymentMix = buildPaymentMix(atendimentos6m);
    const installmentRows = atendimentos6m.filter((item) => String(item.forma_pagamento || '').toLowerCase() === 'parcelado');
    const creditInstallmentAvg = installmentRows.length
      ? round(installmentRows.reduce((sum, item) => sum + (Number(item.parcelas) || 0), 0) / installmentRows.length, 1)
      : null;

    const recurringCosts = inferRecurringCosts(contas6m);
    const payrollCycle = inferPayrollCycle(contas6m);
    const defaultDelinquencyRate = inferDefaultDelinquencyRate(parcelasAll);
    const seasonalityObserved = normalizeSeasonality(sazonalidade?.meses || []);

    return {
      ...existingPatterns,
      ticket_medio_general: ticketMedioGeneral,
      ticket_medio_by_procedure: ticketByProcedure,
      top_procedures_3m: topProcedures3m,
      seasonality_observed: seasonalityObserved,
      monthly_volume_avg: monthlyVolumeAvg,
      payment_mix_observed: paymentMix,
      credit_installment_avg: creditInstallmentAvg,
      default_acquirer: latestMdrConfig?.provider || existingPatterns.default_acquirer || 'Itau',
      acquirer_fees: buildAcquirerFeePattern(latestMdrConfig, existingPatterns.acquirer_fees),
      recurring_costs: recurringCosts,
      payroll_cycle: payrollCycle,
      default_delinquency_rate: defaultDelinquencyRate
    };
  }

  _buildPreferences(existingPreferences) {
    return {
      communication_style: existingPreferences.communication_style || 'informal',
      preferred_notification_time: existingPreferences.preferred_notification_time || '08:30',
      notify_about: existingPreferences.notify_about || ['cashflow_gap', 'high_payable_due', 'new_top_client']
    };
  }

  _buildClinicFields(sourceProfile, clinicProfile) {
    const sourceClinicType = normalizeClinicType(sourceProfile);
    const clinicType = clinicProfile.clinic_type
      && (clinicProfile.clinic_type !== 'harmonizacao_facial' || sourceClinicType === 'harmonizacao_facial')
      ? clinicProfile.clinic_type
      : sourceClinicType;

    return {
      clinic_name: clinicProfile.clinic_name || sourceProfile?.nome_clinica || null,
      city: clinicProfile.city || sourceProfile?.cidade || null,
      clinic_type: clinicType
    };
  }
}

const _defaultInstance = new ProfileBuilderService();
module.exports = _defaultInstance;
module.exports.ProfileBuilderService = ProfileBuilderService;

/**
 * Recalcula o perfil rico de uma clínica específica.
 * Alias conveniente para uso em handlers e cron jobs.
 *
 * @param {string} userId - UUID do usuário.
 * @returns {Promise<void>}
 */
module.exports.rebuildClinicProfile = async (userId) => {
  try {
    await _defaultInstance.runForUser(userId);
  } catch (err) {
    console.warn('[PROFILE_BUILDER] Falha ao recalcular perfil:', err?.message);
  }
};
module.exports._helpers = {
  buildPaymentMix,
  normalizeSeasonality,
  inferRecurringCosts,
  inferPayrollCycle,
  inferDefaultDelinquencyRate,
  deriveLearnedFacts
};
