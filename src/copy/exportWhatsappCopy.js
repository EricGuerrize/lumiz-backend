/**
 * Fase 17 — Copies de exportação WhatsApp.
 * Centraliza mensagens usadas ao gerar relatórios PDF/Excel pelo bot.
 */

function generatingPdf() {
  return 'Gerando seu relatório em PDF. Isso pode levar alguns segundos.';
}

function pdfReadySending() {
  return 'Relatório gerado. Enviando o PDF agora.';
}

function pdfSent() {
  return '✅ Relatório em PDF enviado.';
}

function pdfFailed() {
  return 'Não consegui gerar ou enviar o PDF agora.\n\nTente novamente em alguns instantes. Se continuar falhando, use "relatório" para ver o resumo por texto.';
}

function generatingSpreadsheet(format = 'EXCEL') {
  return `Gerando sua planilha ${String(format).toUpperCase()}. Isso pode levar alguns segundos.`;
}

function spreadsheetReadySending() {
  return 'Planilha gerada. Enviando o arquivo agora.';
}

function spreadsheetSent(format = 'arquivo') {
  return `✅ ${String(format).toUpperCase()} enviado.`;
}

function spreadsheetFailed() {
  return 'Não consegui gerar ou enviar a planilha agora.\n\nTente novamente em alguns instantes.';
}

module.exports = {
  generatingPdf,
  pdfReadySending,
  pdfSent,
  pdfFailed,
  generatingSpreadsheet,
  spreadsheetReadySending,
  spreadsheetSent,
  spreadsheetFailed
};
