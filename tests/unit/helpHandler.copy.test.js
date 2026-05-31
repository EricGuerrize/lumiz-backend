const HelpHandler = require('../../src/controllers/messages/helpHandler');

describe('HelpHandler copy', () => {
  test('handleGreeting usa copy operacional pos-onboarding', () => {
    const response = new HelpHandler().handleGreeting();

    expect(response).toContain('Me manda o que aconteceu na clínica hoje');
    expect(response).toContain('botox R$ 1.200 no pix');
    expect(response).toContain('foto ou PDF de nota');
    expect(response).not.toContain('Sou a *Lumiz*');
  });
});
