/**
 * Contrato da ajuda: atalhos e intents que devem bypassar agentic.
 */

jest.mock('../../src/services/featureFlagService', () => ({
  isEnabled: jest.fn()
}));

const featureFlagService = require('../../src/services/featureFlagService');
const agentRouterService = require('../../src/services/agentic/agentRouterService');
const { HELP_DETERMINISTIC_INTENTS, getHelpShortcutIntent } = require('../../src/config/helpCommandContract');

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

describe('helpCommandContract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    featureFlagService.isEnabled.mockImplementation(async (flag) => {
      if (flag === 'agentic_shadow_mode') return false;
      if (flag === 'agentic_router_enabled') return true;
      return false;
    });
    agentRouterService.clearLog();
  });

  describe('HELP_DETERMINISTIC_INTENTS + agentRouterService', () => {
    it.each([...HELP_DETERMINISTIC_INTENTS])(
      'intent %s roteia deterministic com router ligado',
      async (intencao) => {
        const d = await agentRouterService.decide({
          message: 'teste',
          intent: { intencao, confidence: 0.95 },
          user: { id: 'u1' },
          phone: '5511999999999',
          context: {}
        });
        expect(d.route).toBe('deterministic');
        expect(d.reason).toBe('deterministic_only_intent');
      }
    );
  });

  describe('getHelpShortcutIntent', () => {
    it('mapeia frases literais da ajuda', () => {
      expect(getHelpShortcutIntent('saldo', 'saldo')).toMatchObject({ intencao: 'consultar_saldo' });
      expect(getHelpShortcutIntent('historico', 'histórico')).toMatchObject({ intencao: 'consultar_historico' });
      expect(getHelpShortcutIntent('relatorio', 'Relatório')).toMatchObject({ intencao: 'relatorio_mensal' });
      expect(getHelpShortcutIntent('stats hoje', 'stats hoje')).toMatchObject({ intencao: 'stats_hoje' });
      expect(getHelpShortcutIntent('meta', 'meta')).toMatchObject({ intencao: 'consultar_meta' });
      expect(getHelpShortcutIntent('pdf', 'Pdf')).toMatchObject({
        intencao: 'exportar_dados',
        dados: { formato: 'pdf' }
      });
      expect(getHelpShortcutIntent('gerar pdf', 'gerar pdf')).toMatchObject({
        intencao: 'exportar_dados',
        dados: { formato: 'pdf' }
      });
      expect(getHelpShortcutIntent('excel', 'excel')).toMatchObject({
        intencao: 'exportar_dados',
        dados: { formato: 'excel' }
      });
      expect(getHelpShortcutIntent('buscar botox', 'buscar botox')).toMatchObject({
        intencao: 'buscar_transacao',
        dados: { termo: 'botox' }
      });
      expect(getHelpShortcutIntent('buscar 2800', 'buscar 2800')).toMatchObject({
        intencao: 'buscar_transacao',
        dados: { termo: '2800' }
      });
      expect(getHelpShortcutIntent('apagar ultimo lancamento', 'apagar último lançamento')).toMatchObject({
        intencao: 'desfazer'
      });
      expect(getHelpShortcutIntent('isso foi teste', 'isso foi teste')).toMatchObject({
        intencao: 'desfazer'
      });
      expect(getHelpShortcutIntent('corrigir ultimo lancamento', 'corrigir último lançamento')).toMatchObject({
        intencao: 'editar_transacao'
      });
    });

    it('retorna null para texto fora dos atalhos', () => {
      expect(getHelpShortcutIntent('romulo botox 15k', 'romulo botox 15k')).toBeNull();
      expect(getHelpShortcutIntent('ajuda', 'ajuda')).toBeNull();
    });

    it('atalho relatorio em pdf', () => {
      const msg = norm('relatório em pdf');
      expect(getHelpShortcutIntent(msg, 'relatório em pdf')).toMatchObject({
        intencao: 'exportar_dados',
        dados: { formato: 'pdf' }
      });
    });
  });
});
