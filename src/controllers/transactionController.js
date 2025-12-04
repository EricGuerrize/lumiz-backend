const supabase = require('../db/supabase');
const userController = require('./userController');

class TransactionController {
  async createTransaction(userId, transactionData) {
    try {
      const { tipo, valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao } = transactionData;
      console.log('Criando transação para usuário:', userId);

      if (tipo === 'entrada') {
        // RECEITA = Criar atendimento
        return await this.createAtendimento(userId, { valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao });
      } else {
        // CUSTO = Criar conta a pagar
        return await this.createContaPagar(userId, { valor, categoria, descricao, data, parcelas });
      }
    } catch (error) {
      console.error('Erro ao criar transação:', error);
      throw error;
    }
  }

  async createAtendimento(userId, { valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao }) {
    try {
      // Extrai nome do cliente da descrição se houver
      let nomeCliente = 'Cliente WhatsApp';
      if (descricao) {
        // Procura por padrões como "paciente Maria", "cliente João", etc
        const matchPaciente = descricao.match(/(?:paciente|cliente|pra|para)\s+([A-Za-zÀ-ú]+)/i);
        if (matchPaciente) {
          nomeCliente = matchPaciente[1];
        } else {
          // Se não encontrou padrão, usa a descrição como nome do cliente
          nomeCliente = descricao.split(' ')[0] || 'Cliente WhatsApp';
        }
      }

      // Busca ou cria cliente
      const cliente = await userController.findOrCreateCliente(userId, nomeCliente);
      console.log('Cliente:', cliente.nome, cliente.id);

      // Busca ou cria procedimento
      const procedimento = await userController.findOrCreateProcedimento(userId, categoria || 'Procedimento');
      console.log('Procedimento:', procedimento.nome, procedimento.id);

      // Calcula custo estimado (10% do valor cobrado como exemplo)
      const custoEstimado = valor * 0.1;

      // Define forma de pagamento e status
      const formaPagto = forma_pagamento === 'parcelado' ? 'parcelado' : 'avista';
      const statusPagto = forma_pagamento === 'parcelado' ? 'agendado' : 'pago';

      // Cria atendimento
      const { data: atendimento, error: atendError } = await supabase
        .from('atendimentos')
        .insert([{
          user_id: userId,
          cliente_id: cliente.id,
          data: data || new Date().toISOString().split('T')[0],
          valor_total: valor,
          custo_total: custoEstimado,
          forma_pagamento: formaPagto,
          status_pagamento: statusPagto,
          parcelas: parcelas || null,
          bandeira_cartao: bandeira_cartao || null,
          observacoes: descricao || null
        }])
        .select()
        .single();

      if (atendError) throw atendError;
      console.log('Atendimento criado:', atendimento.id, 'Parcelas:', parcelas || 'À vista');

      // Cria registro de procedimento no atendimento
      const { error: procError } = await supabase
        .from('atendimento_procedimentos')
        .insert([{
          atendimento_id: atendimento.id,
          procedimento_id: procedimento.id,
          valor_cobrado: valor,
          custo_material: custoEstimado,
          ml_utilizado: procedimento.tipo === 'botox' ? 10 : procedimento.tipo === 'acido' ? 1 : null
        }]);

      if (procError) {
        console.error('Erro ao criar procedimento do atendimento:', procError);
      }

      // === GERAÇÃO DE PARCELAS (VENDAS) ===
      if (formaPagto === 'parcelado' && parcelas > 1) {
        console.log(`[FINANCEIRO] Gerando ${parcelas} parcelas para o atendimento ${atendimento.id}`);
        const valorParcela = valor / parcelas;
        const listaParcelas = [];
        const dataBase = new Date(data || new Date());

        for (let i = 0; i < parcelas; i++) {
          const dataVencimento = new Date(dataBase);
          dataVencimento.setMonth(dataVencimento.getMonth() + i);

          listaParcelas.push({
            atendimento_id: atendimento.id,
            // user_id removido pois pode não existir na tabela parcelas e já está vinculado via atendimento
            numero: i + 1,
            valor: valorParcela,
            data_vencimento: dataVencimento.toISOString().split('T')[0],
            paga: false,
            bandeira_cartao: bandeira_cartao || null
          });
        }

        const { error: parcelasError } = await supabase
          .from('parcelas')
          .insert(listaParcelas);

        if (parcelasError) {
          console.error('[FINANCEIRO] Erro ao gerar parcelas:', parcelasError);
          // Não lança erro fatal para não perder o atendimento, mas loga
        } else {
          console.log('[FINANCEIRO] Parcelas geradas com sucesso');
        }
      }

      return atendimento;
    } catch (error) {
      console.error('Erro ao criar atendimento:', error);
      throw error;
    }
  }

