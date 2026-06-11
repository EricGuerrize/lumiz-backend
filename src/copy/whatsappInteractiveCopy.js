/**
 * Fase WhatsApp — contrato central de menus interativos (botões/lista Meta).
 *
 * Botões são a via preferida; o texto de fallback usa palavras (sim/não,
 * confirmar/cancelar), nunca menus numéricos.
 */

const documentCopy = require('./documentWhatsappCopy');
const markers = require('./whatsappMenuMarkers');

const BUTTON_SETS = {
  yesNo: [
    { id: 'menu_yes', title: 'Sim' },
    { id: 'menu_no', title: 'Não' }
  ],
  confirmCancel: [
    { id: 'menu_confirm', title: 'Confirmar' },
    { id: 'menu_cancel', title: 'Cancelar' }
  ],
  confirmCancelCorrect: [
    { id: 'menu_confirm', title: 'Confirmar' },
    { id: 'menu_cancel', title: 'Cancelar' },
    { id: 'menu_correct', title: 'Corrigir' }
  ],
  confirmCorrect: [
    { id: 'menu_confirm', title: 'Confirmar' },
    { id: 'menu_correct', title: 'Corrigir' }
  ],
  mdrMethod: [
    { id: 'menu_type', title: 'Digitar taxas' },
    { id: 'menu_photo', title: 'Enviar print' }
  ],
  mdrSettlement: [
    { id: 'menu_d1', title: 'Auto D+1' },
    { id: 'menu_d30', title: 'Auto D+30' },
    { id: 'menu_flow', title: 'No fluxo' }
  ],
  cardType: [
    { id: 'menu_credit', title: 'Crédito à vista' },
    { id: 'menu_install', title: 'Parcelado' }
  ],
  startChoice: [
    { id: 'menu_yes', title: 'Sim, começar' },
    { id: 'menu_how', title: 'Como funciona' }
  ],
  alterReceivableAction: [
    { id: 'menu_all', title: 'Livres + antecipar' },
    { id: 'menu_free', title: 'Só os livres' },
    { id: 'menu_cancel', title: 'Cancelar' }
  ]
};

const PAYMENT_METHOD_LIST = {
  type: 'list',
  button: 'Escolher forma',
  sections: [{
    title: 'Formas de pagamento',
    rows: [
      { id: 'pay_pix', title: 'PIX' },
      { id: 'pay_debit', title: 'Débito' },
      { id: 'pay_credit', title: 'Crédito à vista' },
      { id: 'pay_install', title: 'Cartão parcelado' }
    ]
  }]
};

/** @type {Array<{ detect: (text: string) => boolean, menu: () => object }>} */
const MENU_RULES = [
  {
    detect: (text) => documentCopy.isDocumentConfirmationPrompt(text),
    menu: () => ({ type: 'buttons', buttons: documentCopy.documentConfirmationButtons() })
  },
  {
    detect: (text) => text.includes(markers.TX_CONFIRM_FOOTER),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.confirmCancelCorrect })
  },
  {
    detect: (text) => text.includes(markers.SUPPLIER_DOC_CONFIRM_FOOTER),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.confirmCancelCorrect })
  },
  {
    detect: (text) => text.includes(markers.INVENTORY_CONFIRM_FOOTER),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.confirmCancelCorrect })
  },
  {
    detect: (text) => text.includes(markers.SUPPLIER_DOC_RETRY_FOOTER),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.confirmCancel })
  },
  {
    detect: (text) => text.includes(markers.MDR_METHOD_FOOTER),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.mdrMethod })
  },
  {
    detect: (text) => text.includes(markers.MDR_CONFIRM_FOOTER),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.confirmCorrect })
  },
  {
    detect: (text) => text.includes(markers.MDR_SETTLEMENT_FOOTER),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.mdrSettlement })
  },
  {
    detect: (text) => text.includes(markers.PAYMENT_CARD_TYPE_FOOTER),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.cardType })
  },
  {
    detect: (text) => text.includes(markers.PAYMENT_METHOD_FOOTER),
    menu: () => PAYMENT_METHOD_LIST
  },
  {
    detect: (text) => text.includes('Responde "sim" pra autorizar ou "não"'),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.yesNo })
  },
  {
    detect: (text) => text.includes('Responda *sim* para ativar o modo real'),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.yesNo })
  },
  {
    detect: (text) => text.includes('Posso começar?') && text.includes('mini raio-x financeiro'),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.yesNo })
  },
  {
    detect: (text) => text.includes('Topa eu te mostrar como funciona?'),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.startChoice })
  },
  {
    detect: (text) => text.includes('Ficou claro? Posso começar o teste rápido'),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.yesNo })
  },
  {
    detect: (text) => text.includes(markers.ALTER_RECEIVABLE_YES_NO_FOOTER),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.yesNo })
  },
  {
    detect: (text) => text.includes(markers.ALTER_RECEIVABLE_ACTION_FOOTER),
    menu: () => ({ type: 'buttons', buttons: BUTTON_SETS.alterReceivableAction })
  }
];

