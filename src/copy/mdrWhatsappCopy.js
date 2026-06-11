const {
  MDR_METHOD_FOOTER,
  MDR_CONFIRM_FOOTER,
  MDR_SETTLEMENT_FOOTER
} = require('./whatsappMenuMarkers');

const mdrWhatsappCopy = {
  intro() {
    return (
      `Para calcular o valor liquido das vendas no cartao, preciso das taxas da sua maquininha.\n\n` +
      MDR_METHOD_FOOTER
    );
  },

  askProvider() {
    return 'Qual maquininha ou banco voce usa para receber cartao?';
  },

  manualRatesRequest() {
    return (
      `Me manda as taxas em uma mensagem.\n` +
      `Exemplo: Debito 1,5% | Credito 1x 3,2% | 2-6x 4,1% | 7-12x 5,2% | Bandeiras: Visa/Master.`
    );
  },

  manualReview({ provider, rawText, resumo }) {
    return (
      `Resumo das taxas (${provider || 'maquininha'}):\n\n` +
      `${resumo || rawText}\n\n` +
      MDR_CONFIRM_FOOTER
    );
  },

  settlementQuestion() {
    return MDR_SETTLEMENT_FOOTER;
  },

  ocrRequest() {
    return (
      `Entra no app da maquininha, abre a tabela de taxas e tira um print.\n` +
      `Pode mandar aqui que eu leio e cadastro automaticamente.`
    );
  },

  ocrReceived({ provider }) {
    return (
      `Recebi o print da ${provider || 'maquininha'}. Vou extrair as taxas agora.\n\n` +
      `Quando terminar, posso te mostrar o resumo pra confirmar.`
    );
  },

  ocrReview({ provider, resumo }) {
    return (
      `Resumo das taxas (${provider || 'maquininha'}):\n\n` +
      `${resumo}\n\n` +
      MDR_CONFIRM_FOOTER
    );
  },

  done() {
    return (
      `Pronto. Taxas configuradas e saldo ajustado ao valor liquido.\n\n` +
      `Se quiser ajustar depois, e so dizer: \"configurar maquininha\".`
    );
  },

  cancelled() {
    return 'Tudo certo. Cancelei a configuracao das taxas.';
  },

  invalidChoice() {
    return 'Não entendi. Toque em uma das opções ou responda com as palavras que aparecem nos botões.';
  },

  needImage() {
    return 'Preciso do print ou foto das taxas para continuar.';
  },

  noPendingConfig() {
    return 'Nao encontrei nenhuma taxa pendente para revisar agora.';
  }
};

module.exports = mdrWhatsappCopy;
