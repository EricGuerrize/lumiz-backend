const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ eq: mockEq, maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockUpsert = jest.fn(() => Promise.resolve({ error: null }));
const mockFrom = jest.fn(() => ({ select: mockSelect, upsert: mockUpsert }));

jest.mock('../../src/db/supabase', () => ({ from: mockFrom }));

const { alreadySent, markSent } = require('../../src/services/reminderSentHelper');

beforeEach(() => jest.clearAllMocks());

describe('alreadySent', () => {
  it('returns true when record exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: 'abc' }, error: null });
    const result = await alreadySent('ref-123', 'parcela_dia');
    expect(result).toBe(true);
  });

  it('returns false when no record exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await alreadySent('ref-123', 'parcela_dia');
    expect(result).toBe(false);
  });

  it('queries reminders_sent table with correct fields', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await alreadySent('ref-456', 'conta_dia');
    expect(mockFrom).toHaveBeenCalledWith('reminders_sent');
    expect(mockEq).toHaveBeenCalledWith('referencia_id', 'ref-456');
    expect(mockEq).toHaveBeenCalledWith('tipo_lembrete', 'conta_dia');
  });
});

describe('markSent', () => {
  it('calls upsert with correct payload and onConflict constraint', async () => {
    await markSent('user-1', 'ref-1', 'parcela_atraso_3');
    expect(mockFrom).toHaveBeenCalledWith('reminders_sent');
    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: 'user-1', referencia_id: 'ref-1', tipo_lembrete: 'parcela_atraso_3' },
      { onConflict: 'referencia_id,tipo_lembrete' }
    );
  });
});
