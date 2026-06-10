/**
 * Copy de WhatsApp para inadimplência e recebíveis vencidos.
 */

const { formatarMoeda } = require('../utils/currency');

function riskLabel(risk) {
  if (risk === 'alto') return 'alto';
  if (risk === 'medio') return 'médio';
  return 'baixo';
}

function emptyOverview() {
  return 'Não encontrei parcelas vencidas no momento.\n\nPara ver tudo que ainda vai receber, digite *parcelas a receber*.';
}

function overview(payload = {}) {
  const clientes = payload.clientes || [];
  if (!payload.totalEmAtraso || clientes.length === 0) {
    return emptyOverview();
  }

  const lines = [
    '⚠️ *Inadimplência / recebíveis vencidos*',
    '',
    `Total em atraso: *${formatarMoeda(payload.totalEmAtraso)}*`,
    `Parcelas vencidas: *${payload.totalParcelas || 0}*`
  ];

  if (Number(payload.percentualFaturamento) > 0) {
    lines.push(`Impacto no mês: *${payload.percentualFaturamento}%* do faturamento registrado`);
  }

  lines.push('', '*Principais clientes:*');
  clientes.slice(0, 5).forEach((client) => {
    lines.push(
      `• ${client.nome || 'Cliente'} — ${formatarMoeda(client.totalEmAtraso)} · ` +
      `${client.totalParcelas} parcela(s) · ${client.diasAtrasoMax}d atraso · risco ${riskLabel(client.risco)}`
    );
  });

  if (clientes.length > 5) {
    lines.push(`... e mais ${clientes.length - 5} cliente(s).`);
  }

  lines.push('', 'Para ver próximos recebimentos, digite *parcelas a receber*.');
  return lines.join('\n');
}

function temporaryError() {
  return 'Não consegui consultar os recebíveis vencidos agora. Tente novamente em alguns instantes.';
}

function alert(payload = {}) {
  const clientes = payload.clientes || [];
  if (!payload.totalEmAtraso || clientes.length === 0) return '';

  const lines = [
    '⚠️ *Alerta de inadimplência*',
    '',
    `Há *${formatarMoeda(payload.totalEmAtraso)}* em parcelas vencidas.`
  ];

  clientes.slice(0, 3).forEach((client) => {
    lines.push(`• ${client.nome || 'Cliente'} — ${formatarMoeda(client.totalEmAtraso)} · ${client.diasAtrasoMax}d atraso`);
  });

  lines.push('', 'Digite *inadimplência* para ver o resumo completo.');
  return lines.join('\n');
}

module.exports = {
  emptyOverview,
  overview,
  temporaryError,
  alert
};
