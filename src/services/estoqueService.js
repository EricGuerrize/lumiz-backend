const supabase = require('../db/supabase');
const transactionController = require('../controllers/transactionController');
const evolutionService = require('./evolutionService');
const copy = require('../copy/estoqueWhatsappCopy');
const { alreadySent, markSent } = require('./reminderSentHelper');

const DIAS_CONSUMO_REFERENCIA = 90;
const MESES_CONSUMO_PADRAO = 3;

function _todayISO() {
  return new Date().toISOString().split('T')[0];
}

function _sinceDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function _tipoLembreteDiario() {
  return `estoque_baixo_${_todayISO()}`;
}

class EstoqueService {
  /**
   * Soma ml de atendimento_procedimentos + saídas manuais no período.
   */
  async _consumoMlNoPeriodo(userId, procedimentoId, days) {
    const sinceStr = _sinceDate(days);

    const { data: atendimentos, error: e1 } = await supabase
      .from('atendimentos')
      .select('id')
      .eq('user_id', userId)
      .gte('data', sinceStr);

    if (e1) {
      console.error('[ESTOQUE] atendimentos consumo:', e1.message);
      return 0;
    }

    const atIds = (atendimentos || []).map((a) => a.id);
    let apSum = 0;
    if (atIds.length) {
      const { data: aps, error: e2 } = await supabase
        .from('atendimento_procedimentos')
        .select('ml_utilizado')
        .eq('procedimento_id', procedimentoId)
        .in('atendimento_id', atIds);

      if (e2) {
        console.error('[ESTOQUE] atendimento_procedimentos consumo:', e2.message);
      } else {
        for (const row of aps || []) {
          apSum += parseFloat(row.ml_utilizado) || 0;
        }
      }
    }

    const sinceStart = new Date(`${sinceStr}T00:00:00.000Z`).toISOString();
    const { data: saidas, error: e3 } = await supabase
      .from('movimentacoes_estoque')
      .select('quantidade')
      .eq('user_id', userId)
      .eq('procedimento_id', procedimentoId)
      .eq('tipo', 'saida')
      .gte('data', sinceStart);

    if (e3) {
      console.error('[ESTOQUE] movimentacoes saida:', e3.message);
      return apSum;
    }

    let saidaSum = 0;
    for (const row of saidas || []) {
      saidaSum += parseFloat(row.quantidade) || 0;
    }

    return apSum + saidaSum;
  }

  async _calcularConsumoMedio(userId, procedimentoId, meses = MESES_CONSUMO_PADRAO) {
    const days = Math.max(1, Math.round(Number(meses) * 30));
    const totalMl = await this._consumoMlNoPeriodo(userId, procedimentoId, days);
    const consumoMedioDiario = totalMl / days;
    return {
      totalMl,
      diasJanela: days,
      consumoMedioDiario,
      consumoMedioMensal: consumoMedioDiario * 30,
    };
  }

  _resolveStatus(estoque, minimo, maximo, totalConsumo90) {
    const min = parseFloat(minimo) || 0;
    const max = parseFloat(maximo) || 0;
    const atual = parseFloat(estoque) || 0;

    if (max > 0 && atual > max) {
      return 'excesso';
    }

    if (!totalConsumo90 || totalConsumo90 <= 0) {
      return 'sem_historico';
    }

    if (min > 0 && atual < min * 0.5) {
      return 'critico';
    }
    if (min > 0 && atual < min) {
      return 'baixo';
    }
    return 'ok';
  }

