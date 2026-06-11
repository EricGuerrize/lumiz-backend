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

  it('detecta menu de correção de venda e retorna lista de campos', () => {
    const txConfirmCopy = require('../../src/copy/transactionConfirmWhatsappCopy');
    const message = txConfirmCopy.buildCorrectionFieldPickerMessage({
      tipo: 'entrada',
      valor: 5000,
      categoria: 'Botox',
      nome_cliente: 'Maria',
      data: '2026-06-11'
    });

    const menu = interactiveCopy.resolveOutboundMenu(message);

    expect(menu).toEqual(expect.objectContaining({
      type: 'list',
      button: 'O que corrigir'
    }));
    expect(menu.sections[0].rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tx_fix_valor', title: 'Valor' }),
      expect.objectContaining({ id: 'tx_fix_procedimento', title: 'Procedimento' })
    ]));
  });

  it('mapeia escolha de campo da lista de correção', () => {
    expect(interactiveCopy.mapInteractiveButtonReply('tx_fix_valor', 'Valor')).toBe('campo valor');
    expect(interactiveCopy.mapInteractiveButtonReply('tx_fix_procedimento', 'Procedimento')).toBe('campo procedimento');
    expect(interactiveCopy.mapInteractiveButtonReply('tx_fix_nome', 'Nome')).toBe('campo nome');
    expect(interactiveCopy.mapInteractiveButtonReply('tx_fix_data', 'Data')).toBe('campo data');
  });

  it('detecta menu de escolha do tipo de planilha', () => {
    const message = 'Planilha ambígua.\n\nToque em *Estoque* ou *Financeiro* para continuar.';
    const menu = interactiveCopy.resolveOutboundMenu(message);
    expect(menu).toEqual(expect.objectContaining({
      type: 'buttons',
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'menu_kind_estoque' }),
        expect.objectContaining({ id: 'menu_kind_financeiro' })
      ])
    }));
  });

  it('mapeia botão de desfazer importação', () => {
    expect(interactiveCopy.mapInteractiveButtonReply('menu_undo_import', 'Desfazer importação')).toBe('desfazer importação');
  });
});
