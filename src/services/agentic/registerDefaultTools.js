/**
 * Fase Agentic 2.1 — Registro das tools core do agente.
 *
 * Mantém a implementação próxima dos serviços já existentes para evitar
 * reescrever regras de negócio. As tools expõem um contrato estável para o
 * LLM e reaproveitam controllers/services determinísticos do backend.
 */

const supabase = require('../../db/supabase');
const transactionController = require('../../controllers/transactionController');
const cashflowService = require('../cashflowService');
const mdrPricingService = require('../mdrPricingService');
const mdrService = require('../mdrService');
const pricingIntelligenceService = require('../pricingIntelligenceService');
const procedimentoCustoService = require('../procedimentoCustoService');
const conversationHistoryService = require('../conversationHistoryService');
const featureFlagService = require('../featureFlagService');
const clinicProfileService = require('./clinicProfileService');
const profileBuilderService = require('./profileBuilderService');

const DEFAULT_SEGMENT = 'clinica_estetica';

const BENCHMARKS = {
  ticket_medio: {
    clinica_estetica: { min: 1200, avg: 3500, max: 8000, source: 'lumiz_design_2026' }
  },
  margem_insumo: {
    clinica_estetica: { min: 0.3, avg: 0.4, max: 0.5, source: 'lumiz_design_2026' }
  },
  pix_share: {
    clinica_estetica: { min: 0.2, avg: 0.3, max: 0.4, source: 'lumiz_design_2026' }
  },
  credit_installment_share: {
    clinica_estetica: { min: 0.35, avg: 0.47, max: 0.6, source: 'lumiz_design_2026' }
  }
};

const MARKET_FEE_TABLES = {
  itau: {
    provider: 'Itau',
    debit: 1.8,
    credit_1x: 3.2,
    credit_2x: 3.7,
    credit_3x: 4.0,
    credit_4x: 4.2,
    credit_5x: 4.5,
    credit_6x: 4.9,
    credit_7x: 5.1,
    credit_8x: 5.3,
    credit_9x: 5.5,
    credit_10x: 5.6,
    credit_11x: 5.7,
    credit_12x: 5.8
  },
  stone: {
    provider: 'Stone',
    debit: 1.6,
    credit_1x: 2.9,
    credit_2x: 3.4,
    credit_3x: 3.7,
    credit_4x: 3.9,
    credit_5x: 4.2,
    credit_6x: 4.5,
    credit_7x: 4.7,
    credit_8x: 4.9,
    credit_9x: 5.1,
    credit_10x: 5.2,
    credit_11x: 5.3,
    credit_12x: 5.4
  },
  cielo: {
    provider: 'Cielo',
    debit: 1.7,
    credit_1x: 3.1,
    credit_2x: 3.5,
    credit_3x: 3.9,
    credit_4x: 4.1,
    credit_5x: 4.3,
    credit_6x: 4.6,
    credit_7x: 4.8,
    credit_8x: 5.0,
    credit_9x: 5.2,
    credit_10x: 5.3,
    credit_11x: 5.4,
    credit_12x: 5.5
  },
  pagseguro: {
    provider: 'PagSeguro',
    debit: 1.9,
    credit_1x: 3.3,
    credit_2x: 3.8,
    credit_3x: 4.2,
    credit_4x: 4.4,
    credit_5x: 4.7,
    credit_6x: 5.0,
    credit_7x: 5.2,
    credit_8x: 5.4,
    credit_9x: 5.6,
    credit_10x: 5.7,
    credit_11x: 5.8,
    credit_12x: 5.9
  }
};

function getSchemaObject(properties, required = []) {
  return {
    type: 'object',
    properties,
    required
  };
}

function normalizeProvider(provider) {
  if (!provider) return 'itau';
  const normalized = String(provider)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (normalized.includes('stone')) return 'stone';
  if (normalized.includes('cielo')) return 'cielo';
  if (normalized.includes('pag')) return 'pagseguro';
  if (normalized.includes('itau') || normalized.includes('itaú')) return 'itau';
  return normalized;
}

function resolveUserId(params, context) {
  return context?.userId || params?.user_id || params?.clinic_id || null;
}

async function resolveClinicProfile(userId) {
  if (!userId) return null;
  return clinicProfileService.getOrCreate(userId);
}

