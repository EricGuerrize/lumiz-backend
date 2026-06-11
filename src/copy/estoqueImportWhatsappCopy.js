const {
  INVENTORY_IMPORT_CONFIRM_FOOTER,
  INVENTORY_IMPORT_UNDO_FOOTER,
} = require('./whatsappMenuMarkers');

function formatItemLine(item) {
  const qty = item.quantidade != null ? item.quantidade : '?';
  const unit = item.unidade || 'unidade';
  const extras = [];
  if (item.validade) extras.push(`val. ${item.validade}`);
  if (item.custo_unitario != null) {
    extras.push(`custo ${Number(item.custo_unitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
  }
  const suffix = extras.length ? ` (${extras.join(', ')})` : '';
  return `• ${item.nome} — ${qty} ${unit}${suffix}`;
}

function previewImport(result = {}) {
  const summary = result.summary || {};
  const preview = Array.isArray(result.preview) ? result.preview : [];
  const inconsistencias = Array.isArray(result.inconsistencias) ? result.inconsistencias : [];
  const filename = result.filename ? `\nArquivo: _${result.filename}_` : '';

  const lines = [
    '📦 *Importação de estoque — prévia*',
    filename,
    '',
    `Linhas válidas: *${summary.valid_rows ?? preview.length}*`,
    `Com problema: *${summary.invalid_rows ?? inconsistencias.length}*`,
    '',
  ];

  if (preview.length) {
    lines.push('*Amostra dos itens:*');
    preview.slice(0, 8).forEach((item) => lines.push(formatItemLine(item)));
    if (preview.length > 8) lines.push(`… e mais ${preview.length - 8} item(ns)`);
    lines.push('');
  }

  if (inconsistencias.length) {
    lines.push(`⚠️ ${inconsistencias.length} linha(s) com inconsistência (nome ou quantidade inválidos).`);
    lines.push('');
  }

  lines.push(INVENTORY_IMPORT_CONFIRM_FOOTER);

  return lines.filter((line) => line !== undefined).join('\n');
}

function importConfirmed(result = {}, options = {}) {
  const applied = result.applied?.length ?? result.summary?.applied_count ?? 0;
  const failed = result.failed?.length ?? result.summary?.failed_count ?? 0;

  const lines = [
    '✅ *Estoque importado!*',
    '',
    `Itens salvos: *${applied}*`,
  ];

  if (failed > 0) {
    lines.push(`Não importados: *${failed}*`);
  }

  lines.push('');
  lines.push('Você pode conferir o saldo com _consultar estoque_.');
  if (options.offerUndo) {
    lines.push(INVENTORY_IMPORT_UNDO_FOOTER);
  } else {
    lines.push('Se precisar, também dá para desfazer pelo dashboard.');
  }

  return lines.join('\n');
}

function importFailed(message) {
  return [
    '❌ Não consegui importar o estoque.',
    message ? `\n${message}` : '',
    '',
    'Tente enviar a planilha novamente ou configure manualmente com _configurar estoque_.',
  ].join('\n');
}

function importCancelled() {
  return 'Importação de estoque cancelada. Pode enviar outra planilha quando quiser.';
}

function importUndoConfirmed() {
  return '↩️ Importação desfeita com sucesso. Se quiser, envie a planilha novamente.';
}

function importUndoCancelled() {
  return 'Perfeito, mantive a importação no estoque.';
}

function importUndoPrompt() {
  return [
    'Quer desfazer essa importação?',
    '',
    INVENTORY_IMPORT_UNDO_FOOTER,
  ].join('\n');
}

module.exports = {
  previewImport,
  importConfirmed,
  importFailed,
  importCancelled,
  importUndoConfirmed,
  importUndoCancelled,
  importUndoPrompt,
};
