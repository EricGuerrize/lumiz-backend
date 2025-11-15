const geminiService = require('../services/geminiService');
const evolutionService = require('../services/evolutionService');
const userController = require('./userController');
const transactionController = require('./transactionController');

class MessageController {
  constructor() {
    // Armazena transações pendentes de confirmação temporariamente
    this.pendingTransactions = new Map();
  }

  async handleIncomingMessage(phone, message) {
    try {
      console.log(`Mensagem recebida de ${phone}: ${message}`);

      const user = await userController.findOrCreateUser(phone);

      // Verifica se existe uma transação pendente de confirmação
      if (this.pendingTransactions.has(phone)) {
        return await this.handleConfirmation(phone, message, user);
      }

      const intent = await geminiService.processMessage(message);
      console.log('Intenção identificada:', intent);

      let response = '';

      switch (intent.intencao) {
        case 'registrar_entrada':
        case 'registrar_saida':
          response = await this.handleTransactionRequest(user, intent, phone);
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
          const greetingMessage = `Oi! Sou a Lumiz 💜\nSua assistente financeira para clínicas de estética.\n\nEm poucos minutos, você vai conseguir:\n✨ Registrar vendas e custos pelo WhatsApp\n📊 Ver resumos financeiros sempre atualizados\n💰 Saber quanto lucrou no mês – sem planilhas\n\nO que você quer fazer?`;

          await evolutionService.sendButtons(phone, greetingMessage, [
            '💰 Ver meu saldo',
            '📋 Ver histórico',
            '❓ Ver ajuda'
          ]);
          response = null;
          break;

        case 'ajuda':
          const helpMessage = `*Como usar a Lumiz* 📋\n\n*Registrar venda (receita):*\n"Paciente Júlia, botox facial, R$ 2.800, cartão 4x"\n"Registra: preenchimento labial, R$ 1.500, PIX"\n\n*Registrar custo (despesa):*\n"Paguei o boleto de R$ 3.200 dos insumos"\n"Custo de R$ 800 com marketing"\n\n*Consultas:*\n"Qual meu lucro do mês?"\n"Mostra minhas últimas vendas"\n"Resumo financeiro de novembro"\n\nO que você quer fazer agora?`;

          await evolutionService.sendButtons(phone, helpMessage, [
            '💰 Ver saldo',
            '📋 Histórico',
            '📊 Relatório mensal'
          ]);
          response = null;
          break;

        case 'apenas_valor':
          response = await this.handleOnlyValue(intent, phone);
          break;

        case 'apenas_procedimento':
          response = await this.handleOnlyProcedure(intent, phone);
          break;

        case 'mensagem_ambigua':
          response = 'Não consegui entender muito bem 🤔\n\nPode me dar mais detalhes? Por exemplo:\n"Paciente Ana, preenchimento labial, R$ 1.500 no PIX"';
          break;

        default:
          response = 'Não entendi muito bem 🤔\n\nPode reformular? Ou digite "ajuda" para ver exemplos do que posso fazer.';
      }

      // Envia resposta somente se não for null (botões já foram enviados)
      if (response !== null) {
        await evolutionService.sendMessage(phone, response);
      }

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

  async handleTransactionRequest(user, intent, phone) {
    const { tipo, valor, categoria, descricao, data } = intent.dados;

    if (!valor || valor <= 0) {
      return 'Preciso de um valor válido para registrar 😊\n\nPode me passar o valor?';
    }

    // Armazena a transação pendente
    this.pendingTransactions.set(phone, {
      user,
      dados: { tipo, valor, categoria, descricao, data },
      timestamp: Date.now()
    });

    // Monta a mensagem de confirmação visual
    const tipoTexto = tipo === 'entrada' ? 'Receita (venda)' : 'Custo (despesa)';
    const emoji = tipo === 'entrada' ? '💰' : '💸';
    const dataFormatada = new Date(data).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    let message = `Confere se está certo 👇\n\n`;
    message += `${emoji} *Tipo:* ${tipoTexto}\n`;
    message += `💵 *Valor:* R$ ${valor.toFixed(2)}\n`;
    message += `📂 *Categoria:* ${categoria || 'Sem categoria'}\n`;
    if (descricao) {
      message += `📝 *Descrição:* ${descricao}\n`;
    }
    message += `📅 *Data:* ${dataFormatada}\n\n`;
    message += `Está tudo certo?`;

    // Envia com botões interativos
    await evolutionService.sendButtons(phone, message, ['✅ Confirmar', '❌ Cancelar']);

    // Retorna null para não enviar mensagem duplicada
    return null;
  }

  async handleOnlyValue(intent, phone) {
    const valor = intent.dados.valor;

    const message = `Vi que você mandou *R$ ${valor.toFixed(2)}* 💰\n\nIsso é uma receita (venda) ou um custo (despesa)?`;

    // Envia com botões interativos
    await evolutionService.sendButtons(phone, message, ['💰 Receita', '💸 Custo']);

    return null;
  }

  async handleOnlyProcedure(intent, phone) {
    const categoria = intent.dados.categoria;

    let response = `Vi que você mencionou *${categoria}* 💉\n\n`;
    response += `Qual foi o valor?\n\n`;
    response += `Pode me mandar o valor completo, por exemplo:\n`;
    response += `"R$ 1.500" ou "1500"`;

    return response;
  }

  async handleConfirmation(phone, message, user) {
    const pending = this.pendingTransactions.get(phone);

    // Verifica se a confirmação expirou (5 minutos)
    if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
      this.pendingTransactions.delete(phone);
      return 'O tempo para confirmar expirou 😅\n\nPode me enviar a movimentação novamente?';
    }

    const messageLower = message.toLowerCase().trim();

    // Confirmação positiva (inclui resposta dos botões)
    if (
      messageLower === 'sim' ||
      messageLower === 's' ||
      messageLower === 'confirmar' ||
      messageLower === 'ok' ||
      messageLower === 'confirma' ||
      messageLower === 'isso' ||
      messageLower === 'correto' ||
      messageLower === '✅ confirmar' ||
      messageLower.includes('confirmar')
    ) {
      // Salva a transação
      const { tipo, valor, categoria, descricao, data } = pending.dados;

      await transactionController.createTransaction(user.id, {
        tipo,
        valor,
        categoria,
        descricao,
        data
      });

      // Remove da lista de pendentes
      this.pendingTransactions.delete(phone);

      const tipoTexto = tipo === 'entrada' ? 'Receita' : 'Custo';
      const emoji = tipo === 'entrada' ? '💰' : '💸';

      return `${emoji} *${tipoTexto} registrada com sucesso!*\n\nTudo anotadinho! ✅`;
    }

    // Confirmação negativa (inclui resposta dos botões)
    if (
      messageLower === 'não' ||
      messageLower === 'nao' ||
      messageLower === 'n' ||
      messageLower === 'cancelar' ||
      messageLower === 'corrigir' ||
      messageLower === '❌ cancelar' ||
      messageLower.includes('cancelar')
    ) {
      this.pendingTransactions.delete(phone);
      return 'Registro cancelado ❌\n\nSe quiser registrar, é só me enviar novamente com os dados corretos!';
    }

    // Resposta inválida
    return 'Não entendi 🤔\n\nResponde "sim" para confirmar ou "não" para cancelar.';
  }

  async handleBalance(user) {
    const balance = await transactionController.getBalance(user.id);

    const lucro = balance.entradas - balance.saidas;
    const margemPercentual = balance.entradas > 0
      ? ((lucro / balance.entradas) * 100).toFixed(1)
      : 0;

    let response = `📊 *Resumo Financeiro*\n\n`;
    response += `• Receitas: R$ ${balance.entradas.toFixed(2)}\n`;
    response += `• Custos: R$ ${balance.saidas.toFixed(2)}\n`;
    response += `• Lucro: R$ ${lucro.toFixed(2)} (${margemPercentual}%)\n\n`;
    response += `Quer ver o relatório detalhado? Digite "relatório do mês"`;

    return response;
  }

  async handleHistory(user) {
    const transactions = await transactionController.getRecentTransactions(user.id, 5);

    if (transactions.length === 0) {
      return 'Você ainda não tem movimentações registradas 📋\n\nQue tal registrar sua primeira venda? 😊';
    }

    let response = `📜 *Últimas movimentações*\n\n`;

    transactions.forEach((t, index) => {
      const emoji = t.type === 'entrada' ? '💰' : '💸';
      const sinal = t.type === 'entrada' ? '+' : '-';
      const categoria = t.categories?.name || 'Sem categoria';
      const data = new Date(t.date).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit'
      });

      response += `${emoji} ${sinal}R$ ${parseFloat(t.amount).toFixed(2)}\n`;
      response += `   ${categoria}`;
      if (t.description) {
        response += ` • ${t.description}`;
      }
      response += `\n   ${data}\n`;

      if (index < transactions.length - 1) {
        response += '\n';
      }
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

    const lucro = report.entradas - report.saidas;
    const margemPercentual = report.entradas > 0
      ? ((lucro / report.entradas) * 100).toFixed(1)
      : 0;

    let response = `📊 *Relatório de ${report.periodo}*\n\n`;
    response += `✨ *Resumo Geral*\n`;
    response += `• Receitas: R$ ${report.entradas.toFixed(2)}\n`;
    response += `• Custos: R$ ${report.saidas.toFixed(2)}\n`;
    response += `• Lucro: R$ ${lucro.toFixed(2)} (${margemPercentual}%)\n`;
    response += `• Total de movimentações: ${report.totalTransacoes}\n\n`;

    if (Object.keys(report.porCategoria).length > 0) {
      response += `💼 *Por categoria:*\n`;
      Object.entries(report.porCategoria)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5) // Mostra apenas top 5
        .forEach(([cat, data]) => {
          response += `• ${cat}: R$ ${data.total.toFixed(2)}\n`;
        });
    }

    return response;
  }
}

module.exports = new MessageController();
