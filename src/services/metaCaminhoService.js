const supabase = require('../db/supabase');
const outlookService = require('./outlookService');

function _dateStr(d) {
  return d.toISOString().split('T')[0];
}

class MetaCaminhoService {
  async calcularCaminhoMeta(userId) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    const todayStr = _dateStr(now);

    const lastDay = new Date(year, month, 0);
    const endOfMonthStr = _dateStr(lastDay);

    const { data: goalRow } = await supabase
      .from('monthly_goals')
      .select('meta_receita, meta_reserva, meta_lucro')
      .eq('user_id', userId)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    let meta_receita;
    if (goalRow != null) {
      meta_receita = parseFloat(goalRow.meta_receita) || 0;
    } else {
      const { data: profile } = await supabase
        .from('profiles')
        .select('meta_mensal')
        .eq('id', userId)
        .maybeSingle();
      meta_receita = profile != null ? parseFloat(profile.meta_mensal) || 0 : 0;
    }

    const { data: atendMes, error: e1 } = await supabase
      .from('atendimentos')
      .select('valor_total')
      .eq('user_id', userId)
      .gte('data', startOfMonth)
      .lte('data', todayStr);

    if (e1) throw e1;

    const receita_realizada = (atendMes || []).reduce(
      (s, a) => s + parseFloat(a.valor_total || 0),
      0
    );

    const falta_faturar = Math.max(0, meta_receita - receita_realizada);
    const percentual_atingido =
      meta_receita > 0 ? (receita_realizada / meta_receita) * 100 : 0;

    const todayD = new Date(`${todayStr}T12:00:00`);
    const endD = new Date(`${endOfMonthStr}T12:00:00`);
    let dias_restantes = Math.ceil((endD - todayD) / 86400000) + 1;
    if (dias_restantes < 1) dias_restantes = 1;

    const media_diaria_necessaria = falta_faturar / dias_restantes;

    const since90 = new Date(now);
    since90.setDate(since90.getDate() - 90);
    const since90Str = _dateStr(since90);

    const { data: atend90, error: e2 } = await supabase
      .from('atendimentos')
      .select('valor_total')
      .eq('user_id', userId)
      .gte('data', since90Str)
      .lte('data', todayStr);

    if (e2) throw e2;

    const list90 = atend90 || [];
    const sum90 = list90.reduce((s, a) => s + parseFloat(a.valor_total || 0), 0);
    const ticket_medio_historico =
      list90.length > 0 ? sum90 / list90.length : 0;

    let procedimentos_necessarios = 0;
    if (falta_faturar <= 0) {
      procedimentos_necessarios = 0;
    } else if (ticket_medio_historico > 0) {
      procedimentos_necessarios = Math.ceil(falta_faturar / ticket_medio_historico);
    } else {
      procedimentos_necessarios = null;
    }

    const since7 = new Date(now);
    since7.setDate(since7.getDate() - 6);
    const since7Str = _dateStr(since7);

    const { data: atend7, error: e3 } = await supabase
      .from('atendimentos')
      .select('valor_total')
      .eq('user_id', userId)
      .gte('data', since7Str)
      .lte('data', todayStr);

    if (e3) throw e3;

    const sum7 = (atend7 || []).reduce((s, a) => s + parseFloat(a.valor_total || 0), 0);
    const ritmo_atual = sum7 / 7;

    const no_caminho =
      meta_receita <= 0
        ? true
        : falta_faturar <= 0
          ? true
          : ritmo_atual >= media_diaria_necessaria - 0.01;

