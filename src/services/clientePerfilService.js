const supabase = require('../db/supabase');

function _todayStr() {
  return new Date().toISOString().split('T')[0];
}

function _normalizeForma(forma) {
  const x = String(forma || '').toLowerCase().trim();
  if (x === 'pix') return 'pix';
  if (x === 'debito') return 'debito';
  if (x === 'dinheiro' || x === 'avista' || x === 'a_vista') return 'dinheiro';
  if (x === 'parcelado') return 'parcelado';
  if (x === 'credito' || x === 'credito_avista') return 'credito';
  return 'dinheiro';
}

function _emptyFormas() {
  return {
    pix: 0,
    credito: 0,
    debito: 0,
    dinheiro: 0,
    parcelado: 0,
  };
}

function _formaPreferida(formas) {
  const keys = ['pix', 'credito', 'debito', 'dinheiro', 'parcelado'];
  let winner = 'pix';
  let best = -1;
  for (const k of keys) {
    const n = Number(formas[k] || 0);
    if (n > best) {
      best = n;
      winner = k;
    }
  }
  return winner;
}

class ClientePerfilService {
  async _getOverdueClientIds(userId) {
    const today = _todayStr();
    const { data, error } = await supabase
      .from('parcelas')
      .select('atendimentos!inner(cliente_id, user_id)')
      .eq('paga', false)
      .eq('atendimentos.user_id', userId)
      .lt('data_vencimento', today);

    if (error) throw error;
    const ids = new Set();
    for (const row of data || []) {
      const cid = row.atendimentos?.cliente_id;
      if (cid) ids.add(cid);
    }
    return ids;
  }

  async getPerfilPagamento(userId) {
    const { data: atendimentos, error } = await supabase
      .from('atendimentos')
      .select('id, cliente_id, forma_pagamento, valor_total')
      .eq('user_id', userId)
      .not('cliente_id', 'is', null);

    if (error) throw error;
    const rows = atendimentos || [];
    if (!rows.length) {
      return {
        clientes: [],
        resumo: {
          total_clientes: 0,
          preferem_pix: 0,
          preferem_cartao: 0,
          preferem_dinheiro: 0,
          clientes_risco_alto: 0,
        },
      };
    }

    const clientIds = [...new Set(rows.map((r) => r.cliente_id).filter(Boolean))];
    const [clientesResult, overdueIds] = await Promise.all([
      supabase
        .from('clientes')
        .select('id, nome')
        .eq('user_id', userId)
        .in('id', clientIds),
      this._getOverdueClientIds(userId),
    ]);
    if (clientesResult.error) throw clientesResult.error;
    const nomeById = new Map((clientesResult.data || []).map((c) => [c.id, c.nome]));

    const byClient = new Map();
    for (const row of rows) {
      const cid = row.cliente_id;
      if (!cid) continue;
      if (!byClient.has(cid)) {
        byClient.set(cid, {
          clienteId: cid,
          nome: nomeById.get(cid) || 'Cliente',
          formas_usadas: _emptyFormas(),
          _sum: 0,
          total_atendimentos: 0,
        });
      }
      const item = byClient.get(cid);
      const f = _normalizeForma(row.forma_pagamento);
      item.formas_usadas[f] += 1;
      item._sum += parseFloat(row.valor_total) || 0;
      item.total_atendimentos += 1;
    }

    const clientes = [...byClient.values()].map((c) => ({
      cliente_id: c.clienteId,
      clienteId: c.clienteId,
      nome: c.nome,
      forma_preferida: _formaPreferida(c.formas_usadas),
      formas_usadas: c.formas_usadas,
      ticket_medio:
        c.total_atendimentos > 0
          ? parseFloat((c._sum / c.total_atendimentos).toFixed(2))
          : 0,
      total_atendimentos: c.total_atendimentos,
      indice_risco_pagamento: overdueIds.has(c.clienteId) ? 'alto' : 'baixo',
    }));

    clientes.sort(
      (a, b) =>
        b.total_atendimentos - a.total_atendimentos ||
        b.ticket_medio - a.ticket_medio
    );

    const resumo = {
      total_clientes: clientes.length,
      preferem_pix: clientes.filter((c) => c.forma_preferida === 'pix').length,
      preferem_cartao: clientes.filter(
        (c) =>
          c.forma_preferida === 'credito' ||
          c.forma_preferida === 'debito' ||
          c.forma_preferida === 'parcelado'
      ).length,
      preferem_dinheiro: clientes.filter(
        (c) => c.forma_preferida === 'dinheiro'
      ).length,
      clientes_risco_alto: clientes.filter(
        (c) => c.indice_risco_pagamento === 'alto'
      ).length,
    };

    return { items: clientes, clientes, resumo };
  }
}

module.exports = new ClientePerfilService();
