const geminiService = require('../services/geminiService');
const evolutionService = require('../services/evolutionService');
const userController = require('./userController');
const transactionController = require('./transactionController');
const reminderService = require('../services/reminderService');
const documentService = require('../services/documentService');

class MessageController {
  constructor() {
    // Armazena transações pendentes de confirmação temporariamente
    this.pendingTransactions = new Map();
    // Armazena transações de documentos pendentes
    this.pendingDocumentTransactions = new Map();
    // Armazena última transação registrada por usuário (para desfazer)
    this.lastTransactions = new Map();
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

      // Verifica se existe transações de documento pendentes
      if (this.pendingDocumentTransactions.has(phone)) {
        return await this.handleDocumentConfirmation(phone, message, user);
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

        case 'comparar_meses':
          response = await this.handleCompareMonths(user);
          break;

        case 'consultar_parcelas':
          response = await this.handlePendingInstallments(user);
          break;

        case 'enviar_documento':
          response = `Claro! Manda a foto do documento que eu analiso pra você 📸\n\nPode ser:\n• Boleto\n• Nota fiscal\n• Extrato bancário\n• Comprovante de pagamento\n\nEu vou ler e te mostrar as informações certinho!\n\nSe preferir, pode colar o código de barras do boleto também (aquele número grande) que eu reconheço 😉`;
          break;

        case 'codigo_boleto':
          response = await this.handleBarcodeMessage(user, intent, phone);
          break;

        case 'desfazer':
          response = await this.handleUndoLastTransaction(user, phone);
          break;

        case 'saudacao':
          response = `Oi! Tudo bem? Sou a *Lumiz* 💜\n\nTo aqui pra te ajudar a organizar as finanças da sua clínica de um jeito simples!\n\nPode me mandar:\n• Uma venda que você fez hoje\n• Um custo que precisa registrar\n• Ou me perguntar como está o caixa\n\nÉ só escrever naturalmente, tipo:\n_"Fiz um botox hoje, 2800 reais"_\n_"Comprei insumos por 1500"_\n_"Como tá meu saldo?"_\n\nBora começar? 😊`;
          break;

        case 'ajuda':
          response = `Posso te ajudar com várias coisas! 😊\n\n*💰 Registrar vendas:*\nMe conta o procedimento e valor, tipo:\n_"Harmonização 4500 da cliente Maria"_\n_"Preenchimento labial 2200"_\n\n*💸 Registrar custos:*\n_"Paguei 3200 de insumos"_\n_"Marketing 800 reais"_\n\n*📊 Ver como tá o financeiro:*\n_"Qual meu saldo?"_\n_"Me mostra o relatório do mês"_\n_"Quero ver minhas últimas vendas"_\n\n*📄 Documentos:*\nManda foto de boleto ou nota fiscal que eu leio pra você!\n\n*💳 Parcelas:*\n_"Quais parcelas tenho pra receber?"_\n\nÉ só me mandar que eu entendo! 🤗`;
          break;

        case 'apenas_valor':
          response = await this.handleOnlyValue(intent, phone);
          break;

        case 'apenas_procedimento':
          response = await this.handleOnlyProcedure(intent, phone);
          break;

        case 'mensagem_ambigua':
          response = 'Hmm, não consegui entender direito 🤔\n\nTenta me explicar melhor! Por exemplo:\n_"Fiz um botox de 2800"_ ou _"Gastei 3200 em insumos"_\n\nSe precisar, é só mandar "ajuda" que te mostro tudo que sei fazer!';
          break;

        default:
          response = 'Opa, não entendi essa 😅\n\nPode reformular? Tipo:\n_"Vendi um preenchimento por 1500"_\n_"Paguei conta de luz 450"_\n_"Como tá meu saldo?"_\n\nOu manda "ajuda" que te explico melhor!';
      }

      return response;
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
      return 'Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.';
    }
  }

  async handleTransactionRequest(user, intent, phone) {
    const { tipo, valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao, nome_cliente } = intent.dados;

    if (!valor || valor <= 0) {
      return 'Não consegui identificar o valor 🤔\n\nMe manda assim: "Botox 2800" ou "Insumos 3200"';
    }

    // Armazena a transação pendente
    this.pendingTransactions.set(phone, {
      user,
      dados: { tipo, valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao, nome_cliente },
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

    // Mostra nome do cliente se disponível
    if (nome_cliente) {
      message += `👤 ${nome_cliente}\n`;
    }

    if (descricao && !nome_cliente) {
      // Só mostra descrição se não tiver cliente (para evitar duplicação)
      message += `📝 ${descricao}\n`;
    }

    // Adiciona informações de pagamento
    if (forma_pagamento === 'parcelado' && parcelas) {
      const valorParcela = valor / parcelas;
      message += `💳 *${parcelas}x de R$ ${valorParcela.toFixed(2)}*\n`;
      if (bandeira_cartao) {
        message += `🏷️ ${bandeira_cartao.toUpperCase()}\n`;
      }
    } else {
      // Mostra forma de pagamento de forma amigável
      const formaTexto = this.getPaymentMethodText(forma_pagamento);
      message += `💳 ${formaTexto}\n`;
    }

    message += `📅 ${dataFormatada}\n\n`;
    message += `Responde *SIM* pra confirmar ou *NÃO* pra cancelar`;

    return message;
  }

  getPaymentMethodText(forma_pagamento) {
    const metodos = {
      'pix': 'PIX',
      'dinheiro': 'Dinheiro',
      'debito': 'Débito',
      'credito_avista': 'Crédito à vista',
      'avista': 'À vista',
      'parcelado': 'Parcelado'
    };
    return metodos[forma_pagamento] || 'À vista';
  }

  async handleOnlyValue(intent, phone) {
    const valor = intent.dados.valor;

    return `Entendi, *R$ ${valor.toFixed(2)}* 💰\n\nMas isso foi uma venda ou um gasto?\n\nMe conta mais, tipo:\n_"Botox ${valor}"_ se foi uma venda\n_"Insumos ${valor}"_ se foi um custo`;
  }

  async handleOnlyProcedure(intent, phone) {
    const categoria = intent.dados.categoria;

    return `Beleza, *${categoria}*! 💉\n\nE qual foi o valor?\n\nMe manda completo, tipo:\n_"${categoria} 2800"_`;
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
        const transaction = await transactionController.createTransaction(user.id, {
          tipo,
          valor,
          categoria,
          descricao,
          data,
          forma_pagamento,
          parcelas,
          bandeira_cartao
        });

        // Salva a última transação para possível desfazer
        this.lastTransactions.set(phone, {
          transactionId: transaction.id,
          tipo,
          valor,
          categoria,
          timestamp: Date.now()
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

        successMsg += `Tudo anotadinho! ✅\n\n`;
        successMsg += `_Errou algo? Manda "desfazer" nos próximos 10 min_`;

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
    return 'Não entendi... É *sim* pra confirmar ou *não* pra cancelar 😊';
  }

  async handleBalance(user) {
    const balance = await transactionController.getBalance(user.id);

    const lucro = balance.entradas - balance.saidas;
    const margemPercentual = balance.entradas > 0
      ? ((lucro / balance.entradas) * 100).toFixed(1)
      : 0;

    if (balance.entradas === 0 && balance.saidas === 0) {
      return `Ainda não tem nenhuma movimentação registrada 📋\n\nMe conta sua primeira venda!\nTipo: _"Botox 2800 da cliente Maria"_`;
    }

    let response = `Olha só como tá seu financeiro! 📊\n\n`;
    response += `*Vendas:* R$ ${balance.entradas.toFixed(2)}\n`;
    response += `*Custos:* R$ ${balance.saidas.toFixed(2)}\n`;
    response += `*Lucro:* R$ ${lucro.toFixed(2)} _(${margemPercentual}% de margem)_\n\n`;

    if (lucro > 0) {
      response += `Tá no positivo! 🎉\n`;
    } else if (lucro < 0) {
      response += `Opa, tá no vermelho... 😬\n`;
    }

    response += `\nQuer ver o relatório completo do mês? Manda _"relatório"_`;

    return response;
  }

  async handleHistory(user) {
    const transactions = await transactionController.getRecentTransactions(user.id, 5);

    if (transactions.length === 0) {
      return `Não achei nenhuma movimentação ainda 📋\n\nBora registrar a primeira?\nÉ só me mandar tipo: _"Botox 2800"_`;
    }

    let response = `Suas últimas movimentações:\n\n`;

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

    response += `\nPra ver mais detalhes, manda _"relatório"_`;

    return response;
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

    const mesNome = now.toLocaleDateString('pt-BR', { month: 'long' });

    if (report.totalTransacoes === 0) {
      return `Ainda não tem movimentações em ${mesNome} 📋\n\nBora começar? Me manda sua primeira venda!`;
    }

    let response = `Seu relatório de *${mesNome}*! 📊\n\n`;
    response += `*Faturamento:* R$ ${report.entradas.toFixed(2)}\n`;
    response += `*Custos:* R$ ${report.saidas.toFixed(2)}\n`;
    response += `*Lucro líquido:* R$ ${lucro.toFixed(2)} _(${margemPercentual}%)_\n\n`;
    response += `Total de ${report.totalTransacoes} movimentações esse mês\n`;

    if (Object.keys(report.porCategoria).length > 0) {
      response += `\n*Principais categorias:*\n`;
      Object.entries(report.porCategoria)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5)
        .forEach(([cat, data]) => {
          const emoji = data.tipo === 'entrada' ? '💰' : '💸';
          response += `${emoji} ${cat}: R$ ${data.total.toFixed(2)}\n`;
        });
    }

    if (lucro > 0) {
      response += `\nMandando bem! 💪`;
    } else if (lucro < 0) {
      response += `\nBora reverter esse cenário! 💪`;
    }

    return response;
  }

  async handleCompareMonths(user) {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Calcula mês anterior
    let previousMonth = currentMonth - 1;
    let previousYear = currentYear;
    if (previousMonth === 0) {
      previousMonth = 12;
      previousYear = currentYear - 1;
    }

    const reportCurrent = await transactionController.getMonthlyReport(
      user.id,
      currentYear,
      currentMonth
    );

    const reportPrevious = await transactionController.getMonthlyReport(
      user.id,
      previousYear,
      previousMonth
    );

    const currentMonthName = now.toLocaleDateString('pt-BR', { month: 'long' });
    const previousMonthName = new Date(previousYear, previousMonth - 1).toLocaleDateString('pt-BR', { month: 'long' });

    const lucroCurrent = reportCurrent.entradas - reportCurrent.saidas;
    const lucroPrevious = reportPrevious.entradas - reportPrevious.saidas;

    // Calcula variações
    const variacaoEntradas = reportPrevious.entradas > 0
      ? (((reportCurrent.entradas - reportPrevious.entradas) / reportPrevious.entradas) * 100).toFixed(1)
      : reportCurrent.entradas > 0 ? 100 : 0;

    const variacaoSaidas = reportPrevious.saidas > 0
      ? (((reportCurrent.saidas - reportPrevious.saidas) / reportPrevious.saidas) * 100).toFixed(1)
      : reportCurrent.saidas > 0 ? 100 : 0;

    const variacaoLucro = reportPrevious.entradas > 0
      ? (((lucroCurrent - lucroPrevious) / Math.abs(lucroPrevious || 1)) * 100).toFixed(1)
      : lucroCurrent > 0 ? 100 : 0;

    let response = `📊 *COMPARATIVO DE MESES*\n\n`;

    // Mês atual
    response += `*${currentMonthName.toUpperCase()}* (atual)\n`;
    response += `💰 Vendas: R$ ${reportCurrent.entradas.toFixed(2)}\n`;
    response += `💸 Custos: R$ ${reportCurrent.saidas.toFixed(2)}\n`;
    response += `📈 Lucro: R$ ${lucroCurrent.toFixed(2)}\n\n`;

    // Mês anterior
    response += `*${previousMonthName.toUpperCase()}*\n`;
    response += `💰 Vendas: R$ ${reportPrevious.entradas.toFixed(2)}\n`;
    response += `💸 Custos: R$ ${reportPrevious.saidas.toFixed(2)}\n`;
    response += `📈 Lucro: R$ ${lucroPrevious.toFixed(2)}\n\n`;

    // Variações
    response += `*VARIAÇÃO*\n`;

    const setaEntradas = variacaoEntradas >= 0 ? '📈' : '📉';
    const setaSaidas = variacaoSaidas >= 0 ? '📈' : '📉';
    const setaLucro = variacaoLucro >= 0 ? '📈' : '📉';

    response += `${setaEntradas} Vendas: ${variacaoEntradas >= 0 ? '+' : ''}${variacaoEntradas}%\n`;
    response += `${setaSaidas} Custos: ${variacaoSaidas >= 0 ? '+' : ''}${variacaoSaidas}%\n`;
    response += `${setaLucro} Lucro: ${variacaoLucro >= 0 ? '+' : ''}${variacaoLucro}%\n\n`;

    // Análise
    if (lucroCurrent > lucroPrevious) {
      response += `Tá crescendo! 🎉 Seu lucro aumentou R$ ${(lucroCurrent - lucroPrevious).toFixed(2)}`;
    } else if (lucroCurrent < lucroPrevious) {
      response += `Lucro caiu R$ ${(lucroPrevious - lucroCurrent).toFixed(2)} 😬\nBora focar em aumentar as vendas!`;
    } else {
      response += `Lucro estável! 🤝`;
    }

    return response;
  }

  async handlePendingInstallments(user) {
    try {
      const installments = await reminderService.getPendingInstallments(user.id);

      if (installments.length === 0) {
        return `Não tem parcelas pendentes! ✅\n\nPra registrar venda parcelada, é só me mandar:\n_"Botox 2800 3x cartão paciente Maria"_`;
      }

      let response = `💳 *PARCELAS A RECEBER*\n\n`;

      // Total a receber
      const totalReceber = installments.reduce((sum, i) => sum + i.valor_parcela, 0);
      response += `💵 Total pendente: *R$ ${totalReceber.toFixed(2)}*\n`;
      response += `📋 ${installments.length} parcela${installments.length > 1 ? 's' : ''} restante${installments.length > 1 ? 's' : ''}\n\n`;

      // Agrupa por mês
      const porMes = {};
      installments.forEach(inst => {
        const mesAno = inst.data_vencimento.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
        if (!porMes[mesAno]) {
          porMes[mesAno] = [];
        }
        porMes[mesAno].push(inst);
      });

      // Mostra próximas 10 parcelas
      let count = 0;
      for (const [mesAno, parcelas] of Object.entries(porMes)) {
        if (count >= 10) break;

        response += `📅 *${mesAno.toUpperCase()}*\n`;

        for (const p of parcelas) {
          if (count >= 10) break;

          const dataFormatada = p.data_vencimento.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit'
          });

          // Formato: parcela • valor • cliente • procedimento
          let linha = `  ${p.parcela_atual}/${p.total_parcelas} • R$ ${p.valor_parcela.toFixed(2)}`;
          linha += ` • ${p.cliente}`;

          // Adiciona procedimento se disponível
          if (p.procedimento && p.procedimento !== 'Procedimento') {
            linha += ` _(${p.procedimento})_`;
          }

          // Adiciona bandeira se disponível
          if (p.bandeira) {
            linha += ` 🏷️${p.bandeira}`;
          }

          response += `${linha}\n`;
          count++;
        }
        response += `\n`;
      }

      if (installments.length > 10) {
        response += `_... e mais ${installments.length - 10} parcela${installments.length - 10 > 1 ? 's' : ''}_`;
      }

      return response.trim();
    } catch (error) {
      console.error('Erro ao buscar parcelas:', error);
      return 'Erro ao buscar parcelas 😢\n\nTente novamente.';
    }
  }

  async handleImageMessage(phone, mediaUrl, caption) {
    try {
      // Verifica se usuário está cadastrado
      if (userController.isOnboarding(phone)) {
        return 'Complete seu cadastro primeiro! 😊\n\nQual o seu nome completo?';
      }

      const user = await userController.findUserByPhone(phone);
      if (!user) {
        userController.startOnboarding(phone);
        return `Olá! Sou a *Lumiz* 💜\n\nParece que você ainda não tem cadastro.\nVou te ajudar a configurar!\n\n*Qual o seu nome completo?*`;
      }

      // Processa a imagem com Gemini Vision
      const result = await documentService.processImage(mediaUrl);

      if (result.tipo_documento === 'erro' || result.tipo_documento === 'nao_identificado') {
        return documentService.formatDocumentSummary(result);
      }

      if (result.transacoes.length === 0) {
        return documentService.formatDocumentSummary(result);
      }

      // Armazena transações pendentes de confirmação
      this.pendingDocumentTransactions.set(phone, {
        user,
        transacoes: result.transacoes,
        timestamp: Date.now()
      });

      return documentService.formatDocumentSummary(result);
    } catch (error) {
      console.error('Erro ao processar imagem:', error);
      return 'Erro ao analisar imagem 😢\n\nTente enviar novamente ou registre manualmente.';
    }
  }

  async handleDocumentMessage(phone, mediaUrl, fileName) {
    try {
      // Verifica se usuário está cadastrado
      if (userController.isOnboarding(phone)) {
        return 'Complete seu cadastro primeiro! 😊\n\nQual o seu nome completo?';
      }

      const user = await userController.findUserByPhone(phone);
      if (!user) {
        userController.startOnboarding(phone);
        return `Olá! Sou a *Lumiz* 💜\n\nParece que você ainda não tem cadastro.\nVou te ajudar a configurar!\n\n*Qual o seu nome completo?*`;
      }

      // Por enquanto, só processamos imagens
      // PDFs podem ser convertidos em imagens ou processados de outra forma
      if (fileName.toLowerCase().endsWith('.pdf')) {
        return `📄 *PDF RECEBIDO*\n\n` +
               `Recebi o arquivo: ${fileName}\n\n` +
               `Por enquanto, prefiro *fotos* ou *screenshots* dos documentos.\n\n` +
               `📸 Tira uma foto do boleto/extrato e me envia!\n\n` +
               `Ou registre manualmente:\n"Insumos 3200"`;
      }

      // Tenta processar como imagem
      return await this.handleImageMessage(phone, mediaUrl, '');
    } catch (error) {
      console.error('Erro ao processar documento:', error);
      return 'Erro ao analisar documento 😢\n\nTente enviar uma foto ou registre manualmente.';
    }
  }

  async handleBarcodeMessage(user, intent, phone) {
    const codigo = intent.dados.codigo;

    // Por enquanto, apenas informa que recebeu o código
    // Futuramente pode integrar com API de consulta de boleto
    let response = `Recebi o código do boleto! 🔢\n\n`;
    response += `Agora me diz: esse boleto é de quê e qual o valor?\n\n`;
    response += `Por exemplo:\n_"Fornecedor 1500"_\n_"Conta de luz 450"_\n\n`;
    response += `Ou se preferir, manda uma foto do boleto que eu leio tudo automaticamente 📸`;

    return response;
  }

  async handleUndoLastTransaction(user, phone) {
    try {
      const lastTransaction = this.lastTransactions.get(phone);

      if (!lastTransaction) {
        return `Não encontrei nenhuma transação recente pra desfazer 🤔\n\nVocê só pode desfazer nos primeiros 10 minutos após registrar.`;
      }

      // Verifica se expirou (10 minutos)
      if (Date.now() - lastTransaction.timestamp > 10 * 60 * 1000) {
        this.lastTransactions.delete(phone);
        return `Passou o tempo pra desfazer essa transação 😅\n\nVocê tem 10 minutos após o registro.\n\nSe precisar corrigir, vai ter que acessar o dashboard.`;
      }

      // Deleta a transação
      const deleted = await transactionController.deleteTransaction(
        user.id,
        lastTransaction.transactionId
      );

      if (!deleted) {
        this.lastTransactions.delete(phone);
        return `Não consegui encontrar essa transação 🤔\n\nTalvez já tenha sido removida.`;
      }

      const emoji = lastTransaction.tipo === 'entrada' ? '💰' : '💸';
      const tipoTexto = lastTransaction.tipo === 'entrada' ? 'venda' : 'custo';

      // Remove do histórico
      this.lastTransactions.delete(phone);

      return `${emoji} *Transação desfeita!*\n\n` +
             `Removi a ${tipoTexto} de *R$ ${lastTransaction.valor.toFixed(2)}* (${lastTransaction.categoria})\n\n` +
             `Quer registrar novamente com os dados corretos? É só me mandar! 😊`;
    } catch (error) {
      console.error('Erro ao desfazer transação:', error);
      return `Erro ao desfazer transação 😢\n\nTente novamente.`;
    }
  }

  async handleDocumentConfirmation(phone, message, user) {
    const pending = this.pendingDocumentTransactions.get(phone);

    // Verifica se expirou (10 minutos para documentos)
    if (Date.now() - pending.timestamp > 10 * 60 * 1000) {
      this.pendingDocumentTransactions.delete(phone);
      return 'O tempo para confirmar expirou 😅\n\nEnvie o documento novamente.';
    }

    const messageLower = message.toLowerCase().trim();

    // Confirmação positiva
    if (
      messageLower === 'sim' ||
      messageLower === 's' ||
      messageLower === 'confirmar' ||
      messageLower === 'ok' ||
      messageLower === 'confirma' ||
      messageLower.includes('confirmar')
    ) {
      try {
        const transacoes = pending.transacoes;
        let registradas = 0;
        let erros = 0;

        for (const t of transacoes) {
          try {
            await transactionController.createTransaction(user.id, {
              tipo: t.tipo,
              valor: t.valor,
              categoria: t.categoria,
              descricao: t.descricao,
              data: t.data,
              forma_pagamento: 'avista',
              parcelas: null,
              bandeira_cartao: null
            });
            registradas++;
          } catch (err) {
            console.error('Erro ao registrar transação do documento:', err);
            erros++;
          }
        }

        this.pendingDocumentTransactions.delete(phone);

        if (erros > 0) {
          return `✅ *${registradas} transação(ões) registrada(s)*\n❌ ${erros} erro(s)\n\nTudo anotadinho!`;
        }

        const emoji = registradas > 1 ? '📄' : (transacoes[0].tipo === 'entrada' ? '💰' : '💸');
        return `${emoji} *${registradas} transação(ões) registrada(s) com sucesso!*\n\nTudo anotadinho! ✅`;
      } catch (error) {
        console.error('Erro ao salvar transações do documento:', error);
        return 'Erro ao salvar transações 😢\n\nTente novamente.';
      }
    }

    // Confirmação negativa
    if (
      messageLower === 'não' ||
      messageLower === 'nao' ||
      messageLower === 'n' ||
      messageLower === 'cancelar' ||
      messageLower.includes('cancelar')
    ) {
      this.pendingDocumentTransactions.delete(phone);
      return 'Registro cancelado ❌\n\nSe quiser, envie o documento novamente ou registre manualmente.';
    }

    return 'Não entendi 🤔\n\nResponde "sim" para registrar ou "não" para cancelar.';
  }
}

module.exports = new MessageController();
