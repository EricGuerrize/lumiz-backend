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

  async createAtendimento(userId, { valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao, nome_cliente }) {
    try {
      // Usa nome_cliente se fornecido, senão extrai da descrição
      let nomeCliente = nome_cliente || 'Cliente WhatsApp';
      if (!nome_cliente && descricao) {
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

  async createContaPagar(userId, { valor, categoria, descricao, data, tipo, parcelas }) {
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
              tipo: tipo || 'fixa', // Usa tipo passado ou 'fixa' como padrão
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
          tipo: tipo || 'fixa', // Usa tipo passado ou 'fixa' como padrão
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
      // Busca transações consolidadas na view
      const { data: transactions, error } = await supabase
        .from('view_financial_ledger')
        .select('*')
        .eq('user_id', userId)
        .order('data', { ascending: false })
        .limit(limit);

      if (error) throw error;

      // Mapeia para o formato esperado pelo frontend/mensagem
      return (transactions || []).map(t => ({
        id: t.id,
        type: t.type,
        amount: parseFloat(t.valor), // valor já vem corrigido da view, mas garante float pro JS
        date: t.data,
        categories: {
          name: t.categoria || 'Sem categoria'
        },
        description: t.descricao
      }));
    } catch (error) {
      console.error('Erro ao buscar transações recentes:', error);
      throw error;
    }
  }

  async getMonthlyReport(userId, year, month) {
    try {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      // End date deve ser o último dia do mês
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

      // 1. Busca totais na View (Rápido)
      const { data: summary, error: summaryError } = await supabase
        .from('view_monthly_report')
        .select('*')
        .eq('user_id', userId)
        .eq('ano', year)
        .eq('mes', month)
        .maybeSingle();

      if (summaryError) throw summaryError;

      // 2. Busca detalhes para listagem via Ledger View
      const { data: transactions, error: transError } = await supabase
        .from('view_financial_ledger')
        .select('*')
        .eq('user_id', userId)
        .gte('data', startDate)
        .lte('data', endDate)
        .order('data', { ascending: false });

      if (transError) throw transError;

      // Agrupa por categoria
      const porCategoria = {};

      (transactions || []).forEach(t => {
        const catName = t.categoria || 'Sem Categoria';
        if (!porCategoria[catName]) {
          porCategoria[catName] = { total: 0, tipo: t.type }; // 'entrada' ou 'saida'
        }
        porCategoria[catName].total += parseFloat(t.valor || 0);
      });

      const entradas = summary ? parseFloat(summary.receitas) : 0;
      const saidas = summary ? parseFloat(summary.despesas) : 0;
      const totalTransacoes = summary ? parseInt(summary.total_transacoes) : (transactions || []).length;

      return {
        periodo: `${month}/${year}`,
        entradas,
        saidas,
        saldo: entradas - saidas,
        totalTransacoes,
        porCategoria,
        transacoes: (transactions || []).map(t => ({
          // Mapeia para manter compatibilidade com quem consome 'transacoes' direto
          ...t,
          amount: parseFloat(t.valor),
          date: t.data,
          category: t.categoria,
          categories: {
            name: t.categoria || 'Sem categoria'
          },
          description: t.descricao
        }))
      };
    } catch (error) {
      console.error('Erro ao gerar relatório mensal:', error);
      throw error;
    }
  }

  async searchTransactions(userId, filters) {
    try {
      const { startDate, endDate, tipo, categoria, minValue, maxValue, limit = 50, offset = 0 } = filters;

      let query = supabase
        .from('view_financial_ledger')
        .select('*', { count: 'exact' })
        .eq('user_id', userId);

      if (startDate) query = query.gte('data', startDate);
      if (endDate) query = query.lte('data', endDate);

      // Tipo (entrada/saida)
      if (tipo) {
        query = query.eq('type', tipo);
      }

      // Filtro por valor
      if (minValue !== null && minValue !== undefined) query = query.gte('valor', minValue);
      if (maxValue !== null && maxValue !== undefined) query = query.lte('valor', maxValue);

      // Filtro por categoria (insensitive filter na view pode ser pesado, mas funcional)
      if (categoria) {
        query = query.ilike('categoria', `%${categoria}%`);
      }

      // Ordenação
      query = query.order('data', { ascending: false });

      // Paginação
      // O Supabase range é 0-based inclusive, então range(0, 9) retorna 10 items.
      query = query.range(offset, offset + limit - 1);

      const { data: transactions, error, count } = await query;

      if (error) throw error;

      // Formata retorno
      const formatted = (transactions || []).map(t => ({
        id: t.id,
        type: t.type,
        amount: parseFloat(t.valor),
        date: t.data,
        category: t.categoria || 'Sem categoria',
        description: t.descricao,
        forma_pagamento: t.payment_method,
        source: t.type === 'entrada' ? 'atendimentos' : 'contas_pagar'
      }));

      // Para saber se tem mais, precisaríamos do count total ou pedir limit + 1.
      // Simplificação: se retornou 'limit', assume que pode ter mais.
      const total = count || 0;
      const hasMore = offset + (transactions || []).length < total;

      return {
        transactions: formatted,
        total,
        limit,
        offset,
        hasMore
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
