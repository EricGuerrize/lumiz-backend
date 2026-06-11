const {
  FINANCIAL_IMPORT_CONFIRM_FOOTER,
  SPREADSHEET_KIND_CHOICE_FOOTER,
} = require('./whatsappMenuMarkers');

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function previewImport(result = {}) {
  const summary = result.summary || {};
  const preview = Array.isArray(result.preview) ? result.preview : [];
  const inconsistencias = Array.isArray(result.inconsistencias) ? result.inconsistencias : [];
  const filename = result.filename ? `\nArquivo: _${result.filename}_` : '';

  const lines = [
    '💼 *Importação financeira — prévia*',
    filename,
    '',
    `Linhas válidas: *${summary.valid_rows ?? preview.length}*`,
    `Com problema: *${summary.invalid_rows ?? inconsistencias.length}*`,
    `Receitas: *${summary.receitas_count ?? 0}* (${formatCurrency(summary.receitas_total)})`,
    `Despesas: *${summary.despesas_count ?? 0}* (${formatCurrency(summary.despesas_total)})`,
    '',
  ];

  if (preview.length) {
    lines.push('*Amostra:*');
    preview.slice(0, 6).forEach((row) => {
      const tipo = row.tipo === 'saida' ? 'Despesa' : 'Receita';
      lines.push(`• ${tipo} ${formatCurrency(row.valor)} em ${row.data || 'data não identificada'}`);
    });
    if (preview.length > 6) lines.push(`… e mais ${preview.length - 6} linha(s)`);
    lines.push('');
  }

  if (inconsistencias.length) {
    lines.push(`⚠️ ${inconsistencias.length} linha(s) com inconsistência (data/valor inválidos).`);
    lines.push('');
  }

  lines.push(FINANCIAL_IMPORT_CONFIRM_FOOTER);
  return lines.filter((line) => line !== undefined).join('\n');
}

function importConfirmed(summary = {}) {
  const receitas = summary.inserted_atendimentos || 0;
  const despesas = summary.inserted_contas_pagar || 0;
  return [
    '✅ *Importação financeira concluída!*',
    '',
    `Receitas importadas: *${receitas}*`,
    `Despesas importadas: *${despesas}*`,
    '',
    'Se algo ficou errado, você pode desfazer o lote pelo dashboard.',
  ].join('\n');
}

function importFailed(message) {
  return [
    '❌ Não consegui importar as movimentações financeiras.',
    message ? `\n${message}` : '',
    '',
    'Tente enviar a planilha novamente.',
  ].join('\n');
}

function importCancelled() {
  return 'Importação financeira cancelada. Pode enviar outra planilha quando quiser.';
}

function askKindChoice({ filename, estoqueSummary = {}, financeiroSummary = {} } = {}) {
  return [
    '🤔 *Planilha ambígua detectada*',
    filename ? `Arquivo: _${filename}_` : '',
    '',
    `Detectei sinais de *estoque* (${estoqueSummary.valid_rows ?? 0} linha(s) válida(s)).`,
    `Também detectei sinais de *financeiro* (${financeiroSummary.valid_rows ?? 0} linha(s) válida(s)).`,
    '',
    SPREADSHEET_KIND_CHOICE_FOOTER,
  ].filter(Boolean).join('\n');
}

function kindChoiceCancelled() {
  return 'Escolha do tipo de planilha cancelada. Envie novamente quando quiser.';
}

module.exports = {
  previewImport,
  importConfirmed,
  importFailed,
  importCancelled,
  askKindChoice,
  kindChoiceCancelled,
};