  async getEstoqueStatus(userId) {
    const { data: rows, error } = await supabase
      .from('procedimentos')
      .select(
        `
        id,
        nome,
        estoque_ml,
        estoque_minimo,
        estoque_maximo,
        unidade,
        custo_material_ml,
        fornecedor_id,
        fornecedores ( id, nome, prazo_medio_dias )
      `
      )
      .eq('user_id', userId)
      .order('nome');

    if (error) throw error;

    const produtos = [];

    for (const r of rows || []) {
      const total90 = await this._consumoMlNoPeriodo(userId, r.id, DIAS_CONSUMO_REFERENCIA);
      const diario90 = total90 / DIAS_CONSUMO_REFERENCIA;
      const consumoMedioMensal = diario90 * 30;

      const estoqueAtual = parseFloat(r.estoque_ml) || 0;
      const estoqueMinimo = parseFloat(r.estoque_minimo) || 0;
      const estoqueMaximo = parseFloat(r.estoque_maximo) || 0;

      let diasSuprimento = null;
      if (diario90 > 0) {
        diasSuprimento = estoqueAtual / diario90;
      }

      const status = this._resolveStatus(estoqueAtual, estoqueMinimo, estoqueMaximo, total90);
      const forn = r.fornecedores;

      produtos.push({
        id: r.id,
        nome: r.nome,
        unidade: r.unidade || 'ml',
        estoqueAtual,
        estoqueMinimo,
        estoqueMaximo: estoqueMaximo || null,
        consumoMedioMensal,
        diasSuprimento,
        status,
        fornecedor: forn
          ? {
              id: forn.id,
              nome: forn.nome,
              prazoMedioDias: forn.prazo_medio_dias ?? 7,
            }
          : null,
      });
    }

    return {
      produtos,
      diasConsumoReferencia: DIAS_CONSUMO_REFERENCIA,
    };
  }

  async getAlertasEstoqueExcesso(userId) {
    const { produtos } = await this.getEstoqueStatus(userId);
    const alertas = produtos.filter((p) => p.status === 'excesso');
    return { alertas, total: alertas.length };
  }

  async getAlertasBaixoEstoque(userId) {
    const { produtos } = await this.getEstoqueStatus(userId);
    const alertas = produtos
      .filter((p) => p.status === 'baixo' || p.status === 'critico')
      .sort((a, b) => {
        if (a.diasSuprimento == null && b.diasSuprimento == null) return 0;
        if (a.diasSuprimento == null) return 1;
        if (b.diasSuprimento == null) return -1;
        return a.diasSuprimento - b.diasSuprimento;
      });
    return { alertas, total: alertas.length };
  }

  async sugerirReposicao(userId, saldoAtualPassado) {
    let saldo = saldoAtualPassado;
    if (saldo == null || !Number.isFinite(Number(saldo))) {
      const balance = await transactionController.getBalance(userId);
      saldo = balance.saldo;
    } else {
      saldo = Number(saldo);
    }

    const { alertas } = await this.getAlertasBaixoEstoque(userId);

    const { data: prows } = await supabase
      .from('procedimentos')
      .select('id, nome, unidade, estoque_ml, custo_material_ml')
      .eq('user_id', userId);

    const byId = new Map((prows || []).map((p) => [p.id, p]));

    const sugestoes = [];

    for (const al of alertas) {
      const meta = byId.get(al.id);
      const custoMl = parseFloat(meta?.custo_material_ml) || 0;

      const total60 = await this._consumoMlNoPeriodo(userId, al.id, 60);
      const estoqueAtual = parseFloat(meta?.estoque_ml) || 0;
      const quantidadeSugerida = Math.max(0, total60 - estoqueAtual);
      const custoEstimado = quantidadeSugerida * custoMl;

      sugestoes.push({
        produto: al.nome,
        procedimentoId: al.id,
        nome: al.nome,
        unidade: al.unidade,
        quantidadeSugerida,
        custoEstimado,
        momento: custoEstimado <= saldo ? 'agora' : 'aguardar',
        status: al.status,
        diasSuprimento: al.diasSuprimento,
        fornecedor: al.fornecedor,
        prazoEntregaDias: al.fornecedor?.prazoMedioDias ?? null,
      });
    }

    return {
      saldoDisponivel: saldo,
      sugestoes,
      total: sugestoes.length,
    };
  }

