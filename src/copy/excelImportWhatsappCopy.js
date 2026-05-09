function importConfirmed(summary = {}) {
  const receitas = summary.inserted_atendimentos || 0;
  const despesas = summary.inserted_contas_pagar || 0;
  const receitasTotal = Number(summary.receitas_total || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  const despesasTotal = Number(summary.despesas_total || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  return [
    'Importação concluída ✅',
    '',
    `Importei ${receitas} receita(s) (${receitasTotal}) e ${despesas} despesa(s) (${despesasTotal}).`,
    'Se algo ficou errado, você pode desfazer o lote pelo dashboard.',
  ].join('\n');
}

module.exports = {
  importConfirmed,
};
