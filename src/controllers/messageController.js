const geminiService = require('../services/geminiService');
const evolutionService = require('../services/evolutionService');
const userController = require('./userController');
const transactionController = require('./transactionController');

class MessageController {
  async handleIncomingMessage(phone, message) {
    try {
      console.log(`Mensagem recebida de ${phone}: ${message}`);

      const user = await userController.findOrCreateUser(phone);

      const intent = await geminiService.processMessage(message);
      console.log('Intenção identificada:', intent);

      let response = '';

      switch (intent.intencao) {
        case 'registrar_entrada':
        case 'registrar_saida':
          response = await this.handleTransaction(user, intent);
          break;

        case 'consultar_saldo':
          response = await this.handleBalance(user);
          break;

        case 'consultar_historico':
          response = await this.handleHistory(user);
          break;

        case 'relatorio_mensal':
          response = await this.handleMonthlyReport(user);
          break;

        case 'saudacao':
          response = `Olá!\n\nSou seu assistente financeiro.\n\nVocê pode:\n- Registrar gastos: "gastei 50 no mercado"\n- Registrar ganhos: "recebi 1500 de salário"\n- Ver saldo: "qual meu saldo?"\n- Ver histórico: "mostra minhas últimas transações"\n- Relatório mensal: "resumo do mês"`;
          break;

        case 'ajuda':
          response = `Como usar\n\nRegistrar despesa:\n"gastei 50 no mercado"\n"paguei 30 de uber"\n\nRegistrar receita:\n"recebi 1500 de salário"\n"ganhei 200 de freelance"\n\nConsultas:\n"qual meu saldo?"\n"mostra meu histórico"\n"relatório do mês"`;
          break;

        default:
          response = 'Desculpe, não entendi. Digite "ajuda" para ver o que posso fazer.';
      }

      await evolutionService.sendMessage(phone, response);

      return { success: true, intent };
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
      await evolutionService.sendMessage(
        phone,
        'Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.'
      );
      return { success: false, error: error.message };
    }
  }

  async handleTransaction(user, intent) {
    const { tipo, valor, categoria, descricao, data } = intent.dados;

    if (!valor || valor <= 0) {
      return 'Por favor, informe um valor válido.';
    }

    const transaction = await transactionController.createTransaction(user.id, {
      tipo,
      valor,
      categoria,
      descricao,
      data
    });

    const tipoTexto = tipo === 'entrada' ? 'Receita' : 'Despesa';

    return `${tipoTexto} registrada!\n\nValor: R$ ${valor.toFixed(2)}\nCategoria: ${categoria || 'Sem categoria'}\nData: ${new Date(data).toLocaleDateString('pt-BR')}`;
  }

  async handleBalance(user) {
    const balance = await transactionController.getBalance(user.id);

    return `Seu saldo atual\n\nSaldo: R$ ${balance.saldo.toFixed(2)}\nEntradas: R$ ${balance.entradas.toFixed(2)}\nSaídas: R$ ${balance.saidas.toFixed(2)}`;
  }

  async handleHistory(user) {
    const transactions = await transactionController.getRecentTransactions(user.id, 5);

    if (transactions.length === 0) {
      return 'Você ainda não possui transações registradas.';
    }

    let response = 'Últimas transações\n\n';

    transactions.forEach(t => {
      const sinal = t.type === 'entrada' ? '+' : '-';
      const categoria = t.categories?.name || 'Sem categoria';
      const data = new Date(t.date).toLocaleDateString('pt-BR');

      response += `${sinal}R$ ${parseFloat(t.amount).toFixed(2)}\n`;
      response += `${categoria} - ${data}\n`;
      if (t.description) {
        response += `${t.description}\n`;
      }
      response += '\n';
    });

    return response.trim();
  }

  async handleMonthlyReport(user) {
    const now = new Date();
    const report = await transactionController.getMonthlyReport(
      user.id,
      now.getFullYear(),
      now.getMonth() + 1
    );

    let response = `Relatório de ${report.periodo}\n\n`;
    response += `Entradas: R$ ${report.entradas.toFixed(2)}\n`;
    response += `Saídas: R$ ${report.saidas.toFixed(2)}\n`;
    response += `Saldo: R$ ${report.saldo.toFixed(2)}\n`;
    response += `Total de transações: ${report.totalTransacoes}\n\n`;

    if (Object.keys(report.porCategoria).length > 0) {
      response += 'Por categoria:\n';
      Object.entries(report.porCategoria)
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([cat, data]) => {
          response += `${cat}: R$ ${data.total.toFixed(2)}\n`;
        });
    }

    return response;
  }
}

module.exports = new MessageController();
