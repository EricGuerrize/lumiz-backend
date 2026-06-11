/**
 * Fase WhatsApp — contrato com a lista de comandos da ajuda.
 *
 * Os exemplos em `HelpHandler.handleHelp()` devem usar sempre `routeIntent`
 * (handlers determinísticos), não a rota agentic. Mantenha esta lista
 * sincronizada com o texto da ajuda ao alterar comandos.
 *
 * Consumido por `agentRouterService` (DETERMINISTIC_ONLY) e referenciado
 * em atalhos em `messageController`.
 */

/** @type {readonly string[]} */
const HELP_DETERMINISTIC_INTENTS = Object.freeze([
  'registrar_entrada',
  'registrar_saida',
  'consultar_saldo',
  'consultar_historico',
  'consultar_contas_pagar',
  'consultar_parcelas',
  'consultar_inadimplencia',
  'consultar_gap_caixa',
  'briefing_diario',
  'consultar_estoque',
  'estoque_entrada',
  'consultar_validade',
  'relatorio_mensal',
  'stats_hoje',
  'buscar_transacao',
  'exportar_dados',
  'consultar_meta'
]);

/**
 * Atalhos com mesma normalização que `messageController` (lower + sem acentos).
 * @param {string} msgSimples
 * @param {string} messageTrimmed
 * @returns {{ intencao: string, dados?: object, confidence: number, source: string }|null}
 */
function getHelpShortcutIntent(msgSimples, messageTrimmed) {
  if (!msgSimples || typeof msgSimples !== 'string') return null;
  const slashCommand = msgSimples.startsWith('/') ? msgSimples.replace(/^\/+/, '').trim() : null;
  if (slashCommand) {
    const aliases = {
      contas: 'contas a pagar',
      receber: 'parcelas a receber',
      inadimplencia: 'inadimplencia',
      inadimplência: 'inadimplencia',
      relatorio: 'relatorio',
      saldo: 'saldo',
      estoque: 'estoque'
    };
    msgSimples = aliases[slashCommand] || slashCommand;
  }

  if (msgSimples === 'saldo') {
    return { intencao: 'consultar_saldo', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'historico') {
    return { intencao: 'consultar_historico', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (
    msgSimples === 'contas a pagar' ||
    msgSimples === 'contas pagar' ||
    msgSimples === 'vencimentos' ||
    msgSimples === 'calendario de vencimentos' ||
    msgSimples === 'boletos a pagar'
  ) {
    return { intencao: 'consultar_contas_pagar', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'relatorio') {
    return { intencao: 'relatorio_mensal', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'stats hoje') {
    return { intencao: 'stats_hoje', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (
    msgSimples === 'briefing' ||
    msgSimples === 'resumo do dia' ||
    msgSimples === 'prioridades de hoje'
  ) {
    return { intencao: 'briefing_diario', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (
    msgSimples === 'gap de caixa' ||
    msgSimples === 'risco de caixa' ||
    msgSimples === 'projecao de caixa' ||
    msgSimples === 'projeção de caixa'
  ) {
    return { intencao: 'consultar_gap_caixa', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (
    msgSimples === 'parcelas' ||
    msgSimples === 'parcelas a receber' ||
    msgSimples === 'recebiveis' ||
    msgSimples === 'recebíveis'
  ) {
    return { intencao: 'consultar_parcelas', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (
    msgSimples === 'inadimplencia' ||
    msgSimples === 'inadimplência' ||
    msgSimples === 'clientes em atraso' ||
    msgSimples === 'recebiveis vencidos' ||
    msgSimples === 'recebíveis vencidos' ||
    msgSimples === 'parcelas vencidas'
  ) {
    return { intencao: 'consultar_inadimplencia', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'estoque' || msgSimples === 'meu estoque' || msgSimples === 'resumo estoque') {
    return { intencao: 'consultar_estoque', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples.startsWith('saldo ') && !/\b(caixa|financeiro|geral|total)\b/.test(msgSimples)) {
    const produto = String(messageTrimmed || '').replace(/^\s*saldo\s+/i, '').trim();
    if (produto) {
      return { intencao: 'consultar_estoque', dados: { produto }, confidence: 0.92, source: 'help_shortcut' };
    }
  }
  if (msgSimples === 'validades' || msgSimples === 'validade' || msgSimples === 'produtos vencendo') {
    return { intencao: 'consultar_validade', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'meta') {
    return { intencao: 'consultar_meta', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (
    msgSimples === 'desfazer' ||
    msgSimples === 'apagar ultimo' ||
    msgSimples === 'apagar ultimo lancamento' ||
    msgSimples === 'apagar ultima' ||
    msgSimples === 'apagar ultima transacao' ||
    msgSimples === 'isso foi teste'
  ) {
    return { intencao: 'desfazer', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (
    msgSimples === 'editar' ||
    msgSimples === 'corrigir ultimo' ||
    msgSimples === 'corrigir ultimo lancamento' ||
    msgSimples === 'corrigir ultima' ||
    msgSimples === 'editar ultima' ||
    msgSimples === 'alterar ultima'
  ) {
    return { intencao: 'editar_transacao', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'excel') {
    return { intencao: 'exportar_dados', dados: { formato: 'excel' }, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'gerar pdf') {
    return { intencao: 'exportar_dados', dados: { formato: 'pdf' }, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'relatorio em pdf') {
    return { intencao: 'exportar_dados', dados: { formato: 'pdf' }, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'manda pdf' || msgSimples === 'me manda o pdf' || msgSimples === 'me manda pdf') {
    return { intencao: 'exportar_dados', dados: { formato: 'pdf' }, confidence: 0.95, source: 'help_shortcut' };
  }

  if (msgSimples.startsWith('buscar ')) {
    const term = String(messageTrimmed || '').replace(/^\s*buscar\s+/i, '').trim();
    if (!term) return null;
    return { intencao: 'buscar_transacao', dados: { termo: term }, confidence: 0.9, source: 'help_shortcut' };
  }

  return null;
}

module.exports = {
  HELP_DETERMINISTIC_INTENTS,
  getHelpShortcutIntent
};
