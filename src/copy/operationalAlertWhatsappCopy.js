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
  const emoji = janelaDias === 1 ? '🚨' : janelaDias <= 3 ? '⚠️' : 'ℹ️';
  const titulo = janelaDias === 1 ? 'vence *amanhã*' : `vence em *${janelaDias} dias*`;
  const linhas = items.slice(0, 6).map((item) => {
    const nome = item.descricao || item.categoria || 'Conta a pagar';
    return `• ${nome}: ${formatCurrency(item.valor)} — ${formatDate(item.data_vencimento)}`;
  });
  const extra = items.length > 6 ? `\n...e mais ${items.length - 6} conta(s).` : '';
  return (
    `${emoji} *Contas a pagar: ${titulo}*\n\n` +
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

/**
 * Alerta proativo de gap de caixa — dona da clínica.
 * @param {number} saldoAtual
 * @param {Array<{data: string, saldoAcumulado: number}>} negativeDays
 * @returns {string|null}
 */
function gapDeCaixa(saldoAtual, negativeDays = []) {
  if (!negativeDays.length) return null;
  const shown = negativeDays.slice(0, 3);
  const linhas = shown.map((d) => `• ${formatDate(d.data)}: saldo projetado ${formatCurrency(d.saldoAcumulado)}`);
  const extra = negativeDays.length > 3 ? `\n...e mais ${negativeDays.length - 3} dia(s) negativos.` : '';
  return (
    '⚡ *Atenção: caixa negativo previsto*\n\n' +
    `Saldo atual: *${formatCurrency(saldoAtual)}*\n\n` +
    `Dias com caixa negativo nos próximos 30 dias:\n${linhas.join('\n')}${extra}\n\n` +
    'Digite *fluxo de caixa* para ver o calendário completo.'
  );
}

/**
 * Cobrança Tier 1 — 1 a 6 dias de atraso, tom informativo e amigável.
 * @param {Array<{nome: string, totalEmAtraso: number, diasAtrasoMax: number}>} clientes
 * @returns {string|null}
 */
function cobrancaTier1(clientes = []) {
  if (!clientes.length) return null;
  const linhas = clientes.slice(0, 5).map((c) => `• ${c.nome}: ${formatCurrency(c.totalEmAtraso)}`);
  const extra = clientes.length > 5 ? `\n...e mais ${clientes.length - 5} cliente(s).` : '';
  return (
    '📋 *Pagamentos em atraso (1–6 dias)*\n\n' +
    `${linhas.join('\n')}${extra}\n\n` +
    'Pode ser esquecimento. Que tal enviar uma mensagem personalizada lembrando cada cliente?'
  );
}

/**
 * Cobrança Tier 2 — 7 a 14 dias de atraso, tom profissional e atento.
 * @param {Array<{nome: string, totalEmAtraso: number, diasAtrasoMax: number}>} clientes
 * @returns {string|null}
 */
function cobrancaTier2(clientes = []) {
  if (!clientes.length) return null;
  const linhas = clientes.slice(0, 5).map((c) => `• ${c.nome}: ${formatCurrency(c.totalEmAtraso)} — ${c.diasAtrasoMax}d em atraso`);
  const extra = clientes.length > 5 ? `\n...e mais ${clientes.length - 5} cliente(s).` : '';
  return (
    '⚠️ *Cobranças em atraso (7–14 dias)*\n\n' +
    `${linhas.join('\n')}${extra}\n\n` +
    'Recomendamos um contato direto e atencioso com cada um desses clientes.'
  );
}

/**
 * Cobrança Tier 3 — 15 a 29 dias de atraso, tom urgente com ação clara.
 * @param {Array<{nome: string, totalEmAtraso: number, diasAtrasoMax: number}>} clientes
 * @returns {string|null}
 */
function cobrancaTier3(clientes = []) {
  if (!clientes.length) return null;
  const linhas = clientes.slice(0, 5).map((c) => `• ${c.nome}: ${formatCurrency(c.totalEmAtraso)} — ${c.diasAtrasoMax}d em atraso`);
  const extra = clientes.length > 5 ? `\n...e mais ${clientes.length - 5} cliente(s).` : '';
  return (
    '🔴 *Cobranças urgentes (15–29 dias)*\n\n' +
    `${linhas.join('\n')}${extra}\n\n` +
    'Esses valores precisam de atenção imediata. Entre em contato e combine uma solução.'
  );
}

/**
 * Cobrança Escalada — 30+ dias de atraso, tom sério com negociação individual.
 * @param {Array<{nome: string, totalEmAtraso: number, diasAtrasoMax: number}>} clientes
 * @returns {string|null}
 */
function cobrancaEscalado(clientes = []) {
  if (!clientes.length) return null;
  const linhas = clientes.slice(0, 5).map((c) => `• ${c.nome}: ${formatCurrency(c.totalEmAtraso)} — ${c.diasAtrasoMax}d em atraso`);
  const extra = clientes.length > 5 ? `\n...e mais ${clientes.length - 5} cliente(s).` : '';
  return (
    '🚨 *Cobranças escaladas (30+ dias)*\n\n' +
    `${linhas.join('\n')}${extra}\n\n` +
    'Situação crítica. Considere uma abordagem individual e uma negociação para regularizar.'
  );
}

module.exports = {
  contasVencendo,
  validades,
  estoqueCritico,
  retornoPaciente,
  reativacaoPaciente,
  gapDeCaixa,
  cobrancaTier1,
  cobrancaTier2,
  cobrancaTier3,
  cobrancaEscalado,
  formatCurrency,
  formatDate,
};
