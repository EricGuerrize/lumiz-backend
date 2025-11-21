const geminiService = require('../services/geminiService');
const evolutionService = require('../services/evolutionService');
const userController = require('./userController');
const transactionController = require('./transactionController');
const reminderService = require('../services/reminderService');
const documentService = require('../services/documentService');
const insightService = require('../services/insightService');
const pdfService = require('../services/pdfService');
const supabase = require('../db/supabase');

class MessageController {
  constructor() {
    // Armazena transações pendentes de confirmação temporariamente
    this.pendingTransactions = new Map();
    // Armazena transações de documentos pendentes
    this.pendingDocumentTransactions = new Map();
    // Armazena última transação registrada por usuário (para desfazer)
    this.lastTransactions = new Map();
    // Armazena edições pendentes
    this.pendingEdits = new Map();
  }

  async handleIncomingMessage(phone, message) {
    try {
      // Verifica se está em processo de onboarding (agora é async)
      if (await userController.isOnboarding(phone)) {
        return await userController.processOnboarding(phone, message);
      }

      // Busca usuário pelo telefone
      const user = await userController.findUserByPhone(phone);

      // Se não encontrou usuário, verifica se é usuário antigo e inicia onboarding
      if (!user) {
        const isReturning = await userController.isReturningUser(phone);
        await userController.startOnboarding(phone, isReturning);
        
        if (isReturning) {
          // Usuário antigo
          return `Que bom que você voltou! Você já tá com o convite do teste gratuito, perfeito!\n\nEsse teste é o primeiro passo: ele vai mostrar como a Lumiz realiza a gestão do seu financeiro pelo WhatsApp em poucos minutos. Depois disso, pra continuar a gestão da sua clínica no dia a dia, só com o plano pago mesmo.\n\n*Para começar seu teste, qual é o nome da sua clínica?*`;
        } else {
          // Novo usuário - 3 mensagens
          // Mensagem 1
          await evolutionService.sendMessage(phone, `Oi, prazer! Sou a Lumiz 👋\n\nSou a IA que vai organizar o financeiro da sua clínica — direto pelo WhatsApp.`);
          
          // Mensagem 2 (com vídeo - por enquanto só texto, vídeo será adicionado depois)
          await new Promise(resolve => setTimeout(resolve, 1000));
          await evolutionService.sendMessage(phone, `Antes de começarmos, veja este vídeo rapidinho para entender como eu te ajudo a controlar tudo sem planilhas.\n\n*[Vídeo será enviado aqui - 30-40s]*`);
          
          // Mensagem 3
          await new Promise(resolve => setTimeout(resolve, 1000));
          return `Vou te ajudar a cuidar das finanças da sua clínica de forma simples, automática e sem complicação.\n\n*Para começar seu teste, qual é o nome da sua clínica?*`;
        }
      }

      // Verifica se existe uma transação pendente de confirmação
      if (this.pendingTransactions.has(phone)) {
        return await this.handleConfirmation(phone, message, user);
      }

      // Verifica se existe transações de documento pendentes
      if (this.pendingDocumentTransactions.has(phone)) {
        return await this.handleDocumentConfirmation(phone, message, user);
      }

      // Verifica se existe edição pendente
      if (this.pendingEdits.has(phone)) {
        return await this.handleEditConfirmation(phone, message, user);
      }

      // Busca contexto histórico e exemplos similares (RAG) para melhorar entendimento
      const conversationHistoryService = require('../services/conversationHistoryService');
      const recentHistory = await conversationHistoryService.getRecentHistory(user.id, 5);
      const similarExamples = await conversationHistoryService.findSimilarExamples(message, user.id, 3);
      
      const intent = await geminiService.processMessage(message, {
        recentMessages: recentHistory,
        similarExamples: similarExamples
      });

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
          // Verifica se usuário quer PDF
          if (intent.dados?.formato === 'pdf' || message.toLowerCase().includes('pdf')) {
            await this.handleMonthlyReportPDF(user, phone, intent.dados);
            return null; // PDF será enviado diretamente
          }
          response = await this.handleMonthlyReport(user, intent.dados);
          break;

        case 'exportar_dados':
          await this.handleExportData(user, phone, intent.dados);
          return null; // PDF será enviado diretamente

        case 'comparar_meses':
          response = await this.handleCompareMonths(user);
          break;

        case 'consultar_parcelas':
          response = await this.handlePendingInstallments(user);
          break;

        case 'stats_hoje':
          response = await this.handleTodayStats(user);
          break;

        case 'ranking_procedimentos':
          response = await this.handleProcedureRanking(user);
          break;

        case 'marcar_parcela_paga':
          response = await this.handleMarkInstallmentPaid(user, phone);
          break;

        case 'exportar_dados':
          response = await this.handleExportData(user);
          break;

        case 'consultar_agenda':
          response = await this.handleSchedule(user);
          break;

        case 'consultar_meta':
          response = await this.handleGoalProgress(user);
          break;
        case 'insights':
          response = await this.handleInsights(user);
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

        case 'editar_transacao':
          response = await this.handleEditTransaction(user, phone, intent);
          break;

        case 'buscar_transacao':
          response = await this.handleSearchTransaction(user, intent, message);
          break;

        case 'definir_meta':
          response = await this.handleDefineGoal(user, phone, intent);
          break;

        case 'saudacao':
          response = `Oi! Tudo bem? Sou a *Lumiz* 💜\n\nTo aqui pra te ajudar a organizar as finanças da sua clínica de um jeito simples!\n\nPode me mandar:\n• Uma venda que você fez hoje\n• Um custo que precisa registrar\n• Ou me perguntar como está o caixa\n\nÉ só escrever naturalmente, tipo:\n_"Fiz um botox hoje, 2800 reais"_\n_"Comprei insumos por 1500"_\n_"Como tá meu saldo?"_\n\nBora começar? 😊`;
          break;

        case 'ajuda':
          response = await this.handleHelp();
          break;

        case 'apenas_valor':
          response = await this.handleOnlyValue(intent, phone);
          break;

        case 'apenas_procedimento':
          response = await this.handleOnlyProcedure(intent, phone);
          break;

        case 'mensagem_ambigua':
          response = await this.handleAmbiguousMessage(user, message);
          break;

        case 'erro':
          response = 'Ops, tive um probleminha técnico 🤔\n\nPode tentar de novo? Se continuar dando erro, tenta simplificar a mensagem.\n\nExemplo: _"Botox 2800"_';
          break;

        default:
          response = await this.handleNotUnderstood(message);
      }

      // Salva conversa no histórico para uso futuro (RAG)
      if (response && response !== null) {
        try {
          await conversationHistoryService.saveConversation(
            user.id,
            message,
            response,
            intent.intencao,
            { dados: intent.dados } // Salva contexto adicional
          );
        } catch (error) {
          // Não quebra se falhar ao salvar histórico
          console.error('[MESSAGE] Erro ao salvar histórico (não crítico):', error.message);
        }
      }

      return response;
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
      return 'Eita, deu um erro aqui 😅\n\nTenta de novo! Se o problema continuar, me manda a mensagem de um jeito mais simples.\n\nExemplo: _"Botox 2800 cliente Maria"_';
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
    message += `✅ *Confirmar* - Salvar esta transação\n`;
    message += `❌ *Cancelar* - Não salvar\n\n`;
    message += `Ou digite "sim" para confirmar ou "não" para cancelar`;

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

        // Adiciona sugestão contextual baseada no tipo de transação
        if (tipo === 'entrada') {
          if (forma_pagamento === 'parcelado') {
            successMsg += `💡 *Dica:* Quer ver suas parcelas? Digite "parcelas"\n`;
            successMsg += `💡 *Dica:* Errou algo? Digite "desfazer" nos próximos 10 minutos\n`;
          } else {
            const dicas = [
              '💡 *Dica:* Quer ver seu saldo? Digite "saldo"',
              '💡 *Dica:* Quer ver o relatório do mês? Digite "relatório"',
              '💡 *Dica:* Quer comparar com mês passado? Digite "comparar"',
              '💡 *Dica:* Errou algo? Digite "desfazer" nos próximos 10 minutos'
            ];
            successMsg += dicas[Math.floor(Math.random() * dicas.length)] + '\n';
          }
        } else {
          successMsg += `💡 *Dica:* Quer ver seus custos? Digite "histórico"\n`;
          successMsg += `💡 *Dica:* Errou algo? Digite "desfazer" nos próximos 10 minutos\n`;
        }

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

    // Adiciona sugestão contextual
    response += `\n💡 *Dica:* Quer ver o relatório completo? Digite "relatório"\n`;
    response += `💡 *Dica:* Quer comparar com mês passado? Digite "comparar"`;

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

    // Adiciona sugestão contextual
    response += `\n💡 *Dica:* Quer buscar uma transação específica? Digite "buscar" seguido do nome ou valor\n`;
    response += `💡 *Dica:* Quer ver o relatório completo? Digite "relatório"`;

    return response;
  }

