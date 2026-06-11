/**
 * Copy WhatsApp para fluxo de Supplier Documents (NF, Boleto, Comprovante).
 * Onda 2.B do plano backend completo.
 */

const { formatarMoeda } = require('../utils/currency');
const { SUPPLIER_DOC_CONFIRM_FOOTER } = require('./whatsappMenuMarkers');

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

function formatItemPreview(item) {
  const descricao = item?.descricao || item?.nome || 'Item';
  const quantidade = Number(item?.quantidade) || 1;
  const unidade = item?.unidade ? ` ${item.unidade}` : '';
  const valor = item?.valor_total || item?.valor_unitario;
  const valorLabel = valor ? ` · ${formatarMoeda(valor)}` : '';
  return `• ${descricao} — ${quantidade}${unidade}${valorLabel}`;
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
    linhas.push(`📦 Itens detectados (${parsed.itens.length}):`);
    linhas.push(parsed.itens.slice(0, 3).map(formatItemPreview).join('\n'));
    if (parsed.itens.length > 3) {
      linhas.push(`• …e mais ${parsed.itens.length - 3} item(ns)`);
    }
    linhas.push('A confirmação registra apenas o financeiro. O estoque será atualizado em uma etapa separada.');
  }

  linhas.push('');
  linhas.push('Posso lançar como conta a pagar?');
  linhas.push(SUPPLIER_DOC_CONFIRM_FOOTER);

  return linhas.join('\n');
}

/**
 * Mensagem de sucesso após salvar contas a pagar.
 */
function supplierDocConfirmado({ contasCount, valorTotal, itensDetectados, fornecedorNome }) {
  const linhas = [];
  linhas.push(`✅ *${contasCount > 1 ? `${contasCount} parcelas registradas` : 'Conta a pagar registrada'}!*`);
  linhas.push('');
  linhas.push(`🏢 ${fornecedorNome || 'Fornecedor'}`);
  linhas.push(`💰 ${formatarMoeda(valorTotal)}`);

  if (itensDetectados > 0) {
    linhas.push('');
    linhas.push(`📦 ${itensDetectados} item(ns) detectado(s), mas o estoque não foi alterado automaticamente.`);
  }
  linhas.push('');
  linhas.push('Me diz "contas a pagar" pra ver o calendário de vencimentos.');
  return linhas.join('\n');
}

function supplierDocCancelado() {
  return '❌ *Documento descartado.* Nada foi registrado.\n\nSe quiser registrar manualmente, é só me mandar "Custo R$ X fornecedor Y".';
}

module.exports = {
  TIPO_NOME,
  confirmacaoSupplierDoc,
  supplierDocConfirmado,
  supplierDocCancelado
};
