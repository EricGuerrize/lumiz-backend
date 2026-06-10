/**
 * Fase WhatsApp — alertas operacionais opt-in.
 *
 * Envia briefings e alertas de validade apenas para perfis que ativaram
 * `alertas_whatsapp_ativos`, preservando o canal de WhatsApp contra spam.
 */

const supabase = require('../db/supabase');
const outboundMessageService = require('./outboundMessageService');
const nfValidadeService = require('./nfValidadeService');
const inadimplenciaService = require('./inadimplenciaService');
const QueryHandler = require('../controllers/messages/queryHandler');
const inadimplenciaCopy = require('../copy/inadimplenciaWhatsappCopy');
const { alreadySent, markSent } = require('./reminderSentHelper');

function readFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

class WhatsappOperationalAlertService {
  constructor() {
    this.queryHandler = new QueryHandler();
  }

  /**
   * @returns {Promise<Array<{user_id: string, phone: string, type: string}>>}
   */
  async sendDailyBriefings() {
    if (!readFlag('WHATSAPP_DAILY_BRIEFING_ENABLED', false)) {
      return [];
    }

    const profiles = await this._getOptInProfiles();
    const sent = [];

    for (const profile of profiles) {
      try {
        const message = await this.queryHandler.handleDailyBriefing({ id: profile.id });
        await outboundMessageService.sendText(profile.telefone, message, {
          messageType: 'daily_briefing',
          source: 'cron'
        });
        sent.push({ user_id: profile.id, phone: profile.telefone, type: 'daily_briefing' });
      } catch (error) {
        console.error(`[OP_ALERTS] Falha briefing ${profile.id}:`, error.message);
      }
    }

    return sent;
  }

  /**
   * @returns {Promise<Array<{user_id: string, phone: string, item_id: string}>>}
   */
  async sendValidityAlerts() {
    if (!readFlag('WHATSAPP_VALIDITY_ALERTS_ENABLED', false)) {
      return [];
    }

    const profiles = await this._getOptInProfiles();
    const sent = [];

    for (const profile of profiles) {
      try {
        const { itens } = await nfValidadeService.listarProximos(profile.id, 15);
        const actionable = (itens || []).filter((item) => item.vence_em_dias <= 15);
        if (!actionable.length) continue;

        const unsent = [];
        for (const item of actionable.slice(0, 5)) {
          const type = this._validityReminderType(item);
          if (await alreadySent(item.id, type)) continue;
          unsent.push({ item, type });
        }

        if (!unsent.length) continue;

        let message = `⚠️ *Validades em atenção*\n\n`;
        unsent.forEach(({ item }) => {
          const status = item.vencido
            ? `vencido há ${Math.abs(item.vence_em_dias)}d`
            : item.vence_em_dias === 0
              ? 'vence hoje'
              : `vence em ${item.vence_em_dias}d`;
          message += `• ${item.descricao} — ${this._formatDate(item.data_validade)} · ${status}\n`;
        });
        message += `\nDigite *validades* para ver a lista completa.`;

        await outboundMessageService.sendText(profile.telefone, message, {
          messageType: 'validity_alert',
          source: 'cron'
        });

        for (const { item, type } of unsent) {
          await markSent(profile.id, item.id, type);
          sent.push({ user_id: profile.id, phone: profile.telefone, item_id: item.id });
        }
      } catch (error) {
        console.error(`[OP_ALERTS] Falha validade ${profile.id}:`, error.message);
      }
    }

    return sent;
  }

  /**
   * @returns {Promise<Array<{user_id: string, phone: string, type: string, total_em_atraso: number}>>}
   */
  async sendInadimplenciaAlerts() {
    if (!readFlag('WHATSAPP_INADIMPLENCIA_ALERTS_ENABLED', false)) {
      return [];
    }

    const profiles = await this._getOptInProfiles();
    const sent = [];
    const type = this._inadimplenciaReminderType(new Date());

    for (const profile of profiles) {
      try {
        if (await alreadySent(profile.id, type)) continue;

        const overview = await inadimplenciaService.getOverview(profile.id);
        const message = inadimplenciaCopy.alert(overview);
        if (!message) continue;

        await outboundMessageService.sendText(profile.telefone, message, {
          messageType: 'inadimplencia_alert',
          source: 'cron'
        });

        await markSent(profile.id, profile.id, type);
        sent.push({
          user_id: profile.id,
          phone: profile.telefone,
          type: 'inadimplencia_alert',
          total_em_atraso: overview.totalEmAtraso || 0
        });
      } catch (error) {
        console.error(`[OP_ALERTS] Falha inadimplência ${profile.id}:`, error.message);
      }
    }

    return sent;
  }

  async _getOptInProfiles() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, telefone')
      .eq('alertas_whatsapp_ativos', true)
      .not('telefone', 'is', null);

    if (error) throw error;
    return data || [];
  }

  _validityReminderType(item) {
    if (item.vencido) return 'validade_vencida';
    if (item.vence_em_dias <= 0) return 'validade_hoje';
    if (item.vence_em_dias <= 7) return 'validade_7d';
    return 'validade_15d';
  }

  _formatDate(value) {
    const [y, m, d] = String(value || '').split('-');
    if (!y || !m || !d) return value || '—';
    return `${d}/${m}`;
  }

  _inadimplenciaReminderType(date) {
    const day = date.toISOString().split('T')[0];
    return `inadimplencia_${day}`;
  }
}

module.exports = new WhatsappOperationalAlertService();