    let acao_sugerida = '';
    if (meta_receita <= 0) {
      acao_sugerida = '';
    } else if (no_caminho) {
      acao_sugerida = '';
    } else if (procedimentos_necessarios == null) {
      acao_sugerida =
        'Defina ticket médio com histórico de atendimentos ou ajuste a meta para um valor alcançável.';
    } else if (procedimentos_necessarios <= 5) {
      acao_sugerida = `Você precisa de mais ${procedimentos_necessarios} procedimento(s) neste mês — considere abrir agenda nos fins de semana.`;
    } else if (procedimentos_necessarios <= 15) {
      acao_sugerida =
        'Ative clientes inativos: você tem pacientes que não vêm há mais de 60 dias.';
    } else {
      acao_sugerida =
        'Meta muito distante para o tempo restante. Considere revisar a meta ou fazer uma promoção de volume.';
    }

    const baseZeros = {
      meta_receita: 0,
      receita_realizada: 0,
      falta_faturar: 0,
      percentual_atingido: 0,
      dias_restantes,
      media_diaria_necessaria: 0,
      ritmo_atual: 0,
      ticket_medio_historico: 0,
      procedimentos_necessarios: 0,
      no_caminho: true,
      acao_sugerida: '',
    };

    let meta_reserva = null;
    let meta_lucro = null;
    if (goalRow != null) {
      if (goalRow.meta_reserva != null && goalRow.meta_reserva !== '') {
        const mr = parseFloat(goalRow.meta_reserva);
        if (Number.isFinite(mr) && mr >= 0) meta_reserva = mr;
      }
      if (goalRow.meta_lucro != null && goalRow.meta_lucro !== '') {
        const ml = parseFloat(goalRow.meta_lucro);
        if (Number.isFinite(ml) && ml >= 0) meta_lucro = ml;
      }
    }

    let lucro_mes_estimado = null;
    try {
      const outlook = await outlookService.getOutlook(userId, 1);
      const last = outlook.meses && outlook.meses.length ? outlook.meses[outlook.meses.length - 1] : null;
      if (last && Number.isFinite(last.lucro)) {
        lucro_mes_estimado = Math.round(last.lucro * 100) / 100;
      }
    } catch {
      lucro_mes_estimado = null;
    }

    let falta_meta_lucro = null;
    let percentual_meta_lucro = null;
    if (meta_lucro != null && meta_lucro > 0 && lucro_mes_estimado != null) {
      falta_meta_lucro = Math.max(0, Math.round((meta_lucro - lucro_mes_estimado) * 100) / 100);
      percentual_meta_lucro = Math.round((lucro_mes_estimado / meta_lucro) * 1000) / 10;
    }

    if (meta_receita <= 0) {
      return {
        ...baseZeros,
        meta_reserva,
        meta_lucro,
        lucro_mes_estimado,
        falta_meta_lucro,
        percentual_meta_lucro,
        meta_reserva_nota:
          meta_reserva != null
            ? 'A meta de reserva é um objetivo declarado; o app não infere quanto já poupou automaticamente.'
            : null,
      };
    }

    return {
      meta_receita,
      receita_realizada: Math.round(receita_realizada * 100) / 100,
      falta_faturar: Math.round(falta_faturar * 100) / 100,
      percentual_atingido: Math.round(percentual_atingido * 10) / 10,
      dias_restantes,
      media_diaria_necessaria: Math.round(media_diaria_necessaria * 100) / 100,
      ritmo_atual: Math.round(ritmo_atual * 100) / 100,
      ticket_medio_historico: Math.round(ticket_medio_historico * 100) / 100,
      procedimentos_necessarios:
        procedimentos_necessarios == null ? 0 : procedimentos_necessarios,
      no_caminho,
      acao_sugerida,
      meta_reserva,
      meta_lucro,
      lucro_mes_estimado,
      falta_meta_lucro,
      percentual_meta_lucro,
      meta_reserva_nota:
        meta_reserva != null
          ? 'A meta de reserva é um objetivo declarado; o app não infere quanto já poupou automaticamente.'
          : null,
      lucro_meta_nota:
        lucro_mes_estimado != null
          ? 'Lucro do mês (indicativo) usa a mesma base do outlook: receita em atendimentos vs saídas no livro.'
          : null,
    };
  }
}

module.exports = new MetaCaminhoService();
