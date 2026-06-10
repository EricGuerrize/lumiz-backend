/**
 * Copy de WhatsApp para documentos, PDFs e falhas de leitura.
 */

const fallbackMessage = () =>
  'Recebi sua mensagem, mas não consegui concluir a leitura agora.\n\n' +
  'Tenta de novo em alguns instantes ou escreve de um jeito mais direto, tipo: "botox 500 no pix".';

const documentPrompt = () =>
  'Pode mandar o documento aqui no WhatsApp.\n\n' +
  'Aceito foto ou PDF de nota fiscal, boleto, extrato ou comprovante. Eu leio, mostro o que encontrei e só registro depois da sua confirmação.\n\n' +
  'Se você quer baixar o relatório mensal da Lumiz, escreva: "gerar pdf" ou "relatório em pdf".';

const isolatedPdfPrompt = () =>
  'Se você quer que eu leia um documento, anexe o PDF/foto aqui no WhatsApp.\n\n' +
  'Se você quer baixar o relatório mensal da Lumiz, escreva: "gerar pdf" ou "relatório em pdf".';

const mediaDownloadFailed = () =>
  'Não consegui baixar esse arquivo agora.\n\n' +
  'Tenta reenviar o PDF/foto. Se continuar falhando, digite o principal lançamento em texto, por exemplo: "toxina R$ 600".';

const documentOcrFailed = () =>
  'Não consegui analisar esse documento com segurança.\n\n' +
  'Tenta enviar uma foto/PDF mais nítido ou registre manualmente, por exemplo: "toxina R$ 600".';

const documentNoTransactions = () =>
  'Li o documento, mas não encontrei uma receita ou despesa clara para registrar.\n\n' +
  'Se quiser, me mande em texto o valor principal. Exemplo: "boleto fornecedor R$ 850 vence dia 10".';

const onboardingDocumentNotIdentified = () =>
  'Não consegui identificar esse documento.\n\n' +
  'Pode enviar uma foto mais clara ou descrever a venda/custo em texto?';

const documentStillProcessing = () =>
  'Recebi seu documento e ainda estou analisando. Já te respondo em instantes.';

const documentProcessingStarted = () =>
  'Recebi o arquivo. Vou analisar agora e te mando o resumo para confirmar antes de registrar.';

const pendingExpired = () =>
  'Não encontrei confirmação pendente desse documento. Pode reenviar o PDF/foto para eu analisar de novo.';

const confirmSupplierDocAgain = () =>
  'Não entendi... responde *1* para confirmar a NF/boleto ou *2* para cancelar.';

const confirmGenericDocAgain = () =>
  'Não entendi... responde *sim* para registrar ou *não* para cancelar.';

const documentCancelled = () =>
  'Documento descartado. Nada foi registrado.\n\nSe quiser tentar de novo, é só enviar o PDF/foto novamente.';

const documentCorrectionGuidance = () =>
  'Sem problema. Ainda não registrei nada.\n\nMe envie a correção em uma frase, por exemplo:\n\n' +
  '"categoria insumos, valor R$ 1.100, data 09/02"\n\n' +
  'Eu vou atualizar a leitura e te pedir confirmação novamente. Se preferir descartar, toque em *Cancelar* ou responda *NÃO*.';

const documentConfirmationInstructions = (count = 1) => {
  const target = count > 1 ? 'TODAS' : 'o lançamento';
  return `Responda *SIM* para registrar ${target}, *NÃO* para cancelar ou *CORRIGIR* se algo estiver errado.`;
};

const documentConfirmationButtons = () => ([
  { id: 'doc_confirm', title: 'Confirmar' },
  { id: 'doc_correct', title: 'Corrigir' },
  { id: 'doc_cancel', title: 'Cancelar' }
]);

const isDocumentConfirmationPrompt = (message = '') => {
  const text = String(message || '');
  const genericDocumentPrompt = text.includes('Responda *SIM*') &&
    text.includes('*NÃO*') &&
    text.includes('*CORRIGIR*');
  const supplierDocumentPrompt = text.includes('Posso lançar como conta a pagar?') &&
    text.includes('Confirme, corrija ou cancele');
  const onboardingAhaCostPrompt = text.includes('💸 *CUSTO*') &&
    text.includes('Tá certo? Me diz se quiser ajustar alguma coisa.');
  const onboardingAct3CostPrompt = text.includes('Custo de teste identificado:') &&
    text.includes('Confirma? Se não for isso, me manda a correção.');

  return genericDocumentPrompt ||
    supplierDocumentPrompt ||
    onboardingAhaCostPrompt ||
    onboardingAct3CostPrompt;
};

const mapDocumentButtonReply = (buttonId = '', buttonTitle = '') => {
  const normalizedId = String(buttonId || '').trim();
  const normalizedTitle = String(buttonTitle || '').trim().toLowerCase();

  if (normalizedId === 'doc_confirm' || normalizedTitle === 'confirmar') return 'sim';
  if (normalizedId === 'doc_correct' || normalizedTitle === 'corrigir') return 'corrigir';
  if (normalizedId === 'doc_cancel' || normalizedTitle === 'cancelar') return 'não';

  return buttonTitle || buttonId || '';
};

module.exports = {
  fallbackMessage,
  documentPrompt,
  isolatedPdfPrompt,
  mediaDownloadFailed,
  documentOcrFailed,
  documentNoTransactions,
  onboardingDocumentNotIdentified,
  documentStillProcessing,
  documentProcessingStarted,
  pendingExpired,
  confirmSupplierDocAgain,
  confirmGenericDocAgain,
  documentCancelled,
  documentCorrectionGuidance,
  documentConfirmationInstructions,
  documentConfirmationButtons,
  isDocumentConfirmationPrompt,
  mapDocumentButtonReply
};
