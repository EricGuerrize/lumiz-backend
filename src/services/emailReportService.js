const supabase = require('../db/supabase');
const exportService = require('./exportService');
const transactionController = require('../controllers/transactionController');
const { alreadySent, markSent } = require('./reminderSentHelper');

function _resolveMonth(monthStr) {
  if (monthStr && /^\d{4}-\d{2}$/.test(String(monthStr))) return String(monthStr);
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function _monthNamePt(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
}

class EmailReportService {
  async sendMonthlyReportEmail(userId, monthStr) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn('[EMAIL_REPORT] RESEND_API_KEY ausente; pulando envio.');
      return { skipped: true, reason: 'missing_api_key' };
    }

    const monthRef = _resolveMonth(monthStr);
    const dedupeKey = `email_relatorio_${monthRef}`;
    const jaEnviado = await alreadySent(userId, dedupeKey);
    if (jaEnviado) return { skipped: true, reason: 'already_sent' };

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, nome_clinica')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!profile?.email) return { skipped: true, reason: 'no_email' };

    const pdfBuffer = await exportService.exportPDF(userId, monthRef);
    const [year, month] = monthRef.split('-').map(Number);
    const report = await transactionController.getMonthlyReport(userId, year, month);
    const entradas = parseFloat(report?.entradas || 0);
    const saidas = parseFloat(report?.saidas || 0);
    const lucro = entradas - saidas;
    const margem = entradas > 0 ? (lucro / entradas) * 100 : 0;

    const { Resend } = require('resend');
    const resend = new Resend(apiKey);
    const monthName = _monthNamePt(monthRef);
    const clinica = profile.nome_clinica || 'sua clínica';

    await resend.emails.send({
      from: 'Lumiz <relatorios@lumiz.com.br>',
      to: profile.email,
      subject: `Relatório Financeiro ${monthName} — ${clinica}`,
      html: `
        <h2>Relatório financeiro - ${monthName}</h2>
        <p><strong>Receitas:</strong> R$ ${entradas.toFixed(2)}</p>
        <p><strong>Despesas:</strong> R$ ${saidas.toFixed(2)}</p>
        <p><strong>Lucro:</strong> R$ ${lucro.toFixed(2)}</p>
        <p><strong>Margem:</strong> ${margem.toFixed(1)}%</p>
      `,
      attachments: [
        {
          filename: `relatorio-${monthRef}.pdf`,
          content: Buffer.from(pdfBuffer).toString('base64'),
        },
      ],
    });

    await markSent(userId, userId, dedupeKey);
    return { success: true, month: monthRef, to: profile.email };
  }
}

module.exports = new EmailReportService();
