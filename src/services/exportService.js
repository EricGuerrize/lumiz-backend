const pdfService = require('./pdfService');
const transactionController = require('../controllers/transactionController');

class ExportService {
  _parseMonth(monthStr) {
    if (!monthStr) {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }
    const [y, m] = monthStr.split('-').map(Number);
    return { year: y, month: m };
  }

  async exportPDF(userId, monthStr) {
    const { year, month } = this._parseMonth(monthStr);
    return pdfService.generateMonthlyReportPDF(userId, year, month);
  }

  async exportCSV(userId, monthStr) {
    const { year, month } = this._parseMonth(monthStr);
    const report = await transactionController.getMonthlyReport(userId, year, month);

    const rows = [
      ['tipo', 'descricao', 'valor', 'data', 'forma_pagamento', 'categoria'],
    ];

    for (const t of report.transactions || []) {
      rows.push([
        t.tipo || '',
        (t.descricao || '').replace(/,/g, ' '),
        t.valor || 0,
        t.data_evento || t.data_recebimento || '',
        t.forma_pagamento || '',
        t.categoria || '',
      ]);
    }

    // Summary footer
    rows.push([]);
    rows.push(['TOTAL ENTRADAS', '', report.entradas || 0, '', '', '']);
    rows.push(['TOTAL SAIDAS', '', report.saidas || 0, '', '', '']);
    rows.push(['LUCRO', '', (report.entradas || 0) - (report.saidas || 0), '', '', '']);

    return rows.map(r => r.join(',')).join('\n');
  }
}

module.exports = new ExportService();