  async registrarEntrada(userId, payload) {
    const procedimentoId = payload.procedimentoId || payload.procedimento_id;
    const q = Number(payload.quantidade);
    const observacoes = payload.observacoes ?? payload.observacao ?? null;
    const fornecedorId = payload.fornecedorId ?? payload.fornecedor_id ?? null;
    const custoUnitario = payload.custoUnitario ?? payload.custo_unitario ?? null;

    if (!procedimentoId || !Number.isFinite(q) || q <= 0) {
      throw new Error('procedimento_id e quantidade válidos são obrigatórios');
    }

    const { data: proc, error: pe } = await supabase
      .from('procedimentos')
      .select('id, nome, estoque_ml, unidade, user_id')
      .eq('id', procedimentoId)
      .eq('user_id', userId)
      .single();

    if (pe || !proc) throw new Error('Procedimento não encontrado');

    const dataMov = payload.data ? new Date(payload.data).toISOString() : new Date().toISOString();

    const { error: me } = await supabase.from('movimentacoes_estoque').insert({
      user_id: userId,
      procedimento_id: procedimentoId,
      tipo: 'entrada',
      quantidade: q,
      custo_unitario: custoUnitario != null ? Number(custoUnitario) : null,
      fornecedor_id: fornecedorId || null,
      atendimento_id: payload.atendimento_id || null,
      data: dataMov,
      observacoes,
    });

    if (me) throw me;

    const novoEstoque = (parseFloat(proc.estoque_ml) || 0) + q;

    const patch = { estoque_ml: novoEstoque };
    if (fornecedorId) patch.fornecedor_id = fornecedorId;

    const { data: updated, error: ue } = await supabase
      .from('procedimentos')
      .update(patch)
      .eq('id', procedimentoId)
      .eq('user_id', userId)
      .select('estoque_ml, nome, unidade')
      .single();

    if (ue) throw ue;

    return {
      procedimentoId,
      nome: updated.nome,
      quantidade: q,
      estoqueAtual: parseFloat(updated.estoque_ml),
      unidade: updated.unidade || 'ml',
    };
  }

  /**
   * Histórico de compras (entradas de estoque) agregado por fornecedor (PDF §4d).
   * @param {string} userId
   * @param {number} [months=12] janela móvel em meses (1–36)
   */
  async getComprasPorFornecedor(userId, months = 12) {
    const m = Math.min(Math.max(Math.round(Number(months)) || 12, 1), 36);
    const since = new Date();
    since.setMonth(since.getMonth() - m);
    since.setHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();

    const { data: movs, error } = await supabase
      .from('movimentacoes_estoque')
      .select('fornecedor_id, quantidade, custo_unitario, data')
      .eq('user_id', userId)
      .eq('tipo', 'entrada')
      .not('fornecedor_id', 'is', null)
      .gte('data', sinceIso);

    if (error) throw error;

    const agg = new Map();
    for (const row of movs || []) {
      const fid = row.fornecedor_id;
      if (!fid) continue;
      const qtd = parseFloat(row.quantidade) || 0;
      const cu = row.custo_unitario != null ? parseFloat(row.custo_unitario) : null;
      const lineTotal = cu != null && Number.isFinite(cu) ? qtd * cu : null;

      if (!agg.has(fid)) {
        agg.set(fid, {
          fornecedor_id: fid,
          total_gasto: 0,
          linhas_com_custo: 0,
          compras_count: 0,
          ultima_compra: null,
        });
      }
      const a = agg.get(fid);
      a.compras_count += 1;
      if (lineTotal != null && Number.isFinite(lineTotal)) {
        a.total_gasto += lineTotal;
        a.linhas_com_custo += 1;
      }
      const d = row.data ? new Date(row.data).toISOString() : null;
      if (d && (!a.ultima_compra || d > a.ultima_compra)) {
        a.ultima_compra = d.split('T')[0];
      }
    }

    const ids = [...agg.keys()];
    if (!ids.length) {
      return { months: m, fornecedores: [] };
    }

    const { data: forns, error: fe } = await supabase
      .from('fornecedores')
      .select('id, nome')
      .eq('user_id', userId)
      .in('id', ids);

    if (fe) throw fe;
    const nomeById = new Map((forns || []).map((f) => [f.id, f.nome]));

    const fornecedores = [...agg.values()]
      .map((a) => ({
        fornecedor_id: a.fornecedor_id,
        nome: nomeById.get(a.fornecedor_id) || 'Fornecedor',
        total_gasto: parseFloat(a.total_gasto.toFixed(2)),
        total_gasto_completo: a.linhas_com_custo === a.compras_count,
        compras_count: a.compras_count,
        ultima_compra: a.ultima_compra,
      }))
      .sort((x, y) => y.total_gasto - x.total_gasto || y.compras_count - x.compras_count);

    const anyIncomplete = fornecedores.some((f) => !f.total_gasto_completo);
    return {
      months: m,
      fornecedores,
      ...(anyIncomplete
        ? {
            nota:
              'total_gasto soma apenas entradas com custo_unitario preenchido; movimentações sem custo entram em compras_count e em ultima_compra mas não no valor.',
          }
        : {}),
    };
  }