  async handleMonthlyReport(user, dados = {}) {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    let periodoTexto = '';

    // Detecta período customizado
    if (dados?.mes || dados?.ano) {
      month = dados.mes || month;
      year = dados.ano || year;
    } else if (dados?.periodo) {
      const periodo = dados.periodo.toLowerCase();
      
      // Detecta semana
      if (periodo.includes('semana')) {
        const inicioSemana = new Date(now);
        inicioSemana.setDate(now.getDate() - now.getDay());
        const fimSemana = new Date(inicioSemana);
        fimSemana.setDate(inicioSemana.getDate() + 6);
        
        periodoTexto = `Semana (${inicioSemana.toLocaleDateString('pt-BR')} a ${fimSemana.toLocaleDateString('pt-BR')})`;
        // Para semana, usa getMonthlyReport com mês atual (aproximação)
        month = now.getMonth() + 1;
        year = now.getFullYear();
      }
      // Detecta mês específico
      else if (periodo.includes('janeiro')) { month = 1; }
      else if (periodo.includes('fevereiro')) { month = 2; }
      else if (periodo.includes('março') || periodo.includes('marco')) { month = 3; }
      else if (periodo.includes('abril')) { month = 4; }
      else if (periodo.includes('maio')) { month = 5; }
      else if (periodo.includes('junho')) { month = 6; }
      else if (periodo.includes('julho')) { month = 7; }
      else if (periodo.includes('agosto')) { month = 8; }
      else if (periodo.includes('setembro')) { month = 9; }
      else if (periodo.includes('outubro')) { month = 10; }
      else if (periodo.includes('novembro')) { month = 11; }
      else if (periodo.includes('dezembro')) { month = 12; }
    }

    const report = await transactionController.getMonthlyReport(user.id, year, month);

    const lucro = report.entradas - report.saidas;
    const margemPercentual = report.entradas > 0
      ? ((lucro / report.entradas) * 100).toFixed(1)
      : 0;

    const mesNome = periodoTexto || new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { 
      month: 'long', 
      year: 'numeric' 
    });

    if (report.totalTransacoes === 0) {
      return `Ainda não tem movimentações em ${mesNome}.\n\nBora começar? Me manda sua primeira venda!`;
    }

    let response = `*RELATÓRIO - ${mesNome}*\n\n`;
    response += `Faturamento: R$ ${report.entradas.toFixed(2)}\n`;
    response += `Custos: R$ ${report.saidas.toFixed(2)}\n`;
    response += `Lucro líquido: R$ ${lucro.toFixed(2)} (${margemPercentual}%)\n\n`;
    response += `Total: ${report.totalTransacoes} movimentações\n`;

