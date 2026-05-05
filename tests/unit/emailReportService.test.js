let emailReportService;
let supabase;
let exportService;
let transactionController;
let reminderSentHelper;

function chainResolve(final) {
  const c = {};
  ['select', 'eq', 'maybeSingle'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  const p = Promise.resolve(final);
  c.then = p.then.bind(p);
  return c;
}

beforeEach(() => {
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  jest.mock('../../src/services/exportService');
  jest.mock('../../src/controllers/transactionController');
  jest.mock('../../src/services/reminderSentHelper');
  supabase = require('../../src/db/supabase');
  exportService = require('../../src/services/exportService');
  transactionController = require('../../src/controllers/transactionController');
  reminderSentHelper = require('../../src/services/reminderSentHelper');
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

describe('emailReportService.sendMonthlyReportEmail', () => {
  it('degrada quando RESEND_API_KEY não existe', async () => {
    emailReportService = require('../../src/services/emailReportService');
    const out = await emailReportService.sendMonthlyReportEmail('u1', '2026-05');
    expect(out).toEqual({ skipped: true, reason: 'missing_api_key' });
  });

  it('retorna skipped quando não há email no profile', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    jest.doMock('resend', () => ({
      Resend: jest.fn().mockImplementation(() => ({
        emails: { send: jest.fn() },
      })),
    }));
    supabase.from = jest.fn(() =>
      chainResolve({ data: { id: 'u1', email: null, nome_clinica: 'X' }, error: null })
    );
    reminderSentHelper.alreadySent.mockResolvedValue(false);
    emailReportService = require('../../src/services/emailReportService');
    const out = await emailReportService.sendMonthlyReportEmail('u1', '2026-05');
    expect(out).toEqual({ skipped: true, reason: 'no_email' });
  });

  it('envia email e marca dedupe quando tudo ok', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const sendMock = jest.fn().mockResolvedValue({ id: 'email_1' });
    jest.doMock('resend', () => ({
      Resend: jest.fn().mockImplementation(() => ({
        emails: { send: sendMock },
      })),
    }));
    supabase.from = jest.fn(() =>
      chainResolve({
        data: { id: 'u1', email: 'a@b.com', nome_clinica: 'Clinica Teste' },
        error: null,
      })
    );
    reminderSentHelper.alreadySent.mockResolvedValue(false);
    reminderSentHelper.markSent.mockResolvedValue(true);
    exportService.exportPDF.mockResolvedValue(Buffer.from('pdf'));
    transactionController.getMonthlyReport.mockResolvedValue({
      entradas: 1000,
      saidas: 400,
    });

    emailReportService = require('../../src/services/emailReportService');
    const out = await emailReportService.sendMonthlyReportEmail('u1', '2026-05');
    expect(out.success).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(reminderSentHelper.markSent).toHaveBeenCalled();
  });
});
