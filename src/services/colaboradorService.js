const supabase = require('../db/supabase');

class ColaboradorService {
  async list(userId) {
    const { data, error } = await supabase
      .from('colaboradores')
      .select('*')
      .eq('user_id', userId)
      .order('nome', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async create(userId, payload) {
    const nome = String(payload?.nome || '').trim();
    if (!nome) throw new Error('nome é obrigatório');
    const row = {
      user_id: userId,
      nome,
      funcao: payload?.funcao || null,
      comissao_pct: Number.isFinite(Number(payload?.comissao_pct)) ? Number(payload.comissao_pct) : 0,
      comissao_fixa: Number.isFinite(Number(payload?.comissao_fixa)) ? Number(payload.comissao_fixa) : 0,
      ativo: payload?.ativo !== undefined ? Boolean(payload.ativo) : true,
    };
    const { data, error } = await supabase
      .from('colaboradores')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async update(userId, id, payload) {
    const updates = {};
    if (payload?.nome !== undefined) updates.nome = String(payload.nome || '').trim();
    if (payload?.funcao !== undefined) updates.funcao = payload.funcao || null;
    if (payload?.comissao_pct !== undefined) updates.comissao_pct = Number(payload.comissao_pct) || 0;
    if (payload?.comissao_fixa !== undefined) updates.comissao_fixa = Number(payload.comissao_fixa) || 0;
    if (payload?.ativo !== undefined) updates.ativo = Boolean(payload.ativo);

    const { data, error } = await supabase
      .from('colaboradores')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async remove(userId, id) {
    const { error } = await supabase
      .from('colaboradores')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    return { ok: true };
  }

  async getComissoesByMonth(userId, colaboradorId, monthStr) {
    const now = new Date();
    const month = monthStr && /^\d{4}-\d{2}$/.test(monthStr)
      ? monthStr
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = month.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;

    const { data, error } = await supabase
      .from('comissoes')
      .select('id, atendimento_id, valor, pct_aplicado, created_at')
      .eq('user_id', userId)
      .eq('colaborador_id', colaboradorId)
      .gte('created_at', `${start}T00:00:00.000Z`)
      .lte('created_at', `${end}T23:59:59.999Z`)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const items = data || [];
    const total = items.reduce((s, i) => s + (parseFloat(i.valor) || 0), 0);
    return { month, items, total: parseFloat(total.toFixed(2)) };
  }
}

module.exports = new ColaboradorService();
