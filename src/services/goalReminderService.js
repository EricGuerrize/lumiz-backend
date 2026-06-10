const supabase = require('../db/supabase');
const outboundMessageService = require('./outboundMessageService');
const transactionController = require('../controllers/transactionController');
const copy = require('../copy/goalWhatsappCopy');
const { alreadySent, markSent } = require('./reminderSentHelper');

class GoalReminderService {
  _getISOWeek() {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return `${now.getFullYear()}_W${String(week).padStart(2, '0')}`;
  }

  async checkAndSendGoalReminders() {
    // Friday guard — retorna vazio imediatamente se não for sexta
    if (new Date().getDay() !== 5) return [];

    const sent = [];
    const semanaKey = `meta_semana_${this._getISOWeek()}`;

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, telefone, meta_mensal')
      .eq('alertas_whatsapp_ativos', true)
      .not('meta_mensal', 'is', null)
      .not('telefone', 'is', null);

    if (error) {
      console.error('[META] Erro ao buscar perfis:', error.message);
      return sent;
    }

    const now = new Date();

    for (const profile of profiles || []) {
      try {
        // Dedup semanal — não reenvia se já enviou nesta semana ISO
        const jaEnviado = await alreadySent(profile.id, semanaKey);
        if (jaEnviado) continue;

        const report = await transactionController.getMonthlyReport(
          profile.id, now.getFullYear(), now.getMonth() + 1
        );

        const meta = parseFloat(profile.meta_mensal);
        const faturamento = report.entradas;
        const progresso = (faturamento / meta) * 100;
        const faltam = Math.max(0, meta - faturamento);
        const barras = Math.min(10, Math.floor(progresso / 10));
        const vazias = 10 - barras;

        const message = copy.progressoSemanal(faturamento, meta, progresso, faltam, barras, vazias);
        await outboundMessageService.sendText(profile.telefone, message);
        await markSent(profile.id, profile.id, semanaKey);
        sent.push({ user_id: profile.id, progresso: progresso.toFixed(1) });
        console.log(`[META] Enviado para ${profile.telefone}: ${progresso.toFixed(1)}%`);
      } catch (err) {
        console.error(`[META] Erro para ${profile.id}:`, err.message);
      }
    }

    console.log(`[META] ${sent.length} lembretes de meta enviados`);
    return sent;
  }
}

module.exports = new GoalReminderService();
