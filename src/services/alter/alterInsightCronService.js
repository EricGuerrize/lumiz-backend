const supabase = require('../../db/supabase');
const featureFlagService = require('../featureFlagService');
const alterRecebiveisService = require('./alterRecebiveisService');
const antecipacaoService = require('./antecipacaoService');
const outboundMessageService = require('../outboundMessageService');
const alterCopy = require('../../copy/alterWhatsappCopy');

/**
 * Onda 3.C — Cron semanal de insight Alter.
 *
 * Para cada usuário com flag `alter_enabled` ligada e WhatsApp cadastrado:
 *   1) Calcula posição de recebíveis (livre / comprometido / antecipado).
 *   2) Chama recomendar(userId) para sugerir antecipação.
 *   3) Envia mensagem WhatsApp via outboundMessageService (Meta Cloud API).
 *
 * Idempotente: só envia 1x por semana por usuário (registra em
 * `feature_flags.meta` ou cai num INSERT-only no futuro).
 *
 * Uso: chamar em `GET /api/cron/alter-insights` com `x-cron-secret`.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

class AlterInsightCronService {
  /**
   * Executa o cron: para cada usuário elegível, calcula posição e recomendação,
   * envia mensagem WhatsApp e marca `alter_insight_last_sent`.
   *
   * Falhas individuais não interrompem o batch — são acumuladas em `errors[]`
   * e devolvidas no payload de retorno (cron de Railway pode logar e seguir).
   *
   * @returns {Promise<{
   *   status: 'success',
   *   total: number,
   *   sent: number,
   *   skipped: number,
   *   errors: number,
   *   detalhe: { sent: Array, skipped: Array, errors: Array }
   * }>}
   */
  async run() {
    const targets = await this._listTargetUsers();
    if (targets.length === 0) {
      return { status: 'success', sent: 0, total: 0, message: 'Nenhum usuário com alter_enabled.' };
    }

    const sent = [];
    const skipped = [];
    const errors = [];

    for (const user of targets) {
      try {
        if (await this._wasSentThisWeek(user.id)) {
          skipped.push({ user_id: user.id, reason: 'already_sent_this_week' });
          continue;
        }
        const posicao = await alterRecebiveisService.getPosicao(user.id);
        const totalAtivo = posicao.livre.valor + posicao.comprometido.valor + posicao.antecipado.valor;
        if (totalAtivo === 0) {
          skipped.push({ user_id: user.id, reason: 'no_recebiveis' });
          continue;
        }
        const recomendacao = await antecipacaoService.recomendar(user.id, { horizonte_dias: 30 });
        const mensagem = alterCopy.insightSemanal({
          livre: posicao.livre.valor,
          comprometido: posicao.comprometido.valor,
          antecipado: posicao.antecipado.valor,
          recomendacao: recomendacao.recomendacao,
          simulacao: recomendacao.simulacao
        });

        if (user.telefone) {
          await outboundMessageService.sendText(user.telefone, mensagem);
        }
        await this._markSentThisWeek(user.id);
        sent.push({ user_id: user.id, telefone: user.telefone || null });
      } catch (err) {
        errors.push({ user_id: user.id, error: err.message });
      }
    }

    return {
      status: 'success',
      total: targets.length,
      sent: sent.length,
      skipped: skipped.length,
      errors: errors.length,
      detalhe: { sent, skipped, errors }
    };
  }

  /**
   * Lista usuários com flag `alter_enabled` ligada e telefone cadastrado.
   *
   * Implementação atual: faz N+1 (1 query nos profiles + 1 lookup por usuário).
   * Aceitável enquanto a base é pequena. Quando crescer, refatorar para JOIN
   * em SQL via RPC `select_users_with_feature_flag('alter_enabled')` — issue
   * registrada no `HANDOFF_BACKEND.md` na seção de débito técnico.
   *
   * @private
   * @returns {Promise<Array<{id: string, telefone: string|null}>>}
   */
  async _listTargetUsers() {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, telefone')
      .eq('alertas_whatsapp_ativos', true)
      .not('telefone', 'is', null);
    if (error) throw error;

    const elegibles = [];
    for (const p of profiles || []) {
      const enabled = await featureFlagService.isEnabled('alter_enabled', p.id);
      if (enabled) elegibles.push(p);
    }
    return elegibles;
  }

  /**
   * Idempotência semanal: olha `feature_flags(name='alter_insight_last_sent')`
   * e checa `meta.timestamp`. Retorna true se o último envio foi há < 7 dias.
   *
   * @private
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async _wasSentThisWeek(userId) {
    const { data } = await supabase
      .from('feature_flags')
      .select('meta, updated_at')
      .eq('user_id', userId)
      .eq('name', 'alter_insight_last_sent')
      .maybeSingle();
    if (!data || !data.meta?.timestamp) return false;
    const last = new Date(data.meta.timestamp);
    return (Date.now() - last.getTime()) < WEEK_MS;
  }

  /**
   * Persiste timestamp do envio em `feature_flags(name='alter_insight_last_sent')`.
   * Upsert por `(user_id, name)` mantém apenas o último.
   *
   * @private
   * @param {string} userId
   */
  async _markSentThisWeek(userId) {
    await supabase
      .from('feature_flags')
      .upsert({
        user_id: userId,
        name: 'alter_insight_last_sent',
        enabled: true,
        meta: { timestamp: new Date().toISOString() }
      }, { onConflict: 'user_id,name' });
  }
}

module.exports = new AlterInsightCronService();
module.exports.AlterInsightCronService = AlterInsightCronService;
