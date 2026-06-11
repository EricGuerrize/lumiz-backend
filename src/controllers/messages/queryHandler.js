const transactionController = require('../transactionController');
const cashflowService = require('../../services/cashflowService');
const estoqueService = require('../../services/estoqueService');
const nfValidadeService = require('../../services/nfValidadeService');
const inadimplenciaService = require('../../services/inadimplenciaService');
const inadimplenciaCopy = require('../../copy/inadimplenciaWhatsappCopy');
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
    const now = new Date();
    const cash = await this.safeMonthlyCashSummary(user.id, now.getFullYear(), now.getMonth() + 1);

    const lucro = balance.entradas - balance.saidas;
    const margemPercentual = balance.entradas > 0
      ? ((lucro / balance.entradas) * 100).toFixed(1)
      : 0;

    if (balance.entradas === 0 && balance.saidas === 0) {
      return `Ainda não tem nenhuma movimentação registrada 📋\n\nMe conta sua primeira venda!\nTipo: _"Botox R$ 2800 da cliente Maria"_`;
    }

    let response = `Seu financeiro até agora 📊\n\n`;
    response += `*Faturamento registrado:* ${formatarMoeda(balance.entradas)}\n`;
    if (cash) {
      response += `*Caixa previsto no mês:* ${formatarMoeda(cash.entradasPrevistas)}\n`;
    }
    response += `*Custos registrados:* ${formatarMoeda(balance.saidas)}\n`;
    if (cash) {
      response += `*Saídas previstas no mês:* ${formatarMoeda(cash.saidasPrevistas)}\n`;
    }
    response += `*Resultado estimado:* ${formatarMoeda(lucro)} _(${margemPercentual}% de margem)_\n\n`;

    if (lucro > 0) {
      response += `Resultado positivo até aqui.\n`;
    } else if (lucro < 0) {
      response += `Atenção: os custos já passaram o faturamento registrado.\n`;
    }

    if (cash && cash.parcelasPrevistas > 0) {
      response += `\nNo caixa deste mês entram ${cash.parcelasPrevistas} parcela(s) prevista(s). `;
      response += `Venda parcelada não é a mesma coisa que dinheiro recebido no mês.\n\n`;
    } else {
      response += `\nObservação: vendas parceladas aparecem como faturamento vendido; o caixa recebido pode cair em meses diferentes.\n\n`;
    }
    response += `Quer ver o relatório completo do mês? Manda _"relatório"_`;

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

    const [report, cash] = await Promise.all([
      transactionController.getMonthlyReport(user.id, year, month),
      this.safeMonthlyCashSummary(user.id, year, month)
    ]);

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

    let response = `*RELATÓRIO FINANCEIRO - ${mesNome}*\n\n`;
    response += `Faturamento registrado: ${formatarMoeda(report.entradas)}\n`;
    if (cash) {
      response += `Caixa previsto no mês: ${formatarMoeda(cash.entradasPrevistas)}\n`;
    }
    response += `Custos registrados: ${formatarMoeda(report.saidas)}\n`;
    if (cash) {
      response += `Saídas previstas no mês: ${formatarMoeda(cash.saidasPrevistas)}\n`;
      response += `Saldo de caixa previsto: ${formatarMoeda(cash.saldoPrevisto)}\n`;
    }
    response += `Resultado estimado: ${formatarMoeda(lucro)} (${margemPercentual}%)\n\n`;
    response += `Total: ${report.totalTransacoes} movimentações\n`;

    if (Object.keys(report.porCategoria).length > 0) {
      response += `\n*Principais categorias:*\n`;
      Object.entries(report.porCategoria)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5)
        .forEach(([cat, data]) => {
          const tipo = data.tipo === 'entrada' ? 'Receita' : 'Custo';
          response += `${tipo} - ${this.cleanCategoryLabel(cat)}: ${formatarMoeda(data.total)}\n`;
        });
    }

    response += `\n*Leitura CFO:*\n`;
    if (cash && cash.parcelasPrevistas > 0) {
      response += `• Há ${cash.parcelasPrevistas} parcela(s) prevista(s) no caixa deste mês; compare caixa com faturamento antes de decidir retirada ou compra grande.\n`;
    } else {
      response += `• Vendas parceladas entram como faturamento vendido; o recebimento em caixa pode acontecer em meses diferentes.\n`;
    }
    response += `• Se ainda faltam custos fixos ou insumos, a margem real pode mudar.\n`;

    response += `\nPara PDF completo: "me manda pdf", "relatório em pdf" ou "gerar pdf do mês".`;

    if (lucro > 0) {
      response += `\n\nMandando bem!`;
    } else if (lucro < 0) {
      response += `\n\nBora reverter esse cenário!`;
    }

    return response;
  }

  cleanCategoryLabel(category) {
    const label = String(category || '').trim();
    const normalized = label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (/\b(credito em|cartao em|parcelado|forma de pagamento|pagamento)\b/.test(normalized)) {
      return 'Procedimento não identificado';
    }

    return label || 'Sem categoria';
  }

  async safeMonthlyCashSummary(userId, year, month) {
    if (typeof transactionController.getMonthlyCashSummary !== 'function') return null;
    try {
      return await transactionController.getMonthlyCashSummary(userId, year, month);
    } catch (error) {
      console.warn('[QUERY] Falha ao calcular resumo de caixa mensal:', error.message);
      return null;
    }
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

  async handleContasPagar(user) {
    try {
      const { items, valorTotal } = await cashflowService.getContasPagarPriority(user.id, { daysAhead: 60, limit: 10 });

      if (!items || items.length === 0) {
        return `Nenhuma conta a pagar pendente nos próximos 60 dias 👍`;
      }

      const formatDate = (d) => {
        if (!d) return '—';
        const [y, m, day] = d.split('-');
        return `${day}/${m}`;
      };

      const linhas = [`📋 *Contas a pagar* (próximos 60 dias)\n`];
      for (const c of items) {
        const venc = formatDate(c.data_vencimento);
        const atraso = c.diasAtraso > 0 ? ` ⚠️ ${c.diasAtraso}d atraso` : '';
        linhas.push(`• ${c.descricao || c.categoria || 'Sem descrição'} — ${formatarMoeda(c.valor)} · venc. ${venc}${atraso}`);
      }
      linhas.push(`\n*Total: ${formatarMoeda(valorTotal)}*`);

      return linhas.join('\n');
    } catch (error) {
      console.error('Erro ao consultar contas a pagar:', error);
      return 'Erro ao buscar contas. Tente novamente.';
    }
  }

  async handleCashflowGap(user) {
    try {
      const projection = await cashflowService.getCashflowProjection(user.id, 30);
      const summary = projection.summary || {};
      const saldoAtual = projection.saldoAtual || 0;
      const saldoFinal = summary.saldoFinal ?? saldoAtual;
      const primeiroRisco = summary.primeiroDiaCaixaNegativo;

      let response = `📉 *Projeção de caixa — 30 dias*\n\n`;
      response += `Caixa disponível hoje: ${formatarMoeda(saldoAtual)}\n`;
      response += `Entradas previstas: ${formatarMoeda(summary.totalEntradas || 0)}\n`;
      response += `Saídas previstas: ${formatarMoeda(summary.totalSaidas || 0)}\n`;
      response += `Saldo projetado: ${formatarMoeda(saldoFinal)}\n\n`;

      if (summary.temProjecaoCaixaNegativo) {
        response += `⚠️ Risco de caixa negativo em ${this.formatDateShort(primeiroRisco)}.\n`;
        response += `Revise contas próximas ou recebíveis antes de assumir novas compras.`;
      } else {
        response += `Sem risco de caixa negativo nos próximos 30 dias com os dados atuais.`;
      }

      return response;
    } catch (error) {
      console.error('Erro ao consultar gap de caixa:', error);
      return 'Não consegui calcular a projeção de caixa agora. Tente novamente em alguns instantes.';
    }
  }

  async handleDailyBriefing(user) {
    try {
      const [balance, contas, estoque, validades] = await Promise.all([
        transactionController.getBalance(user.id),
        cashflowService.getContasPagarPriority(user.id, { daysAhead: 7, limit: 5 }),
        estoqueService.getAlertasBaixoEstoque(user.id).catch(() => ({ alertas: [] })),
        nfValidadeService.listarProximos(user.id, 30).catch(() => ({ itens: [] })),
      ]);

      const contasItems = contas.items || [];
      const estoqueAlertas = estoque.alertas || [];
      const validadeItens = (validades.itens || []).slice(0, 3);

      let response = `☀️ *Briefing financeiro de hoje*\n\n`;
      response += `Caixa disponível: ${formatarMoeda(balance.saldo || 0)}\n`;
      response += `Contas nos próximos 7 dias: ${formatarMoeda(contas.valorTotal || 0)}\n`;

      if (contasItems.length) {
        response += `\n*Prioridades:*\n`;
        contasItems.slice(0, 3).forEach((c) => {
          response += `• ${c.descricao || c.categoria} — ${formatarMoeda(c.valor)} · ${this.formatDateShort(c.data_vencimento)}\n`;
        });
      }

      if (estoqueAlertas.length) {
        response += `\n*Estoque em atenção:*\n`;
        estoqueAlertas.slice(0, 3).forEach((item) => {
          response += `• ${item.nome}: ${item.estoqueAtual} ${item.unidade || 'ml'}\n`;
        });
      }

      if (validadeItens.length) {
        response += `\n*Validades próximas:*\n`;
        validadeItens.forEach((item) => {
          response += `• ${item.descricao} · ${this.formatDateShort(item.data_validade)}\n`;
        });
      }

      response += `\nPara detalhar: "contas a pagar", "estoque" ou "gap de caixa".`;
      return response;
    } catch (error) {
      console.error('Erro ao montar briefing:', error);
      return 'Não consegui montar o briefing agora. Tente novamente em alguns instantes.';
    }
  }

  async handleInadimplencia(user) {
    try {
      const overview = await inadimplenciaService.getOverview(user.id);
      return inadimplenciaCopy.overview(overview);
    } catch (error) {
      console.error('Erro ao consultar inadimplência:', error);
      return inadimplenciaCopy.temporaryError();
    }
  }

  async handleValidades(user, dados = {}) {
    try {
      const days = Number(dados?.dias || dados?.days || 90);
      const { itens } = await nfValidadeService.listarProximos(user.id, days);
      const proximos = itens || [];

      if (!proximos.length) {
        return `Não encontrei itens com validade nos próximos ${Math.min(Math.max(days || 90, 1), 365)} dias.`;
      }

      let response = `🧾 *Validades próximas*\n\n`;
      proximos.slice(0, 10).forEach((item) => {
        const status = item.vencido
          ? `vencido há ${Math.abs(item.vence_em_dias)}d`
          : item.vence_em_dias === 0
            ? 'vence hoje'
            : `vence em ${item.vence_em_dias}d`;
        response += `• ${item.descricao} — ${this.formatDateShort(item.data_validade)} · ${status}\n`;
      });

      if (proximos.length > 10) {
        response += `\n... e mais ${proximos.length - 10} item(ns).`;
      }

      return response.trim();
    } catch (error) {
      console.error('Erro ao consultar validades:', error);
      return 'Não consegui consultar as validades agora. Tente novamente em alguns instantes.';
    }
  }

  formatDateShort(d) {
    if (!d) return '—';
    const [y, m, day] = String(d).split('-');
    if (!y || !m || !day) return String(d);
    return `${day}/${m}`;
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
