const pdfQueueService = require('../../services/pdfQueueService');
const pdfService = require('../../services/pdfService');
const excelService = require('../../services/excelService');
const evolutionService = require('../../services/evolutionService');

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
      await evolutionService.sendMessage(
        phone,
        'Gerando seu relatório em PDF...\n\nIsso pode levar alguns segundos!'
      );

      const now = new Date();
      const year = dados?.ano || now.getFullYear();
      const month = dados?.mes || now.getMonth() + 1;

      const pdfBuffer = await pdfService.generateMonthlyReportPDF(user.id, year, month);
      const base64Pdf = pdfBuffer.toString('base64');
      const mesNome = now.toLocaleDateString('pt-BR', { month: 'long' });
      const fileName = `Relatorio_${mesNome}_${year}.pdf`;

      await evolutionService.sendMessage(
        phone,
        `✅ *Relatório gerado!*\n\nEnviando PDF...`
      );

      // Envia PDF via Evolution API
      await evolutionService.sendMedia(phone, base64Pdf, 'application/pdf', fileName);

      return null; // Já enviou via media
    } catch (error) {
      console.error('[EXPORT] Erro ao exportar PDF:', error);
      await evolutionService.sendMessage(
        phone,
        '❌ Não consegui gerar o PDF agora.\n\nTente novamente em alguns instantes.'
      );
      return null;
    }
  }

  /**
   * Exporta dados em Excel
   */
  async handleExportDataExcel(user, phone, dados, formato = 'excel') {
    try {
      await evolutionService.sendMessage(
        phone,
        `Gerando sua planilha ${formato.toUpperCase()}...\n\nIsso pode levar alguns segundos!`
      );

      const now = new Date();
      const year = dados?.ano || now.getFullYear();
      const month = dados?.mes || now.getMonth() + 1;

      const excelBuffer = await excelService.generateMonthlyExcel(user.id, year, month);
      const base64Excel = excelBuffer.toString('base64');
      const mesNome = now.toLocaleDateString('pt-BR', { month: 'long' });
      const extension = formato === 'csv' ? 'csv' : 'xlsx';
      const fileName = `Relatorio_${mesNome}_${year}.${extension}`;
      const mimeType = formato === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      await evolutionService.sendMessage(
        phone,
        `✅ *Planilha gerada!*\n\nEnviando arquivo...`
      );

      await evolutionService.sendMedia(phone, base64Excel, mimeType, fileName);

      return null; // Já enviou via media
    } catch (error) {
      console.error('[EXPORT] Erro ao exportar planilha:', error);
      await evolutionService.sendMessage(
        phone,
        '❌ Não consegui gerar a planilha agora.\n\nTente novamente em alguns instantes.'
      );
      return null;
    }
  }
}

module.exports = ExportHandler;

