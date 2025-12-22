/**
 * Handler para ajuda e comandos
 */
class HelpHandler {
  /**
   * Mostra ajuda
   */
  handleHelp() {
    return `*COMANDOS DISPONÍVEIS*\n\n` +
      `💰 *Registrar Vendas:*\n` +
      `"Botox 2800"\n` +
      `"Preenchimento 3500 cliente Maria"\n\n` +
      `💸 *Registrar Custos:*\n` +
      `"Insumos 1500"\n` +
      `"Aluguel 2500"\n\n` +
      `📊 *Consultas:*\n` +
      `"saldo" - Ver saldo atual\n` +
      `"histórico" - Últimas movimentações\n` +
      `"relatório" - Relatório mensal\n` +
      `"stats hoje" - Estatísticas do dia\n\n` +
      `🔍 *Buscar:*\n` +
      `"buscar botox" - Busca transações\n` +
      `"buscar 2800" - Busca por valor\n\n` +
      `📄 *Documentos:*\n` +
      `Envie foto de boleto, nota fiscal ou extrato\n\n` +
      `⚙️ *Outros:*\n` +
      `"desfazer" - Remove última transação\n` +
      `"editar" - Edita uma transação\n` +
      `"meta" - Ver progresso da meta\n\n` +
      `Precisa de mais ajuda? É só perguntar! 😊`;
  }

  /**
   * Mensagem de saudação
   */
  handleGreeting() {
    return `Oi! Tudo bem? Sou a *Lumiz* 💜\n\nTo aqui pra te ajudar a organizar as finanças da sua clínica de um jeito simples!\n\nPode me mandar:\n• Uma venda que você fez hoje\n• Um custo que precisa registrar\n• Ou me perguntar como está o caixa\n\nÉ só escrever naturalmente, tipo:\n_"Fiz um botox hoje, 2800 reais"_\n_"Comprei insumos por 1500"_\n_"Como tá meu saldo?"_\n\nBora começar? 😊`;
  }

  /**
   * Mensagem para envio de documento
   */
  handleDocumentPrompt() {
    return `Claro! Manda a foto do documento que eu analiso pra você 📸\n\nPode ser:\n• Boleto\n• Nota fiscal\n• Extrato bancário\n• Comprovante de pagamento\n\nEu vou ler e te mostrar as informações certinho!\n\nSe preferir, pode colar o código de barras do boleto também (aquele número grande) que eu reconheço 😉`;
  }

  /**
   * Mensagem para mensagem ambígua
   */
  async handleAmbiguousMessage(user, message, transactionController) {
    try {
      // Busca últimas transações para sugerir categorias
      const recentTrans = await transactionController.getRecentTransactions(user.id, 3);

      let response = `Hmm, não consegui entender direito 🤔\n\n`;

      // Analisa a mensagem para dar dicas específicas
      const msgLower = message.toLowerCase();
      const temNumero = /\d+/.test(message);
      const temPalavraChave = /botox|preenchimento|harmoniza|insumo|marketing|aluguel/i.test(message);

      if (!temNumero && temPalavraChave) {
        response += `Parece que falta o valor! Tenta assim:\n`;
        if (msgLower.includes('botox')) {
          response += `_"Botox 2800"_ ou _"Botox 2800 cliente Maria"_\n\n`;
        } else if (msgLower.includes('preench')) {
          response += `_"Preenchimento 3500"_ ou _"Preenchimento labial 2200"_\n\n`;
        } else {
          response += `_"${message} + valor"_\n\n`;
        }
      } else if (temNumero && !temPalavraChave) {
        response += `Entendi o número, mas não sei o que é. Isso foi uma venda ou um gasto?\n\n`;
        response += `Exemplo:\n_"Botox ${message}"_ se foi venda\n_"Insumos ${message}"_ se foi custo\n\n`;
      } else {
        response += `Tenta me explicar de um jeito mais simples! Por exemplo:\n`;
        response += `_"Fiz um botox de 2800"_ ou _"Gastei 3200 em insumos"_\n\n`;
      }

      // Sugere baseado no histórico se tiver
      if (recentTrans.length > 0) {
        const categorias = [...new Set(recentTrans.map(t => t.categories?.name).filter(Boolean))];
        if (categorias.length > 0) {
          response += `💡 *Suas últimas categorias:*\n`;
          categorias.slice(0, 3).forEach(cat => {
            response += `• ${cat}\n`;
          });
          response += `\n`;
        }
      }

      response += `Ou digite "ajuda" para ver todos os comandos!`;

      return response;
    } catch (error) {
      console.error('Erro ao processar mensagem ambígua:', error);
      return 'Não entendi essa mensagem 😅\n\nPode reformular? Tipo:\n_"Botox 2800"_ ou _"Insumos 1500"_\n\nOu digite "ajuda" para ver os comandos!';
    }
  }
}

module.exports = HelpHandler;

