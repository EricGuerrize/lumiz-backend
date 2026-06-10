const supabase = require('../db/supabase');
const transactionController = require('../controllers/transactionController');
const outboundMessageService = require('./outboundMessageService');
const copy = require('../copy/monthlyReportWhatsappCopy');
const emailReportService = require('./emailReportService');

/**
 * Envia resumo do mês civil anterior a quem tem `reporte_mensal_whatsapp` ativo.
 * @returns {Promise<{ enviados: number, erros: number, detalhes: object[] }>}
 */
async function deliverPreviousMonthSummaries() {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, telefone, nome_completo')
    .eq('reporte_mensal_whatsapp', true)
    .not('telefone', 'is', null);

  if (error) {
    console.error('[MONTHLY_REPORT] Erro ao listar perfis:', error.message);
    return { enviados: 0, erros: 0, detalhes: [] };
  }

  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prev.getFullYear();
  const month = prev.getMonth() + 1;

  const detalhes = [];
  let enviados = 0;
  let erros = 0;

  for (const p of profiles || []) {
    try {
      const report = await transactionController.getMonthlyReport(p.id, year, month);
      const msg = copy.resumoMensalAnterior({ year, month }, report);
      await outboundMessageService.sendText(p.telefone, msg);
      const emailStatus = await emailReportService.sendMonthlyReportEmail(
        p.id,
        `${year}-${String(month).padStart(2, '0')}`
      );
      enviados += 1;
      detalhes.push({ user_id: p.id, ok: true, email: emailStatus });
    } catch (e) {
      erros += 1;
      console.error(`[MONTHLY_REPORT] Falha user ${p.id}:`, e.message);
      detalhes.push({ user_id: p.id, ok: false, error: e.message });
    }
  }

  console.log(`[MONTHLY_REPORT] Enviados=${enviados} erros=${erros} (mês ref ${year}-${month})`);
  return { enviados, erros, mes_referencia: { year, month }, detalhes };
}

module.exports = { deliverPreviousMonthSummaries };
