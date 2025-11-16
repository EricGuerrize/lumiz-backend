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
        return await this.createContaPagar(userId, { valor, categoria, descricao, data });
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

      return atendimento;
    } catch (error) {
      console.error('Erro ao criar atendimento:', error);
      throw error;
    }
  }

  async createContaPagar(userId, { valor, categoria, descricao, data }) {
    try {
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

  async getBalance(userId) {
    try {
      // Busca atendimentos (receitas)
      const { data: atendimentos, error: atendError } = await supabase
        .from('atendimentos')
        .select('valor_total, custo_total')
        .eq('user_id', userId);

      if (atendError) throw atendError;

      // Busca contas a pagar (custos adicionais)
      const { data: contas, error: contasError } = await supabase
        .from('contas_pagar')
        .select('valor')
        .eq('user_id', userId);

      if (contasError) throw contasError;

      const entradas = (atendimentos || []).reduce((acc, a) => acc + parseFloat(a.valor_total || 0), 0);
      const custosAtend = (atendimentos || []).reduce((acc, a) => acc + parseFloat(a.custo_total || 0), 0);
      const custosContas = (contas || []).reduce((acc, c) => acc + parseFloat(c.valor || 0), 0);
      const saidas = custosAtend + custosContas;

      return {
        saldo: entradas - saidas,
        entradas,
        saidas
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

      const entradas = (atendimentos || []).reduce((acc, a) => acc + parseFloat(a.valor_total || 0), 0);
      const custosAtend = (atendimentos || []).reduce((acc, a) => acc + parseFloat(a.custo_total || 0), 0);
      const custosContas = (contas || []).reduce((acc, c) => acc + parseFloat(c.valor || 0), 0);
      const saidas = custosAtend + custosContas;

      // Agrupa por categoria (procedimento para entradas, categoria para saídas)
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

      return {
        periodo: `${month}/${year}`,
        entradas,
        saidas,
        saldo: entradas - saidas,
        totalTransacoes: (atendimentos || []).length + (contas || []).length,
        porCategoria,
        transacoes: [...(atendimentos || []), ...(contas || [])]
      };
    } catch (error) {
      console.error('Erro ao gerar relatório mensal:', error);
      throw error;
    }
  }
}

module.exports = new TransactionController();
