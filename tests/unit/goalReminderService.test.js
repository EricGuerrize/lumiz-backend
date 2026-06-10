let supabase;
let outboundMessageService;
let transactionController;
let reminderSentHelper;
let goalReminderService;

const mockProfile = { id: 'user-1', telefone: '5511999990001', meta_mensal: '10000' };

function setupSupabaseMock(profiles) {
  supabase.from = jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        not: jest.fn(() => ({
          not: jest.fn(() => Promise.resolve({ data: profiles, error: null }))
        }))
      }))
    }))
  }));
}

beforeEach(() => {
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  jest.mock('../../src/services/outboundMessageService');
  jest.mock('../../src/controllers/transactionController');
  jest.mock('../../src/services/reminderSentHelper');
  supabase = require('../../src/db/supabase');
  outboundMessageService = require('../../src/services/outboundMessageService');
  transactionController = require('../../src/controllers/transactionController');
  reminderSentHelper = require('../../src/services/reminderSentHelper');
  goalReminderService = require('../../src/services/goalReminderService');
});

describe('Friday guard', () => {
  it('returns [] immediately when today is not Friday', async () => {
    const spy = jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3); // Wednesday
    const result = await goalReminderService.checkAndSendGoalReminders();
    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('proceeds when today is Friday', async () => {
    const spy = jest.spyOn(Date.prototype, 'getDay').mockReturnValue(5);
    setupSupabaseMock([]);
    const result = await goalReminderService.checkAndSendGoalReminders();
    expect(Array.isArray(result)).toBe(true);
    spy.mockRestore();
  });
});

describe('weekly dedup', () => {
  it('skips user when already sent this week', async () => {
    const daySpy = jest.spyOn(Date.prototype, 'getDay').mockReturnValue(5);
    setupSupabaseMock([mockProfile]);
    reminderSentHelper.alreadySent.mockResolvedValue(true);

    const result = await goalReminderService.checkAndSendGoalReminders();
    expect(result).toHaveLength(0);
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
    daySpy.mockRestore();
  });
});

describe('normal send', () => {
  it('sends message and marks sent when Friday and not yet sent', async () => {
    const daySpy = jest.spyOn(Date.prototype, 'getDay').mockReturnValue(5);
    setupSupabaseMock([mockProfile]);
    reminderSentHelper.alreadySent.mockResolvedValue(false);
    transactionController.getMonthlyReport = jest.fn().mockResolvedValue({ entradas: 5000, saidas: 2000 });
    outboundMessageService.sendText = jest.fn().mockResolvedValue({ status: 'sent' });
    reminderSentHelper.markSent.mockResolvedValue();

    const result = await goalReminderService.checkAndSendGoalReminders();
    expect(result).toHaveLength(1);
    expect(outboundMessageService.sendText).toHaveBeenCalledWith(mockProfile.telefone, expect.any(String));
    expect(reminderSentHelper.markSent).toHaveBeenCalled();
    daySpy.mockRestore();
  });

  it('calculates progress correctly at 50%', async () => {
    const daySpy = jest.spyOn(Date.prototype, 'getDay').mockReturnValue(5);
    setupSupabaseMock([mockProfile]); // meta = 10000
    reminderSentHelper.alreadySent.mockResolvedValue(false);
    transactionController.getMonthlyReport = jest.fn().mockResolvedValue({ entradas: 5000, saidas: 0 });
    outboundMessageService.sendText = jest.fn().mockResolvedValue({ status: 'sent' });
    reminderSentHelper.markSent.mockResolvedValue();

    const result = await goalReminderService.checkAndSendGoalReminders();
    expect(result[0].progresso).toBe('50.0');
    daySpy.mockRestore();
  });
});
