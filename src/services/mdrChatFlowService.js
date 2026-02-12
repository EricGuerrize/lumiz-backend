const { normalizePhone } = require('../utils/phone');
const mdrService = require('./mdrService');
const onboardingService = require('./onboardingService');
const mdrCopy = require('../copy/mdrWhatsappCopy');

const STEP = {
  CHOOSE_METHOD: 'CHOOSE_METHOD',
  PROVIDER_MANUAL: 'PROVIDER_MANUAL',
  PROVIDER_OCR: 'PROVIDER_OCR',
  MANUAL_RATES: 'MANUAL_RATES',
  REVIEW_MANUAL: 'REVIEW_MANUAL',
  SETTLEMENT_MANUAL: 'SETTLEMENT_MANUAL',
  OCR_WAIT_IMAGE: 'OCR_WAIT_IMAGE',
  OCR_REVIEW: 'OCR_REVIEW',
  SETTLEMENT_OCR: 'SETTLEMENT_OCR'
};

class MdrChatFlowService {
  constructor() {
    this.states = new Map();
  }

  isActive(phone) {
    const normalized = normalizePhone(phone) || phone;
    return this.states.has(normalized);
  }

  isTrigger(messageLower) {
    const text = messageLower || '';
    if (text.includes('configurar maquininha') || text.includes('configurar taxas')) {
      return true;
    }
    if (text.includes('maquininha') && text.includes('configurar')) return true;
    if (text.includes('taxas do cartao') || text.includes('taxa cartao')) return true;
    return false;
  }

  isCancel(messageLower) {
    return ['cancelar', 'parar', 'sair'].some((kw) => messageLower === kw);
  }

  async handleMessageIfNeeded({ phone, user, message }) {
    const normalizedPhone = normalizePhone(phone) || phone;
    const trimmed = (message || '').trim();
    const lower = trimmed.toLowerCase();

    if (!user || !user.id) {
      return null;
    }

    if (this.isActive(normalizedPhone)) {
      return await this.handleMessage({ phone: normalizedPhone, user, message: trimmed });
    }

    if (this.isTrigger(lower)) {
      return await this.startFlow({ phone: normalizedPhone, user });
    }

    if (lower.includes('revisar taxas') || lower === 'revisar') {
      return await this.handleOcrFollowup({ phone: normalizedPhone, user, message: lower });
    }

    return null;
  }

  async handleMedia({ phone, user, mediaUrl }) {
    const normalizedPhone = normalizePhone(phone) || phone;
    const state = this.states.get(normalizedPhone);
    if (!state || state.step !== STEP.OCR_WAIT_IMAGE) {
      return null;
    }

    if (!mediaUrl) {
      return mdrCopy.needImage();
    }

    await mdrService.requestOcr({
      phone: normalizedPhone,
      userId: user.id,
      imageUrl: mediaUrl,
      provider: state.provider || null
    });

    this.states.delete(normalizedPhone);
    return mdrCopy.ocrReceived({ provider: state.provider });
  }

  async startFlow({ phone, user }) {
    this.states.set(phone, {
      step: STEP.CHOOSE_METHOD,
      userId: user.id
    });
    return mdrCopy.intro();
  }

