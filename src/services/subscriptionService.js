const supabase = require('../db/supabase');
const cacheService = require('./cacheService');

const TRIAL_DAYS = 14;
const PLAN_DAYS = 30;
const GRACE_MS = 24 * 60 * 60 * 1000; // 24h in ms
const CACHE_TTL = 300; // 5 minutes

function cacheKey(clinicId) {
  return `subscription:${clinicId}`;
}

async function startTrial(clinicId) {
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('subscriptions')
    .upsert(
      { clinic_id: clinicId, status: 'trial', trial_ends_at: trialEndsAt, updated_at: new Date().toISOString() },
      { onConflict: 'clinic_id', ignoreDuplicates: true }
    );

  if (error) throw error;
  await cacheService.delete(cacheKey(clinicId));
}

async function getStatus(clinicId) {
  const cached = await cacheService.get(cacheKey(clinicId));
  if (cached) return cached;

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('clinic_id', clinicId)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    await cacheService.set(cacheKey(clinicId), data, CACHE_TTL);
  }

  return data || null;
}

async function isBlocked(clinicId) {
  let sub;
  try {
    sub = await getStatus(clinicId);
  } catch (e) {
    console.error('[SUBSCRIPTION] Falha ao verificar status, liberando acesso:', e?.message);
    return false;
  }

  if (!sub) return false;

  const now = Date.now();

  if (sub.status === 'paid') {
    if (!sub.plan_expires_at) return false;
    return new Date(sub.plan_expires_at).getTime() + GRACE_MS < now;
  }

  if (sub.status === 'trial') {
    return new Date(sub.trial_ends_at).getTime() + GRACE_MS < now;
  }

  return sub.status === 'expired' || sub.status === 'cancelled';
}

async function activate(clinicId, { asaasPaymentId, paymentUrl } = {}) {
  const planExpiresAt = new Date(Date.now() + PLAN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'paid',
      plan_expires_at: planExpiresAt,
      last_payment_id: asaasPaymentId || null,
      payment_url: paymentUrl || null,
      updated_at: new Date().toISOString()
    })
    .eq('clinic_id', clinicId);

  if (error) throw error;
  await cacheService.delete(cacheKey(clinicId));
}

async function updatePaymentUrl(clinicId, { asaasCustomerId, paymentUrl }) {
  const { error } = await supabase
    .from('subscriptions')
    .update({
      asaas_customer_id: asaasCustomerId || null,
      payment_url: paymentUrl,
      updated_at: new Date().toISOString()
    })
    .eq('clinic_id', clinicId);

  if (error) throw error;
  await cacheService.delete(cacheKey(clinicId));
}

async function getTrialsExpiringSoon(days) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('subscriptions')
    .select('clinic_id, trial_ends_at, reminder_7d_sent_at, reminder_2d_sent_at')
    .eq('status', 'trial')
    .gte('trial_ends_at', now)
    .lte('trial_ends_at', cutoff);

  if (error) throw error;
  return data || [];
}

async function markReminderSent(clinicId, days) {
  const field = days <= 2 ? 'reminder_2d_sent_at' : 'reminder_7d_sent_at';
  const { error } = await supabase
    .from('subscriptions')
    .update({ [field]: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('clinic_id', clinicId);

  if (error) throw error;
}

async function findByAsaasCustomerId(asaasCustomerId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('asaas_customer_id', asaasCustomerId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

module.exports = {
  startTrial,
  getStatus,
  isBlocked,
  activate,
  updatePaymentUrl,
  getTrialsExpiringSoon,
  markReminderSent,
  findByAsaasCustomerId
};
