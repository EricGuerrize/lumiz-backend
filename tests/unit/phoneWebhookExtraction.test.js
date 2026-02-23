const { extractPhoneFromWebhookBody } = require('../../src/utils/phone');

describe('extractPhoneFromWebhookBody', () => {
  test('usa senderPn quando remoteJid vem como @lid', () => {
    const body = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '197864932270200@lid',
          senderPn: '556592556938@s.whatsapp.net',
          fromMe: false
        },
        message: { conversation: 'oi' }
      }
    };

    expect(extractPhoneFromWebhookBody(body)).toBe('556592556938');
  });

  test('cai para remoteJid quando ele já contém número', () => {
    const body = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '5565992556938@s.whatsapp.net',
          fromMe: false
        },
        message: { conversation: 'oi' }
      }
    };

    expect(extractPhoneFromWebhookBody(body)).toBe('5565992556938');
  });
});
