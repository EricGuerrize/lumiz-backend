const { formatarMoeda } = require('../utils/currency');

module.exports = {
  parcelaAntecipado(clienteNome, valor, parcelaAtual, totalParcelas, dias) {
    return `⏰ *LEMBRETE DE PARCELA*\n\n` +
      `📋 Cliente: *${clienteNome}*\n` +
      `💳 Parcela: *${parcelaAtual}/${totalParcelas}*\n` +
      `💵 Valor: *${formatarMoeda(valor)}*\n\n` +
      `📅 Vence em *${dias} dia${dias > 1 ? 's' : ''}*\n\n` +
      `_Prepare-se para receber o pagamento no prazo!_`;
  },

  parcelaNoDia(clienteNome, valor, parcelaAtual, totalParcelas, bandeira) {
    let msg = `⏰ *LEMBRETE DE PARCELA*\n\n` +
      `📋 Cliente: *${clienteNome}*\n` +
      `💳 Parcela: *${parcelaAtual}/${totalParcelas}*\n` +
      `💵 Valor: *${formatarMoeda(valor)}*\n`;
    if (bandeira) msg += `🏷️ Bandeira: ${bandeira.toUpperCase()}\n`;
    msg += `\n📅 Vence *HOJE*\n\n`;
    if (parcelaAtual === totalParcelas) {
      msg += `🎉 *Última parcela!*`;
    } else {
      const restantes = totalParcelas - parcelaAtual;
      msg += `📌 Faltam ${restantes} parcela${restantes > 1 ? 's' : ''}`;
    }
    return msg;
  },

  parcelaAtraso(clienteNome, valor, parcelaAtual, totalParcelas, diasAtraso) {
    return `🔴 *PARCELA EM ATRASO*\n\n` +
      `📋 Cliente: *${clienteNome}*\n` +
      `💳 Parcela: *${parcelaAtual}/${totalParcelas}*\n` +
      `💵 Valor: *${formatarMoeda(valor)}*\n\n` +
      `⚠️ Atraso de *${diasAtraso} dia${diasAtraso > 1 ? 's' : ''}*\n\n` +
      `Entre em contato com o cliente para regularizar o pagamento.`;
  },

  contaAntecipada(descricao, valor, dataVencimento, dias) {
    const dataFormatada = new Date(dataVencimento + 'T12:00:00').toLocaleDateString('pt-BR');
    return `*LEMBRETE DE CONTA A PAGAR*\n\n` +
      `Descrição: *${descricao}*\n` +
      `Valor: *${formatarMoeda(valor)}*\n` +
      `Vencimento: *${dataFormatada}*\n\n` +
      `*Vence em ${dias} dia${dias > 1 ? 's' : ''}*\n\n` +
      `Para marcar como paga, digite "paguei ${descricao.toLowerCase()}".`;
  },

  contaNoDia(descricao, valor, dataVencimento) {
    const dataFormatada = new Date(dataVencimento + 'T12:00:00').toLocaleDateString('pt-BR');
    return `*LEMBRETE DE CONTA A PAGAR*\n\n` +
      `Descrição: *${descricao}*\n` +
      `Valor: *${formatarMoeda(valor)}*\n` +
      `Vencimento: *${dataFormatada}*\n\n` +
      `*Vence HOJE!*\n\n` +
      `Para marcar como paga, digite "paguei ${descricao.toLowerCase()}".`;
  },

  contaAtraso(descricao, valor, diasAtraso) {
    return `🔴 *CONTA EM ATRASO*\n\n` +
      `Descrição: *${descricao}*\n` +
      `Valor: *${formatarMoeda(valor)}*\n\n` +
      `⚠️ Atraso de *${diasAtraso} dia${diasAtraso > 1 ? 's' : ''}*\n\n` +
      `Regularize o pagamento o quanto antes para evitar juros.\n` +
      `Para marcar como paga, digite "paguei ${descricao.toLowerCase()}".`;
  },
};