/**
 * @param {string} message
 * @returns {{ type: 'buttons', buttons: Array<{id: string, title: string}> }|{ type: 'list', button: string, sections: Array }|null}
 */
function resolveOutboundMenu(message = '') {
  const text = String(message || '');
  if (!text.trim()) return null;

  for (const rule of MENU_RULES) {
    if (rule.detect(text)) {
      return rule.menu();
    }
  }
  return null;
}

/**
 * Normaliza clique em botão/lista para texto que os handlers já entendem.
 * Preferência: palavras naturais (sim, confirmar), não dígitos.
 * @param {string} buttonId
 * @param {string} buttonTitle
 * @returns {string}
 */
function mapInteractiveButtonReply(buttonId = '', buttonTitle = '') {
  const normalizedId = String(buttonId || '').trim();
  const normalizedTitle = String(buttonTitle || '').trim().toLowerCase();

  if (['doc_confirm', 'doc_correct', 'doc_cancel'].includes(normalizedId)) {
    return documentCopy.mapDocumentButtonReply(buttonId, buttonTitle);
  }

  const byId = {
    menu_yes: 'sim',
    menu_no: 'não',
    menu_how: 'como funciona',
    menu_confirm: 'confirmar',
    menu_cancel: 'cancelar',
    menu_correct: 'corrigir',
    menu_type: 'digitar',
    menu_photo: 'enviar print',
    menu_d1: 'd+1',
    menu_d30: 'd+30',
    menu_flow: 'no fluxo',
    menu_credit: 'crédito à vista',
    menu_install: 'parcelado',
    menu_all: 'comprometer tudo',
    menu_free: 'só livres',
    pay_pix: 'pix',
    pay_debit: 'débito',
    pay_credit: 'crédito à vista',
    pay_install: 'parcelado'
  };

  if (byId[normalizedId]) {
    return byId[normalizedId];
  }

  if (normalizedTitle === 'sim') return 'sim';
  if (normalizedTitle === 'confirmar') return 'confirmar';
  if (normalizedTitle === 'cancelar') return 'cancelar';
  if (normalizedTitle === 'não' || normalizedTitle === 'nao') return 'não';
  if (normalizedTitle === 'corrigir') return 'corrigir';
  if (normalizedTitle === 'pix') return 'pix';
  if (normalizedTitle === 'débito' || normalizedTitle === 'debito') return 'débito';
  if (normalizedTitle.includes('crédito') || normalizedTitle.includes('credito')) return 'crédito à vista';
  if (normalizedTitle.includes('parcelado')) return 'parcelado';
  if (normalizedTitle.includes('começar') || normalizedTitle.includes('comecar')) return 'sim';
  if (normalizedTitle.includes('como funciona')) return 'como funciona';
  if (normalizedTitle.includes('digitar')) return 'digitar';
  if (normalizedTitle.includes('print') || normalizedTitle.includes('foto')) return 'enviar print';
  if (normalizedTitle.includes('d+1') || normalizedTitle === 'auto d+1') return 'd+1';
  if (normalizedTitle.includes('d+30') || normalizedTitle === 'auto d+30') return 'd+30';
  if (normalizedTitle.includes('fluxo')) return 'no fluxo';
  if (normalizedTitle.includes('antecipar')) return 'comprometer tudo';
  if (normalizedTitle.includes('só os livres') || normalizedTitle.includes('so os livres')) return 'só livres';

  return buttonTitle || buttonId || '';
}

module.exports = {
  BUTTON_SETS,
  resolveOutboundMenu,
  mapInteractiveButtonReply
};
