function alertaCaixaNegativo(saldoMinimo, dataRisco) {
  const data = new Date(dataRisco).toLocaleDateString('pt-BR');
  return `⚠️ *Alerta de Caixa — Lumiz*\n\nSeu fluxo de caixa projetado ficará negativo em *${data}*.\n\nSaldo mínimo projetado: *R$ ${saldoMinimo.toFixed(2)}*\n\nAcesse o painel para revisar suas contas a pagar e receitas previstas. 💡`;
}

module.exports = { alertaCaixaNegativo };
