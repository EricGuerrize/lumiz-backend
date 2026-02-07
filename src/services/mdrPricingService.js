const DEFAULT_SETTLEMENT_MODE = 'automatic_d1';

class MdrPricingService {
  constructor() {
    this.holidayCache = new Map();
  }

  normalizePaymentMethod(method, installments = 1) {
    const text = String(method || '').toLowerCase().trim();

    if (!text) {
      return installments > 1 ? 'parcelado' : null;
    }

    if (text.includes('pix')) return 'pix';
    if (text.includes('dinheiro') || text.includes('especie')) return 'dinheiro';
    if (text.includes('debito')) return 'debito';
    if (text.includes('parcelado')) return 'parcelado';
    if (text.includes('credito') || text.includes('cartao') || text === 'avista' || text === 'a_vista') {
      return installments > 1 ? 'parcelado' : 'credito_avista';
    }

    return installments > 1 ? 'parcelado' : text;
  }

  normalizeSettlementMode(mode) {
    const text = String(mode || '').toLowerCase().trim();
    if (!text) return DEFAULT_SETTLEMENT_MODE;

    if (
      text === 'automatic_d1' ||
      text === 'd+1' ||
      text === 'd1' ||
      text === 'automatic' ||
      text === 'automatica'
    ) {
      return 'automatic_d1';
    }

    if (text === 'automatic_d30' || text === 'd+30' || text === 'd30') {
      return 'automatic_d30';
    }

    if (
      text === 'no_fluxo' ||
      text === 'flow' ||
      text === 'no fluxo' ||
      text === 'mes_a_mes' ||
      text === 'mensal'
    ) {
      return 'no_fluxo';
    }

    return DEFAULT_SETTLEMENT_MODE;
  }

  calculateSalePricing({
    valorBruto,
    formaPagamento,
    parcelas,
    bandeiraCartao,
    saleDate,
    mdrConfig
  }) {
    const grossValue = this._roundCurrency(valorBruto);
    const installments = this._normalizeInstallments(parcelas);
    const paymentMethod = this.normalizePaymentMethod(formaPagamento, installments);
    const normalizedBrand = this._normalizeBrand(bandeiraCartao);
    const normalizedDate = this._parseDate(saleDate);
    const settlementMode = mdrConfig
      ? this.normalizeSettlementMode(
        mdrConfig?.raw_payload?.settlement_mode || mdrConfig?.settlement_mode
      )
      : (paymentMethod === 'parcelado' ? 'no_fluxo' : DEFAULT_SETTLEMENT_MODE);

    const rateResolution = this.resolveRate({
      paymentMethod,
      installments,
      brand: normalizedBrand,
      mdrConfig
    });

    const percent = this._toNumber(rateResolution.percent) || 0;
    const netTotal = this._roundCurrency(grossValue * (1 - (percent / 100)));
    const scheduleDates = this._buildSettlementSchedule({
      paymentMethod,
      installments,
      saleDate: normalizedDate,
      settlementMode
    });

    const snapshotBase = {
      mdr_config_id: mdrConfig?.id || null,
      payment_method: paymentMethod,
      settlement_mode: settlementMode,
      brand: normalizedBrand || null,
      rate_source: rateResolution.source,
      used_average: rateResolution.usedAverage === true,
      compatible_rates: rateResolution.compatibleRates || [],
      sale_date: this._formatDate(normalizedDate)
    };

    const parcelPlans = this._buildParcelPlans({
      paymentMethod,
      installments,
      grossValue,
      netTotal,
      percent,
      settlementMode,
      scheduleDates,
      snapshotBase
    });

    return {
      valorBruto: grossValue,
      valorLiquido: netTotal,
      mdrPercentApplied: this._roundPercent(percent),
      settlementModeApplied: settlementMode,
      recebimentoPrevisto: parcelPlans[0]?.recebimento_previsto || this._formatDate(normalizedDate),
      mdrRuleSnapshot: {
        ...snapshotBase,
        parcelas_geradas: parcelPlans.length
      },
      parcelasPlan: parcelPlans
    };
  }

