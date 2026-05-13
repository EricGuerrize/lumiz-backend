/**
 * NPS conversacional — formato de mensagem + analytics.
 */

const mockSupabaseInsert = jest.fn(() => ({ error: null }));

jest.mock('../../src/db/supabase', () => ({
  from: jest.fn(() => ({
    insert: (...args) => mockSupabaseInsert(...args)
  }))
}));

jest.mock('../../src/services/analyticsService', () => ({
  track: jest.fn(() => Promise.resolve())
}));

const analyticsService = require('../../src/services/analyticsService');
const conversationalNpsService = require('../../src/services/conversationalNpsService');

describe('conversationalNpsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseInsert.mockReturnValue({ error: null });
  });

  it('retorna null quando não é linha NPS', async () => {
    expect(await conversationalNpsService.tryConsumeNpsMessage({
      userId: 'u1',
      phone: '5511999999999',
      message: 'oi tudo bem'
    })).toBeNull();
    expect(mockSupabaseInsert).not.toHaveBeenCalled();
  });

  it('persiste score e dispara analytics', async () => {
    const reply = await conversationalNpsService.tryConsumeNpsMessage({
      userId: 'u1',
      phone: '5511999999999',
      message: 'nps: 9 adorei'
    });
    expect(reply).toContain('9/10');
    expect(mockSupabaseInsert).toHaveBeenCalled();
    expect(analyticsService.track).toHaveBeenCalledWith(
      'conversational_nps_submitted',
      expect.objectContaining({
        userId: 'u1',
        phone: '5511999999999',
        source: 'whatsapp',
        properties: { score: 9, has_comment: true }
      })
    );
  });

  it('rejeita score fora de 0–10', async () => {
    expect(await conversationalNpsService.tryConsumeNpsMessage({
      userId: 'u1',
      phone: '5511999999999',
      message: 'nps: 11'
    })).toBeNull();
  });
});
