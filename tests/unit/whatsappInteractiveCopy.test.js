const interactiveCopy = require('../../src/copy/whatsappInteractiveCopy');
const TransactionHandler = require('../../src/controllers/messages/transactionHandler');
const mdrCopy = require('../../src/copy/mdrWhatsappCopy');

describe('whatsappInteractiveCopy', () => {
  it('detecta confirmação de transação e retorna 3 botões', () => {
    const handler = new TransactionHandler(new Map());
    const message = handler.buildConfirmationMessage({
      tipo: 'entrada',
      valor: 500,
      categoria: 'Botox',
      data: '2026-06-01',
      forma_pagamento: 'pix'
    });

    const menu = interactiveCopy.resolveOutboundMenu(message);

    expect(menu).toEqual(expect.objectContaining({
      type: 'buttons',
      buttons: expect.arrayContaining([
        expect.objectContaining({ title: 'Confirmar' }),
        expect.objectContaining({ title: 'Cancelar' }),
        expect.objectContaining({ title: 'Corrigir' })
      ])
    }));
  });

  it('detecta menu MDR com 2 opções', () => {
    const menu = interactiveCopy.resolveOutboundMenu(mdrCopy.intro());
    expect(menu?.buttons).toHaveLength(2);
  });

  it('mapeia clique de botão para palavras naturais', () => {
    expect(interactiveCopy.mapInteractiveButtonReply('menu_confirm', 'Confirmar')).toBe('confirmar');
    expect(interactiveCopy.mapInteractiveButtonReply('menu_cancel', 'Cancelar')).toBe('cancelar');
    expect(interactiveCopy.mapInteractiveButtonReply('menu_correct', 'Corrigir')).toBe('corrigir');
    expect(interactiveCopy.mapInteractiveButtonReply('menu_yes', 'Sim')).toBe('sim');
    expect(interactiveCopy.mapInteractiveButtonReply('menu_no', 'Não')).toBe('não');
    expect(interactiveCopy.mapInteractiveButtonReply('doc_confirm', 'Confirmar')).toBe('sim');
  });

  it('mapeia lista de forma de pagamento', () => {
    expect(interactiveCopy.mapInteractiveButtonReply('pay_install', 'Cartão parcelado')).toBe('parcelado');
  });
});
