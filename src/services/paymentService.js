const subscriptionService = require('./subscriptionService');
const userRepository = require('../repositories/userRepository');
const analyticsService = require('./analyticsService');
const { trialAccountService } = require('./trialAccountService');

const PLAN_VALUE = 149.99;
const ASAAS_BASE_URL = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';

function asaasHeaders() {
  return {
    'Content-Type': 'application/json',
    'access_token': process.env.ASAAS_API_KEY
  };
}

async function asaasPost(path, body) {
  const res = await fetch(`${ASAAS_BASE_URL}${path}`, {
    method: 'POST',
    headers: asaasHeaders(),
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`[ASAAS] ${path} falhou: ${JSON.stringify(json)}`);
  }
  return json;
}

async function createOrGetCustomer(clinicId) {
  const sub = await subscriptionService.getStatus(clinicId);
  if (sub?.asaas_customer_id) return sub.asaas_customer_id;

  const profile = await userRepository.findById(clinicId);
  const name = profile?.nome || profile?.name || `Clínica ${clinicId.slice(0, 8)}`;

  const customer = await asaasPost('/customers', { name, externalReference: clinicId });

  await subscriptionService.updatePaymentUrl(clinicId, {
    asaasCustomerId: customer.id,
    paymentUrl: sub?.payment_url || null
  });

  return customer.id;
}

async function generatePaymentLink(clinicId) {
  const sub = await subscriptionService.getStatus(clinicId);
  if (sub?.payment_url) return sub.payment_url;

  const customerId = await createOrGetCustomer(clinicId);

  const link = await asaasPost('/paymentLinks', {
    name: 'Lumiz — Plano Mensal',
    value: PLAN_VALUE,
    billingType: 'UNDEFINED',
    chargeType: 'RECURRENT',
    cycle: 'MONTHLY',
    customer: customerId,
    externalReference: clinicId,
    description: 'Assinatura mensal Lumiz — Gestão Financeira para Clínicas'
  });

  const url = link.url || link.paymentUrl || link.invoiceUrl;

  await subscriptionService.updatePaymentUrl(clinicId, {
    asaasCustomerId: customerId,
    paymentUrl: url
  });

  return url;
}

async function handleWebhook(payload) {
  const confirmedEvents = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];
  if (!confirmedEvents.includes(payload?.event)) return;

  const payment = payload.payment;
  if (!payment) return;

  const customerId = payment.customer;
  if (!customerId) return;

  const sub = await subscriptionService.findByAsaasCustomerId(customerId);
  if (!sub) {
    console.warn('[PAYMENT] Webhook recebido para customer desconhecido:', customerId);
    return;
  }

  const paymentId = payment.id;
  if (sub.last_payment_id && paymentId && sub.last_payment_id === paymentId) {
    console.warn('[PAYMENT] Webhook idempotente (mesmo payment.id) — reexecutando só migração trial se pendente:', paymentId);
    try {
      const migration = await trialAccountService.migrateToLiveAccount(sub.clinic_id);
      if (migration?.migrated) {
        console.log(`[PAYMENT] Conta-fantasma convertida (retry) clinic_id=${sub.clinic_id} vendas=${migration.sales} custos=${migration.costs}`);
      }
    } catch (migrationError) {
      console.error('[PAYMENT] Falha ao converter conta-fantasma (retry):', migrationError?.message || migrationError);
    }
    return;
  }

  await subscriptionService.activate(sub.clinic_id, {
    asaasPaymentId: paymentId,
    paymentUrl: sub.payment_url
  });

  let migrationSummary = { migrated: false, sales: 0, costs: 0 };
  try {
    const migration = await trialAccountService.migrateToLiveAccount(sub.clinic_id);
    migrationSummary = migration || migrationSummary;
    if (migration?.migrated) {
      console.log(`[PAYMENT] Conta-fantasma convertida clinic_id=${sub.clinic_id} vendas=${migration.sales} custos=${migration.costs}`);
    }
  } catch (migrationError) {
    console.error('[PAYMENT] Falha ao converter conta-fantasma:', migrationError?.message || migrationError);
  }

  await analyticsService
    .track('subscription_activated_via_webhook', {
      phone: null,
      userId: sub.clinic_id,
      source: 'asaas_webhook',
      properties: {
        payment_id: paymentId,
        trial_migrated: Boolean(migrationSummary?.migrated),
        migrated_sales: migrationSummary?.sales || 0,
        migrated_costs: migrationSummary?.costs || 0
      }
    })
    .catch(() => {});

  console.log(`[PAYMENT] Plano ativado para clinic_id=${sub.clinic_id} (payment=${paymentId})`);

  try {
    const outboundMessageService = require('./outboundMessageService');
    const subscriptionCopy = require('../copy/subscriptionCopy');
    const profile = await userRepository.findById(sub.clinic_id);
    if (profile?.telefone) {
      await outboundMessageService.sendText(profile.telefone, subscriptionCopy.planActivated());
    }
  } catch (e) {
    console.error('[PAYMENT] Falha ao enviar mensagem de confirmação:', e?.message);
  }
}

module.exports = { generatePaymentLink, handleWebhook, createOrGetCustomer };
