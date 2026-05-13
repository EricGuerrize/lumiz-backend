const transactionController = require('../transactionController');
const { formatarMoeda } = require('../../utils/currency');

/**
 * Handler para consultas e relatórios
 */
class QueryHandler {
  /**
   * Consulta saldo do usuário
   */
  async handleBalance(user) {
    const balance = await transactionController.getBalance(user.id);

    const lucro = balance.entradas - balance.saidas;
    const margemPercentual = balance.entradas > 0
      ? ((lucro / balance.entradas) * 100).toFixed(1)
      : 0;

    if (balance.entradas === 0 && balance.saidas === 0) {
      return `Ainda não tem nenhuma movimentação registrada 📋\n\nMe conta sua primeira venda!\nTipo: _"Botox R$ 2800 da cliente Maria"_`;
    }

    let response = `Olha só como tá seu financeiro! 📊\n\n`;
    response += `*Vendas:* ${formatarMoeda(balance.entradas)}\n`;
    response += `*Custos:* ${formatarMoeda(balance.saidas)}\n`;
    response += `*Lucro:* ${formatarMoeda(lucro)} _(${margemPercentual}% de margem)_\n\n`;

    if (lucro > 0) {
      response += `Tá no positivo! 🎉\n`;
    } else if (lucro < 0) {
      response += `Opa, tá no vermelho... 😬\n`;
    }

    response += `\nQuer ver o relatório completo do mês? Manda _"relatório"_`;

    return response;
  }

  /**
   * Consulta histórico recente
   */
  async handleHistory(user) {
    const transactions = await transactionController.getRecentTransactions(user.id, 5);

    if (transactions.length === 0) {
      return `Não achei nenhuma movimentação ainda 📋\n\nBora registrar a primeira?\nÉ só me mandar tipo: _"Botox R$ 2800"_`;
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

      response += `${emoji} ${sinal}${formatarMoeda(parseFloat(t.amount))} • ${categoria} • ${data}\n`;
    });

    response += `\nPra ver mais detalhes, manda _"relatório"_`;

