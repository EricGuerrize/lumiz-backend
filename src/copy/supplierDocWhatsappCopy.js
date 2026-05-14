/**
 * Copy WhatsApp para fluxo de Supplier Documents (NF, Boleto, Comprovante).
 * Onda 2.B do plano backend completo.
 */

const { formatarMoeda } = require('../utils/currency');

const TIPO_NOME = {
  nf: 'NOTA FISCAL',
  boleto: 'BOLETO',
  comprovante: 'COMPROVANTE',
  outro: 'DOCUMENTO'
};

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    if (String(dateStr).includes('-')) {
      const [ano, mes, dia] = String(dateStr).split('-');
      return `${dia}/${mes}`;
    }
  } catch (_) { /* ignore */ }
  return String(dateStr);
}

/**
 * Mensagem inicial pedindo confirmação após detectar NF/boleto.
 *
 * @param {Object} parsed - output do supplierDocumentService.fromDocumentResult
 * @param {Object} options
 * @param {boolean} [options.isLowConfidence]
 */
function confirmacaoSupplierDoc(parsed, options = {}) {
  const tipo = TIPO_NOME[parsed?.tipo] || 'DOCUMENTO';
  const fornecedorNome = parsed?.fornecedor?.nome || 'fornecedor não identificado';
  const cnpj = parsed?.fornecedor?.cnpj ? ` (CNPJ ${parsed.fornecedor.cnpj})` : '';
  const valorTotal = parsed?.valor_total ? formatarMoeda(parsed.valor_total) : 'valor desconhecido';
  const totalParcelas = Array.isArray(parsed?.vencimentos) ? parsed.vencimentos.length : 1;

  const linhas = [];
  if (options.isLowConfidence) {
    linhas.push('🤔 *Não tenho 100% de certeza, confere por favor:*\n');
  }
  linhas.push(`📄 *${tipo}*\n`);
  linhas.push(`🏢 ${fornecedorNome}${cnpj}`);
  linhas.push(`💰 *${valorTotal}*${totalParcelas > 1 ? ` em ${totalParcelas}x` : ''}`);
  if (parsed?.category) {
    const categoryLine = parsed?.category_trigger
      ? `📂 ${parsed.category} · ${fornecedorNome}`
      : `📂 ${parsed.category}`;
    linhas.push(categoryLine);
  }

  if (totalParcelas > 1 && Array.isArray(parsed?.vencimentos)) {
    const previewParcelas = parsed.vencimentos.slice(0, 4).map((v, idx) => {
      const dataLabel = formatDate(v.data) || '—';
      return `   ${idx + 1}/${totalParcelas} ${formatarMoeda(v.valor)} · venc. ${dataLabel}`;
    }).join('\n');
    linhas.push(previewParcelas);
    if (parsed.vencimentos.length > 4) {
      linhas.push(`   …e mais ${parsed.vencimentos.length - 4} parcela(s).`);
    }
  } else if (parsed?.vencimentos?.[0]?.data) {
    linhas.push(`📅 Vencimento ${formatDate(parsed.vencimentos[0].data)}`);
  }

  if (Array.isArray(parsed?.itens) && parsed.itens.length > 0) {
    linhas.push('');
    linhas.push(`📦 ${parsed.itens.length} item(ns) detectado(s) na nota — vou tentar atualizar o estoque após confirmar.`);
  }

  linhas.push('');
  linhas.push('Posso lançar como conta a pagar? (responde *sim* ou *não*)');

  return linhas.join('\n');
}

/**
 * Mensagem de sucesso após salvar contas + estoque.
 */
function supplierDocConfirmado({ contasCount, valorTotal, estoqueAplicados, estoquePendentes, fornecedorNome }) {
  const linhas = [];
  linhas.push(`✅ *${contasCount > 1 ? `${contasCount} parcelas registradas` : 'Conta a pagar registrada'}!*`);
  linhas.push('');
  linhas.push(`🏢 ${fornecedorNome || 'Fornecedor'}`);
  linhas.push(`💰 ${formatarMoeda(valorTotal)}`);

  if (estoqueAplicados > 0) {
    linhas.push('');
    linhas.push(`📦 ${estoqueAplicados} item(ns) entraram no estoque automaticamente.`);
  }
  if (estoquePendentes > 0) {
    linhas.push(`⚠️ ${estoquePendentes} item(ns) ficaram pendentes de match — confirme no painel.`);
  }
  linhas.push('');
  linhas.push('Me diz "contas a pagar" pra ver o calendário de vencimentos.');
  return linhas.join('\n');
}

function supplierDocCancelado() {
  return '❌ *Documento descartado.*\n\nSe quiser registrar manualmente, é só me mandar "Custo R$ X fornecedor Y".';
}

module.exports = {
  TIPO_NOME,
  confirmacaoSupplierDoc,
  supplierDocConfirmado,
  supplierDocCancelado
};