  async findProcedimentoByNome(userId, nomeBusca) {
    const termo = String(nomeBusca || '').trim();
    if (!termo) return null;

    const { data: exato, error: e1 } = await supabase
      .from('procedimentos')
      .select('id, nome, estoque_ml, unidade')
      .eq('user_id', userId)
      .ilike('nome', termo)
      .limit(1)
      .maybeSingle();

    if (!e1 && exato) return exato;

    const { data: parcial, error: e2 } = await supabase
      .from('procedimentos')
      .select('id, nome, estoque_ml, unidade')
      .eq('user_id', userId)
      .ilike('nome', `%${termo}%`)
      .limit(1)
      .maybeSingle();

    if (e2) return null;
    return parcial || null;
  }

  async checkAndAlertEstoqueBaixo() {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, telefone')
      .not('telefone', 'is', null);

    if (error) {
      console.error('[ESTOQUE] perfis:', error.message);
      return [];
    }

    const tipoDia = _tipoLembreteDiario();
    const sent = [];

    for (const profile of profiles || []) {
      try {
        const { alertas } = await this.getAlertasBaixoEstoque(profile.id);
        const pendentes = [];
        for (const a of alertas) {
          const ja = await alreadySent(a.id, tipoDia);
          if (!ja) pendentes.push(a);
        }

        if (!pendentes.length) continue;

        let message;
        if (pendentes.length === 1 && pendentes[0].status === 'critico') {
          message = copy.alertaEstoqueCritico(pendentes[0]);
        } else {
          message = copy.alertaEstoqueBaixo(pendentes);
        }

        await evolutionService.sendMessage(profile.telefone, message);

        for (const a of pendentes) {
          await markSent(profile.id, a.id, tipoDia);
          sent.push({ user_id: profile.id, procedimento_id: a.id });
        }
      } catch (err) {
        console.error(`[ESTOQUE] alerta ${profile.id}:`, err.message);
      }
    }

    console.log(`[ESTOQUE] ${sent.length} alertas de estoque registrados`);
    return sent;
  }

  /**
   * Alerta diário (dedupe) quando estoque > estoque_maximo definido.
   */
  async checkAndAlertEstoqueExcesso() {
    const tipoDia = `estoque_excesso_${_todayISO()}`;
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, telefone')
      .not('telefone', 'is', null);

    if (error) {
      console.error('[ESTOQUE] excesso perfis:', error.message);
      return [];
    }

    const sent = [];
    for (const profile of profiles || []) {
      try {
        const { alertas } = await this.getAlertasEstoqueExcesso(profile.id);
        const pendentes = [];
        for (const a of alertas) {
          const ja = await alreadySent(a.id, tipoDia);
          if (!ja) pendentes.push(a);
        }
        if (!pendentes.length) continue;

        const message = copy.alertaEstoqueExcesso(pendentes);
        await evolutionService.sendMessage(profile.telefone, message);
        for (const a of pendentes) {
          await markSent(profile.id, a.id, tipoDia);
          sent.push({ user_id: profile.id, procedimento_id: a.id });
        }
      } catch (err) {
        console.error(`[ESTOQUE] excesso ${profile.id}:`, err.message);
      }
    }
    console.log(`[ESTOQUE] ${sent.length} alertas de excesso registrados`);
    return sent;
  }
}

module.exports = new EstoqueService();
