const { formatarMoeda } = require('../utils/currency');

module.exports = {
  progressoSemanal(faturamento, meta, progresso, faltam, barras, vazias) {
    let msg = `📊 *ACOMPANHAMENTO SEMANAL DA META*\n\n`;
    msg += `Meta mensal: ${formatarMoeda(meta)}\n`;
    msg += `Faturamento atual: ${formatarMoeda(faturamento)}\n`;
    msg += `Progresso: ${progresso.toFixed(1)}%\n\n`;
    msg += `[${'▓'.repeat(barras)}${'░'.repeat(vazias)}]\n\n`;
    if (faltam > 0) {
      msg += `Faltam *${formatarMoeda(faltam)}* para atingir a meta 💪\n\n`;
      msg += `_Continue assim! Cada atendimento conta._`;
    } else {
      msg += `🎉 *Meta atingida!* Parabéns, você superou o objetivo deste mês!`;
    }
    return msg;
  },

  semMeta() {
    return `📊 Você ainda não tem uma meta mensal definida.\n\nPara definir, envie: *"minha meta é R$ 50000"*`;
  },
};
