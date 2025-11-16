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
      // Verifica se está em processo de onboarding
      if (userController.isOnboarding(phone)) {
        return await userController.processOnboarding(phone, message);
      }

      // Busca usuário pelo telefone
      const user = await userController.findUserByPhone(phone);

      // Se não encontrou usuário, inicia onboarding
      if (!user) {
        userController.startOnboarding(phone);
        return `Olá! Sou a *Lumiz* 💜\n\nSua assistente para gestão de clínica estética!\n\nParece que você ainda não tem cadastro.\nVou te ajudar a configurar!\n\n*Qual o seu nome completo?*`;
      }

      // Verifica se existe uma transação pendente de confirmação
      if (this.pendingTransactions.has(phone)) {
        return await this.handleConfirmation(phone, message, user);
      }

      const intent = await geminiService.processMessage(message);

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
          response = `Oi! Sou a *Lumiz* 💜\nAssistente financeira para clínicas de estética.\n\n*Me manda assim:*\n\n📝 *Para registrar venda:*\n"Botox, 2800, paciente Maria"\n"Preenchimento labial 1500 pix"\n\n📝 *Para registrar custo:*\n"Insumos 3200"\n"Marketing 800"\n\n📊 *Para consultar:*\n"Saldo" ou "Resumo"\n"Histórico"\n"Relatório"\n\nMe manda sua primeira movimentação! 😊`;
          break;

        case 'ajuda':
          response = `*Exemplos de uso:* 📋\n\n💰 *REGISTRAR VENDA:*\n"Botox 2800 paciente Ana"\n"Preenchimento 1500 pix"\n"Harmonização facial 4500"\n\n💸 *REGISTRAR CUSTO:*\n"Insumos 3200"\n"Marketing 800"\n"Aluguel 5000"\n\n📊 *CONSULTAR:*\n"Saldo" - ver resumo\n"Histórico" - últimas movimentações\n"Relatório" - relatório do mês\n\n*Dica:* Quanto mais info, melhor! Ex:\n"Botox glabela, 2800, Dra. Maria, cartão 3x"`;
          break;

        case 'apenas_valor':
          response = await this.handleOnlyValue(intent, phone);
          break;

        case 'apenas_procedimento':
          response = await this.handleOnlyProcedure(intent, phone);
          break;

        case 'mensagem_ambigua':
          response = 'Não entendi 🤔\n\nMe manda assim:\n"Botox 2800" (venda)\n"Insumos 3200" (custo)\n\nOu digite "ajuda"';
          break;

        default:
          response = 'Não entendi 🤔\n\nTenta assim:\n"Botox 2800"\n"Insumos 3200"\n"Saldo"\n\nOu manda "ajuda"';
      }

      return response;
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
      return 'Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.';
    }
  }

  async handleTransactionRequest(user, intent, phone) {
    const { tipo, valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao } = intent.dados;

    if (!valor || valor <= 0) {
      return 'Não consegui identificar o valor 🤔\n\nMe manda assim: "Botox 2800" ou "Insumos 3200"';
    }

    // Armazena a transação pendente
    this.pendingTransactions.set(phone, {
      user,
      dados: { tipo, valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao },
      timestamp: Date.now()
    });

    // Monta a mensagem de confirmação visual
    const tipoTexto = tipo === 'entrada' ? 'VENDA' : 'CUSTO';
    const emoji = tipo === 'entrada' ? '💰' : '💸';
    const dataFormatada = new Date(data).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    });

    let message = `${emoji} *${tipoTexto}*\n\n`;
    message += `💵 *R$ ${valor.toFixed(2)}*\n`;
    message += `📂 ${categoria || 'Sem categoria'}\n`;
    if (descricao) {
      message += `📝 ${descricao}\n`;
    }

    // Adiciona informações de parcelamento
    if (forma_pagamento === 'parcelado' && parcelas) {
      const valorParcela = valor / parcelas;
      message += `💳 *${parcelas}x de R$ ${valorParcela.toFixed(2)}*\n`;
      if (bandeira_cartao) {
        message += `🏷️ ${bandeira_cartao.toUpperCase()}\n`;
      }
    } else {
      message += `💳 À vista\n`;
    }

    message += `📅 ${dataFormatada}\n\n`;
    message += `Responde *SIM* pra confirmar ou *NÃO* pra cancelar`;

    return message;
  }

  async handleOnlyValue(intent, phone) {
    const valor = intent.dados.valor;

    return `Vi *R$ ${valor.toFixed(2)}* 💰\n\nIsso é venda ou custo?\n\nMe manda assim:\n"Botox ${valor}" (se for venda)\n"Insumos ${valor}" (se for custo)`;
  }

  async handleOnlyProcedure(intent, phone) {
    const categoria = intent.dados.categoria;

    return `Vi *${categoria}* 💉\n\nQual o valor?\n\nMe manda assim:\n"${categoria} 2800"`;
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
      const { tipo, valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao } = pending.dados;

      try {
        await transactionController.createTransaction(user.id, {
          tipo,
          valor,
          categoria,
          descricao,
          data,
          forma_pagamento,
          parcelas,
          bandeira_cartao
        });

        // Remove da lista de pendentes
        this.pendingTransactions.delete(phone);

        const tipoTexto = tipo === 'entrada' ? 'Receita' : 'Custo';
        const emoji = tipo === 'entrada' ? '💰' : '💸';

        let successMsg = `${emoji} *${tipoTexto} registrada com sucesso!*\n\n`;

        if (forma_pagamento === 'parcelado' && parcelas) {
          const valorParcela = valor / parcelas;
          successMsg += `💳 ${parcelas}x de R$ ${valorParcela.toFixed(2)}\n`;
          successMsg += `📅 Você receberá lembretes mensais!\n\n`;
        }

        successMsg += `Tudo anotadinho! ✅`;

        return successMsg;
      } catch (error) {
        console.error('Erro ao salvar transação:', error);
        return `Erro ao salvar transação 😢\n\nTente novamente.`;
      }
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

    let response = `📊 *RESUMO*\n\n`;
    response += `💰 Vendas: *R$ ${balance.entradas.toFixed(2)}*\n`;
    response += `💸 Custos: *R$ ${balance.saidas.toFixed(2)}*\n`;
    response += `✨ Lucro: *R$ ${lucro.toFixed(2)}* (${margemPercentual}%)\n\n`;

    if (balance.entradas === 0 && balance.saidas === 0) {
      response += `Ainda não tem movimentações.\n\nMe manda sua primeira venda:\n"Botox 2800"`;
    } else {
      response += `Manda "relatório" pra ver detalhado`;
    }

    return response;
  }

  async handleHistory(user) {
    const transactions = await transactionController.getRecentTransactions(user.id, 5);

    if (transactions.length === 0) {
      return 'Sem movimentações ainda 📋\n\nMe manda sua primeira:\n"Botox 2800"';
    }

    let response = `📜 *ÚLTIMAS 5*\n\n`;

    transactions.forEach((t) => {
      const emoji = t.type === 'entrada' ? '💰' : '💸';
      const sinal = t.type === 'entrada' ? '+' : '-';
      const categoria = t.categories?.name || 'Sem categoria';
      const data = new Date(t.date).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit'
      });

      response += `${emoji} ${sinal}R$ ${parseFloat(t.amount).toFixed(2)} • ${categoria} • ${data}\n`;
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

    const mesNome = now.toLocaleDateString('pt-BR', { month: 'long' }).toUpperCase();

    let response = `📊 *RELATÓRIO ${mesNome}*\n\n`;
    response += `💰 Vendas: *R$ ${report.entradas.toFixed(2)}*\n`;
    response += `💸 Custos: *R$ ${report.saidas.toFixed(2)}*\n`;
    response += `✨ Lucro: *R$ ${lucro.toFixed(2)}* (${margemPercentual}%)\n`;
    response += `📝 ${report.totalTransacoes} movimentações\n`;

    if (Object.keys(report.porCategoria).length > 0) {
      response += `\n*TOP CATEGORIAS:*\n`;
      Object.entries(report.porCategoria)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5)
        .forEach(([cat, data]) => {
          const emoji = data.tipo === 'entrada' ? '💰' : '💸';
          response += `${emoji} ${cat}: R$ ${data.total.toFixed(2)}\n`;
        });
    }

    return response;
  }
}

module.exports = new MessageController();
