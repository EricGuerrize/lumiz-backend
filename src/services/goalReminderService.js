const supabase = require('../db/supabase');
const evolutionService = require('./evolutionService');
const transactionController = require('../controllers/transactionController');
const copy = require('../copy/goalWhatsappCopy');

class GoalReminderService {
  async checkAndSendGoalReminders() {
    const sent = [];

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, telefone, meta_mensal')
      .not('meta_mensal', 'is', null)
      .not('telefone', 'is', null);

    if (error) {
      console.error('[META] Erro ao buscar perfis:', error.message);
      return sent;
    }

    const now = new Date();

    for (const profile of profiles || []) {
      try {
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
        await evolutionService.sendMessage(profile.telefone, message);
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