  resolveRate({ paymentMethod, installments, brand, mdrConfig }) {
    if (!paymentMethod || paymentMethod === 'pix' || paymentMethod === 'dinheiro') {
      return {
        percent: 0,
        source: 'no_mdr_for_payment_method',
        usedAverage: false,
        compatibleRates: []
      };
    }

    if (!mdrConfig) {
      return {
        percent: 0,
        source: 'no_mdr_config',
        usedAverage: false,
        compatibleRates: []
      };
    }

    const tiposVenda = mdrConfig.tipos_venda || mdrConfig.raw_payload?.tiposVenda || {};
    const parcelasConfig = mdrConfig.parcelas || mdrConfig.raw_payload?.parcelas || {};

    let exactRate = null;
    let source = null;
    let compatibleRates = [];

    if (paymentMethod === 'debito') {
      exactRate = this._resolveValueByBrand(tiposVenda.debito, brand);
      source = exactRate !== null ? 'debito_exact' : null;
      compatibleRates = this._collectNumericRates(tiposVenda.debito);
    } else if (paymentMethod === 'credito_avista') {
      exactRate = this._resolveValueByBrand(tiposVenda.credito_avista, brand);
      source = exactRate !== null ? 'credito_avista_exact' : null;
      compatibleRates = this._collectNumericRates(tiposVenda.credito_avista);
    } else if (paymentMethod === 'parcelado') {
      const installmentKey = String(installments);
      const exactInstallmentConfig = parcelasConfig?.[installmentKey];
      exactRate = this._resolveValueByBrand(exactInstallmentConfig, brand);
      source = exactRate !== null ? `parcelas_${installmentKey}x_exact` : null;

      const table = tiposVenda?.parcelado?.tabela || {};
      if (exactRate === null) {
        const rangeMatch = this._findRangeRate(table, installments, brand);
        if (rangeMatch.rate !== null) {
          exactRate = rangeMatch.rate;
          source = rangeMatch.source;
        }
      }

      compatibleRates = [
        ...this._collectNumericRates(exactInstallmentConfig),
        ...this._collectNumericRates(table),
        ...this._collectNumericRates(parcelasConfig)
      ];
    }

    if (exactRate !== null) {
      return {
        percent: exactRate,
        source: source || 'exact',
        usedAverage: false,
        compatibleRates: this._uniqueNumbers(compatibleRates)
      };
    }

    const averageSourceRates = compatibleRates.length
      ? compatibleRates
      : this._collectNumericRates({ tiposVenda, parcelasConfig });

    if (!averageSourceRates.length) {
      return {
        percent: 0,
        source: 'no_rate_found',
        usedAverage: false,
        compatibleRates: []
      };
    }

    const avg = averageSourceRates.reduce((sum, value) => sum + value, 0) / averageSourceRates.length;
    return {
      percent: this._roundPercent(avg),
      source: 'average_fallback',
      usedAverage: true,
      compatibleRates: this._uniqueNumbers(averageSourceRates)
    };
  }

  _buildParcelPlans({
    paymentMethod,
    installments,
    grossValue,
    netTotal,
    percent,
    settlementMode,
    scheduleDates,
    snapshotBase
  }) {
    if (paymentMethod === 'parcelado' && settlementMode === 'no_fluxo') {
      const grossParts = this._splitCurrency(grossValue, installments);
      const netParts = this._splitCurrency(netTotal, installments);

      return netParts.map((netPart, index) => ({
        numero: index + 1,
        valor_bruto: grossParts[index],
        valor_liquido: netPart,
        mdr_percent_applied: this._roundPercent(percent),
        recebimento_previsto: this._formatDate(scheduleDates[index]),
        mdr_rule_snapshot: {
          ...snapshotBase,
          parcela: index + 1,
          total_parcelas: installments
        }
      }));
    }

    return [{
      numero: 1,
      valor_bruto: grossValue,
      valor_liquido: netTotal,
      mdr_percent_applied: this._roundPercent(percent),
      recebimento_previsto: this._formatDate(scheduleDates[0] || new Date()),
      mdr_rule_snapshot: {
        ...snapshotBase,
        parcela: 1,
        total_parcelas: paymentMethod === 'parcelado' ? installments : 1
      }
    }];
  }

  _buildSettlementSchedule({ paymentMethod, installments, saleDate, settlementMode }) {
    if (paymentMethod === 'pix' || paymentMethod === 'dinheiro') {
      return [saleDate];
    }

    if (settlementMode === 'automatic_d30') {
      return [this._nextBusinessDay(this._addDays(saleDate, 30))];
    }

    if (settlementMode === 'automatic_d1') {
      return [this._nextBusinessDay(this._addDays(saleDate, 1))];
    }

    const nth = saleDate.getDate();
    const totalInstallments = paymentMethod === 'parcelado' ? installments : 1;
    const dates = [];
    for (let i = 1; i <= totalInstallments; i += 1) {
      const target = this._addMonths(saleDate, i);
      dates.push(this._nthBusinessDay(target.getFullYear(), target.getMonth(), nth));
    }
    return dates;
  }

  _findRangeRate(table, installments, brand) {
    const entries = Object.entries(table || {});
    for (const [key, value] of entries) {
      const range = this._parseRange(key);
      if (!range) continue;
      if (installments < range.min || installments > range.max) continue;
      const rate = this._resolveValueByBrand(value, brand);
      if (rate !== null) {
        return { rate, source: `range_${key}` };
      }
    }
    return { rate: null, source: null };
  }

  _resolveValueByBrand(value, brand) {
    const parsedNumber = this._toNumber(value);
    if (parsedNumber !== null) {
      return parsedNumber;
    }

    if (!value || typeof value !== 'object') {
      return null;
    }

    if (brand) {
      const aliases = this._brandAliases(brand);
      for (const [key, keyValue] of Object.entries(value)) {
        if (!this._keyMatchesBrand(key, aliases)) continue;
        const parsed = this._toNumber(keyValue);
        if (parsed !== null) {
          return parsed;
        }
      }
    }

    return null;
  }

