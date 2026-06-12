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
const cashflowService = require('./cashflowService');
const estoqueProdutoService = require('./estoqueProdutoService');
const QueryHandler = require('../controllers/messages/queryHandler');
const inadimplenciaCopy = require('../copy/inadimplenciaWhatsappCopy');
const operationalCopy = require('../copy/operationalAlertWhatsappCopy');
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
    const type = this._datedReminderType('daily_briefing');

    for (const profile of profiles) {
      try {
        if (await alreadySent(profile.id, type)) continue;

        const message = await this.queryHandler.handleDailyBriefing({ id: profile.id });
        await outboundMessageService.sendText(profile.telefone, message, {
          messageType: 'daily_briefing',
          source: 'cron'
        });
        await markSent(profile.id, profile.id, type);
        sent.push({ user_id: profile.id, phone: profile.telefone, type: 'daily_briefing' });
      } catch (error) {
        console.error(`[OP_ALERTS] Falha briefing ${profile.id}:`, error.message);
      }
    }

    return sent;
  }

  /**
   * Envia alerta diário de contas a pagar vencendo em 7, 3 e 1 dia.
   * @returns {Promise<Array<{user_id: string, phone: string, conta_id: string, window: number}>>}
   */
  async sendBillDueAlerts() {
    if (!readFlag('WHATSAPP_BILL_DUE_ALERTS_ENABLED', false)) {
      return [];
    }

    const profiles = await this._getOptInProfiles();
    const sent = [];

    for (const profile of profiles) {
      for (const windowDays of [7, 3, 1]) {
        try {
          const contas = await this._getBillsDueIn(profile.id, windowDays);
          const unsent = [];
          for (const conta of contas) {
            const type = this._datedReminderType(`conta_vencendo_${windowDays}d`);
            if (await alreadySent(conta.id, type)) continue;
            unsent.push(conta);
          }

          if (!unsent.length) continue;
          const message = operationalCopy.contasVencendo(unsent, windowDays);
          if (!message) continue;

          await outboundMessageService.sendText(profile.telefone, message, {
            messageType: 'bill_due_alert',
            source: 'cron'
          });

          const type = this._datedReminderType(`conta_vencendo_${windowDays}d`);
          for (const conta of unsent) {
            await markSent(profile.id, conta.id, type);
            sent.push({ user_id: profile.id, phone: profile.telefone, conta_id: conta.id, window: windowDays });
          }
        } catch (error) {
          console.error(`[OP_ALERTS] Falha contas a pagar ${profile.id}/${windowDays}d:`, error.message);
        }
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
        const actionable = await this._getValidityItems(profile.id, 30);
        if (!actionable.length) continue;

        const unsent = [];
        for (const item of actionable.slice(0, 5)) {
          const type = this._validityReminderType(item);
          if (await alreadySent(item.id, type)) continue;
          unsent.push({ item, type });
        }

        if (!unsent.length) continue;

        const message = operationalCopy.validades(unsent.map(({ item }) => item));
        if (!message) continue;

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
   * Envia alerta de estoque abaixo do mínimo configurado.
   * @returns {Promise<Array<{user_id: string, phone: string, product_id: string}>>}
   */
  async sendCriticalStockAlerts() {
    if (!readFlag('WHATSAPP_CRITICAL_STOCK_ALERTS_ENABLED', false)) {
      return [];
    }

    const profiles = await this._getOptInProfiles();
    const sent = [];
    const type = this._datedReminderType('estoque_critico');

    for (const profile of profiles) {
      try {
        const items = await estoqueProdutoService.listarAlertasCriticos(profile.id);
        const unsent = [];
        for (const item of items.slice(0, 8)) {
          if (await alreadySent(item.id, type)) continue;
          unsent.push(item);
        }
        if (!unsent.length) continue;

        const message = operationalCopy.estoqueCritico(unsent);
        if (!message) continue;

        await outboundMessageService.sendText(profile.telefone, message, {
          messageType: 'critical_stock_alert',
          source: 'cron'
        });

        for (const item of unsent) {
          await markSent(profile.id, item.id, type);
          sent.push({ user_id: profile.id, phone: profile.telefone, product_id: item.id });
        }
      } catch (error) {
        console.error(`[OP_ALERTS] Falha estoque crítico ${profile.id}:`, error.message);
      }
    }

    return sent;
  }

  /**
   * Sugere retornos por ciclo de procedimento para a dona da clínica.
   * @returns {Promise<Array<{user_id: string, phone: string, atendimento_id: string}>>}
   */
  async sendPatientReturnAlerts() {
    if (!readFlag('WHATSAPP_PATIENT_RETURN_ALERTS_ENABLED', false)) {
      return [];
    }

    const profiles = await this._getOptInProfiles();
    const sent = [];
    const type = this._datedReminderType('paciente_retorno');

    for (const profile of profiles) {
      try {
        const candidates = await this._getPatientReturnCandidates(profile.id);
        const unsent = [];
        for (const item of candidates.slice(0, 6)) {
          if (await alreadySent(item.atendimentoId, type)) continue;
          unsent.push(item);
        }
        const message = operationalCopy.retornoPaciente(unsent);
        if (!message) continue;

        await outboundMessageService.sendText(profile.telefone, message, {
          messageType: 'patient_return_alert',
          source: 'cron'
        });

        for (const item of unsent) {
          await markSent(profile.id, item.atendimentoId, type);
          sent.push({ user_id: profile.id, phone: profile.telefone, atendimento_id: item.atendimentoId });
        }
      } catch (error) {
        console.error(`[OP_ALERTS] Falha retorno paciente ${profile.id}:`, error.message);
      }
    }

    return sent;
  }

  /**
   * Sugere reativação de pacientes sem atendimento recente para a dona da clínica.
   * @returns {Promise<Array<{user_id: string, phone: string, cliente_id: string}>>}
   */
  async sendPatientReactivationAlerts() {
    if (!readFlag('WHATSAPP_PATIENT_REACTIVATION_ALERTS_ENABLED', false)) {
      return [];
    }

    const profiles = await this._getOptInProfiles();
    const sent = [];
    const type = this._weeklyReminderType('paciente_reativacao');

    for (const profile of profiles) {
      try {
        const candidates = await this._getPatientReactivationCandidates(profile.id, 45);
        const unsent = [];
        for (const item of candidates.slice(0, 6)) {
          if (await alreadySent(item.clienteId, type)) continue;
          unsent.push(item);
        }
        const message = operationalCopy.reativacaoPaciente(unsent);
        if (!message) continue;

        await outboundMessageService.sendText(profile.telefone, message, {
          messageType: 'patient_reactivation_alert',
          source: 'cron'
        });

        for (const item of unsent) {
          await markSent(profile.id, item.clienteId, type);
          sent.push({ user_id: profile.id, phone: profile.telefone, cliente_id: item.clienteId });
        }
      } catch (error) {
        console.error(`[OP_ALERTS] Falha reativação paciente ${profile.id}:`, error.message);
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

  /**
   * Alerta diário quando a projeção de 30 dias detecta caixa negativo.
   * @returns {Promise<Array<{user_id: string, phone: string, type: string}>>}
   */
  async sendCashFlowGapAlerts() {
    if (!readFlag('WHATSAPP_CASH_GAP_ALERTS_ENABLED', false)) return [];

    const profiles = await this._getOptInProfiles();
    const sent = [];
    const type = this._datedReminderType('cash_gap_alert');

    for (const profile of profiles) {
      try {
        if (await alreadySent(profile.id, type)) continue;

        const projection = await cashflowService.getCashflowProjection(profile.id, 30);
        if (!projection || !projection.summary || !projection.summary.temProjecaoCaixaNegativo) continue;

        const negativeDays = (projection.days || []).filter((d) => d.caixaNegativo);
        const message = operationalCopy.gapDeCaixa(projection.saldoAtual, negativeDays);
        if (!message) continue;

        await outboundMessageService.sendText(profile.telefone, message, {
          messageType: 'cash_gap_alert',
          source: 'cron',
        });

        await markSent(profile.id, profile.id, type);
        sent.push({ user_id: profile.id, phone: profile.telefone, type: 'cash_gap_alert' });
      } catch (error) {
        console.error(`[OP_ALERTS] Falha gap de caixa ${profile.id}:`, error.message);
      }
    }

    return sent;
  }

  /**
   * Régua de cobrança em 4 níveis por dias de atraso (1–6, 7–14, 15–29, 30+).
   * @returns {Promise<Array<{user_id: string, phone: string, tier: string}>>}
   */
  async sendCobrancaAlerts() {
    if (!readFlag('WHATSAPP_COBRANCA_ALERTS_ENABLED', false)) return [];

    const profiles = await this._getOptInProfiles();
    const sent = [];

    const tiers = [
      {
        key: 'tier1',
        type: () => this._datedReminderType('cobranca_t1'),
        filter: (dias) => dias >= 1 && dias < 7,
        copyFn: operationalCopy.cobrancaTier1,
        messageType: 'cobranca_alert_t1',
      },
      {
        key: 'tier2',
        type: () => this._datedReminderType('cobranca_t2'),
        filter: (dias) => dias >= 7 && dias < 15,
        copyFn: operationalCopy.cobrancaTier2,
        messageType: 'cobranca_alert_t2',
      },
      {
        key: 'tier3',
        type: () => this._datedReminderType('cobranca_t3'),
        filter: (dias) => dias >= 15 && dias < 30,
        copyFn: operationalCopy.cobrancaTier3,
        messageType: 'cobranca_alert_t3',
      },
      {
        key: 'escalado',
        type: () => this._datedReminderType('cobranca_escalado'),
        filter: (dias) => dias >= 30,
        copyFn: operationalCopy.cobrancaEscalado,
        messageType: 'cobranca_alert_escalado',
      },
    ];

    for (const profile of profiles) {
      try {
        const overview = await inadimplenciaService.getOverview(profile.id);
        const clientes = overview && overview.clientes ? overview.clientes : [];

        for (const tier of tiers) {
          const tierClientes = clientes.filter((c) => tier.filter(c.diasAtrasoMax || 0));
          if (!tierClientes.length) continue;

          const tierType = tier.type();
          if (await alreadySent(profile.id, tierType)) continue;

          const message = tier.copyFn(tierClientes);
          if (!message) continue;

          await outboundMessageService.sendText(profile.telefone, message, {
            messageType: tier.messageType,
            source: 'cron',
          });

          await markSent(profile.id, profile.id, tierType);
          sent.push({ user_id: profile.id, phone: profile.telefone, tier: tier.key });
        }
      } catch (error) {
        console.error(`[OP_ALERTS] Falha cobrança ${profile.id}:`, error.message);
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

  async _getBillsDueIn(userId, days) {
    const due = new Date();
    due.setDate(due.getDate() + Number(days));
    const dueStr = due.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('contas_pagar')
      .select('id, descricao, categoria, valor, data_vencimento, status_pagamento')
      .eq('user_id', userId)
      .eq('status_pagamento', 'pendente')
      .eq('data_vencimento', dueStr)
      .order('valor', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async _getValidityItems(userId, days) {
    const [lotes, legacy] = await Promise.all([
      estoqueProdutoService.listarLotesProximosVencimento(userId, days).catch((error) => {
        console.warn(`[OP_ALERTS] Falha validade estoque real ${userId}:`, error.message);
        return [];
      }),
      nfValidadeService.listarProximos(userId, days).catch((error) => {
        console.warn(`[OP_ALERTS] Falha validade NF legado ${userId}:`, error.message);
        return { itens: [] };
      })
    ]);

    const realItems = (lotes || []).map((item) => ({
      id: item.id,
      source: 'lote',
      nome: item.nome,
      validade: item.validade,
      lote: item.lote,
      quantidade: item.quantidade,
      unidade: item.unidade,
      valorRisco: item.valorRisco,
      vence_em_dias: item.venceEmDias,
      vencido: item.venceEmDias < 0,
    }));

    const legacyItems = (legacy.itens || []).map((item) => ({
      id: item.id,
      source: 'nf',
      nome: item.descricao,
      validade: item.data_validade,
      lote: null,
      quantidade: null,
      unidade: null,
      valorRisco: null,
      vence_em_dias: item.vence_em_dias,
      vencido: item.vencido,
    }));

    return [...realItems, ...legacyItems]
      .filter((item) => item.vence_em_dias <= days)
      .sort((a, b) => a.vence_em_dias - b.vence_em_dias);
  }

  async _getPatientReturnCandidates(userId) {
    const { data, error } = await supabase
      .from('atendimentos')
      .select('id, data, cliente_id, clientes(nome), atendimento_procedimentos(procedimentos(nome))')
      .eq('user_id', userId)
      .order('data', { ascending: false })
      .limit(250);
    if (error) throw error;

    const today = new Date().toISOString().split('T')[0];
    const seen = new Set();
    const candidates = [];

    for (const row of data || []) {
      const procedimento = row.atendimento_procedimentos?.[0]?.procedimentos?.nome || 'Procedimento';
      const key = `${row.cliente_id || row.clientes?.nome}:${procedimento}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const diasSemAtendimento = this._daysBetween(row.data, today);
      const ciclo = this._procedureCycleDays(procedimento);
      if (diasSemAtendimento < ciclo) continue;

      candidates.push({
        atendimentoId: row.id,
        clienteId: row.cliente_id,
        paciente: row.clientes?.nome || 'Paciente',
        procedimento,
        ultimaData: row.data,
        diasSemAtendimento,
        cicloDias: ciclo,
      });
    }

    return candidates.sort((a, b) => b.diasSemAtendimento - a.diasSemAtendimento);
  }

  async _getPatientReactivationCandidates(userId, days = 45) {
    const [clientesResult, atendimentosResult] = await Promise.all([
      supabase
        .from('clientes')
        .select('id, nome')
        .eq('user_id', userId)
        .order('nome', { ascending: true })
        .limit(300),
      supabase
        .from('atendimentos')
        .select('cliente_id, data')
        .eq('user_id', userId)
        .not('cliente_id', 'is', null)
        .order('data', { ascending: false })
        .limit(1000)
    ]);
    if (clientesResult.error) throw clientesResult.error;
    if (atendimentosResult.error) throw atendimentosResult.error;

    const latestByClient = new Map();
    for (const row of atendimentosResult.data || []) {
      if (!row.cliente_id || latestByClient.has(row.cliente_id)) continue;
      latestByClient.set(row.cliente_id, row.data);
    }

    const today = new Date().toISOString().split('T')[0];
    return (clientesResult.data || [])
      .map((cliente) => {
        const lastDate = latestByClient.get(cliente.id);
        if (!lastDate) return null;
        const diasSemAtendimento = this._daysBetween(lastDate, today);
        if (diasSemAtendimento < days) return null;
        return {
          clienteId: cliente.id,
          paciente: cliente.nome,
          ultimaData: lastDate,
          diasSemAtendimento,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.diasSemAtendimento - a.diasSemAtendimento);
  }

  _validityReminderType(item) {
    const source = item.source || 'item';
    if (item.vencido) return `validade_${source}_vencida`;
    if (item.vence_em_dias <= 0) return `validade_${source}_hoje`;
    if (item.vence_em_dias <= 7) return `validade_${source}_7d`;
    if (item.vence_em_dias <= 15) return `validade_${source}_15d`;
    return `validade_${source}_30d`;
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

  _datedReminderType(prefix) {
    const day = new Date().toISOString().split('T')[0];
    return `${prefix}_${day}`;
  }

  _weeklyReminderType(prefix) {
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((now - first) / 86400000) + first.getUTCDay() + 1) / 7);
    return `${prefix}_${now.getUTCFullYear()}_w${String(week).padStart(2, '0')}`;
  }

  _daysBetween(start, end) {
    if (!start || !end) return 0;
    return Math.floor((new Date(`${end}T12:00:00`) - new Date(`${String(start).slice(0, 10)}T12:00:00`)) / 86400000);
  }

  _procedureCycleDays(procedureName) {
    const value = String(procedureName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/botox|toxina|dysport|xeomin/.test(value)) return 120;
    if (/preench|hialuron|bioestimul|sculptra|radiesse/.test(value)) return 180;
    if (/limpeza|peeling|skinbooster|microagulh/.test(value)) return 45;
    if (/laser|depil/.test(value)) return 30;
    return 90;
  }
}

module.exports = new WhatsappOperationalAlertService();
