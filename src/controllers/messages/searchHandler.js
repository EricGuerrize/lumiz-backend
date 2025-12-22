const supabase = require('../../db/supabase');

/**
 * Handler para buscas e pesquisas
 */
class SearchHandler {
  /**
   * Busca transações
   */
  async handleSearchTransaction(user, intent, messageOriginal = '') {
    try {
      const searchTerm = intent.dados?.termo || intent.dados?.categoria || messageOriginal.trim();

      if (!searchTerm) {
        return 'O que você quer buscar? Pode ser:\n• Nome do procedimento\n• Nome do cliente\n• Valor\n• Categoria';
      }

      const results = [];
      const isValorBusca = /^\d+([.,]\d+)?$/.test(searchTerm);
      const valorNumerico = isValorBusca ? parseFloat(searchTerm.replace(',', '.')) : null;

      // Busca em atendimentos
      let atendimentosQuery = supabase
        .from('atendimentos')
        .select('id, valor_total, data, descricao, cliente_id, atendimento_procedimentos(procedimentos(nome))')
        .eq('user_id', user.id);

      if (isValorBusca) {
        const valorMin = valorNumerico * 0.9;
        const valorMax = valorNumerico * 1.1;
        atendimentosQuery = atendimentosQuery.gte('valor_total', valorMin).lte('valor_total', valorMax);
      } else {
        atendimentosQuery = atendimentosQuery.or(`descricao.ilike.%${searchTerm}%`);
      }

      const { data: atendimentos, error: atendError } = await atendimentosQuery
        .order('data', { ascending: false })
        .limit(20);

      if (!atendError && atendimentos) {
        atendimentos.forEach(a => {
          const categoria = a.atendimento_procedimentos?.[0]?.procedimentos?.nome || 'Procedimento';
          results.push({
            tipo: 'entrada',
            valor: parseFloat(a.valor_total || 0),
            categoria,
            descricao: a.descricao || '',
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

      response += `Para ver mais detalhes, digite "buscar" seguido do nome ou valor.`;

      return response;
    } catch (error) {
      console.error('Erro ao buscar transação:', error);
      return 'Erro ao buscar transações. Tente novamente.';
    }
  }
}

module.exports = SearchHandler;

