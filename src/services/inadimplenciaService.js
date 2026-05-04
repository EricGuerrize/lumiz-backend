const supabase = require('../db/supabase');
const { formatarMoeda } = require('../utils/currency');

class InadimplenciaService {
  _dateStr(date) {
    return date.toISOString().split('T')[0];
  }

  _daysDiff(lateDate, referenceDate) {
    return Math.max(0, Math.floor((referenceDate - lateDate) / 86400000));
  }

  _riskFrom(daysMax, totalParcelas) {
    if (daysMax > 30 || totalParcelas > 2) return 'alto';
    if (daysMax >= 15) return 'medio';
    return 'baixo';
  }

  async _getOverdueRows(userId, clienteId = null) {
    const today = this._dateStr(new Date());
    let query = supabase
      .from('parcelas')
      .select(`
        id,
        numero,
        valor,
        data_vencimento,
        atendimento_id,
        atendimentos!inner (
          id,
          user_id,
          cliente_id,
          valor_total,
          data,
          clientes (id, nome)
        )
      `)
      .eq('paga', false)
      .eq('atendimentos.user_id', userId)
      .lt('data_vencimento', today)
      .order('data_vencimento', { ascending: true });

    if (clienteId) {
      query = query.eq('atendimentos.cliente_id', clienteId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async _getCurrentMonthRevenue(userId) {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const { data, error } = await supabase
      .from('atendimentos')
      .select('valor_total')
      .eq('user_id', userId)
      .gte('data', this._dateStr(firstDay))
      .lte('data', this._dateStr(now));

    if (error) throw error;
    return (data || []).reduce((sum, row) => sum + (parseFloat(row.valor_total) || 0), 0);
  }

  async getOverview(userId) {
    const rows = await this._getOverdueRows(userId);
    const faturamentoMes = await this._getCurrentMonthRevenue(userId);
    const now = new Date();

    const byClient = new Map();
    for (const row of rows) {
      const clientId = row.atendimentos?.clientes?.id || row.atendimentos?.cliente_id;
      const clientName = row.atendimentos?.clientes?.nome || 'Cliente';
      if (!clientId) continue;

      const overdueDays = row.data_vencimento
        ? this._daysDiff(new Date(`${row.data_vencimento}T12:00:00`), now)
        : 0;
      const amount = parseFloat(row.valor) || 0;

      if (!byClient.has(clientId)) {
        byClient.set(clientId, {
          clienteId: clientId,
          nome: clientName,
          totalEmAtraso: 0,
          totalParcelas: 0,
          diasAtrasoMax: 0,
          atendimentos: new Set(),
        });
      }

      const item = byClient.get(clientId);
      item.totalEmAtraso += amount;
      item.totalParcelas += 1;
      item.diasAtrasoMax = Math.max(item.diasAtrasoMax, overdueDays);
      if (row.atendimento_id) item.atendimentos.add(row.atendimento_id);
    }

    const clientes = Array.from(byClient.values()).map((c) => ({
      clienteId: c.clienteId,
      nome: c.nome,
      totalEmAtraso: parseFloat(c.totalEmAtraso.toFixed(2)),
      totalParcelas: c.totalParcelas,
      diasAtrasoMax: c.diasAtrasoMax,
      atendimentosEmAtraso: c.atendimentos.size,
      risco: this._riskFrom(c.diasAtrasoMax, c.totalParcelas),
    }));

    clientes.sort((a, b) => b.totalEmAtraso - a.totalEmAtraso);

    const totalEmAtraso = clientes.reduce((sum, c) => sum + c.totalEmAtraso, 0);
    const totalParcelas = clientes.reduce((sum, c) => sum + c.totalParcelas, 0);
    const percentualFaturamento = faturamentoMes > 0 ? (totalEmAtraso / faturamentoMes) * 100 : 0;
    const pctFmt = parseFloat(percentualFaturamento.toFixed(1));

    let mensagemImpacto;
    if (totalEmAtraso <= 0) {
      mensagemImpacto = 'Não há parcelas em atraso.';
    } else if (faturamentoMes > 0) {
      mensagemImpacto = `Você tem ${formatarMoeda(totalEmAtraso)} em parcelas em atraso; isso representa ${pctFmt}% do faturamento do mês atual.`;
    } else {
      mensagemImpacto = `Você tem ${formatarMoeda(totalEmAtraso)} em parcelas em atraso. (Sem faturamento registrado no mês atual para calcular percentual.)`;
    }

    return {
      totalEmAtraso: parseFloat(totalEmAtraso.toFixed(2)),
      percentualFaturamento: pctFmt,
      totalParcelas,
      faturamentoMesReferencia: parseFloat(faturamentoMes.toFixed(2)),
      periodoFaturamentoReferencia: 'mes_atual',
      mensagemImpacto,
      clientes,
    };
  }

  async getDetalheCliente(userId, clienteId) {
    const rows = await this._getOverdueRows(userId, clienteId);
    const now = new Date();

    const parcelas = rows.map((row) => {
      const valor = parseFloat(row.valor) || 0;
      const diasAtraso = row.data_vencimento
        ? this._daysDiff(new Date(`${row.data_vencimento}T12:00:00`), now)
        : 0;

      return {
        parcelaId: row.id,
        atendimentoId: row.atendimento_id,
        numero: row.numero,
        valor,
        dataVencimento: row.data_vencimento,
        diasAtraso,
        cliente: {
          id: row.atendimentos?.clientes?.id || row.atendimentos?.cliente_id,
          nome: row.atendimentos?.clientes?.nome || 'Cliente',
        },
        atendimento: {
          id: row.atendimentos?.id,
          data: row.atendimentos?.data,
          valorTotal: parseFloat(row.atendimentos?.valor_total || 0),
        },
      };
    });

    const totalEmAtraso = parcelas.reduce((sum, p) => sum + p.valor, 0);
    const diasAtrasoMax = parcelas.reduce((max, p) => Math.max(max, p.diasAtraso), 0);

    return {
      clienteId,
      totalEmAtraso: parseFloat(totalEmAtraso.toFixed(2)),
      totalParcelas: parcelas.length,
      risco: this._riskFrom(diasAtrasoMax, parcelas.length),
      parcelas,
    };
  }
}

module.exports = new InadimplenciaService();