async function maybeRunProfileBuilder(userId) {
  if (!userId) return;

  try {
    const flags = await featureFlagService.listForUser(userId);
    if (!flags.profile_builder_enabled) return;
    await profileBuilderService.runForUser(userId);
  } catch (error) {
    console.warn('[AgenticTools] Profile builder skipped:', error.message);
  }
}

function buildSyntheticMdrConfig(providerKey, fees) {
  return {
    provider: providerKey,
    status: 'confirmed',
    tipos_venda: {
      debito: fees.debit ?? 0,
      credito_avista: fees.credit_1x ?? 0,
      parcelado: {
        tabela: {
          '2x': fees.credit_2x ?? fees.credit_1x ?? 0,
          '3x': fees.credit_3x ?? fees.credit_2x ?? fees.credit_1x ?? 0,
          '4x': fees.credit_4x ?? fees.credit_3x ?? 0,
          '5x': fees.credit_5x ?? fees.credit_4x ?? 0,
          '6x': fees.credit_6x ?? fees.credit_5x ?? 0,
          '7x': fees.credit_7x ?? fees.credit_6x ?? 0,
          '8x': fees.credit_8x ?? fees.credit_7x ?? 0,
          '9x': fees.credit_9x ?? fees.credit_8x ?? 0,
          '10x': fees.credit_10x ?? fees.credit_9x ?? 0,
          '11x': fees.credit_11x ?? fees.credit_10x ?? 0,
          '12x': fees.credit_12x ?? fees.credit_11x ?? 0
        }
      }
    },
    parcelas: {
      '2': fees.credit_2x ?? fees.credit_1x ?? 0,
      '3': fees.credit_3x ?? fees.credit_2x ?? fees.credit_1x ?? 0,
      '4': fees.credit_4x ?? fees.credit_3x ?? 0,
      '5': fees.credit_5x ?? fees.credit_4x ?? 0,
      '6': fees.credit_6x ?? fees.credit_5x ?? 0,
      '7': fees.credit_7x ?? fees.credit_6x ?? 0,
      '8': fees.credit_8x ?? fees.credit_7x ?? 0,
      '9': fees.credit_9x ?? fees.credit_8x ?? 0,
      '10': fees.credit_10x ?? fees.credit_9x ?? 0,
      '11': fees.credit_11x ?? fees.credit_10x ?? 0,
      '12': fees.credit_12x ?? fees.credit_11x ?? 0
    },
    raw_payload: {
      settlement_mode: 'no_fluxo'
    }
  };
}

async function resolveFeeConfig(userId, phone, preferredProvider) {
  const providerKey = normalizeProvider(preferredProvider);
  const clinicProfile = await resolveClinicProfile(userId);
  const profileFees = clinicProfile?.patterns?.acquirer_fees?.by_modality || null;
  const profileConfidence = clinicProfile?.patterns?.acquirer_fees?.confidence || null;
  const latestConfig = await mdrService.getLatestConfig(phone || null, userId || null);

  if (latestConfig) {
    return {
      providerKey,
      providerName: latestConfig.provider || MARKET_FEE_TABLES[providerKey]?.provider || preferredProvider || 'Configuração atual',
      confidence: profileConfidence || 'clinic_reported',
      config: latestConfig
    };
  }

  if (profileFees) {
    return {
      providerKey,
      providerName: clinicProfile?.patterns?.default_acquirer || MARKET_FEE_TABLES[providerKey]?.provider || preferredProvider || 'Mercado',
      confidence: profileConfidence || 'estimate',
      config: buildSyntheticMdrConfig(providerKey, {
        debit: profileFees.debit,
        credit_1x: profileFees.credit_1x,
        credit_2x: profileFees.credit_2x,
        credit_3x: profileFees.credit_3x,
        credit_4x: profileFees.credit_4x,
        credit_5x: profileFees.credit_5x,
        credit_6x: profileFees.credit_6x,
        credit_7x: profileFees.credit_7x,
        credit_8x: profileFees.credit_8x,
        credit_9x: profileFees.credit_9x,
        credit_10x: profileFees.credit_10x,
        credit_11x: profileFees.credit_11x,
        credit_12x: profileFees.credit_12x
      })
    };
  }

  const fallbackFees = MARKET_FEE_TABLES[providerKey] || MARKET_FEE_TABLES.itau;
  return {
    providerKey,
    providerName: fallbackFees.provider,
    confidence: 'estimate',
    config: buildSyntheticMdrConfig(providerKey, fallbackFees)
  };
}

