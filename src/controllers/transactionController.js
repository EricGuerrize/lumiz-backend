const supabase = require('../db/supabase');

class TransactionController {
  async createTransaction(userId, transactionData) {
    try {
      const { tipo, valor, categoria, descricao, data } = transactionData;

      let categoryId = null;
      if (categoria) {
        categoryId = await this.findOrCreateCategory(userId, categoria, tipo);
      }

      const { data: transaction, error } = await supabase
        .from('transactions')
        .insert([{
          user_id: userId,
          category_id: categoryId,
          type: tipo,
          amount: valor,
          description: descricao,
          date: data || new Date().toISOString().split('T')[0]
        }])
        .select()
        .single();

      if (error) throw error;
      return transaction;
    } catch (error) {
      console.error('Erro ao criar transação:', error);
      throw error;
    }
  }

  async findOrCreateCategory(userId, categoryName, type) {
    try {
      const { data: existing } = await supabase
        .from('categories')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', categoryName)
        .single();

      if (existing) {
        return existing.id;
      }

      const { data: newCategory, error } = await supabase
        .from('categories')
        .insert([{
          user_id: userId,
          name: categoryName,
          type: type
        }])
        .select('id')
        .single();

      if (error) throw error;
      return newCategory.id;
    } catch (error) {
      console.error('Erro ao buscar/criar categoria:', error);
      return null;
    }
  }

  async getBalance(userId) {
    try {
      const { data: transactions, error } = await supabase
        .from('transactions')
        .select('type, amount')
        .eq('user_id', userId);

      if (error) throw error;

      const balance = transactions.reduce((acc, t) => {
        if (t.type === 'entrada') {
          return acc + parseFloat(t.amount);
        } else {
          return acc - parseFloat(t.amount);
        }
      }, 0);

      const entradas = transactions
        .filter(t => t.type === 'entrada')
        .reduce((acc, t) => acc + parseFloat(t.amount), 0);

      const saidas = transactions
        .filter(t => t.type === 'saida')
        .reduce((acc, t) => acc + parseFloat(t.amount), 0);

      return {
        saldo: balance,
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
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          categories (name)
        `)
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Erro ao buscar transações recentes:', error);
      throw error;
    }
  }

  async getMonthlyReport(userId, year, month) {
    try {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = new Date(year, month, 0).toISOString().split('T')[0];

      const { data: transactions, error } = await supabase
        .from('transactions')
        .select(`
          *,
          categories (name)
        `)
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });

      if (error) throw error;

      const entradas = transactions
        .filter(t => t.type === 'entrada')
        .reduce((acc, t) => acc + parseFloat(t.amount), 0);

      const saidas = transactions
        .filter(t => t.type === 'saida')
        .reduce((acc, t) => acc + parseFloat(t.amount), 0);

      const saldo = entradas - saidas;

      const porCategoria = transactions.reduce((acc, t) => {
        const catName = t.categories?.name || 'Sem categoria';
        if (!acc[catName]) {
          acc[catName] = { total: 0, tipo: t.type };
        }
        acc[catName].total += parseFloat(t.amount);
        return acc;
      }, {});

      return {
        periodo: `${month}/${year}`,
        entradas,
        saidas,
        saldo,
        totalTransacoes: transactions.length,
        porCategoria,
        transacoes: transactions
      };
    } catch (error) {
      console.error('Erro ao gerar relatório mensal:', error);
      throw error;
    }
  }
}

module.exports = new TransactionController();