  async handleMessage({ phone, user, message }) {
    const state = this.states.get(phone);
    const lower = message.toLowerCase();

    if (this.isCancel(lower)) {
      this.states.delete(phone);
      return mdrCopy.cancelled();
    }

    switch (state.step) {
      case STEP.CHOOSE_METHOD: {
        const choice = this._choice(message, {
          manual: ['1', 'manual', 'digitar', 'texto'],
          ocr: ['2', 'print', 'foto', 'imagem']
        });

        if (!choice) {
          return mdrCopy.invalidChoice();
        }

        if (choice === 'manual') {
          state.step = STEP.PROVIDER_MANUAL;
          return mdrCopy.askProvider();
        }

        state.step = STEP.PROVIDER_OCR;
        return mdrCopy.askProvider();
      }

      case STEP.PROVIDER_MANUAL: {
        state.provider = message;
        state.step = STEP.MANUAL_RATES;
        return mdrCopy.manualRatesRequest();
      }

      case STEP.PROVIDER_OCR: {
        state.provider = message;
        state.step = STEP.OCR_WAIT_IMAGE;
        return mdrCopy.ocrRequest();
      }

      case STEP.MANUAL_RATES: {
        state.rawText = message;
        state.parsed = this._parseManualRates(message);
        state.step = STEP.REVIEW_MANUAL;
        return mdrCopy.manualReview({
          provider: state.provider,
          rawText: state.rawText,
          resumo: this._formatManualSummary(state.parsed)
        });
      }

      case STEP.REVIEW_MANUAL: {
        const choice = this._choice(message, {
          confirm: ['1', 'confirmar', 'sim', 'ok'],
          edit: ['2', 'corrigir', 'ajustar']
        });

        if (!choice) {
          return mdrCopy.invalidChoice();
        }

        if (choice === 'edit') {
          state.step = STEP.MANUAL_RATES;
          return mdrCopy.manualRatesRequest();
        }

        state.step = STEP.SETTLEMENT_MANUAL;
        return mdrCopy.settlementQuestion();
      }

      case STEP.SETTLEMENT_MANUAL: {
        const settlement = this._choice(message, {
          automatic_d1: ['1', 'automatico', 'automatica', 'd+1', 'd1', 'antecipado'],
          automatic_d30: ['2', 'd+30', 'd30', '30 dias', 'trinta dias'],
          no_fluxo: ['3', 'no fluxo', 'parcelado', 'mes a mes', 'mensal']
        });

        if (!settlement) {
          return mdrCopy.invalidChoice();
        }

        const settlementMode = this._normalizeSettlementMode(settlement);
        const rawPayload = {
          raw_text: state.rawText,
          settlement_mode: settlementMode,
          parsed: state.parsed
        };

        const config = await mdrService.saveManualConfig({
          phone,
          userId: user.id,
          provider: state.provider,
          bandeiras: state.parsed?.bandeiras || [],
          tiposVenda: state.parsed?.tiposVenda || {},
          parcelas: state.parsed?.parcelas || {},
          rawPayload
        });

        await mdrService.confirmConfig(config.id, {
          rawPayload: { ...(config.raw_payload || {}), settlement_mode: settlementMode }
        });

        await this._markConfigured(phone, config.id, settlementMode);
        this.states.delete(phone);
        return mdrCopy.done();
      }

      case STEP.OCR_REVIEW: {
        const choice = this._choice(message, {
          confirm: ['1', 'confirmar', 'sim', 'ok'],
          edit: ['2', 'corrigir', 'ajustar']
        });

        if (!choice) {
          return mdrCopy.invalidChoice();
        }

        if (choice === 'edit') {
          state.step = STEP.OCR_WAIT_IMAGE;
          return mdrCopy.ocrRequest();
        }

        state.step = STEP.SETTLEMENT_OCR;
        return mdrCopy.settlementQuestion();
      }

      case STEP.SETTLEMENT_OCR: {
        const settlement = this._choice(message, {
          automatic_d1: ['1', 'automatico', 'automatica', 'd+1', 'd1', 'antecipado'],
          automatic_d30: ['2', 'd+30', 'd30', '30 dias', 'trinta dias'],
          no_fluxo: ['3', 'no fluxo', 'parcelado', 'mes a mes', 'mensal']
        });

        if (!settlement) {
          return mdrCopy.invalidChoice();
        }

        const settlementMode = this._normalizeSettlementMode(settlement);
        if (state.configId) {
          await mdrService.confirmConfig(state.configId, {
            rawPayload: { ...(state.rawPayload || {}), settlement_mode: settlementMode }
          });
          await this._markConfigured(phone, state.configId, settlementMode);
        }

        this.states.delete(phone);
        return mdrCopy.done();
      }

      default:
        this.states.delete(phone);
        return null;
    }
  }

  async handleOcrFollowup({ phone, user, message }) {
    const config = await mdrService.getLatestConfig(phone, user.id);
    if (!config) {
      return mdrCopy.noPendingConfig();
    }

    const lower = message.toLowerCase();

    if (lower.includes('revisar taxas') || lower === 'revisar') {
      const resumo = this._formatRates(config);
      this.states.set(phone, {
        step: STEP.OCR_REVIEW,
        configId: config.id,
        provider: config.provider,
        rawPayload: config.raw_payload
      });
      return mdrCopy.ocrReview({ provider: config.provider, resumo });
    }

    if (lower === 'sim') {
      const resumo = this._formatRates(config);
      this.states.set(phone, {
        step: STEP.SETTLEMENT_OCR,
        configId: config.id,
        provider: config.provider,
        rawPayload: config.raw_payload,
        resumo
      });
      return mdrCopy.settlementQuestion();
    }

    return null;
  }

  _choice(message, map) {
    const text = (message || '').toLowerCase().trim();
    for (const [key, options] of Object.entries(map)) {
      if (options.some((opt) => text === opt || text.includes(opt))) return key;
    }
    return null;
  }

  _formatRates(config) {
    const tipos = config.tipos_venda || config.raw_payload?.tiposVenda || {};
    const parcelas = config.parcelas || config.raw_payload?.parcelas || {};
    const bandeiras = config.bandeiras || config.raw_payload?.bandeiras || [];

    const lines = [];
    if (bandeiras.length) {
      lines.push(`Bandeiras: ${bandeiras.join(', ')}`);
    }

    if (tipos.debito) lines.push(`Debito: ${this._fmtPercent(tipos.debito)}`);
    if (tipos.credito_avista) lines.push(`Credito 1x: ${this._fmtPercent(tipos.credito_avista)}`);

    if (tipos.parcelado?.tabela) {
      const tabela = tipos.parcelado.tabela;
      if (tabela['2-6']) lines.push(`Credito 2-6x: ${this._fmtPercent(tabela['2-6'])}`);
      if (tabela['7-12']) lines.push(`Credito 7-12x: ${this._fmtPercent(tabela['7-12'])}`);
    }

    const parcelKeys = Object.keys(parcelas || {});
    if (!lines.length && parcelKeys.length) {
      lines.push('Parcelas:');
      parcelKeys.forEach((k) => lines.push(`- ${k}x: ${this._fmtPercent(parcelas[k])}`));
    }

    if (!lines.length) {
      return 'Taxas recebidas. Se algo estiver errado, responda 2 para corrigir.';
    }

    return lines.join('\n');
  }