  async createContaPagar(userId, { valor, categoria, descricao, data, parcelas }) {
    try {
      // === GERAÇÃO DE PARCELAS (CUSTOS) ===
      // Se for parcelado, cria múltiplas entradas em contas_pagar

      if (parcelas && parcelas > 1) {
        console.log(`[FINANCEIRO] Gerando ${parcelas} parcelas de custo`);
        const valorParcela = valor / parcelas;
        const dataBase = new Date(data || new Date());
        const contasCriadas = [];

        for (let i = 0; i < parcelas; i++) {
          const dataVencimento = new Date(dataBase);
          dataVencimento.setMonth(dataVencimento.getMonth() + i);

          const descricaoParcela = `${descricao || categoria || 'Despesa'} (${i + 1}/${parcelas})`;

          const { data: conta, error } = await supabase
            .from('contas_pagar')
            .insert([{
              user_id: userId,
              descricao: descricaoParcela,
              valor: valorParcela,
              data: dataVencimento.toISOString().split('T')[0],
              tipo: 'fixa', // Mantém 'fixa' ou 'variavel' conforme lógica original, aqui padronizado
              categoria: categoria || 'Outros',
              status_pagamento: i === 0 ? 'pago' : 'pendente', // Primeira parcela paga, resto pendente? Ou tudo pago?
              // Assumindo que se registrou "Gastei", já pagou a primeira ou tudo se for cartão.
              // Mas para controle financeiro, cartão de crédito é dívida futura.
              // Vamos marcar como 'pendente' as futuras para aparecerem no fluxo de caixa futuro.
              observacoes: `Parcela ${i + 1} de ${parcelas}`
            }])
            .select()
            .single();

          if (error) throw error;
          contasCriadas.push(conta);
        }

        console.log(`[FINANCEIRO] ${contasCriadas.length} contas a pagar criadas (parceladas)`);
        return contasCriadas[0]; // Retorna a primeira para referência
      }

      // Custo à vista (padrão)
      const { data: conta, error } = await supabase
        .from('contas_pagar')
        .insert([{
          user_id: userId,
          descricao: categoria || 'Despesa',
          valor: valor,
          data: data || new Date().toISOString().split('T')[0],
          tipo: 'fixa',
          categoria: categoria || 'Outros',
          status_pagamento: 'pago',
          observacoes: descricao || null
        }])
        .select()
        .single();

      if (error) throw error;
      console.log('Conta a pagar criada:', conta.id);
      return conta;
    } catch (error) {
      console.error('Erro ao criar conta a pagar:', error);
      throw error;
    }
  }

  // ... (getBalance e getRecentTransactions mantidos iguais) ...
  // Precisamos pular essas funções para chegar no deleteTransaction
  // Como o replace_file_content substitui um bloco contínuo, vou ter que incluir o meio ou fazer em 2 chamadas.
  // Vou fazer em 2 chamadas para ser mais seguro e não reescrever código inalterado.
  // Esta chamada termina aqui, cobrindo createAtendimento e createContaPagar.
  // A próxima cobrirá deleteTransaction.

  // ... (código omitido para a próxima chamada) ...