async function fetchRecentCardSales(userId, days = 90) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('atendimentos')
    .select('valor_total, forma_pagamento, parcelas, bandeira_cartao, data')
    .eq('user_id', userId)
    .gte('data', sinceStr)
    .in('forma_pagamento', ['debito', 'credito_avista', 'parcelado']);

  if (error) throw error;
  return data || [];
}

async function buildCompareMachineFeesResult(userId, phone, alternatives = []) {
  const clinicProfile = await resolveClinicProfile(userId);
  const defaultProvider = normalizeProvider(clinicProfile?.patterns?.default_acquirer || 'itau');
  const current = await resolveFeeConfig(userId, phone, defaultProvider);
  const sales = await fetchRecentCardSales(userId, 90);
  const comparisonProviders = (alternatives.length ? alternatives : ['stone', 'cielo', 'pagseguro'])
    .map(normalizeProvider)
    .filter((provider) => provider && provider !== current.providerKey && MARKET_FEE_TABLES[provider]);

  const currentMonthlyCost = sales.reduce((sum, sale) => {
    const pricing = mdrPricingService.calculateSalePricing({
      valorBruto: Number(sale.valor_total) || 0,
      formaPagamento: sale.forma_pagamento,
      parcelas: sale.parcelas,
      bandeiraCartao: sale.bandeira_cartao,
      saleDate: sale.data,
      mdrConfig: current.config
    });
    return sum + Math.max(0, pricing.valorBruto - pricing.valorLiquido);
  }, 0) / 3;

  const alternativesResult = comparisonProviders.map((providerKey) => {
    const syntheticConfig = buildSyntheticMdrConfig(providerKey, MARKET_FEE_TABLES[providerKey]);
    const monthlyCost = sales.reduce((sum, sale) => {
      const pricing = mdrPricingService.calculateSalePricing({
        valorBruto: Number(sale.valor_total) || 0,
        formaPagamento: sale.forma_pagamento,
        parcelas: sale.parcelas,
        bandeiraCartao: sale.bandeira_cartao,
        saleDate: sale.data,
        mdrConfig: syntheticConfig
      });
      return sum + Math.max(0, pricing.valorBruto - pricing.valorLiquido);
    }, 0) / 3;

    return {
      acquirer: MARKET_FEE_TABLES[providerKey].provider,
      average_fee: Number((monthlyCost <= 0 ? 0 : (monthlyCost / Math.max(1, sales.reduce((s, sale) => s + (Number(sale.valor_total) || 0), 0) / 3)) * 100).toFixed(2)),
      monthly_savings: Number(Math.max(0, currentMonthlyCost - monthlyCost).toFixed(2)),
      annual_savings: Number((Math.max(0, currentMonthlyCost - monthlyCost) * 12).toFixed(2))
    };
  }).sort((a, b) => b.monthly_savings - a.monthly_savings);

  return {
    current: {
      acquirer: current.providerName,
      average_fee: Number((currentMonthlyCost <= 0 ? 0 : (currentMonthlyCost / Math.max(1, sales.reduce((s, sale) => s + (Number(sale.valor_total) || 0), 0) / 3)) * 100).toFixed(2)),
      monthly_cost: Number(currentMonthlyCost.toFixed(2)),
      annual_cost: Number((currentMonthlyCost * 12).toFixed(2)),
      confidence: current.confidence
    },
    alternatives: alternativesResult,
    recommended: alternativesResult[0]?.acquirer || current.providerName,
    disclaimer: current.confidence === 'estimate'
      ? 'Comparativo estimado com base em taxas médias de mercado; confirme sua taxa real para precisão.'
      : undefined
  };
}