  _collectNumericRates(value) {
    if (value === null || value === undefined) {
      return [];
    }

    const parsed = this._toNumber(value);
    if (parsed !== null) {
      return [parsed];
    }

    if (typeof value === 'object') {
      return Object.values(value).flatMap((item) => this._collectNumericRates(item));
    }

    return [];
  }

  _parseRange(key) {
    const clean = String(key || '').toLowerCase().replace(/\s/g, '');
    const direct = clean.match(/^(\d{1,2})-(\d{1,2})x?$/);
    if (direct) {
      return { min: Number(direct[1]), max: Number(direct[2]) };
    }

    const mixed = clean.match(/^(\d{1,2})x?a(\d{1,2})x?$/);
    if (mixed) {
      return { min: Number(mixed[1]), max: Number(mixed[2]) };
    }

    return null;
  }

  _brandAliases(brand) {
    const normalized = this._normalizeBrand(brand);
    if (!normalized) return [];

    const groups = {
      visa: ['visa'],
      mastercard: ['master', 'mastercard'],
      elo: ['elo'],
      amex: ['amex', 'americanexpress', 'americanexpresscard', 'american express']
    };

    for (const aliases of Object.values(groups)) {
      if (aliases.includes(normalized)) {
        return aliases;
      }
    }
    return [normalized];
  }

  _keyMatchesBrand(key, aliases) {
    const normalizedKey = this._normalizeBrand(key);
    return aliases.some((alias) => normalizedKey.includes(alias));
  }

  _normalizeBrand(brand) {
    if (!brand) return null;
    return String(brand)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
  }

  _normalizeInstallments(value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 1) {
      return Math.round(parsed);
    }
    return 1;
  }

  _splitCurrency(total, count) {
    if (count <= 1) return [this._roundCurrency(total)];

    const totalCents = Math.round(this._roundCurrency(total) * 100);
    const baseCents = Math.floor(totalCents / count);
    let remainder = totalCents - (baseCents * count);

    const parts = [];
    for (let i = 0; i < count; i += 1) {
      const extra = remainder > 0 ? 1 : 0;
      parts.push((baseCents + extra) / 100);
      remainder -= extra;
    }

    return parts.map((value) => this._roundCurrency(value));
  }

  _nextBusinessDay(date) {
    let cursor = this._parseDate(date);
    while (!this._isBusinessDay(cursor)) {
      cursor = this._addDays(cursor, 1);
    }
    return cursor;
  }

  _nthBusinessDay(year, month, nth) {
    const cappedNth = Math.max(1, Number(nth) || 1);
    const lastDay = new Date(year, month + 1, 0).getDate();

    let count = 0;
    let lastBusinessDay = null;

    for (let day = 1; day <= lastDay; day += 1) {
      const current = new Date(year, month, day, 12, 0, 0);
      if (!this._isBusinessDay(current)) continue;
      count += 1;
      lastBusinessDay = current;
      if (count === cappedNth) {
        return current;
      }
    }

    return lastBusinessDay || new Date(year, month, lastDay, 12, 0, 0);
  }

  _isBusinessDay(date) {
    const weekday = date.getDay();
    if (weekday === 0 || weekday === 6) {
      return false;
    }

    const holidaySet = this._getHolidaySet(date.getFullYear());
    return !holidaySet.has(this._formatDate(date));
  }

  _getHolidaySet(year) {
    if (this.holidayCache.has(year)) {
      return this.holidayCache.get(year);
    }

    const holidays = new Set();
    const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
    fixed.forEach((md) => holidays.add(`${year}-${md}`));

    const easter = this._calculateEaster(year);
    const goodFriday = this._addDays(easter, -2);
    holidays.add(this._formatDate(goodFriday));

    this.holidayCache.set(year, holidays);
    return holidays;
  }

  _calculateEaster(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  _addDays(date, days) {
    const next = this._parseDate(date);
    next.setDate(next.getDate() + Number(days || 0));
    return next;
  }

  _addMonths(date, months) {
    const next = this._parseDate(date);
    next.setMonth(next.getMonth() + Number(months || 0));
    return next;
  }

  _parseDate(value) {
    if (value instanceof Date) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0);
    }

    if (typeof value === 'string') {
      const parts = value.split('-').map((part) => Number(part));
      if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
        return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
      }
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    }

    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0);
  }

  _formatDate(date) {
    const d = this._parseDate(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  _toNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const clean = value.replace('%', '').replace(',', '.').trim();
      const parsed = Number(clean);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  _roundCurrency(value) {
    return Number((Number(value) || 0).toFixed(2));
  }

  _roundPercent(value) {
    return Number((Number(value) || 0).toFixed(4));
  }

  _uniqueNumbers(values) {
    return [...new Set((values || []).map((value) => this._roundPercent(value)))];
  }
}

module.exports = new MdrPricingService();