  async getBalance(userId) {
    try {
      // Usa a view otimizada para calcular saldo
      const { data: balance, error } = await supabase
        .from('view_finance_balance')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (!balance) {
        return { saldo: 0, entradas: 0, saidas: 0 };
      }

      return {
        saldo: parseFloat(balance.saldo),
        entradas: parseFloat(balance.total_receitas),
        saidas: parseFloat(balance.total_despesas)
      };
    } catch (error) {
      console.error('Erro ao calcular saldo:', error);
      throw error;
    }
  }

  async getRecentTransactions(userId, limit = 10) {
    try {
      // Busca últimos atendimentos
      const { data: atendimentos, error: atendError } = await supabase
        .from('atendimentos')
        .select(`
          id,
          data,
          valor_total,
          custo_total,
          observacoes,
          atendimento_procedimentos (
            procedimentos (
              nome
            )
          )
        `)
        .eq('user_id', userId)
        .order('data', { ascending: false })
        .limit(limit);

      if (atendError) throw atendError;

      // Formata para o formato esperado
      const transactions = (atendimentos || []).map(a => ({
        id: a.id,
        type: 'entrada',
        amount: a.valor_total,
        date: a.data,
        categories: {
          name: a.atendimento_procedimentos?.[0]?.procedimentos?.nome || 'Procedimento'
        }
      }));

      // Busca últimas contas a pagar
      const { data: contas, error: contasError } = await supabase
        .from('contas_pagar')
        .select('*')
        .eq('user_id', userId)
        .order('data', { ascending: false })
        .limit(limit);

      if (contasError) throw contasError;

      // Adiciona contas ao array
      (contas || []).forEach(c => {
        transactions.push({
          id: c.id,
          type: 'saida',
          amount: c.valor,
          date: c.data,
          categories: {
            name: c.categoria || c.descricao || 'Despesa'
          }
        });
      });

      // Ordena por data e limita
      return transactions
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, limit);
    } catch (error) {
      console.error('Erro ao buscar transações recentes:', error);
      throw error;
    }
  }

  async getMonthlyReport(userId, year, month) {
    try {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = new Date(year, month, 0).toISOString().split('T')[0];

      // 1. Busca totais na View (Rápido)
      const { data: summary, error: summaryError } = await supabase
        .from('view_monthly_report')
        .select('*')
        .eq('user_id', userId)
        .eq('ano', year)
        .eq('mes', month)
        .single();

      if (summaryError && summaryError.code !== 'PGRST116') throw summaryError;

      // 2. Busca detalhes para listagem (Ainda necessário para mostrar na tela)
      // Atendimentos do mês
      const { data: atendimentos, error: atendError } = await supabase
        .from('atendimentos')
        .select(`
          *,
          atendimento_procedimentos (
            procedimentos (
              nome
            )
          )
        `)
        .eq('user_id', userId)
        .gte('data', startDate)
        .lte('data', endDate);

      if (atendError) throw atendError;

      // Contas do mês
      const { data: contas, error: contasError } = await supabase
        .from('contas_pagar')
        .select('*')
        .eq('user_id', userId)
        .gte('data', startDate)
        .lte('data', endDate);

      if (contasError) throw contasError;

      // Agrupa por categoria (mantido em JS pois é complexo fazer em SQL sem view específica)
      const porCategoria = {};

      (atendimentos || []).forEach(a => {
        const catName = a.atendimento_procedimentos?.[0]?.procedimentos?.nome || 'Procedimento';
        if (!porCategoria[catName]) {
          porCategoria[catName] = { total: 0, tipo: 'entrada' };
        }
        porCategoria[catName].total += parseFloat(a.valor_total || 0);
      });

      (contas || []).forEach(c => {
        const catName = c.categoria || c.descricao || 'Despesa';
        if (!porCategoria[catName]) {
          porCategoria[catName] = { total: 0, tipo: 'saida' };
        }
        porCategoria[catName].total += parseFloat(c.valor || 0);
      });

      const entradas = summary ? parseFloat(summary.receitas) : 0;
      const saidas = summary ? parseFloat(summary.despesas) : 0;

      return {
        periodo: `${month}/${year}`,
        entradas,
        saidas,
        saldo: entradas - saidas,
        totalTransacoes: summary ? parseInt(summary.total_transacoes) : 0,
        porCategoria,
        transacoes: [...(atendimentos || []), ...(contas || [])]
      };
    } catch (error) {
      console.error('Erro ao gerar relatório mensal:', error);
      throw error;
    }
  }

  async searchTransactions(userId, filters) {
    try {
      const { startDate, endDate, tipo, categoria, minValue, maxValue, limit = 50, offset = 0 } = filters;

      let transactions = [];

      // Busca atendimentos (entradas)
      if (!tipo || tipo === 'entrada') {
        let atendQuery = supabase
          .from('atendimentos')
          .select(`
            id,
            data,
            valor_total,
            custo_total,
            observacoes,
            forma_pagamento,
            parcelas,
            bandeira_cartao,
            atendimento_procedimentos (
              procedimentos (
                nome
              )
            )
          `)
          .eq('user_id', userId);

        if (startDate) atendQuery = atendQuery.gte('data', startDate);
        if (endDate) atendQuery = atendQuery.lte('data', endDate);
        if (minValue) atendQuery = atendQuery.gte('valor_total', minValue);
        if (maxValue) atendQuery = atendQuery.lte('valor_total', maxValue);

        const { data: atendimentos, error: atendError } = await atendQuery
          .order('data', { ascending: false });

        if (atendError) throw atendError;

        (atendimentos || []).forEach(a => {
          const catName = a.atendimento_procedimentos?.[0]?.procedimentos?.nome || 'Procedimento';

          // Filtra por categoria se especificado
          if (categoria && !catName.toLowerCase().includes(categoria.toLowerCase())) {
            return;
          }

          transactions.push({
            id: a.id,
            type: 'entrada',
            amount: parseFloat(a.valor_total),
            date: a.data,
            category: catName,
            description: a.observacoes,
            forma_pagamento: a.forma_pagamento,
            parcelas: a.parcelas,
            bandeira_cartao: a.bandeira_cartao,
            source: 'atendimentos'
          });
        });
      }

      // Busca contas (saídas)
      if (!tipo || tipo === 'saida') {
        let contasQuery = supabase
          .from('contas_pagar')
          .select('*')
          .eq('user_id', userId);

        if (startDate) contasQuery = contasQuery.gte('data', startDate);
        if (endDate) contasQuery = contasQuery.lte('data', endDate);
        if (minValue) contasQuery = contasQuery.gte('valor', minValue);
        if (maxValue) contasQuery = contasQuery.lte('valor', maxValue);

        const { data: contas, error: contasError } = await contasQuery
          .order('data', { ascending: false });

        if (contasError) throw contasError;

        (contas || []).forEach(c => {
          const catName = c.categoria || c.descricao || 'Despesa';

          // Filtra por categoria se especificado
          if (categoria && !catName.toLowerCase().includes(categoria.toLowerCase())) {
            return;
          }

          transactions.push({
            id: c.id,
            type: 'saida',
            amount: parseFloat(c.valor),
            date: c.data,
            category: catName,
            description: c.observacoes,
            source: 'contas_pagar'
          });
        });
      }

      // Ordena por data
      transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Aplica paginação
      const total = transactions.length;
      const paginated = transactions.slice(offset, offset + limit);

      return {
        transactions: paginated,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
    } catch (error) {
      console.error('Erro ao buscar transações:', error);
      throw error;
    }
  }

  async updateTransaction(userId, transactionId, updateData) {
    try {
      const { tipo, valor, categoria, descricao, data } = updateData;

      // Tenta atualizar atendimento primeiro
      const { data: atendimento, error: atendError } = await supabase
        .from('atendimentos')
        .select('id')
        .eq('id', transactionId)
        .eq('user_id', userId)
        .single();

      if (atendimento && !atendError) {
        // É um atendimento (entrada)
        const updates = {};
        if (valor !== undefined) {
          updates.valor_total = valor;
          updates.custo_total = valor * 0.1; // Recalcula custo
        }
        if (data !== undefined) updates.data = data;
        if (descricao !== undefined) updates.observacoes = descricao;

        const { data: updated, error: updateError } = await supabase
          .from('atendimentos')
          .update(updates)
          .eq('id', transactionId)
          .eq('user_id', userId)
          .select()
          .single();

        if (updateError) throw updateError;
        return { ...updated, type: 'entrada' };
      }

      // Se não for atendimento, tenta conta a pagar
      const { data: conta, error: contaError } = await supabase
        .from('contas_pagar')
        .select('id')
        .eq('id', transactionId)
        .eq('user_id', userId)
        .single();

      if (conta && !contaError) {
        // É uma conta (saída)
        const updates = {};
        if (valor !== undefined) updates.valor = valor;
        if (data !== undefined) updates.data = data;
        if (descricao !== undefined) updates.observacoes = descricao;
        if (categoria !== undefined) {
          updates.categoria = categoria;
          updates.descricao = categoria;
        }

        const { data: updated, error: updateError } = await supabase
          .from('contas_pagar')
          .update(updates)
          .eq('id', transactionId)
          .eq('user_id', userId)
          .select()
          .single();

        if (updateError) throw updateError;
        return { ...updated, type: 'saida' };
      }

      return null; // Não encontrado
    } catch (error) {
      console.error('Erro ao atualizar transação:', error);
      throw error;
    }
  }

  async deleteTransaction(userId, transactionId) {
    try {
      // Tenta deletar atendimento primeiro
      const { data: atendimento, error: atendCheckError } = await supabase
        .from('atendimentos')
        .select('id')
        .eq('id', transactionId)
        .eq('user_id', userId)
        .single();

      if (atendimento && !atendCheckError) {
        console.log(`[FINANCEIRO] Deletando atendimento ${transactionId} e dados relacionados`);

        // 1. Deleta procedimentos relacionados
        await supabase
          .from('atendimento_procedimentos')
          .delete()
          .eq('atendimento_id', transactionId);

        // 2. Deleta parcelas relacionadas
        await supabase
          .from('parcelas')
          .delete()
          .eq('atendimento_id', transactionId);

        // 3. Deleta o atendimento
        const { error: deleteError } = await supabase
          .from('atendimentos')
          .delete()
          .eq('id', transactionId)
          .eq('user_id', userId);

        if (deleteError) throw deleteError;
        return { id: transactionId, type: 'entrada' };
      }

      // Se não for atendimento, tenta conta a pagar
      const { data: conta, error: contaCheckError } = await supabase
        .from('contas_pagar')
        .select('id')
        .eq('id', transactionId)
        .eq('user_id', userId)
        .single();

      if (conta && !contaCheckError) {
        // Se for conta a pagar, deleta apenas ela
        // (Se implementarmos parcelas de contas como múltiplas contas, o usuário terá que deletar uma por uma
        // ou implementamos um "group_id" futuro para deletar todas. Por enquanto, deleta a individual)

        const { error: deleteError } = await supabase
          .from('contas_pagar')
          .delete()
          .eq('id', transactionId)
          .eq('user_id', userId);

        if (deleteError) throw deleteError;
        return { id: transactionId, type: 'saida' };
      }

      return null; // Não encontrado
    } catch (error) {
      console.error('Erro ao deletar transação:', error);
      throw error;
    }
  }

  async getTodayStats(userId) {
    try {
      const today = new Date().toISOString().split('T')[0];

      // Busca atendimentos de hoje
      const { data: atendimentos, error: atendError } = await supabase
        .from('atendimentos')
        .select(`
          valor_total,
          custo_total,
          atendimento_procedimentos (
            procedimentos (
              nome
            )
          )
        `)
        .eq('user_id', userId)
        .eq('data', today);

      if (atendError) throw atendError;

      // Busca contas de hoje
      const { data: contas, error: contasError } = await supabase
        .from('contas_pagar')
        .select('valor, categoria')
        .eq('user_id', userId)
        .eq('data', today);

      if (contasError) throw contasError;

      const faturamento = (atendimentos || []).reduce((acc, a) => acc + parseFloat(a.valor_total || 0), 0);
      const custosAtend = (atendimentos || []).reduce((acc, a) => acc + parseFloat(a.custo_total || 0), 0);
      const custosContas = (contas || []).reduce((acc, c) => acc + parseFloat(c.valor || 0), 0);
      const totalCustos = custosAtend + custosContas;
      const lucro = faturamento - totalCustos;

      // Agrupa vendas por procedimento
      const porProcedimento = {};
      (atendimentos || []).forEach(a => {
        const procName = a.atendimento_procedimentos?.[0]?.procedimentos?.nome || 'Procedimento';
        if (!porProcedimento[procName]) {
          porProcedimento[procName] = { quantidade: 0, valor: 0 };
        }
        porProcedimento[procName].quantidade++;
        porProcedimento[procName].valor += parseFloat(a.valor_total || 0);
      });

      return {
        faturamento,
        custos: totalCustos,
        lucro,
        qtdVendas: (atendimentos || []).length,
        qtdCustos: (contas || []).length,
        porProcedimento
      };
    } catch (error) {
      console.error('Erro ao buscar stats de hoje:', error);
      throw error;
    }
  }

  async getProcedureRanking(userId) {
    try {
      // Busca todos os atendimentos com procedimentos
      const { data: atendimentos, error: atendError } = await supabase
        .from('atendimentos')
        .select(`
          valor_total,
          data,
          atendimento_procedimentos (
            procedimentos (
              nome
            )
          )
        `)
        .eq('user_id', userId);

      if (atendError) throw atendError;

      if (!atendimentos || atendimentos.length === 0) {
        return { ranking: [], totalGeral: 0, qtdTotal: 0 };
      }

      // Agrupa por procedimento
      const porProcedimento = {};
      (atendimentos || []).forEach(a => {
        const procName = a.atendimento_procedimentos?.[0]?.procedimentos?.nome || 'Procedimento';
        if (!porProcedimento[procName]) {
          porProcedimento[procName] = { quantidade: 0, valor: 0, ticketMedio: 0 };
        }
        porProcedimento[procName].quantidade++;
        porProcedimento[procName].valor += parseFloat(a.valor_total || 0);
      });

      // Calcula ticket médio
      Object.keys(porProcedimento).forEach(proc => {
        porProcedimento[proc].ticketMedio = porProcedimento[proc].valor / porProcedimento[proc].quantidade;
      });

      // Converte para array e ordena por valor total
      const ranking = Object.entries(porProcedimento)
        .map(([nome, data]) => ({ nome, ...data }))
        .sort((a, b) => b.valor - a.valor);

      const totalGeral = ranking.reduce((acc, p) => acc + p.valor, 0);
      const qtdTotal = ranking.reduce((acc, p) => acc + p.quantidade, 0);

      return { ranking, totalGeral, qtdTotal };
    } catch (error) {
      console.error('Erro ao buscar ranking de procedimentos:', error);
      throw error;
    }
  }

  async getUpcomingSchedules(userId) {
    try {
      const today = new Date().toISOString().split('T')[0];

      const { data: agendamentos, error } = await supabase
        .from('agendamentos')
        .select(`
          *,
          clientes (nome),
          procedimentos (nome)
        `)
        .eq('user_id', userId)
        .gte('data_agendamento', today)
        .order('data_agendamento', { ascending: true })
        .limit(10);

      if (error) throw error;

      return agendamentos || [];
    } catch (error) {
      console.error('Erro ao buscar agendamentos:', error);
      throw error;
    }
  }
}

module.exports = new TransactionController();
