/**
 * Fase Agentic 5 — Conta-fantasma do onboarding.
 * Persiste os lançamentos do teste rápido antes da conversão da clínica em uso real.
 */

const supabase = require('../db/supabase');
const { normalizePhone } = require('../utils/phone');
const { formatarMoeda } = require('../utils/currency');

const ROLE_LABELS = Object.freeze({
  dona_gestora: 'dona/gestora',
  adm_financeiro: 'adm/financeiro',
  secretaria: 'secretária',
  profissional: 'profissional'
});

function buildDefaultSnapshot() {
  return {
    sales: [],
    costs: [],
    initial_balance: null,
    totals: {
      entradas: 0,
      custosFixos: 0,
      custosVariaveis: 0,
      saldoParcial: 0
    }
  };
}

function normalizeSnapshot(snapshot = {}) {
  const base = buildDefaultSnapshot();
  return {
    ...base,
    ...snapshot,
    sales: Array.isArray(snapshot.sales) ? snapshot.sales : [],
    costs: Array.isArray(snapshot.costs) ? snapshot.costs : [],
    totals: {
      ...base.totals,
      ...(snapshot.totals || {})
    }
  };
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString().split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().split('T')[0];
  return parsed.toISOString().split('T')[0];
}

function sanitizeRevenue(sale = {}) {
  return {
    description: sale.procedimento || 'Procedimento',
    patient: sale.paciente || null,
    amount: Number(sale.valor) || 0,
    payment_method: sale.forma_pagamento || null,
    installments: Number.isFinite(Number(sale.parcelas)) ? Number(sale.parcelas) : null,
    payment_split: Array.isArray(sale.payment_split) ? sale.payment_split : null,
    card_brand: sale.bandeira_cartao || null,
    date: normalizeDate(sale.data),
    original_text: sale.original_text || null
  };
}

function sanitizeCost(cost = {}) {
  return {
    description: cost.descricao || cost.categoria || 'Despesa',
    amount: Number(cost.valor) || 0,
    type: cost.tipo || 'variavel',
    category: cost.categoria || 'Outros',
    category_trigger: cost.category_trigger || null,
    payment_method: cost.forma_pagamento || null,
    installments: Number.isFinite(Number(cost.parcelas)) ? Number(cost.parcelas) : null,
    due_dates: Array.isArray(cost.datas_vencimento) ? cost.datas_vencimento : null,
    date: normalizeDate(cost.data),
    original_text: cost.original_text || null
  };
}

function computeGhostSummary(snapshot = {}) {
  const normalized = normalizeSnapshot(snapshot);
  const entradas = normalized.sales.reduce((sum, sale) => sum + (Number(sale.amount) || 0), 0);
  const custosFixos = normalized.costs
    .filter((cost) => cost?.type === 'fixa')
    .reduce((sum, cost) => sum + (Number(cost.amount) || 0), 0);
  const custosVariaveis = normalized.costs
    .filter((cost) => cost?.type !== 'fixa')
    .reduce((sum, cost) => sum + (Number(cost.amount) || 0), 0);
  const saldoParcial = entradas - custosFixos - custosVariaveis;

  return {
    entradas: Number(entradas.toFixed(2)),
    custosFixos: Number(custosFixos.toFixed(2)),
    custosVariaveis: Number(custosVariaveis.toFixed(2)),
    saldoParcial: Number(saldoParcial.toFixed(2))
  };
}

