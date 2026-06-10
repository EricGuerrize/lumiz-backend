const documentCopy = require('../../copy/documentWhatsappCopy');

/**
 * Handler para ajuda e comandos
 *
 * A lista de exemplos em handleHelp() é o contrato com o usuário; intents
 * correspondentes devem permanecer na rota determinística — ver
 * src/config/helpCommandContract.js e agentRouterService.
 */
class HelpHandler {
  /**
   * Mostra ajuda
   */
  handleHelp() {
    return `COMANDOS DISPONÍVEIS\n\n` +
      `💰 Registrar Vendas:\n` +
      `"Botox 2800"\n` +
      `"Preenchimento 3500 cliente Maria"\n\n` +
      `💸 Registrar Custos:\n` +
      `"Insumos 1500"\n` +
      `"Aluguel 2500"\n\n` +
      `📊 Consultas:\n` +
      `"saldo" - Ver saldo atual\n` +
      `"histórico" - Últimas movimentações\n` +
      `"contas a pagar" - Calendário de vencimentos\n` +
      `"parcelas a receber" - Recebíveis pendentes\n` +
      `"gap de caixa" - Projeção de caixa dos próximos 30 dias\n` +
      `"briefing" - Prioridades financeiras do dia\n` +
      `"relatório" - Relatório mensal\n` +
      `"stats hoje" - Estatísticas do dia\n\n` +
      `📦 Estoque e validade:\n` +
      `"configurar estoque" - Cadastrar inventário inicial\n` +
      `"estoque" - Resumo do estoque\n` +
      `"saldo botox" - Saldo de um item específico\n` +
      `"entrada estoque botox 3 frascos" - Dar entrada manual\n` +
      `"baixar estoque botox 10 unidades" - Dar baixa manual\n` +
      `"validades" - Itens próximos do vencimento\n\n` +
      `🔍 Buscar:\n` +
      `"buscar botox" - Busca transações\n` +
      `"buscar 2800" - Busca por valor\n\n` +
      `📄 Documentos:\n` +
      `Envie foto de boleto, nota fiscal ou extrato\n\n` +
      `📥 Exportar:\n` +
      `"gerar pdf" - Relatório mensal em PDF\n` +
      `"relatório em pdf" - Relatório mensal em PDF\n` +
      `"excel" - Relatório em planilha Excel\n\n` +
      `⚙️ Outros:\n` +
      `"desfazer" - Remove última transação\n` +
      `"editar" - Edita uma transação\n` +
      `"meta" - Ver progresso da meta`;
  }

  /**
   * Envia link do dashboard
   */
  handleDashboard() {
    const url = process.env.DASHBOARD_URL || 'https://lumiz-financeiro.vercel.app';
    return `Aqui está seu acesso ao dashboard 🌐\n\n${url}\n\nPor lá você visualiza relatórios, gráficos e o histórico completo das suas movimentações!`;
  }

  /**
   * Mensagem de saudação
   */
  handleGreeting() {
    return `Oi! Me manda o que aconteceu na clínica hoje:\n\n• venda: _"botox R$ 1.200 no pix"_\n• custo: _"toxina R$ 600"_\n• conta: _"aluguel R$ 2.000 vence dia 10"_\n• consulta: _"quanto entrou hoje?"_\n\nTambém aceito foto ou PDF de nota, boleto e comprovante.`;
  }

  /**
   * Mensagem para envio de documento
   */
  handleDocumentPrompt() {
    return documentCopy.documentPrompt();
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
        response += `Posso te ajudar com:\n`;
        response += `• Registrar vendas: "Botox 2800"\n`;
        response += `• Registrar custos: "Insumos 1500"\n`;
        response += `• Ver saldo: "saldo"\n`;
        response += `• Ver histórico: "histórico"\n\n`;
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
      return 'Não entendi essa mensagem 😅\n\nPode reformular? Tipo:\n_"Botox R$ 2800"_ ou _"Insumos R$ 1500"_\n\nOu digite "ajuda" para ver os comandos!';
    }
  }
}

module.exports = HelpHandler;
