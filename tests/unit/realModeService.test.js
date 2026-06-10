process.env.REDIS_CACHE_ENABLED = 'false';

const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockRuntimeGet = jest.fn();
const mockRuntimeUpsert = jest.fn();
const mockInvalidateUser = jest.fn();
const mockInvalidatePhone = jest.fn();

jest.mock('../../src/db/supabase', () => ({
  from: jest.fn(() => ({
    update: mockUpdate,
    eq: mockEq
  }))
}));

jest.mock('../../src/services/cacheService', () => ({
  invalidateUser: mockInvalidateUser,
  invalidatePhone: mockInvalidatePhone
}));

jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  get: mockRuntimeGet,
  upsert: mockRuntimeUpsert,
  clear: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/utils/phone', () => ({ normalizePhone: (phone) => phone }));

const realModeService = require('../../src/services/realModeService');

describe('realModeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REQUIRE_WHATSAPP_REAL_MODE_CONFIRMATION;
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockEq.mockResolvedValue({ error: null });
    mockRuntimeGet.mockResolvedValue(null);
    mockRuntimeUpsert.mockResolvedValue(true);
    mockInvalidateUser.mockResolvedValue(true);
    mockInvalidatePhone.mockResolvedValue(true);
  });

  it('não pede confirmação extra por padrão depois do onboarding', async () => {
    await expect(realModeService.needsConfirmation({
      id: 'u1',
      whatsapp_real_mode_confirmed_at: null
    }, '5511999999999')).resolves.toBe(false);
  });

  it('mantém compatibilidade com confirmação explícita quando flag legado está ativa', async () => {
    process.env.REQUIRE_WHATSAPP_REAL_MODE_CONFIRMATION = 'true';

    await expect(realModeService.needsConfirmation({
      id: 'u1',
      whatsapp_real_mode_confirmed_at: null
    }, '5511999999999')).resolves.toBe(true);
  });

  it('não pede confirmação quando já há timestamp na coluna', async () => {
    await expect(realModeService.needsConfirmation({
      id: 'u1',
      whatsapp_real_mode_confirmed_at: '2026-05-29T18:00:00.000Z'
    }, '5511999999999')).resolves.toBe(false);
  });

  it('persiste confirmação em runtime state mesmo se a coluna ainda não existir no remoto', async () => {
    mockEq.mockResolvedValueOnce({
      error: { code: 'PGRST204', message: 'Could not find column whatsapp_real_mode_confirmed_at' }
    });

    await expect(realModeService.confirm({ id: 'u1' }, '5511999999999')).resolves.toEqual(expect.any(String));

    expect(mockRuntimeUpsert).toHaveBeenCalledWith(
      '5511999999999',
      'real_mode_confirmed',
      expect.objectContaining({ user_id: 'u1', confirmed_at: expect.any(String) }),
      expect.any(Number)
    );
  });
});
