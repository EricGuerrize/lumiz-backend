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

  if (msgSimples === 'saldo') {
    return { intencao: 'consultar_saldo', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'historico') {
    return { intencao: 'consultar_historico', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'relatorio') {
    return { intencao: 'relatorio_mensal', dados: {}, confidence: 0.95, source: 'help_shortcut' };
  }
  if (msgSimples === 'stats hoje') {
    return { intencao: 'stats_hoje', dados: {}, confidence: 0.95, source: 'help_shortcut' };
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
  if (msgSimples === 'pdf') {
    return { intencao: 'exportar_dados', dados: { formato: 'pdf' }, confidence: 0.95, source: 'help_shortcut' };
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
