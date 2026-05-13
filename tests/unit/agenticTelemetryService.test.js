jest.mock('../../src/services/analyticsService', () => ({
  track: jest.fn(() => Promise.resolve())
}));

const analyticsService = require('../../src/services/analyticsService');
const { safeAgenticTrack } = require('../../src/services/agenticTelemetryService');

describe('agenticTelemetryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delega ao analyticsService.track', async () => {
    await safeAgenticTrack('agentic_test_event', {
      phone: '5511999999999',
      userId: 'u1',
      properties: { x: 1 }
    });
    expect(analyticsService.track).toHaveBeenCalledWith('agentic_test_event', {
      phone: '5511999999999',
      userId: 'u1',
      source: 'whatsapp',
      properties: { x: 1 }
    });
  });

  it('ignora evento sem nome', async () => {
    await safeAgenticTrack('', { phone: '1', userId: 'u' });
    expect(analyticsService.track).not.toHaveBeenCalled();
  });
});