function mapCashflowProjectionToToolResult(projection) {
  const inflows = [];
  const outflows = [];

  for (const day of projection.days || []) {
    for (const event of day.eventos || []) {
      if (event.tipo === 'entrada') {
        inflows.push({
          date: day.date,
          value: Number(event.valor || 0),
          source: event.tipo,
          description: event.descricao
        });
      } else {
        outflows.push({
          date: day.date,
          value: Number(event.valor || 0),
          category: event.descricao,
          vendor: event.descricao,
          status: 'pending'
        });
      }
    }
  }

  const alerts = [];
  if (projection.summary?.primeiroDiaCaixaNegativo) {
    alerts.push(`gap previsto em ${projection.summary.primeiroDiaCaixaNegativo}`);
  }

  return {
    inflows,
    outflows,
    net_balance: Number(projection.summary?.saldoFinal || 0),
    alerts
  };
}

async function registerCoreTools(toolRegistry) {
  if (toolRegistry.has('register_sale')) {
    return;
  }

  toolRegistry.register({
    name: 'register_sale',
    description: 'Registra uma venda da clínica, cria atendimento e agenda parcelas futuras quando houver cartão parcelado.',
    category: 'transactions',
    requiresConfirmation: true,
    parameters: getSchemaObject({
      value: { type: 'number', description: 'Valor bruto da venda.' },
      category: { type: 'string', description: 'Procedimento principal.' },
      description: { type: 'string', description: 'Descrição complementar da venda.' },
      date: { type: 'string', description: 'Data da venda em YYYY-MM-DD.' },
      payment_method: { type: 'string', enum: ['pix', 'dinheiro', 'debito', 'credito_avista', 'parcelado', 'misto'] },
      installments: { type: 'integer', description: 'Número de parcelas quando parcelado.' },
      card_brand: { type: 'string', description: 'Bandeira do cartão.' },
      client_name: { type: 'string', description: 'Nome do paciente/cliente.' }
    }, ['value', 'category']),
    execute: async (params, context) => {
      const userId = resolveUserId(params, context);
      if (!userId) throw new Error('user_id ausente para register_sale');

      const atendimento = await transactionController.createAtendimento(userId, {
        valor: Number(params.value),
        categoria: params.category,
        descricao: params.description || params.category,
        data: params.date,
        forma_pagamento: params.payment_method,
        parcelas: params.installments,
        bandeira_cartao: params.card_brand,
        nome_cliente: params.client_name
      });

      let parcelas = [];
      if (params.payment_method === 'parcelado') {
        const { data, error } = await supabase
          .from('parcelas')
          .select('numero, valor, valor_bruto, valor_liquido, data_vencimento')
          .eq('atendimento_id', atendimento.id)
          .order('numero', { ascending: true });
        if (error) throw error;
        parcelas = data || [];
      }

      await clinicProfileService.incrementDataPoints(userId, 1);
      void maybeRunProfileBuilder(userId);

      return {
        atendimento_id: atendimento.id,
        gross_value: Number(atendimento.valor_bruto || atendimento.valor_total || params.value),
        net_value: Number(atendimento.valor_liquido || atendimento.valor_total || params.value),
        expected_date: atendimento.recebimento_previsto || atendimento.data,
        installments: parcelas.map((item) => ({
          installment: item.numero,
          gross_value: Number(item.valor_bruto || item.valor || 0),
          net_value: Number(item.valor_liquido || item.valor || 0),
          expected_date: item.data_vencimento
        }))
      };
    }
  });

  toolRegistry.register({
    name: 'register_cost',
    description: 'Registra um custo já pago ou uma conta a pagar futura da clínica.',
    category: 'transactions',
    requiresConfirmation: true,
    parameters: getSchemaObject({
      value: { type: 'number', description: 'Valor total do custo.' },
      description: { type: 'string', description: 'Descrição do custo.' },
      category: { type: 'string', description: 'Categoria do custo.' },
      category_trigger: { type: 'string', description: 'Explicação do porquê a categoria foi escolhida.' },
      payment_method: { type: 'string', enum: ['pix', 'boleto', 'dinheiro', 'transfer', 'cartao', 'debit', 'credit'] },
      emission_date: { type: 'string', description: 'Data de emissão/documento.' },
      installments: {
        type: 'array',
        items: getSchemaObject({
          number: { type: 'integer' },
          value: { type: 'number' },
          due_date: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'paid', 'overdue'] }
        }, ['number', 'value', 'due_date'])
      },
      source: { type: 'string', enum: ['text', 'audio', 'photo', 'pdf'] },
      source_ref: { type: 'string' },
      transaction_kind: { type: 'string', enum: ['expense', 'accounts_payable'] }
    }, ['value', 'description', 'category']),
    execute: async (params, context) => {
      const userId = resolveUserId(params, context);
      if (!userId) throw new Error('user_id ausente para register_cost');

      const installments = Array.isArray(params.installments) ? params.installments : [];
      const isAccountsPayable = params.transaction_kind === 'accounts_payable'
        || installments.some((item) => item.status === 'pending')
        || params.payment_method === 'boleto';

      const accountPayableIds = [];
      let firstId = null;

      if (installments.length > 0) {
        const { data, error } = await supabase
          .from('contas_pagar')
          .insert(
            installments.map((item) => ({
              user_id: userId,
              descricao: `${params.description} (${item.number}/${installments.length})`,
              valor: Number(item.value),
              data: item.due_date,
              data_vencimento: item.due_date,
              tipo: 'variavel',
              categoria: params.category,
              status_pagamento: item.status === 'paid' ? 'pago' : 'pendente',
              observacoes: params.category_trigger || null
            }))
          )
          .select('id');

        if (error) throw error;
        accountPayableIds.push(...(data || []).map((row) => row.id));
        firstId = accountPayableIds[0] || null;
      } else if (isAccountsPayable) {
        const dueDate = params.emission_date || new Date().toISOString().split('T')[0];
        const { data, error } = await supabase
          .from('contas_pagar')
          .insert({
            user_id: userId,
            descricao: params.description,
            valor: Number(params.value),
            data: dueDate,
            data_vencimento: dueDate,
            tipo: 'variavel',
            categoria: params.category,
            status_pagamento: 'pendente',
            observacoes: params.category_trigger || null
          })
          .select('id')
          .single();

        if (error) throw error;
        firstId = data.id;
        accountPayableIds.push(data.id);
      } else {
        const conta = await transactionController.createContaPagar(userId, {
          valor: Number(params.value),
          categoria: params.category,
          descricao: params.description,
          data: params.emission_date,
          tipo: 'variavel'
        });
        firstId = conta.id;
        accountPayableIds.push(conta.id);
      }

      await clinicProfileService.incrementDataPoints(userId, 1);
      void maybeRunProfileBuilder(userId);

      return {
        cost_id: firstId,
        accounts_payable_ids: accountPayableIds,
        category: params.category,
        category_trigger: params.category_trigger || null
      };
    }
  });

  toolRegistry.register({
    name: 'update_clinic_profile',
    description: 'Atualiza um fato específico do perfil da clínica.',
    category: 'memory',
    parameters: getSchemaObject({
      field: { type: 'string', description: 'Caminho do campo. Ex: patterns.ticket_medio_general' },
      value: { type: 'string', description: 'Valor serializado como string quando necessário.' },
      source_fact: { type: 'string', description: 'Fato que motivou a atualização.' }
    }, ['field', 'value']),
    execute: async (params, context) => {
      const userId = resolveUserId(params, context);
      if (!userId) throw new Error('user_id ausente para update_clinic_profile');
      const ok = await clinicProfileService.updateField(userId, params.field, params.value, params.source_fact);
      return { ok };
    }
  });

  toolRegistry.register({
    name: 'get_clinic_profile',
    description: 'Lê o perfil atual da clínica com patterns, preferências e fatos aprendidos.',
    category: 'memory',
    parameters: getSchemaObject({}),
    execute: async (params, context) => {
      const userId = resolveUserId(params, context);
      if (!userId) throw new Error('user_id ausente para get_clinic_profile');
      const profile = await resolveClinicProfile(userId);
      return profile || {};
    }
  });

  toolRegistry.register({
    name: 'project_cashflow_30d',
    description: 'Projeta entradas, saídas e saldo líquido para os próximos 30 dias.',
    category: 'analysis',
    parameters: getSchemaObject({}),
    execute: async (params, context) => {
      const userId = resolveUserId(params, context);
      if (!userId) throw new Error('user_id ausente para project_cashflow_30d');
      const projection = await cashflowService.getCashflowProjection(userId, 30);
      return mapCashflowProjectionToToolResult(projection);
    }
  });

  toolRegistry.register({
    name: 'calculate_net_value',
    description: 'Calcula receita líquida após taxas do meio de pagamento e devolve o breakdown por parcela.',
    category: 'analysis',
    parameters: getSchemaObject({
      gross: { type: 'number', description: 'Valor bruto da venda.' },
      payment_method: { type: 'string', enum: ['pix', 'dinheiro', 'debito', 'credito_avista', 'parcelado'] },
      installments: { type: 'integer' },
      acquirer: { type: 'string', description: 'Nome da adquirente.' },
      card_brand: { type: 'string', description: 'Bandeira do cartão.' },
      sale_date: { type: 'string', description: 'Data da venda em YYYY-MM-DD.' }
    }, ['gross', 'payment_method']),
    execute: async (params, context) => {
      const userId = resolveUserId(params, context);
      const feeConfig = await resolveFeeConfig(userId, context?.phone, params.acquirer);
      const pricing = mdrPricingService.calculateSalePricing({
        valorBruto: Number(params.gross),
        formaPagamento: params.payment_method,
        parcelas: params.installments,
        bandeiraCartao: params.card_brand,
        saleDate: params.sale_date || new Date().toISOString().split('T')[0],
        mdrConfig: feeConfig.config
      });

      return {
        net: pricing.valorLiquido,
        fee_total: Number((pricing.valorBruto - pricing.valorLiquido).toFixed(2)),
        fee_percent: pricing.mdrPercentApplied,
        confidence: feeConfig.confidence,
        rate_confidence: feeConfig.confidence, // alias explícito para o system prompt
        breakdown: pricing.parcelasPlan.map((item) => ({
          installment: item.numero,
          gross_value: item.valor_bruto,
          fee: Number((item.valor_bruto - item.valor_liquido).toFixed(2)),
          net_value: item.valor_liquido,
          expected_date: item.recebimento_previsto
        }))
      };
    }
  });

  toolRegistry.register({
    name: 'calculate_margin',
    description: 'Calcula margem real de um procedimento com base no histórico da clínica.',
    category: 'analysis',
    parameters: getSchemaObject({
      procedure: { type: 'string', description: 'Nome do procedimento.' }
    }, ['procedure']),
    execute: async (params, context) => {
      const userId = resolveUserId(params, context);
      if (!userId) throw new Error('user_id ausente para calculate_margin');
      const [report, feeConfig] = await Promise.all([
        procedimentoCustoService.getCustoRealProcedimentos(userId, 6),
        resolveFeeConfig(userId, context?.phone, null)
      ]);
      const match = (report.procedimentos || []).find((item) =>
        String(item.nome || '').toLowerCase().includes(String(params.procedure).toLowerCase())
        || String(params.procedure).toLowerCase().includes(String(item.nome || '').toLowerCase())
      );

      if (!match) {
        return {
          average_price: 0,
          insumo_estimate: 0,
          net_revenue_estimate: 0,
          margin_percent: 0,
          sample_size: 0,
          rate_confidence: feeConfig.confidence
        };
      }

      return {
        average_price: match.valor_cobrado_medio,
        insumo_estimate: match.custo_material_medio,
        net_revenue_estimate: Number((match.valor_cobrado_medio - match.custo_total_real).toFixed(2)),
        margin_percent: match.margem_real,
        sample_size: match.atendimentos_no_periodo,
        rate_confidence: feeConfig.confidence
      };
    }
  });

  toolRegistry.register({
    name: 'compare_machine_fees',
    description: 'Compara a taxa atual da adquirente com alternativas de mercado e estima economia mensal.',
    category: 'analysis',
    parameters: getSchemaObject({
      alternatives: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista opcional de adquirentes para comparar.'
      }
    }),
    execute: async (params, context) => {
      const userId = resolveUserId(params, context);
      if (!userId) throw new Error('user_id ausente para compare_machine_fees');
      return buildCompareMachineFeesResult(userId, context?.phone, params.alternatives || []);
    }
  });

  toolRegistry.register({
    name: 'register_acquirer_fees',
    description: 'Registra as taxas reais da maquininha e promove a confiança dos cálculos para clinic_reported.',
    category: 'configuration',
    requiresConfirmation: true,
    parameters: getSchemaObject({
      acquirer: { type: 'string', description: 'Nome da adquirente.' },
      fees: getSchemaObject({
        pix: { type: 'number' },
        debit: { type: 'number' },
        credit_1x: { type: 'number' },
        credit_2x: { type: 'number' },
        credit_3x: { type: 'number' },
        credit_4x: { type: 'number' },
        credit_6x: { type: 'number' },
        credit_10x: { type: 'number' },
        credit_12x: { type: 'number' }
      }),
      source: { type: 'string', enum: ['text', 'photo', 'pdf', 'alter_sync'] },
      source_ref: { type: 'string' },
      reported_at: { type: 'string' }
    }, ['acquirer', 'fees', 'source']),
    execute: async (params, context) => {
      const userId = resolveUserId(params, context);
      if (!userId) throw new Error('user_id ausente para register_acquirer_fees');

      const providerKey = normalizeProvider(params.acquirer);
      const tiposVenda = {
        debito: params.fees.debit ?? null,
        credito_avista: params.fees.credit_1x ?? null,
        parcelado: {
          tabela: Object.fromEntries(
            Object.entries(params.fees)
              .filter(([key, value]) => key.startsWith('credit_') && key !== 'credit_1x' && value !== undefined && value !== null)
              .map(([key, value]) => [`${key.replace('credit_', '')}x`, value])
          )
        }
      };

      const parcelas = Object.fromEntries(
        Object.entries(params.fees)
          .filter(([key, value]) => key.startsWith('credit_') && key !== 'credit_1x' && value !== undefined && value !== null)
          .map(([key, value]) => [key.replace('credit_', ''), value])
      );

      const config = await mdrService.saveManualConfig({
        phone: context?.phone || null,
        userId,
        bandeiras: [],
        tiposVenda,
        parcelas,
        provider: params.acquirer,
        rawPayload: {
          settlement_mode: 'no_fluxo',
          source_ref: params.source_ref || null,
          source: params.source
        }
      });

      await mdrService.confirmConfig(config.id, { rawPayload: config.raw_payload });
      await clinicProfileService.updateAcquirerFees(userId, MARKET_FEE_TABLES[providerKey]?.provider || params.acquirer, params.fees, params.source === 'alter_sync' ? 'verified' : 'clinic_reported');
      void maybeRunProfileBuilder(userId);

      return {
        ok: true,
        confidence_promoted_to: params.source === 'alter_sync' ? 'verified' : 'clinic_reported'
      };
    }
  });

  toolRegistry.register({
    name: 'get_benchmark',
    description: 'Retorna benchmark de mercado para uma métrica relevante do segmento de clínica estética.',
    category: 'analysis',
    parameters: getSchemaObject({
      metric: { type: 'string', enum: ['ticket_medio', 'margem_insumo', 'pix_share', 'credit_installment_share'] },
      segment: { type: 'string', description: 'Segmento do benchmark.' }
    }, ['metric']),
    execute: async (params) => {
      const segment = params.segment || DEFAULT_SEGMENT;
      const bucket = BENCHMARKS[params.metric]?.[segment] || BENCHMARKS[params.metric]?.[DEFAULT_SEGMENT];
      if (!bucket) {
        return { value: null, range: null, source: 'unavailable' };
      }
      return {
        value: bucket.avg,
        range: { min: bucket.min, max: bucket.max },
        source: bucket.source
      };
    }
  });

  toolRegistry.register({
    name: 'search_clinic_history',
    description: 'Busca histórico recente e exemplos semelhantes de conversas da clínica.',
    category: 'memory',
    parameters: getSchemaObject({
      query: { type: 'string', description: 'Consulta textual para busca.' },
      limit: { type: 'integer', description: 'Quantidade máxima de resultados.' }
    }, ['query']),
    execute: async (params, context) => {
      const userId = resolveUserId(params, context);
      if (!userId) throw new Error('user_id ausente para search_clinic_history');
      const results = await conversationHistoryService.findSimilarExamples(params.query, userId, params.limit || 5);
      return (results || []).map((item) => ({
        date: item.created_at || null,
        type: item.intent,
        summary: item.user_message,
        full_record_id: item.id || null
      }));
    }
  });

  return toolRegistry.list();
}

module.exports = registerCoreTools;
