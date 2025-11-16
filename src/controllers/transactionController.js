const supabase = require('../db/supabase');

class TransactionController {
  async createTransaction(userId, transactionData) {
    try {
      const { tipo, valor, categoria, descricao, data } = transactionData;

      // Insere na tabela whatsapp_transactions do Lovable Cloud
      const { data: transaction, error } = await supabase
        .from('whatsapp_transactions')
        .insert([{
          user_id: userId,
          type: tipo,
          amount: valor,
          category: categoria || 'Sem categoria',
          description: descricao || null,
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

  async getBalance(userId) {
    try {
      const { data: transactions, error } = await supabase
        .from('whatsapp_transactions')
        .select('type, amount')
        .eq('user_id', userId);

      if (error) throw error;

      const entradas = (transactions || [])
        .filter(t => t.type === 'entrada')
        .reduce((acc, t) => acc + parseFloat(t.amount), 0);

      const saidas = (transactions || [])
        .filter(t => t.type === 'saida')
        .reduce((acc, t) => acc + parseFloat(t.amount), 0);

      const balance = entradas - saidas;

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
        .from('whatsapp_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      // Formata para compatibilidade com o código existente
      return (data || []).map(t => ({
        ...t,
        categories: { name: t.category }
      }));
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
        .from('whatsapp_transactions')
        .select('*')
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });

      if (error) throw error;

      const transactionList = transactions || [];

      const entradas = transactionList
        .filter(t => t.type === 'entrada')
        .reduce((acc, t) => acc + parseFloat(t.amount), 0);

      const saidas = transactionList
        .filter(t => t.type === 'saida')
        .reduce((acc, t) => acc + parseFloat(t.amount), 0);

      const saldo = entradas - saidas;

      const porCategoria = transactionList.reduce((acc, t) => {
        const catName = t.category || 'Sem categoria';
        if (!acc[catName]) {
          acc[catName] = { total: 0, tipo: t.type };
        }
        acc[catName].total += parseFloat(t.amount);
        return acc;
      }, {});

      // Formata transações para compatibilidade
      const transacoesFormatadas = transactionList.map(t => ({
        ...t,
        categories: { name: t.category }
      }));

      return {
        periodo: `${month}/${year}`,
        entradas,
        saidas,
        saldo,
        totalTransacoes: transactionList.length,
        porCategoria,
        transacoes: transacoesFormatadas
      };
    } catch (error) {
      console.error('Erro ao gerar relatório mensal:', error);
      throw error;
    }
  }
}

module.exports = new TransactionController();
