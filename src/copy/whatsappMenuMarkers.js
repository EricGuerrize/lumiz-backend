/**
 * Rodapés estáveis para detectar menus interativos no envio WhatsApp.
 * Texto visível ao usuário — sem opções numéricas; botões são a via preferida.
 */

const TX_CONFIRM_FOOTER =
  'Toque nos botões abaixo ou responda com *confirmar*, *cancelar* ou *corrigir*.';

const SUPPLIER_DOC_CONFIRM_FOOTER =
  'Toque nos botões ou responda com *confirmar*, *cancelar* ou *corrigir*.';

const INVENTORY_CONFIRM_FOOTER =
  'Toque nos botões ou responda com *confirmar*, *cancelar* ou *corrigir*.';

const INVENTORY_IMPORT_CONFIRM_FOOTER =
  'Toque nos botões ou responda com *confirmar* ou *cancelar* para a importação.';

const INVENTORY_IMPORT_UNDO_FOOTER =
  'Se quiser desfazer agora, toque no botão ou responda *desfazer importação*.';

const FINANCIAL_IMPORT_CONFIRM_FOOTER =
  'Toque nos botões ou responda com *confirmar* ou *cancelar* para a importação.';

const SPREADSHEET_KIND_CHOICE_FOOTER =
  'Toque em *Estoque* ou *Financeiro* para continuar.';

const SUPPLIER_DOC_RETRY_FOOTER =
  'Não entendi... responde *confirmar* para lançar a NF/boleto ou *cancelar* para descartar.';

const MDR_METHOD_FOOTER =
  'Como prefere enviar as taxas? Toque em uma opção ou responda *digitar* ou *enviar print*.';

const MDR_CONFIRM_FOOTER =
  'Confirma esse resumo? Toque em uma opção ou responda *confirmar* ou *corrigir*.';

const MDR_SETTLEMENT_FOOTER =
  'Quando o dinheiro cai na conta?\n\n' +
  '• *D+1* — automática, próximo dia útil\n' +
  '• *D+30* — automática, até 30 dias\n' +
  '• *No fluxo* — parcelado mês a mês\n\n' +
  'Toque em uma opção ou responda com essas palavras.';

const PAYMENT_CARD_TYPE_FOOTER =
  'No cartão foi como? Toque em uma opção ou responda *crédito à vista* ou *parcelado*.';

const PAYMENT_METHOD_FOOTER =
  'Qual foi a forma de pagamento? Toque em *Escolher forma* ou responda PIX, débito, crédito à vista ou parcelado.';

const ALTER_RECEIVABLE_YES_NO_FOOTER =
  'Quer comprometer esses recebíveis? Toque em uma opção ou responda *sim* ou *não*.';

const ALTER_RECEIVABLE_ACTION_FOOTER =
  'Toque em uma opção ou responda *comprometer tudo*, *só livres* ou *cancelar*.';

const TX_CORRECTION_FIELD_ENTRADA_FOOTER =
  'Toque em *O que corrigir* e escolha valor, procedimento, nome ou data.';

const TX_CORRECTION_FIELD_SAIDA_FOOTER =
  'Toque em *O que corrigir* e escolha valor, categoria, descrição ou data.';

const ESTOQUE_YES_NO_FOOTER =
  'Toque nos botões ou responda *sim* ou *não*.';

const ESTOQUE_ENTRY_CONFIRM_FOOTER =
  'Toque nos botões ou responda *confirmar* ou *cancelar*.';

module.exports = {
  TX_CONFIRM_FOOTER,
  SUPPLIER_DOC_CONFIRM_FOOTER,
  INVENTORY_CONFIRM_FOOTER,
  INVENTORY_IMPORT_CONFIRM_FOOTER,
  INVENTORY_IMPORT_UNDO_FOOTER,
  FINANCIAL_IMPORT_CONFIRM_FOOTER,
  SPREADSHEET_KIND_CHOICE_FOOTER,
  SUPPLIER_DOC_RETRY_FOOTER,
  MDR_METHOD_FOOTER,
  MDR_CONFIRM_FOOTER,
  MDR_SETTLEMENT_FOOTER,
  PAYMENT_CARD_TYPE_FOOTER,
  PAYMENT_METHOD_FOOTER,
  ALTER_RECEIVABLE_YES_NO_FOOTER,
  ALTER_RECEIVABLE_ACTION_FOOTER,
  TX_CORRECTION_FIELD_ENTRADA_FOOTER,
  TX_CORRECTION_FIELD_SAIDA_FOOTER,
  ESTOQUE_YES_NO_FOOTER,
  ESTOQUE_ENTRY_CONFIRM_FOOTER
};
