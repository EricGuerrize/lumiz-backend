/**
 * Copies WhatsApp — alertas operacionais proativos.
 * Centraliza textos enviados por crons opt-in para evitar hardcode em services.
 */

function formatCurrency(value) {
  const number = Number(value) || 0;
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(value) {
  const [y, m, d] = String(value || '').split('-');
  if (!y || !m || !d) return value || '-';
  return `${d}/${m}`;
}

function contasVencendo(items = [], janelaDias) {
  if (!items.length) return null;
  const titulo = janelaDias === 1
    ? 'vence amanhã'
    : `vence em ${janelaDias} dias`;
  const linhas = items.slice(0, 6).map((item) => {
    const nome = item.descricao || item.categoria || 'Conta a pagar';
    return `• ${nome}: ${formatCurrency(item.valor)} — ${formatDate(item.data_vencimento)}`;
  });
  const extra = items.length > 6 ? `\n...e mais ${items.length - 6} conta(s).` : '';
  return (
    `📌 *Contas a pagar: ${titulo}*\n\n` +
    `${linhas.join('\n')}${extra}\n\n` +
    'Digite *contas a pagar* para ver o calendário completo.'
  );
}

function validades(items = []) {
  if (!items.length) return null;
  const linhas = items.slice(0, 6).map((item) => {
    const quantidade = item.quantidade != null
      ? ` · ${Number(item.quantidade).toLocaleString('pt-BR')} ${item.unidade || 'un.'}`
      : '';
    const valor = item.valorRisco != null && Number(item.valorRisco) > 0
      ? ` · risco ${formatCurrency(item.valorRisco)}`
      : '';
    const lote = item.lote ? ` · lote ${item.lote}` : '';
    return `• ${item.nome} — ${formatDate(item.validade)}${lote}${quantidade}${valor}`;
  });
  const extra = items.length > 6 ? `\n...e mais ${items.length - 6} item(ns).` : '';
  return (
    '⚠️ *Validades em atenção*\n\n' +
    `${linhas.join('\n')}${extra}\n\n` +
    'Digite *validades* para ver a lista completa.'
  );
}

function estoqueCritico(items = []) {
  if (!items.length) return null;
  const linhas = items.slice(0, 8).map((item) => {
    const min = item.estoqueMinimo || item.estoque_minimo || 0;
    const atual = item.estoqueAtual ?? item.estoque_atual ?? 0;
    const unidade = item.unidade || 'un.';
    const status = item.status === 'critico' ? 'crítico' : 'baixo';
    const cobertura = item.diasSuprimento != null
      ? ` · ${Math.round(Number(item.diasSuprimento) * 10) / 10}d`
      : '';
    return `• ${item.nome}: ${atual} ${unidade} (mín. ${min}) — ${status}${cobertura}`;
  });
  return (
    '📦 *Estoque em atenção*\n\n' +
    `${linhas.join('\n')}\n\n` +
    'Digite *estoque* para revisar os saldos.'
  );
}

function retornoPaciente(items = []) {
  if (!items.length) return null;
  const linhas = items.slice(0, 6).map((item) => {
    return `• ${item.paciente} — ${item.procedimento} · último em ${formatDate(item.ultimaData)} (${item.diasSemAtendimento}d)`;
  });
  return (
    '👤 *Pacientes para retorno*\n\n' +
    `${linhas.join('\n')}\n\n` +
    'Sugestão: revise a agenda e decida manualmente quem deve ser contatado.'
  );
}

function reativacaoPaciente(items = []) {
  if (!items.length) return null;
  const linhas = items.slice(0, 6).map((item) => {
    return `• ${item.paciente} — sem atendimento há ${item.diasSemAtendimento}d`;
  });
  return (
    '👥 *Pacientes sem retorno recente*\n\n' +
    `${linhas.join('\n')}\n\n` +
    'Não enviei nada para pacientes. Esta é só uma lista para você avaliar.'
  );
}

module.exports = {
  contasVencendo,
  validades,
  estoqueCritico,
  retornoPaciente,
  reativacaoPaciente,
  formatCurrency,
  formatDate,
};
