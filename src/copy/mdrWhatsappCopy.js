const mdrWhatsappCopy = {
  intro() {
    return (
      `Para calcular o valor liquido das vendas no cartao, preciso das taxas da sua maquininha.\n\n` +
      `Como voce prefere enviar?\n\n` +
      `1️⃣ Vou digitar as taxas\n` +
      `2️⃣ Enviar print/foto da tela de taxas`
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
      `Confirma?\n\n` +
      `1️⃣ Confirmar\n` +
      `2️⃣ Corrigir`
    );
  },

  settlementQuestion() {
    return (
      `Quando o dinheiro cai na sua conta?\n\n` +
      `1️⃣ Automatica / D+1 (recebe tudo antecipado)\n` +
      `2️⃣ No fluxo (recebe parcelado mes a mes)`
    );
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
      `Confirma?\n\n` +
      `1️⃣ Confirmar\n` +
      `2️⃣ Corrigir`
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
    return 'Nao entendi. Pode responder com 1 ou 2?';
  },

  needImage() {
    return 'Preciso do print ou foto das taxas para continuar.';
  },

  noPendingConfig() {
    return 'Nao encontrei nenhuma taxa pendente para revisar agora.';
  }
};

module.exports = mdrWhatsappCopy;
