const pdfService = require('../../services/pdfService');
const excelService = require('../../services/excelService');
const outboundMessageService = require('../../services/outboundMessageService');
const exportCopy = require('../../copy/exportWhatsappCopy');

/**
 * Handler para exportação de dados (PDF, Excel)
 */
class ExportHandler {
  /**
   * Processa exportação de dados
   */
  async handleExportData(user, phone, dados = {}) {
    const formato = dados?.formato || 'pdf';

    if (formato === 'excel' || formato === 'csv') {
      return await this.handleExportDataExcel(user, phone, dados, formato);
    }

    return await this.handleExportDataPDF(user, phone, dados);
  }

  /**
   * Exporta dados em PDF
   */
  async handleExportDataPDF(user, phone, dados = {}) {
    try {
      await outboundMessageService.sendText(phone, exportCopy.generatingPdf(), {
        messageType: 'export_pdf_status',
        source: 'export_handler'
      });

      const now = new Date();
      const year = dados?.ano || now.getFullYear();
      const month = dados?.mes || now.getMonth() + 1;

      const pdfBuffer = await pdfService.generateMonthlyReportPDF(user.id, year, month);
      const mesNome = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
      const fileName = `Relatorio_${mesNome}_${year}.pdf`;

      await outboundMessageService.sendText(phone, exportCopy.pdfReadySending(), {
        messageType: 'export_pdf_status',
        source: 'export_handler'
      });

      await outboundMessageService.sendDocument(phone, pdfBuffer, fileName, 'application/pdf', {
        messageType: 'export_pdf',
        source: 'export_handler'
      });

      return exportCopy.pdfSent();
    } catch (error) {
      console.error('[EXPORT] Erro ao exportar PDF:', error);
      return exportCopy.pdfFailed();
    }
  }

  /**
   * Exporta dados em Excel
   */
  async handleExportDataExcel(user, phone, dados, formato = 'excel') {
    try {
      await outboundMessageService.sendText(phone, exportCopy.generatingSpreadsheet(formato), {
        messageType: 'export_spreadsheet_status',
        source: 'export_handler'
      });

      const now = new Date();
      const year = dados?.ano || now.getFullYear();
      const month = dados?.mes || now.getMonth() + 1;

      let excelBuffer;
      if (formato === 'csv') {
        excelBuffer = await excelService.generateCSVReport(user.id, year, month);
      } else {
        excelBuffer = await excelService.generateExcelReport(user.id, year, month);
      }
      const mesNome = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
      const extension = formato === 'csv' ? 'csv' : 'xlsx';
      const fileName = `Relatorio_${mesNome}_${year}.${extension}`;
      const mimeType = formato === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      await outboundMessageService.sendText(phone, exportCopy.spreadsheetReadySending(), {
        messageType: 'export_spreadsheet_status',
        source: 'export_handler'
      });

      await outboundMessageService.sendDocument(phone, excelBuffer, fileName, mimeType, {
        messageType: 'export_spreadsheet',
        source: 'export_handler'
      });

      return exportCopy.spreadsheetSent(formato);
    } catch (error) {
      console.error('[EXPORT] Erro ao exportar planilha:', error);
      return exportCopy.spreadsheetFailed();
    }
  }
}

module.exports = ExportHandler;
