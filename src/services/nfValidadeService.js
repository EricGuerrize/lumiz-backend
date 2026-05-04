const supabase = require('../db/supabase');

function _todayISO() {
  return new Date().toISOString().split('T')[0];
}

class NfValidadeService {
  /**
   * Itens com validade nos próximos `days` dias (inclui vencidos até hoje).
   */
  async listarProximos(userId, days = 90) {
    const d = Math.min(Math.max(parseInt(String(days), 10) || 90, 1), 365);
    const end = new Date();
    end.setDate(end.getDate() + d);
    const endStr = end.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('nf_validade_itens')
      .select('id, descricao, data_validade, origem, created_at')
      .eq('user_id', userId)
      .lte('data_validade', endStr)
      .order('data_validade', { ascending: true });

    if (error) throw error;

    const today = _todayISO();
    const itens = (data || []).map((row) => ({
      id: row.id,
      descricao: row.descricao,
      data_validade: row.data_validade,
      origem: row.origem,
      created_at: row.created_at,
      vencido: row.data_validade < today,
      vence_em_dias: Math.ceil(
        (new Date(`${row.data_validade}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000
      ),
    }));

    return { days: d, hoje: today, itens };
  }

  async criar(userId, { descricao, data_validade, origem = 'manual' }) {
    const desc = String(descricao || '').trim();
    if (!desc) throw new Error('descricao é obrigatória');
    if (!data_validade || !/^\d{4}-\d{2}-\d{2}$/.test(String(data_validade))) {
      throw new Error('data_validade deve ser YYYY-MM-DD');
    }
    const orig = ['manual', 'import', 'api'].includes(origem) ? origem : 'manual';

    const { data, error } = await supabase
      .from('nf_validade_itens')
      .insert({
        user_id: userId,
        descricao: desc,
        data_validade,
        origem: orig,
      })
      .select('id, descricao, data_validade, origem, created_at')
      .single();

    if (error) throw error;
    return data;
  }

  async remover(userId, id) {
    const { data, error } = await supabase
      .from('nf_validade_itens')
      .delete()
      .eq('user_id', userId)
      .eq('id', id)
      .select('id');

    if (error) throw error;
    return { removidos: (data || []).length };
  }
}

module.exports = new NfValidadeService();