    return response;
  }

  /**
   * Gera relatório mensal
   */
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
      return `Ainda não tem movimentações em ${mesNome}.\n\nBora começar? Me manda sua primeira venda! (ex: "Botox R$ 2800")`;
    }

    let response = `*RELATÓRIO - ${mesNome}*\n\n`;
    response += `Faturamento: ${formatarMoeda(report.entradas)}\n`;
    response += `Custos: ${formatarMoeda(report.saidas)}\n`;
    response += `Lucro líquido: ${formatarMoeda(lucro)} (${margemPercentual}%)\n\n`;
    response += `Total: ${report.totalTransacoes} movimentações\n`;

    if (Object.keys(report.porCategoria).length > 0) {
      response += `\n*Principais categorias:*\n`;
      Object.entries(report.porCategoria)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5)
        .forEach(([cat, data]) => {
          const tipo = data.tipo === 'entrada' ? 'Receita' : 'Custo';
          response += `${tipo} - ${cat}: ${formatarMoeda(data.total)}\n`;
        });
    }

    response += `\nPara PDF completo: "me manda pdf", "relatório em pdf" ou "gerar pdf do mês".`;

    if (lucro > 0) {
      response += `\n\nMandando bem!`;
    } else if (lucro < 0) {
      response += `\n\nBora reverter esse cenário!`;
    }

    return response;
  }

  /**
   * Compara meses
   */
  async handleCompareMonths(user) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Mês anterior
    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear = currentYear - 1;
    }

    const [current, previous] = await Promise.all([
      transactionController.getMonthlyReport(user.id, currentYear, currentMonth),
      transactionController.getMonthlyReport(user.id, prevYear, prevMonth)
    ]);

    const currentLucro = current.entradas - current.saidas;
    const previousLucro = previous.entradas - previous.saidas;
    const variacaoLucro = currentLucro - previousLucro;
    const variacaoPercentual = previousLucro !== 0
      ? ((variacaoLucro / previousLucro) * 100).toFixed(1)
      : '0';

    let response = `*COMPARATIVO MENSAL*\n\n`;
    response += `*Mês Atual:*\n`;
    response += `Faturamento: ${formatarMoeda(current.entradas)}\n`;
    response += `Custos: ${formatarMoeda(current.saidas)}\n`;
    response += `Lucro: ${formatarMoeda(currentLucro)}\n\n`;
    response += `*Mês Anterior:*\n`;
    response += `Faturamento: ${formatarMoeda(previous.entradas)}\n`;
    response += `Custos: ${formatarMoeda(previous.saidas)}\n`;
    response += `Lucro: ${formatarMoeda(previousLucro)}\n\n`;
    response += `*Variação:*\n`;
    response += `Lucro: ${variacaoLucro >= 0 ? '+' : ''}${formatarMoeda(variacaoLucro)} (${variacaoPercentual}%)`;

    return response;
  }

  /**
   * Estatísticas do dia
   */
  async handleTodayStats(user) {
    const today = new Date().toISOString().split('T')[0];
    const atendimentos = await transactionController.getRecentTransactions(user.id, 100);
    const hoje = atendimentos.filter(t => t.date === today);

    if (hoje.length === 0) {
      return `Ainda não tem movimentações hoje 📅\n\nBora começar? Me manda sua primeira venda! (ex: "Botox R$ 2800")`;
    }

    const entradas = hoje.filter(t => t.type === 'entrada').reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const saidas = hoje.filter(t => t.type === 'saida').reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const lucro = entradas - saidas;

    let response = `*ESTATÍSTICAS DE HOJE*\n\n`;
    response += `Vendas: ${formatarMoeda(entradas)}\n`;
    response += `Custos: ${formatarMoeda(saidas)}\n`;
    response += `Lucro: ${formatarMoeda(lucro)}\n`;
    response += `Movimentações: ${hoje.length}`;

    return response;
  }

  /**
   * Ranking de procedimentos
   */
  async handleProcedureRanking(user) {
    const report = await transactionController.getMonthlyReport(user.id, new Date().getFullYear(), new Date().getMonth() + 1);
    
    const procedimentos = Object.entries(report.porCategoria)
      .filter(([_, data]) => data.tipo === 'entrada')
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5);

    if (procedimentos.length === 0) {
      return `Ainda não tem procedimentos registrados este mês 📋`;
    }

    let response = `*TOP 5 PROCEDIMENTOS DO MÊS*\n\n`;
    procedimentos.forEach(([nome, data], index) => {
      response += `${index + 1}. ${nome}: ${formatarMoeda(data.total)}\n`;
    });

    return response;
  }

  /**
   * Compara períodos customizados
   */
  async handleCompareCustomPeriods(user, dados) {
    try {
      const periodo1 = dados.periodo1 || {};
      const periodo2 = dados.periodo2 || {};

      if (!periodo1.mes || !periodo2.mes) {
        return await this.handleCompareMonths(user);
      }

      const year1 = periodo1.ano || new Date().getFullYear();
      const month1 = this.parseMonthName(periodo1.mes);
      const year2 = periodo2.ano || new Date().getFullYear();
      const month2 = this.parseMonthName(periodo2.mes);

      if (!month1 || !month2) {
        return 'Não consegui entender os períodos. Tente: "comparar janeiro com fevereiro"';
      }

      const report1 = await transactionController.getMonthlyReport(user.id, year1, month1);
      const report2 = await transactionController.getMonthlyReport(user.id, year2, month2);

      const lucro1 = report1.entradas - report1.saidas;
      const lucro2 = report2.entradas - report2.saidas;

      const month1Name = new Date(year1, month1 - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
      const month2Name = new Date(year2, month2 - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });

      // Calcula variações
      const variacaoEntradas = report1.entradas > 0
        ? (((report2.entradas - report1.entradas) / report1.entradas) * 100).toFixed(1)
        : report2.entradas > 0 ? 100 : 0;

      const variacaoSaidas = report1.saidas > 0
        ? (((report2.saidas - report1.saidas) / report1.saidas) * 100).toFixed(1)
        : report2.saidas > 0 ? 100 : 0;

      const variacaoLucro = lucro1 !== 0
        ? (((lucro2 - lucro1) / Math.abs(lucro1)) * 100).toFixed(1)
        : lucro2 > 0 ? 100 : 0;

      let response = `📊 *COMPARATIVO DE PERÍODOS*\n\n`;
      response += `*${month1Name.toUpperCase()} ${year1}*\n`;
      response += `💰 Vendas: ${formatarMoeda(report1.entradas)}\n`;
      response += `💸 Custos: ${formatarMoeda(report1.saidas)}\n`;
      response += `📈 Lucro: ${formatarMoeda(lucro1)}\n\n`;
      response += `*${month2Name.toUpperCase()} ${year2}*\n`;
      response += `💰 Vendas: ${formatarMoeda(report2.entradas)}\n`;
      response += `💸 Custos: ${formatarMoeda(report2.saidas)}\n`;
      response += `📈 Lucro: ${formatarMoeda(lucro2)}\n\n`;
      response += `*VARIAÇÃO*\n`;

      const setaEntradas = variacaoEntradas >= 0 ? '📈' : '📉';
      const setaSaidas = variacaoSaidas >= 0 ? '📈' : '📉';
      const setaLucro = variacaoLucro >= 0 ? '📈' : '📉';

      response += `${setaEntradas} Vendas: ${variacaoEntradas >= 0 ? '+' : ''}${variacaoEntradas}%\n`;
      response += `${setaSaidas} Custos: ${variacaoSaidas >= 0 ? '+' : ''}${variacaoSaidas}%\n`;
      response += `${setaLucro} Lucro: ${variacaoLucro >= 0 ? '+' : ''}${variacaoLucro}%\n\n`;

      if (lucro2 > lucro1) {
        response += `Tá crescendo! 🎉 Seu lucro aumentou ${formatarMoeda(lucro2 - lucro1)}`;
      } else if (lucro2 < lucro1) {
        response += `Lucro caiu ${formatarMoeda(lucro1 - lucro2)} 😬\nBora focar em aumentar as vendas!`;
      } else {
        response += `Lucro estável! 🤝`;
      }

      return response;
    } catch (error) {
      console.error('Erro ao comparar períodos:', error);
      return 'Erro ao comparar períodos. Tente novamente.';
    }
  }

  parseMonthName(monthName) {
    const months = {
      'janeiro': 1, 'fevereiro': 2, 'março': 3, 'marco': 3,
      'abril': 4, 'maio': 5, 'junho': 6,
      'julho': 7, 'agosto': 8, 'setembro': 9,
      'outubro': 10, 'novembro': 11, 'dezembro': 12
    };
    return months[monthName?.toLowerCase()] || parseInt(monthName);
  }
}

module.exports = QueryHandler;