  _formatManualSummary(parsed) {
    if (!parsed) return '';
    const lines = [];
    if (parsed.bandeiras?.length) {
      lines.push(`Bandeiras: ${parsed.bandeiras.join(', ')}`);
    }
    if (parsed.tiposVenda?.debito !== undefined) {
      lines.push(`Debito: ${this._fmtPercent(parsed.tiposVenda.debito)}`);
    }
    if (parsed.tiposVenda?.credito_avista !== undefined) {
      lines.push(`Credito 1x: ${this._fmtPercent(parsed.tiposVenda.credito_avista)}`);
    }
    const tabela = parsed.tiposVenda?.parcelado?.tabela;
    if (tabela?.['2-6']) lines.push(`Credito 2-6x: ${this._fmtPercent(tabela['2-6'])}`);
    if (tabela?.['7-12']) lines.push(`Credito 7-12x: ${this._fmtPercent(tabela['7-12'])}`);
    if (parsed.parcelas && Object.keys(parsed.parcelas).length) {
      Object.keys(parsed.parcelas).forEach((k) => {
        lines.push(`Parcela ${k}x: ${this._fmtPercent(parsed.parcelas[k])}`);
      });
    }
    return lines.join('\n');
  }

  _parseManualRates(rawText) {
    const text = (rawText || '').toLowerCase();
    const parsed = {
      bandeiras: [],
      tiposVenda: {},
      parcelas: {}
    };

    const bandeiras = ['visa', 'master', 'mastercard', 'elo', 'amex', 'hipercard', 'dinners', 'diners'];
    bandeiras.forEach((b) => {
      if (text.includes(b)) {
        const label = b === 'mastercard' ? 'mastercard' : b;
        if (!parsed.bandeiras.includes(label)) parsed.bandeiras.push(label);
      }
    });

    const pct = (value) => {
      if (!value) return undefined;
      const normalized = value.replace(',', '.');
      const num = Number(normalized);
      return Number.isNaN(num) ? undefined : num;
    };

    const matchDebito = text.match(/debito[^0-9]*([0-9]+[.,]?[0-9]*)%/);
    if (matchDebito) parsed.tiposVenda.debito = pct(matchDebito[1]);

    const matchCreditoAvista = text.match(/credito[^0-9]*(1x|avista|a vista)?[^0-9]*([0-9]+[.,]?[0-9]*)%/);
    if (matchCreditoAvista) parsed.tiposVenda.credito_avista = pct(matchCreditoAvista[2]);

    const match26 = text.match(/(2\s*-\s*6x|2\s*a\s*6x)[^0-9]*([0-9]+[.,]?[0-9]*)%/);
    const match712 = text.match(/(7\s*-\s*12x|7\s*a\s*12x)[^0-9]*([0-9]+[.,]?[0-9]*)%/);
    if (match26 || match712) {
      parsed.tiposVenda.parcelado = { tabela: {} };
      if (match26) parsed.tiposVenda.parcelado.tabela['2-6'] = pct(match26[2]);
      if (match712) parsed.tiposVenda.parcelado.tabela['7-12'] = pct(match712[2]);
    }

    const genericParcelas = [...text.matchAll(/(\d{1,2})\s*x[^0-9]*([0-9]+[.,]?[0-9]*)%/g)];
    genericParcelas.forEach((m) => {
      const key = m[1];
      const value = pct(m[2]);
      if (value !== undefined) parsed.parcelas[key] = value;
    });

    return parsed;
  }

  _fmtPercent(value) {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'number') return `${value}%`;
    return String(value);
  }

  _normalizeSettlementMode(choice) {
    const normalized = String(choice || '').toLowerCase().trim();
    if (normalized === 'automatic' || normalized === 'automatic_d1' || normalized === 'd+1' || normalized === 'd1') {
      return 'automatic_d1';
    }
    if (normalized === 'automatic_d30' || normalized === 'd+30' || normalized === 'd30') {
      return 'automatic_d30';
    }
    if (normalized === 'flow' || normalized === 'no_fluxo') {
      return 'no_fluxo';
    }
    return 'automatic_d1';
  }

  async _markConfigured(phone, configId, settlementMode) {
    try {
      await onboardingService.savePhaseData(phone, 'phase2', {
        mdr_status: 'configured',
        last_mdr_config_id: configId,
        settlement_mode: settlementMode
      });
      await onboardingService.updateStepStatus(phone, 'phase2_mdr_setup', 'completed', {
        source: 'chat',
        config_id: configId
      });
    } catch (error) {
      console.error('[MDR_CHAT] Falha ao atualizar onboarding:', error.message);
    }
  }
}

module.exports = new MdrChatFlowService();
