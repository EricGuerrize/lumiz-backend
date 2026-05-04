/**
 * Resumo mensal automático (WhatsApp) — texto curto; detalhe no dashboard.
 * @param {{ year: number, month: number }} ref
 * @param {{ entradas?: number, saidas?: number }} report
 */
function resumoMensalAnterior(ref, report) {
  const ent = parseFloat(report?.entradas) || 0;
  const sai = parseFloat(report?.saidas) || 0;
  const lucro = ent - sai;
  const mesNome = new Date(ref.year, ref.month - 1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  const lucroStr = lucro.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const entStr = ent.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const saiStr = sai.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    `Lumiz — resumo de ${mesNome}\n` +
    `Receitas: R$ ${entStr}\n` +
    `Despesas: R$ ${saiStr}\n` +
    `Resultado (livro): R$ ${lucroStr}\n` +
    `Abra o dashboard para relatório completo e exportação.`
  );
}

module.exports = { resumoMensalAnterior };