    if (Object.keys(report.porCategoria).length > 0) {
      response += `\n*Principais categorias:*\n`;
      Object.entries(report.porCategoria)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5)
        .forEach(([cat, data]) => {
          const tipo = data.tipo === 'entrada' ? 'Receita' : 'Custo';
          response += `${tipo} - ${cat}: R$ ${data.total.toFixed(2)}\n`;
        });
    }

    // Adiciona sugestão contextual
    response += `\n💡 *Dica:* Quer exportar em PDF? Digite "relatório pdf"\n`;
    response += `💡 *Dica:* Quer comparar com mês passado? Digite "comparar"`;

    if (lucro > 0) {
      response += `\n\nMandando bem! 🎉`;
    } else if (lucro < 0) {
      response += `\n\nBora reverter esse cenário! 💪`;
    }

    return response;
  }

  async handleMonthlyReportPDF(user, phone, dados = {}) {
    try {
      const now = new Date();
      let year = now.getFullYear();
      let month = now.getMonth() + 1;

      // Detecta período customizado
      if (dados?.mes || dados?.ano) {
        month = dados.mes || month;
        year = dados.ano || year;
      } else if (dados?.periodo) {
        const periodo = dados.periodo.toLowerCase();
        if (periodo.includes('janeiro')) { month = 1; }
        else if (periodo.includes('fevereiro')) { month = 2; }
        else if (periodo.includes('março') || periodo.includes('marco')) { month = 3; }
        else if (periodo.includes('abril')) { month = 4; }
        else if (periodo.includes('maio')) { month = 5; }
        else if (periodo.includes('junho')) { month = 6; }
        else if (periodo.includes('julho')) { month = 7; }
        else if (periodo.includes('agosto')) { month = 8; }
        else if (periodo.includes('setembro')) { month = 9; }
        else if (periodo.includes('outubro')) { month = 10; }
        else if (periodo.includes('novembro')) { month = 11; }
        else if (periodo.includes('dezembro')) { month = 12; }
      }

      // Envia mensagem de processamento
      await evolutionService.sendMessage(
        phone,
        'Gerando seu relatório em PDF...\n\nIsso pode levar alguns segundos!'
      );

      // Gera o PDF
      const pdfBuffer = await pdfService.generateMonthlyReportPDF(user.id, year, month);
      const base64Pdf = pdfBuffer.toString('base64');
      
      // Nome do arquivo
      const mesNome = now.toLocaleDateString('pt-BR', { month: 'long' });
      const fileName = `Relatorio_${mesNome}_${year}.pdf`;

      // Envia o PDF
      await evolutionService.sendDocument(phone, base64Pdf, fileName, 'application/pdf');

      // Confirmação
      await evolutionService.sendMessage(
        phone,
        '*PDF gerado e enviado!*\n\nSeu relatório mensal completo está no documento acima.'
      );
    } catch (error) {
      console.error('[PDF] Erro ao gerar/enviar PDF:', error);
      await evolutionService.sendMessage(
        phone,
        'Ops! Não consegui gerar o PDF agora.\n\nTente novamente em alguns instantes.'
      );
    }
  }

  async handleExportData(user, phone, dados) {
    try {
      const now = new Date();
      let year = now.getFullYear();
      let month = now.getMonth() + 1;

      // Tenta extrair mês/ano da mensagem se fornecido
      if (dados?.mes) {
        month = parseInt(dados.mes);
      }
      if (dados?.ano) {
        year = parseInt(dados.ano);
      }

      await evolutionService.sendMessage(
        phone,
        '📄 Gerando seu relatório em PDF...\n\nIsso pode levar alguns segundos! ⏳'
      );

      const pdfBuffer = await pdfService.generateMonthlyReportPDF(user.id, year, month);
      const base64Pdf = pdfBuffer.toString('base64');
      
      const mesNome = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
      const fileName = `Relatorio_${mesNome}_${year}.pdf`;

      await evolutionService.sendDocument(phone, base64Pdf, fileName, 'application/pdf');

      await evolutionService.sendMessage(
        phone,
        '✅ *Relatório exportado com sucesso!*\n\nSeu PDF está pronto acima 📊'
      );
    } catch (error) {
      console.error('[EXPORT] Erro ao exportar dados:', error);
      await evolutionService.sendMessage(
        phone,
        '❌ Não consegui gerar o relatório agora.\n\nTente novamente em alguns instantes.'
      );
    }
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

    // Adiciona sugestão contextual
    response += `\n\n💡 *Dica:* Quer ver o relatório completo? Digite "relatório"\n`;
    response += `💡 *Dica:* Quer ver insights? Digite "insights"`;

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

  async handleTodayStats(user) {
    try {
      const stats = await transactionController.getTodayStats(user.id);

      const hoje = new Date().toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      });

      if (stats.qtdVendas === 0 && stats.qtdCustos === 0) {
        return `📊 *RESULTADO DE HOJE*\n_(${hoje})_\n\nAinda não registrou nada hoje! 📋\n\nBora começar? Me manda sua primeira venda do dia!\n_"Botox 2800 paciente Maria"_`;
      }

      let response = `📊 *RESULTADO DE HOJE*\n_(${hoje})_\n\n`;

      response += `💰 *Faturamento:* R$ ${stats.faturamento.toFixed(2)}\n`;
      response += `💸 *Custos:* R$ ${stats.custos.toFixed(2)}\n`;
      response += `📈 *Lucro:* R$ ${stats.lucro.toFixed(2)}\n\n`;

      response += `📋 ${stats.qtdVendas} venda${stats.qtdVendas !== 1 ? 's' : ''}`;
      if (stats.qtdCustos > 0) {
        response += ` • ${stats.qtdCustos} custo${stats.qtdCustos !== 1 ? 's' : ''}`;
      }
      response += `\n`;

      // Mostra procedimentos do dia
      if (Object.keys(stats.porProcedimento).length > 0) {
        response += `\n*Procedimentos:*\n`;
        Object.entries(stats.porProcedimento)
          .sort((a, b) => b[1].valor - a[1].valor)
          .forEach(([proc, data]) => {
            response += `• ${proc}: ${data.quantidade}x = R$ ${data.valor.toFixed(2)}\n`;
          });
      }

      // Análise rápida
      if (stats.lucro > 0) {
        const margemPercentual = ((stats.lucro / stats.faturamento) * 100).toFixed(1);
        response += `\nDia positivo! 🎉 Margem de ${margemPercentual}%`;
      } else if (stats.lucro < 0) {
        response += `\nDia no vermelho 😬 Foca nas vendas!`;
      }

      return response;
    } catch (error) {
      console.error('Erro ao buscar stats de hoje:', error);
      return 'Erro ao buscar dados de hoje 😢\n\nTente novamente.';
    }
  }

  async handleHelp() {
    let response = `📚 *GUIA COMPLETO DA LUMIZ*\n\n`;

    // Vendas
    response += `💰 *REGISTRAR VENDAS*\n`;
    response += `_"Botox 2800"_\n`;
    response += `_"Fiz um preenchimento 3500"_\n`;
    response += `_"Atendi Maria harmonização 4500 pix"_\n`;
    response += `_"Vendi bioestimulador 6000 3x cartão"_\n\n`;

    // Custos
    response += `💸 *REGISTRAR CUSTOS*\n`;
    response += `_"Insumos 3200"_\n`;
    response += `_"Paguei aluguel 5000"_\n`;
    response += `_"Marketing 800"_\n`;
    response += `_"Comprei material 1500"_\n\n`;

    // Relatórios
    response += `📊 *RELATÓRIOS*\n`;
    response += `_"Vendas hoje"_ - resultado do dia\n`;
    response += `_"Saldo"_ - resumo geral\n`;
    response += `_"Relatório"_ - detalhes do mês\n`;
    response += `_"Comparar"_ - vs mês anterior\n`;
    response += `_"Histórico"_ - últimas movimentações\n`;
    response += `_"Ranking"_ - procedimentos mais vendidos\n`;
    response += `_"Meta"_ - progresso da meta mensal\n`;
    response += `_"Exportar"_ - gerar relatório para copiar\n\n`;

    // Parcelas
    response += `💳 *PARCELAS*\n`;
    response += `_"Parcelas"_ - ver a receber\n`;
    response += `_"Recebi parcela"_ - ver próximas parcelas\n`;
    response += `_"Botox 2800 3x visa"_ - registrar parcelado\n\n`;

    // Agenda
    response += `📅 *AGENDA*\n`;
    response += `_"Agenda"_ - ver próximos agendamentos\n\n`;

    // Documentos
    response += `📄 *DOCUMENTOS*\n`;
    response += `Envia foto de boleto/nota que eu leio!\n`;
    response += `Ou cola o código de barras\n\n`;

    // Outros
    response += `🔧 *OUTROS*\n`;
    response += `_"Desfazer"_ - cancela última (10min)\n`;
    response += `_"Ontem"_ ou _"semana passada"_ - datas relativas\n\n`;

    response += `É só escrever naturalmente! 🤗`;

    return response;
  }

  async handleProcedureRanking(user) {
    try {
      const ranking = await transactionController.getProcedureRanking(user.id);

      if (ranking.ranking.length === 0) {
        return `📊 *RANKING DE PROCEDIMENTOS*\n\nAinda não tem vendas registradas! 📋\n\nRegistre sua primeira venda:\n_"Botox 2800 cliente Maria"_`;
      }

      let response = `🏆 *RANKING DE PROCEDIMENTOS*\n\n`;
      response += `💰 Total faturado: *R$ ${ranking.totalGeral.toFixed(2)}*\n`;
      response += `📋 ${ranking.qtdTotal} atendimento${ranking.qtdTotal !== 1 ? 's' : ''}\n\n`;

      // Mostra top 10
      const top = ranking.ranking.slice(0, 10);
      top.forEach((proc, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const percentual = ((proc.valor / ranking.totalGeral) * 100).toFixed(1);

        response += `${medal} *${proc.nome}*\n`;
        response += `   ${proc.quantidade}x • R$ ${proc.valor.toFixed(2)} _(${percentual}%)_\n`;
        response += `   Ticket médio: R$ ${proc.ticketMedio.toFixed(2)}\n\n`;
      });

      if (ranking.ranking.length > 10) {
        response += `_... e mais ${ranking.ranking.length - 10} procedimento${ranking.ranking.length - 10 > 1 ? 's' : ''}_\n`;
      }

      // Insight
      if (top.length > 0) {
        response += `\n💡 *${top[0].nome}* é seu campeão de vendas!`;
      }

      return response;
    } catch (error) {
      console.error('Erro ao buscar ranking:', error);
      return 'Erro ao buscar ranking 😢\n\nTente novamente.';
    }
  }

  async handleMarkInstallmentPaid(user, phone) {
    try {
      const installments = await reminderService.getPendingInstallments(user.id);

      if (installments.length === 0) {
        return `✅ *Não tem parcelas pendentes!*\n\nTodas as parcelas foram recebidas ou você não tem vendas parceladas.\n\nPra registrar venda parcelada:\n_"Botox 2800 3x cartão paciente Maria"_`;
      }

      // Mostra próximas 5 parcelas para o usuário escolher
      const proximas = installments.slice(0, 5);

      let response = `💳 *MARCAR PARCELA COMO RECEBIDA*\n\n`;
      response += `Próximas parcelas a vencer:\n\n`;

      proximas.forEach((p, index) => {
        const dataFormatada = p.data_vencimento.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        });

        response += `*${index + 1}.* ${p.cliente} - ${p.procedimento}\n`;
        response += `   ${p.parcela_atual}/${p.total_parcelas} • R$ ${p.valor_parcela.toFixed(2)}\n`;
        response += `   📅 Vence: ${dataFormatada}\n\n`;
      });

      response += `💡 *Dica:* O sistema calcula automaticamente as parcelas pendentes baseado na data de cada venda.\n\n`;
      response += `Para ver todas as parcelas, manda _"parcelas"_\n`;
      response += `Para registrar nova venda parcelada:\n_"Botox 2800 6x visa cliente Ana"_`;

      return response;
    } catch (error) {
      console.error('Erro ao buscar parcelas para marcar:', error);
      return 'Erro ao buscar parcelas 😢\n\nTente novamente.';
    }
  }

  async handleExportData(user) {
    try {
      const now = new Date();
      const report = await transactionController.getMonthlyReport(
        user.id,
        now.getFullYear(),
        now.getMonth() + 1
      );

      const mesNome = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const lucro = report.entradas - report.saidas;
      const margemPercentual = report.entradas > 0
        ? ((lucro / report.entradas) * 100).toFixed(1)
        : 0;

      if (report.totalTransacoes === 0) {
        return `📊 *EXPORTAR RELATÓRIO*\n\nAinda não tem movimentações esse mês! 📋\n\nRegistre suas vendas e custos, depois volte aqui pra exportar.`;
      }

      // Gera relatório em formato texto para copiar
      let response = `📋 *RELATÓRIO PARA EXPORTAÇÃO*\n`;
      response += `_${mesNome}_\n\n`;
      response += `━━━━━━━━━━━━━━━━━━━━\n`;
      response += `*RESUMO FINANCEIRO*\n`;
      response += `━━━━━━━━━━━━━━━━━━━━\n\n`;

      response += `Faturamento: R$ ${report.entradas.toFixed(2)}\n`;
      response += `Custos: R$ ${report.saidas.toFixed(2)}\n`;
      response += `Lucro: R$ ${lucro.toFixed(2)}\n`;
      response += `Margem: ${margemPercentual}%\n`;
      response += `Movimentações: ${report.totalTransacoes}\n\n`;

      if (Object.keys(report.porCategoria).length > 0) {
        response += `━━━━━━━━━━━━━━━━━━━━\n`;
        response += `*POR CATEGORIA*\n`;
        response += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        // Separa entradas e saídas
        const entradas = [];
        const saidas = [];

        Object.entries(report.porCategoria).forEach(([cat, data]) => {
          if (data.tipo === 'entrada') {
            entradas.push({ cat, total: data.total });
          } else {
            saidas.push({ cat, total: data.total });
          }
        });

        if (entradas.length > 0) {
          response += `*Receitas:*\n`;
          entradas.sort((a, b) => b.total - a.total).forEach(e => {
            response += `• ${e.cat}: R$ ${e.total.toFixed(2)}\n`;
          });
          response += `\n`;
        }

        if (saidas.length > 0) {
          response += `*Custos:*\n`;
          saidas.sort((a, b) => b.total - a.total).forEach(s => {
            response += `• ${s.cat}: R$ ${s.total.toFixed(2)}\n`;
          });
          response += `\n`;
        }
      }

      response += `━━━━━━━━━━━━━━━━━━━━\n\n`;
      response += `📱 *Copie este relatório* e cole onde precisar!\n\n`;
      // Adiciona sugestão contextual
      response += `\n💡 *Dica:* Quer exportar em PDF? Digite "relatório pdf"\n`;
      response += `💡 *Dica:* Quer comparar com mês passado? Digite "comparar"`;

      return response;
    } catch (error) {
      console.error('Erro ao exportar dados:', error);
      return 'Erro ao gerar relatório 😢\n\nTente novamente.';
    }
  }

  async handleSchedule(user) {
    try {
      const agendamentos = await transactionController.getUpcomingSchedules(user.id);

      if (agendamentos.length === 0) {
        return `📅 *SUA AGENDA*\n\nNenhum agendamento encontrado! 📋\n\nAguarde a próxima versão com agendamento via WhatsApp! 😊`;
      }

      let response = `📅 *PRÓXIMOS AGENDAMENTOS*\n\n`;

      // Agrupa por data
      const porData = {};
      agendamentos.forEach(ag => {
        const dataStr = new Date(ag.data_agendamento).toLocaleDateString('pt-BR', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit'
        });
        if (!porData[dataStr]) {
          porData[dataStr] = [];
        }
        porData[dataStr].push(ag);
      });

      Object.entries(porData).forEach(([data, ags]) => {
        response += `*${data.toUpperCase()}*\n`;
        ags.forEach(ag => {
          const hora = new Date(ag.data_agendamento).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
          });
          const cliente = ag.clientes?.nome || 'Cliente';
          const procedimento = ag.procedimentos?.nome || 'Procedimento';
          const status = ag.status === 'confirmado' ? '✅' : ag.status === 'pendente' ? '⏳' : '❓';

          response += `${status} ${hora} - ${cliente}\n`;
          response += `   📋 ${procedimento}\n`;
          if (ag.observacoes) {
            response += `   📝 ${ag.observacoes}\n`;
          }
          response += `\n`;
        });
      });

      response += `💡 Em breve você poderá gerenciar agendamentos completos pelo WhatsApp!`;

      return response;
    } catch (error) {
      console.error('Erro ao buscar agenda:', error);
      return 'Erro ao buscar agendamentos 😢\n\nTente novamente.';
    }
  }

  async handleGoalProgress(user) {
    try {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      const reportCurrent = await transactionController.getMonthlyReport(
        user.id,
        currentYear,
        currentMonth
      );

      const faturamentoAtual = reportCurrent.entradas;

      // Busca meta configurada pelo usuário
      const { data: profile } = await supabase
        .from('profiles')
        .select('meta_mensal')
        .eq('id', user.id)
        .single();

      let meta = profile?.meta_mensal;

      // Se não tem meta configurada, calcula automática (10% acima do mês anterior)
      if (!meta || meta <= 0) {
        let previousMonth = currentMonth - 1;
        let previousYear = currentYear;
        if (previousMonth === 0) {
          previousMonth = 12;
          previousYear = currentYear - 1;
        }

        const reportPrevious = await transactionController.getMonthlyReport(
          user.id,
          previousYear,
          previousMonth
        );

        const faturamentoAnterior = reportPrevious.entradas;
        meta = faturamentoAnterior > 0 ? faturamentoAnterior * 1.1 : 10000;
      }

      const percentualAtingido = meta > 0 ? ((faturamentoAtual / meta) * 100).toFixed(1) : 0;
      const faltando = Math.max(0, meta - faturamentoAtual);

      // Calcula dias restantes no mês
      const ultimoDia = new Date(currentYear, currentMonth, 0).getDate();
      const diasRestantes = ultimoDia - now.getDate();

      let response = `🎯 *PROGRESSO DA META*\n`;
      response += `_${currentMonthName}_\n\n`;

      // Barra de progresso visual
      const barraCheia = Math.min(10, Math.floor(percentualAtingido / 10));
      const barraVazia = 10 - barraCheia;
      const barra = '▓'.repeat(barraCheia) + '░'.repeat(barraVazia);

      response += `${barra} ${percentualAtingido}%\n\n`;

      response += `Faturamento: R$ ${faturamentoAtual.toFixed(2)}\n`;
      response += `Meta: R$ ${meta.toFixed(2)}\n`;

      if (faltando > 0) {
        response += `Falta: R$ ${faltando.toFixed(2)}\n\n`;
      } else {
        response += `*Meta atingida!*\n\n`;
      }

      response += `${diasRestantes} dia${diasRestantes !== 1 ? 's' : ''} restante${diasRestantes !== 1 ? 's' : ''} no mês\n\n`;

      // Análise e dicas
      if (percentualAtingido >= 100) {
        response += `*Parabéns!* Você já bateu a meta!\n`;
        response += `Continue assim e supere ainda mais!`;
      } else if (percentualAtingido >= 75) {
        response += `*Quase lá!* Falta pouco pra bater a meta.\n`;
        response += `Média diária necessária: R$ ${(faltando / Math.max(1, diasRestantes)).toFixed(2)}`;
      } else if (percentualAtingido >= 50) {
        response += `*Bom progresso!* Mas precisa acelerar.\n`;
        response += `Média diária necessária: R$ ${(faltando / Math.max(1, diasRestantes)).toFixed(2)}`;
      } else {
        response += `*Atenção!* Meta ainda distante.\n`;
        response += `Média diária necessária: R$ ${(faltando / Math.max(1, diasRestantes)).toFixed(2)}`;
      }

      if (!profile?.meta_mensal) {
        response += `\n\nPara definir sua meta personalizada, digite "minha meta é [valor]".`;
      }

      return response;
    } catch (error) {
      console.error('Erro ao calcular progresso da meta:', error);
      return 'Erro ao calcular meta 😢\n\nTente novamente.';
    }
  }

  async handleInsights(user) {
    try {
      const message = await insightService.getInsightsMessage(user.id);
      return message;
    } catch (error) {
      console.error('Erro ao buscar insights:', error);
      return 'Não consegui gerar insights agora 😢\n\nTenta novamente mais tarde.';
    }
  }

  async handleImageMessage(phone, mediaUrl, caption) {
    try {
      // Verifica se está em onboarding e se pode processar imagem (steps de custo)
      if (await userController.isOnboarding(phone)) {
        const step = userController.getOnboardingStep(phone);
        // Permite processar imagem durante steps de custo
        if (step === 'pedir_custo_variavel' || step === 'pedir_custo_fixo') {
          // Processa a imagem e retorna para o onboarding
          const documentService = require('../services/documentService');
          const result = await documentService.processImage(mediaUrl);
          
          if (result.tipo_documento === 'erro' || result.tipo_documento === 'nao_identificado') {
            return 'Não consegui ler o documento na imagem 😢\n\nTente enviar uma foto mais nítida ou registre manualmente (ex: "Comprei 6 frascos de Biogeli, paguei 1.800 no cartão").';
          }

          if (result.transacoes.length === 0) {
            return 'Não encontrei informações de custo na imagem 😢\n\nTente enviar uma foto mais nítida ou registre manualmente.';
          }

          // Usa a primeira transação encontrada
          const transacao = result.transacoes[0];
          // Simula um intent para processar no onboarding
          const intent = {
            intencao: 'registrar_saida',
            dados: {
              valor: transacao.valor,
              categoria: transacao.categoria || 'Custo',
              descricao: transacao.descricao || '',
              forma_pagamento: transacao.forma_pagamento || 'PIX',
              data: transacao.data || new Date().toISOString().split('T')[0]
            }
          };

          // Processa como se fosse uma mensagem de texto
          return await userController.processOnboarding(phone, JSON.stringify(intent));
        } else {
          return 'Complete seu cadastro primeiro! 😊\n\nContinue respondendo as perguntas.';
        }
      }

      const user = await userController.findUserByPhone(phone);
      if (!user) {
        await userController.startOnboarding(phone);
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
      // Verifica se está em onboarding e se pode processar documento (steps de custo)
      if (await userController.isOnboarding(phone)) {
        const step = userController.getOnboardingStep(phone);
        // Permite processar documento durante steps de custo
        if (step === 'pedir_custo_variavel' || step === 'pedir_custo_fixo') {
          // Processa como imagem
          return await this.handleImageMessage(phone, mediaUrl, '');
        } else {
          return 'Complete seu cadastro primeiro! 😊\n\nContinue respondendo as perguntas.';
        }
      }

      const user = await userController.findUserByPhone(phone);
      if (!user) {
        await userController.startOnboarding(phone);
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

  async handleAmbiguousMessage(user, message) {
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

      response += `Ou manda "ajuda" pra ver todos os comandos! 😊`;

      return response;
    } catch (error) {
      console.error('Erro ao gerar mensagem de ajuda:', error);
      return 'Hmm, não consegui entender direito 🤔\n\nTenta me explicar melhor! Por exemplo:\n_"Fiz um botox de 2800"_ ou _"Gastei 3200 em insumos"_\n\nSe precisar, é só mandar "ajuda" que te mostro tudo que sei fazer!';
    }
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
        return `Passou o tempo pra desfazer essa transação 😅\n\nVocê tem 10 minutos após o registro.\n\nSe precisar corrigir, use o comando "editar" ou "buscar" para encontrar a transação.`;
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
             `💡 *Dica:* Quer registrar novamente? É só me mandar a transação correta!\n` +
             `💡 *Dica:* Quer ver seu saldo atualizado? Digite "saldo"`;
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

  // ========== NOVOS HANDLERS ==========

  async handleEditTransaction(user, phone, intent) {
    try {
      const lastTransaction = this.lastTransactions.get(phone);

      if (!lastTransaction) {
        return 'Não encontrei nenhuma transação recente para editar.\n\nVocê só pode editar transações registradas nos últimos 10 minutos.';
      }

      // Verifica se expirou (10 minutos)
      if (Date.now() - lastTransaction.timestamp > 10 * 60 * 1000) {
        this.lastTransactions.delete(phone);
        return 'Passou o tempo para editar essa transação.\n\nVocê tem 10 minutos após o registro.';
      }

      // Mostra transação atual e pergunta o que mudar
      const tipoTexto = lastTransaction.tipo === 'entrada' ? 'Receita' : 'Custo';
      let msg = `*EDITAR TRANSAÇÃO*\n\n`;
      msg += `Tipo: ${tipoTexto}\n`;
      msg += `Valor: R$ ${lastTransaction.valor.toFixed(2)}\n`;
      msg += `Categoria: ${lastTransaction.categoria}\n`;
      msg += `Data: ${new Date(lastTransaction.data).toLocaleDateString('pt-BR')}\n`;
      if (lastTransaction.descricao) {
        msg += `Descrição: ${lastTransaction.descricao}\n`;
      }
      msg += `\nO que você quer mudar?\n`;
      msg += `• Digite o novo valor (ex: "3000")\n`;
      msg += `• Digite a nova categoria (ex: "Botox")\n`;
      msg += `• Digite a nova data (ex: "15/11")\n`;
      msg += `• Digite a nova descrição\n`;
      msg += `\nOu digite "cancelar" para não editar.`;

      // Armazena edição pendente
      this.pendingEdits.set(phone, {
        transactionId: lastTransaction.transactionId,
        tipo: lastTransaction.tipo,
        valor: lastTransaction.valor,
        categoria: lastTransaction.categoria,
        data: lastTransaction.data,
        descricao: lastTransaction.descricao,
        timestamp: Date.now()
      });

      return msg;
    } catch (error) {
      console.error('Erro ao iniciar edição:', error);
      return 'Erro ao editar transação. Tente novamente.';
    }
  }

  async handleEditConfirmation(phone, message, user) {
    const pending = this.pendingEdits.get(phone);

    if (!pending) {
      return 'Não encontrei edição pendente.';
    }

    // Verifica se expirou (10 minutos)
    if (Date.now() - pending.timestamp > 10 * 60 * 1000) {
      this.pendingEdits.delete(phone);
      return 'O tempo para editar expirou.';
    }

    const messageLower = message.toLowerCase().trim();

    // Cancelar
    if (messageLower === 'cancelar' || messageLower === 'não' || messageLower === 'nao') {
      this.pendingEdits.delete(phone);
      return 'Edição cancelada.';
    }

    // Processa a edição
    try {
      const updates = {};
      let changed = false;

      // Detecta valor (número isolado ou com R$)
      const valorMatch = message.match(/r?\$?\s*(\d+(?:[.,]\d{2})?)/i) || message.match(/^(\d+(?:[.,]\d{2})?)$/);
      if (valorMatch) {
        const valor = parseFloat(valorMatch[1].replace(',', '.'));
        if (valor > 0 && valor !== pending.valor) {
          updates.valor = valor;
          changed = true;
        }
      }

      // Detecta data (formato brasileiro)
      const dataMatch = message.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
      if (dataMatch) {
        const dia = parseInt(dataMatch[1]);
        const mes = parseInt(dataMatch[2]);
        const ano = dataMatch[3] ? parseInt(dataMatch[3]) : new Date().getFullYear();
        const novaData = new Date(ano, mes - 1, dia).toISOString().split('T')[0];
        if (novaData !== pending.data) {
          updates.data = novaData;
          changed = true;
        }
      }

      // Se não detectou valor nem data, assume que é categoria ou descrição
      if (!valorMatch && !dataMatch && message.length > 2) {
        // Tenta detectar se é categoria (palavras curtas) ou descrição
        if (message.split(' ').length <= 3) {
          updates.categoria = message;
          changed = true;
        } else {
          updates.descricao = message;
          changed = true;
        }
      }

      if (!changed) {
        return 'Não entendi o que você quer mudar.\n\nDigite:\n• Um valor (ex: "3000")\n• Uma categoria (ex: "Botox")\n• Uma data (ex: "15/11")\n• Uma descrição\n\nOu "cancelar" para não editar.';
      }

      // Atualiza a transação
      const updated = await transactionController.updateTransaction(
        user.id,
        pending.transactionId,
        updates
      );

      if (!updated) {
        this.pendingEdits.delete(phone);
        return 'Não consegui encontrar essa transação para editar.';
      }

      // Atualiza lastTransactions
      this.lastTransactions.set(phone, {
        transactionId: pending.transactionId,
        tipo: pending.tipo,
        valor: updates.valor || pending.valor,
        categoria: updates.categoria || pending.categoria,
        data: updates.data || pending.data,
        descricao: updates.descricao || pending.descricao,
        timestamp: Date.now()
      });

      this.pendingEdits.delete(phone);

      const tipoTexto = pending.tipo === 'entrada' ? 'receita' : 'custo';
      const emoji = pending.tipo === 'entrada' ? '💰' : '💸';
      let response = `✅ *Transação editada com sucesso!*\n\n`;
      response += `${emoji} ${tipoTexto}: *R$ ${transaction.valor.toFixed(2)}*\n`;
      if (transaction.categoria) response += `📂 ${transaction.categoria}\n`;
      if (transaction.data) response += `📅 ${new Date(transaction.data).toLocaleDateString('pt-BR')}\n`;
      response += `\n💡 *Dica:* Quer ver seu saldo atualizado? Digite "saldo"\n`;
      response += `💡 *Dica:* Quer buscar outra transação? Digite "buscar"`;

      return response;
    } catch (error) {
      console.error('Erro ao editar transação:', error);
      this.pendingEdits.delete(phone);
      return 'Erro ao editar transação. Tente novamente.';
    }
  }

  async handleSearchTransaction(user, intent, messageOriginal = '') {
    try {
      // Extrai termo de busca da mensagem original
      let searchTerm = messageOriginal
        .toLowerCase()
        .replace(/\b(buscar|encontrar|procurar|achar|mostrar|transação|transacao)\b/gi, '')
        .trim();

      // Se não encontrou, tenta dos dados do intent
      if (!searchTerm) {
        searchTerm = intent.dados?.termo || intent.dados?.busca || intent.dados?.procurar || '';
      }

      if (!searchTerm || searchTerm.length < 2) {
        return 'O que você quer buscar?\n\nExemplos:\n• "buscar botox"\n• "encontrar maria"\n• "procurar 2800"';
      }

      // Detecta se é busca por valor numérico
      const valorNumerico = parseFloat(searchTerm.replace(/[^\d.,]/g, '').replace(',', '.'));
      const isValorBusca = !isNaN(valorNumerico) && valorNumerico > 0;

      const results = [];

      // Busca em atendimentos - busca mais abrangente
      let atendQuery = supabase
        .from('atendimentos')
        .select(`
          id,
          valor_total,
          data,
          observacoes,
          cliente_id,
          clientes(nome),
          atendimento_procedimentos(
            procedimento_id,
            procedimentos(nome)
          )
        `)
        .eq('user_id', user.id);

      if (isValorBusca) {
        // Busca por valor aproximado (±10%)
        const valorMin = valorNumerico * 0.9;
        const valorMax = valorNumerico * 1.1;
        atendQuery = atendQuery.gte('valor_total', valorMin).lte('valor_total', valorMax);
      }
      // Para busca por texto, busca todos e filtra depois (mais flexível)

      const { data: atendimentos, error: atendError } = await atendQuery
        .order('data', { ascending: false })
        .limit(50); // Busca mais para filtrar depois

      if (!atendError && atendimentos) {
        atendimentos.forEach(a => {
          const procedimento = a.atendimento_procedimentos?.[0]?.procedimentos?.nome || '';
          const cliente = a.clientes?.nome || '';
          const observacoes = (a.observacoes || '').toLowerCase();
          const termoLower = searchTerm.toLowerCase();

          // Se não é busca por valor, verifica se o termo está em algum campo
          if (!isValorBusca) {
            const matchProcedimento = procedimento.toLowerCase().includes(termoLower);
            const matchCliente = cliente.toLowerCase().includes(termoLower);
            const matchObservacoes = observacoes.includes(termoLower);
            const matchValor = a.valor_total && a.valor_total.toString().includes(searchTerm);

            if (!matchProcedimento && !matchCliente && !matchObservacoes && !matchValor) {
              return; // Não faz match, pula
            }
          }

          results.push({
            tipo: 'entrada',
            valor: parseFloat(a.valor_total || 0),
            categoria: procedimento || 'Procedimento',
            descricao: cliente || observacoes || '',
            data: a.data,
            id: a.id
          });
        });
      }

      // Busca em contas a pagar
      let contasQuery = supabase
        .from('contas_pagar')
        .select('id, valor, data, descricao, categoria')
        .eq('user_id', user.id);

      if (isValorBusca) {
        const valorMin = valorNumerico * 0.9;
        const valorMax = valorNumerico * 1.1;
        contasQuery = contasQuery.gte('valor', valorMin).lte('valor', valorMax);
      } else {
        contasQuery = contasQuery.or(`descricao.ilike.%${searchTerm}%,categoria.ilike.%${searchTerm}%`);
      }

      const { data: contas, error: contasError } = await contasQuery
        .order('data', { ascending: false })
        .limit(20);

      if (!contasError && contas) {
        contas.forEach(c => {
          results.push({
            tipo: 'saida',
            valor: parseFloat(c.valor || 0),
            categoria: c.categoria || c.descricao || '',
            descricao: c.descricao || '',
            data: c.data,
            id: c.id
          });
        });
      }

      if (results.length === 0) {
        return `Não encontrei nenhuma transação com "${searchTerm}".\n\nTente buscar por:\n• Nome do procedimento\n• Nome do cliente\n• Valor aproximado\n• Categoria`;
      }

      // Remove duplicatas e ordena por data (mais recente primeiro)
      const uniqueResults = results.filter((r, index, self) =>
        index === self.findIndex(t => t.id === r.id && t.tipo === r.tipo)
      );
      uniqueResults.sort((a, b) => new Date(b.data) - new Date(a.data));

      let response = `*Encontrei ${uniqueResults.length} transação(ões):*\n\n`;

      uniqueResults.slice(0, 10).forEach((r, index) => {
        const tipo = r.tipo === 'entrada' ? 'Receita' : 'Custo';
        const data = new Date(r.data).toLocaleDateString('pt-BR');
        response += `${index + 1}. ${tipo}: R$ ${r.valor.toFixed(2)}\n`;
        response += `   ${r.categoria}`;
        if (r.descricao) response += ` - ${r.descricao}`;
        response += `\n   Data: ${data}\n\n`;
      });

      if (uniqueResults.length > 10) {
        response += `... e mais ${uniqueResults.length - 10} transação(ões)\n\n`;
      }

      // Adiciona sugestão contextual
      response += `\n💡 *Dica:* Quer editar alguma transação? Digite "editar" seguido do número\n`;
      response += `💡 *Dica:* Quer ver o relatório completo? Digite "relatório"`;

      return response;
    } catch (error) {
      console.error('Erro ao buscar transação:', error);
      return 'Erro ao buscar transações. Tente novamente.';
    }
  }

  /**
   * Trata mensagens não entendidas, analisando palavras-chave e sugerindo opções
   */
  async handleNotUnderstood(message) {
    const messageLower = message.toLowerCase();
    
    // Palavras-chave para detectar intenções prováveis
    const keywords = {
      registrar: ['vender', 'vendi', 'fiz', 'atendi', 'realizei', 'fechei', 'botox', 'preenchimento', 'harmonização', 'procedimento', 'paciente', 'cliente'],
      custo: ['paguei', 'gastei', 'comprei', 'pagar', 'conta', 'boleto', 'insumos', 'material', 'fornecedor'],
      saldo: ['saldo', 'caixa', 'quanto tenho', 'quanto tem', 'dinheiro', 'lucro'],
      relatorio: ['relatório', 'relatorio', 'resumo', 'mês', 'mensal', 'balanço'],
      historico: ['histórico', 'historico', 'últimas', 'ultimas', 'movimentações', 'movimentacoes'],
      buscar: ['buscar', 'encontrar', 'procurar', 'achar', 'mostrar'],
      meta: ['meta', 'objetivo', 'progresso', 'quanto falta'],
      ajuda: ['ajuda', 'help', 'como usar', 'o que você faz', 'comandos']
    };

    // Detecta palavras-chave na mensagem
    const detectedIntents = [];
    for (const [intent, words] of Object.entries(keywords)) {
      if (words.some(word => messageLower.includes(word))) {
        detectedIntents.push(intent);
      }
    }

    // Se detectou intenções, sugere baseado nelas
    if (detectedIntents.length > 0) {
      const suggestions = [];
      
      if (detectedIntents.includes('registrar')) {
        suggestions.push('1️⃣ Registrar venda (ex: "Botox 2800 paciente Maria")');
      }
      if (detectedIntents.includes('custo')) {
        suggestions.push('2️⃣ Registrar custo (ex: "Paguei insumos 1500")');
      }
      if (detectedIntents.includes('saldo')) {
        suggestions.push('3️⃣ Ver saldo (digite "saldo")');
      }
      if (detectedIntents.includes('relatorio')) {
        suggestions.push('4️⃣ Ver relatório (digite "relatório")');
      }
      if (detectedIntents.includes('historico')) {
        suggestions.push('5️⃣ Ver histórico (digite "histórico")');
      }
      if (detectedIntents.includes('buscar')) {
        suggestions.push('6️⃣ Buscar transação (ex: "buscar botox")');
      }
      if (detectedIntents.includes('meta')) {
        suggestions.push('7️⃣ Ver meta (digite "meta")');
      }

      if (suggestions.length > 0) {
        return `Não entendi bem 😅\n\nVocê quis dizer:\n${suggestions.slice(0, 3).join('\n')}\n\nOu digite "ajuda" para ver todos os comandos.`;
      }
    }

    // Fallback padrão
    return `Não entendi essa mensagem 😅\n\nVocê pode:\n• Registrar venda: "Botox 2800 paciente Maria"\n• Registrar custo: "Paguei insumos 1500"\n• Ver saldo: "saldo"\n• Ver relatório: "relatório"\n\nOu digite "ajuda" para ver todos os comandos.`;
  }

  async handleDefineGoal(user, phone, intent) {
    try {
      const valor = intent.dados?.valor || intent.dados?.meta;

      if (!valor || valor <= 0) {
        return 'Qual é a sua meta de faturamento?\n\nExemplos:\n• "minha meta é 50000"\n• "definir meta 50k"\n• "objetivo de 50000 reais"';
      }

      // Salva meta no perfil do usuário
      const { error } = await supabase
        .from('profiles')
        .update({
          meta_mensal: parseFloat(valor),
          meta_atualizada_em: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) {
        console.error('Erro ao salvar meta:', error);
        return 'Erro ao definir meta. Tente novamente.';
      }

      return `✅ *Meta definida com sucesso!*\n\n` +
             `🎯 Meta mensal: *R$ ${parseFloat(valor).toFixed(2)}*\n\n` +
             `💡 *Dica:* Quer ver seu progresso? Digite "meta"\n` +
             `💡 *Dica:* Quer ver seu saldo atual? Digite "saldo"`;
    } catch (error) {
      console.error('Erro ao definir meta:', error);
      return 'Erro ao definir meta. Tente novamente.';
    }
  }
}

module.exports = new MessageController();
