const supabase = require('../db/supabase');
const cashflowService = require('./cashflowService');
const evolutionService = require('./evolutionService');
const copy = require('../copy/emergencyWhatsappCopy');

class EmergencyModeService {
  async getStatus(userId) {
    const projection = await cashflowService.getCashflowProjection(userId, 30);

    let saldoMinimo = projection.saldoAtual;
    let dataRisco = null;
    let runningBalance = projection.saldoAtual;

    for (const day of projection.days) {
      runningBalance += (day.entradas || 0) - (day.saidas || 0);
      if (runningBalance < saldoMinimo) {
        saldoMinimo = runningBalance;
        dataRisco = day.date;
      }
    }

    const alert = saldoMinimo < 0;

    return {
      alert,
      saldoAtual: projection.saldoAtual,
      saldoMinimo: parseFloat(saldoMinimo.toFixed(2)),
      dataRisco,
      diasAnalisados: 30,
    };
  }

  async checkAndAlert() {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, telefone')
      .not('telefone', 'is', null);

    if (error) {
      console.error('[EMERGENCY] Erro ao buscar perfis:', error.message);
      return [];
    }

    const alertsSent = [];

    for (const profile of profiles || []) {
      try {
        const status = await this.getStatus(profile.id);
        if (status.alert) {
          const message = copy.alertaCaixaNegativo(status.saldoMinimo, status.dataRisco);
          await evolutionService.sendMessage(profile.telefone, message);
          alertsSent.push({ user_id: profile.id, saldoMinimo: status.saldoMinimo, dataRisco: status.dataRisco });
          console.log(`[EMERGENCY] Alerta enviado para ${profile.telefone}`);
        }
      } catch (err) {
        console.error(`[EMERGENCY] Erro para ${profile.id}:`, err.message);
      }
    }

    console.log(`[EMERGENCY] ${alertsSent.length} alertas enviados`);
    return alertsSent;
  }
}

module.exports = new EmergencyModeService();
