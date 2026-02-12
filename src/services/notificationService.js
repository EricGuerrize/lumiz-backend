const supabase = require('../db/supabase');
const cacheService = require('./cacheService');
const evolutionService = require('./evolutionService');
const { formatarMoeda } = require('../utils/currency');

class NotificationService {
  constructor() {
    this.ALERT_TTL_SECONDS = 24 * 60 * 60;
  }

  normalizeCategory(category) {
    return String(category || 'Outros').trim();
  }

  toMonthKey(dateValue) {
    const date = new Date(dateValue || Date.now());
    if (Number.isNaN(date.getTime())) return 'unknown';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  buildAlertKey({ userId, category, date, currentValue }) {
    return [
      'fixed_cost_alert',
      userId,
      this.normalizeCategory(category).toLowerCase().replace(/\s+/g, '_'),
      this.toMonthKey(date),
      Number(currentValue).toFixed(2)
    ].join(':');
  }

  async getManagerPhone(userId) {
    const { data: primaryMember, error: memberError } = await supabase
      .from('clinic_members')
      .select('telefone')
      .eq('clinic_id', userId)
      .eq('is_primary', true)
      .eq('is_active', true)
      .eq('confirmed', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberError && memberError.code !== 'PGRST116') {
      console.error('[FIXED_COST_ALERT] Erro ao buscar membro primário:', memberError);
    }

    if (primaryMember?.telefone) {
      return primaryMember.telefone;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('telefone')
      .eq('id', userId)
      .maybeSingle();

    if (profileError && profileError.code !== 'PGRST116') {
      console.error('[FIXED_COST_ALERT] Erro ao buscar telefone do profile:', profileError);
    }

    return profile?.telefone || null;
  }

  formatDelta(deltaValue, deltaPercent) {
    const sign = deltaValue >= 0 ? '+' : '-';
    const deltaAbs = Math.abs(deltaValue);
    const percentAbs = Math.abs(deltaPercent || 0);
    return `${sign}${formatarMoeda(deltaAbs)} (${sign}${percentAbs.toFixed(2)}%)`;
  }

  buildMessage({ category, previousValue, currentValue, deltaValue, deltaPercent }) {
    const trendText = deltaValue > 0 ? 'subiu' : 'caiu';
    return [
      `⚠️ *Custo fixo alterado*: ${category}`,
      '',
      `Mês anterior: ${formatarMoeda(previousValue)}`,
      `Atual: ${formatarMoeda(currentValue)}`,
      `Diferença: ${this.formatDelta(deltaValue, deltaPercent)}`,
      '',
      `Esse custo ${trendText} em relação ao último lançamento.`
    ].join('\n');
  }

  async notifyFixedCostChange({ userId, category, currentValue, previousValue, date }) {
    const categoryNormalized = this.normalizeCategory(category);
    const current = Number(currentValue || 0);
    const previous = Number(previousValue || 0);

    if (!Number.isFinite(current) || !Number.isFinite(previous)) return { sent: false, reason: 'invalid_values' };
    if (current === previous) return { sent: false, reason: 'no_change' };

    const alertKey = this.buildAlertKey({
      userId,
      category: categoryNormalized,
      date,
      currentValue: current
    });

    const alreadySent = await cacheService.get(alertKey);
    if (alreadySent) {
      return { sent: false, reason: 'duplicate' };
    }

    const managerPhone = await this.getManagerPhone(userId);
    if (!managerPhone) {
      return { sent: false, reason: 'manager_phone_not_found' };
    }

    const deltaValue = current - previous;
    const deltaPercent = previous > 0 ? (deltaValue / previous) * 100 : 0;
    const message = this.buildMessage({
      category: categoryNormalized,
      previousValue: previous,
      currentValue: current,
      deltaValue,
      deltaPercent
    });

    await evolutionService.sendMessage(managerPhone, message);
    await cacheService.set(alertKey, { sentAt: new Date().toISOString() }, this.ALERT_TTL_SECONDS);

    return { sent: true, managerPhone };
  }
}

module.exports = new NotificationService();