function buildForwardSummary({
  clinicName,
  testedByName,
  snapshot
}) {
  const normalized = normalizeSnapshot(snapshot);
  const totals = computeGhostSummary(normalized);
  const sale = normalized.sales[0] || null;
  const variableCost = normalized.costs.find((cost) => cost?.type !== 'fixa') || normalized.costs[0] || null;
  const fixedCost = normalized.costs.find((cost) => cost?.type === 'fixa') || null;

  const bulletLines = [];
  if (sale?.amount) {
    bulletLines.push(`Registrou uma venda de ${formatarMoeda(sale.amount)}${sale.description ? ` (${sale.description})` : ''}`);
  }
  if (variableCost?.amount) {
    const parcelsLabel = variableCost.installments && variableCost.installments > 1
      ? ` em ${variableCost.installments}x`
      : '';
    bulletLines.push(`Organizou um custo de ${formatarMoeda(variableCost.amount)}${parcelsLabel}${variableCost.category ? ` como ${variableCost.category}` : ''}`);
  }
  if (fixedCost?.amount) {
    bulletLines.push(`Também registrou um custo fixo de ${formatarMoeda(fixedCost.amount)}${fixedCost.category ? ` em ${fixedCost.category}` : ''}`);
  }
  bulletLines.push(`Montou um resumo parcial com entradas de ${formatarMoeda(totals.entradas)}, custos de ${formatarMoeda(totals.custosFixos + totals.custosVariaveis)} e saldo de ${formatarMoeda(totals.saldoParcial)}`);

  const header = testedByName
    ? `Oi, testei a Lumiz aqui pra ${clinicName || 'a clínica'} e gostei bastante.`
    : `Oi, testei a Lumiz aqui pra ${clinicName || 'a clínica'} e gostei bastante.`;

  return [
    `${header} É um financeiro que vive no WhatsApp: dá pra registrar venda e custo por texto, foto ou PDF, sem planilha.`,
    '',
    'Em poucos minutos no teste, ele:',
    ...bulletLines.map((line) => `- ${line}`),
    '',
    'Se fizer sentido, vale ver uma demo rápida ou pedir o link de continuação.'
  ].join('\n');
}

