/**
 * Webhook Asaas — ativação + migração trial (idempotência).
 */

jest.mock('../../src/services/subscriptionService', () => ({
  findByAsaasCustomerId: jest.fn(),
  activate: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../src/services/trialAccountService', () => ({
  trialAccountService: {
    migrateToLiveAccount: jest.fn()
  }
}));

jest.mock('../../src/repositories/userRepository', () => ({
  findById: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/services/analyticsService', () => ({
  track: jest.fn(() => Promise.resolve())
}));

const subscriptionService = require('../../src/services/subscriptionService');
const { trialAccountService } = require('../../src/services/trialAccountService');
const analyticsService = require('../../src/services/analyticsService');
const { handleWebhook } = require('../../src/services/paymentService');

describe('paymentService.handleWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignora eventos que não confirmam pagamento', async () => {
    await handleWebhook({ event: 'PAYMENT_CREATED', payment: { id: 'p', customer: 'c' } });
    expect(subscriptionService.findByAsaasCustomerId).not.toHaveBeenCalled();
  });

  it('ativa assinatura e tenta migrar trial no primeiro processamento', async () => {
    subscriptionService.findByAsaasCustomerId.mockResolvedValue({
      clinic_id: 'clinic-1',
      payment_url: 'https://pay',
      last_payment_id: null
    });
    trialAccountService.migrateToLiveAccount.mockResolvedValue({
      migrated: true,
      sales: 1,
      costs: 1
    });

    await handleWebhook({
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_1', customer: 'cust_1' }
    });

    expect(subscriptionService.activate).toHaveBeenCalledWith(
      'clinic-1',
      expect.objectContaining({ asaasPaymentId: 'pay_1' })
    );
    expect(trialAccountService.migrateToLiveAccount).toHaveBeenCalledWith('clinic-1');
    expect(analyticsService.track).toHaveBeenCalledWith(
      'subscription_activated_via_webhook',
      expect.objectContaining({
        userId: 'clinic-1',
        source: 'asaas_webhook',
        properties: expect.objectContaining({
          payment_id: 'pay_1',
          trial_migrated: true
        })
      })
    );
  });

  it('idempotência: mesmo payment.id não reativa; ainda chama migrate uma vez (retry seguro)', async () => {
    subscriptionService.findByAsaasCustomerId.mockResolvedValue({
      clinic_id: 'clinic-1',
      last_payment_id: 'pay_1',
      payment_url: 'https://pay'
    });
    trialAccountService.migrateToLiveAccount.mockResolvedValue({
      migrated: false,
      reason: 'already_converted',
      sales: 0,
      costs: 0
    });

    await handleWebhook({
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_1', customer: 'cust_1' }
    });

    expect(subscriptionService.activate).not.toHaveBeenCalled();
    expect(trialAccountService.migrateToLiveAccount).toHaveBeenCalledWith('clinic-1');
    expect(analyticsService.track).not.toHaveBeenCalled();
  });
});