class TrialAccountService {
  async getByPhone(phone) {
    const normalizedPhone = normalizePhone(phone) || phone;
    if (!normalizedPhone) return null;

    const { data, error } = await supabase
      .from('trial_accounts')
      .select('*')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  async getByClinicId(clinicId) {
    if (!clinicId) return null;

    const { data, error } = await supabase
      .from('trial_accounts')
      .select('*')
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  async upsertContext({
    phone,
    clinicId = null,
    ownerName = null,
    clinicName = null,
    role = null,
    referralSummary = null,
    metadata = null
  }) {
    const normalizedPhone = normalizePhone(phone) || phone;
    if (!normalizedPhone) {
      throw new Error('phone é obrigatório para upsertContext');
    }

    const existing = await this.getByPhone(normalizedPhone);
    const payload = {
      phone: normalizedPhone,
      clinic_id: clinicId || existing?.clinic_id || null,
      owner_name: ownerName || existing?.owner_name || null,
      clinic_name: clinicName || existing?.clinic_name || null,
      role: role || existing?.role || null,
      referral_summary: referralSummary || existing?.referral_summary || null,
      metadata: {
        ...(existing?.metadata || {}),
        ...(metadata || {})
      },
      updated_at: new Date().toISOString()
    };

    if (existing?.id) {
      const { data, error } = await supabase
        .from('trial_accounts')
        .update(payload)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('trial_accounts')
      .insert([{
        ...payload,
        status: 'active',
        snapshot: buildDefaultSnapshot()
      }])
      .select('*')
      .single();

    if (error) throw error;
    return data;
  }

  async saveRevenue({
    phone,
    clinicId,
    ownerName = null,
    clinicName = null,
    role = null,
    sale
  }) {
    const account = await this.upsertContext({ phone, clinicId, ownerName, clinicName, role });
    const snapshot = normalizeSnapshot(account.snapshot);
    snapshot.sales.push(sanitizeRevenue(sale));
    snapshot.totals = computeGhostSummary(snapshot);

    return this._updateSnapshot(account.id, snapshot);
  }

  async saveCost({
    phone,
    clinicId,
    ownerName = null,
    clinicName = null,
    role = null,
    cost
  }) {
    const account = await this.upsertContext({ phone, clinicId, ownerName, clinicName, role });
    const snapshot = normalizeSnapshot(account.snapshot);
    snapshot.costs.push(sanitizeCost(cost));
    snapshot.totals = computeGhostSummary(snapshot);

    return this._updateSnapshot(account.id, snapshot);
  }

  async setInitialBalance({
    phone,
    clinicId,
    ownerName = null,
    clinicName = null,
    role = null,
    initialBalance
  }) {
    const account = await this.upsertContext({ phone, clinicId, ownerName, clinicName, role });
    const snapshot = normalizeSnapshot(account.snapshot);
    snapshot.initial_balance = Number(initialBalance) || 0;
    snapshot.totals = computeGhostSummary(snapshot);

    return this._updateSnapshot(account.id, snapshot);
  }

  async saveReferralSummary({
    phone,
    clinicId,
    ownerName = null,
    clinicName = null,
    role = null
  }) {
    const account = await this.upsertContext({ phone, clinicId, ownerName, clinicName, role });
    const referralSummary = buildForwardSummary({
      clinicName: clinicName || account.clinic_name,
      testedByName: ownerName || account.owner_name,
      snapshot: account.snapshot
    });

    return this.upsertContext({
      phone,
      clinicId,
      ownerName,
      clinicName,
      role,
      referralSummary
    });
  }

  async migrateToLiveAccount(clinicId) {
    const account = await this.getByClinicId(clinicId);
    if (!account) {
      return { migrated: false, reason: 'not_found', sales: 0, costs: 0 };
    }

    if (account.status === 'converted') {
      return { migrated: false, reason: 'already_converted', sales: 0, costs: 0 };
    }

    const snapshot = normalizeSnapshot(account.snapshot);
    const transactionController = require('../controllers/transactionController');
    let migratedSales = 0;
    let migratedCosts = 0;

    for (const sale of snapshot.sales) {
      await transactionController.createAtendimento(clinicId, {
        valor: sale.amount,
        categoria: sale.description,
        descricao: sale.original_text || sale.description,
        data: sale.date,
        forma_pagamento: sale.payment_method,
        parcelas: sale.installments,
        bandeira_cartao: sale.card_brand,
        nome_cliente: sale.patient || 'Cliente WhatsApp'
      });
      migratedSales += 1;
    }

    for (const cost of snapshot.costs) {
      await transactionController.createContaPagar(clinicId, {
        valor: cost.amount,
        categoria: cost.category,
        descricao: cost.description,
        data: cost.date,
        tipo: cost.type,
        parcelas: cost.installments,
        condicoes_pagamento: cost.due_dates,
        observacoes: cost.category_trigger || null
      });
      migratedCosts += 1;
    }

    if (Number.isFinite(Number(snapshot.initial_balance))) {
      await supabase
        .from('profiles')
        .update({ initial_balance: Number(snapshot.initial_balance), updated_at: new Date().toISOString() })
        .eq('id', clinicId)
        .is('initial_balance', null);
    }

    const { error } = await supabase
      .from('trial_accounts')
      .update({
        status: 'converted',
        converted_at: new Date().toISOString(),
        metadata: {
          ...(account.metadata || {}),
          migration: {
            migrated_sales: migratedSales,
            migrated_costs: migratedCosts,
            migrated_at: new Date().toISOString()
          }
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', account.id);

    if (error) throw error;

    return {
      migrated: true,
      reason: 'ok',
      sales: migratedSales,
      costs: migratedCosts
    };
  }

  async _updateSnapshot(id, snapshot) {
    const { data, error } = await supabase
      .from('trial_accounts')
      .update({
        snapshot,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return data;
  }
}

module.exports = {
  trialAccountService: new TrialAccountService(),
  computeGhostSummary,
  buildForwardSummary,
  normalizeSnapshot,
  ROLE_LABELS
};
