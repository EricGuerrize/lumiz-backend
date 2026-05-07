const { formatarMoeda } = require('../utils/currency');

/**
 * Onda 3.C — Copy WhatsApp Alter.
 *
 * Centraliza mensagens semanais e gatilhos relacionados a recebíveis,
 * antecipação e cobertura. Mantém português brasileiro coloquial,
 * em linha com o resto do app.
 */

function _fmt(valor) {
  return formatarMoeda(valor || 0);
}

function insightSemanal({ livre, comprometido, antecipado, recomendacao, simulacao }) {
  const linhas = [];
  linhas.push('📊 *Relatório Alter — sua agenda de recebíveis*');
  linhas.push('');
  linhas.push(`💚 Livre: ${_fmt(livre)}`);
  if (comprometido > 0) linhas.push(`🤝 Comprometido: ${_fmt(comprometido)}`);
  if (antecipado > 0) linhas.push(`⚡ Já antecipado: ${_fmt(antecipado)}`);
  linhas.push('');

  if (recomendacao?.deve_antecipar) {
    linhas.push(`⚠️ *Sugestão*: antecipar ${_fmt(recomendacao.valor_alvo)}`);
    linhas.push(`(horizonte ${recomendacao.horizonte_dias} dias)`);
    if (simulacao?.taxa_efetiva_pct != null) {
      const taxaPct = (simulacao.taxa_efetiva_pct * 100).toFixed(2);
      linhas.push(`Custo estimado: ${_fmt(simulacao.custo_antecipacao)} (taxa ~${taxaPct}%)`);
    }
    linhas.push('');
    linhas.push(recomendacao.motivo || 'Saldo previsto fica negativo no período.');
  } else {
    linhas.push('✅ Sem necessidade de antecipar — saldo está saudável.');
  }

  linhas.push('');
  linhas.push('Quer rodar a simulação? Acessa o dashboard ou me chama aqui.');
  return linhas.join('\n');
}

function pagarFornecedorSugestao({ fornecedorNome, total, cobertura }) {
  const linhas = [];
  linhas.push('💡 *Pagar fornecedor com recebível*');
  linhas.push('');
  linhas.push(`Fornecedor: ${fornecedorNome || 'sem nome'}`);
  linhas.push(`Total a pagar: ${_fmt(total)}`);
  linhas.push('');
  if (cobertura.cobre_sem_antecipacao) {
    linhas.push(`✅ Recebíveis livres já cobrem (${_fmt(cobertura.recebiveis_livres_valor)}).`);
    linhas.push('Quer comprometer esses recebíveis? Responda *1* para sim, *2* para não.');
  } else {
    linhas.push(`⚠️ Cobre só parcial: ${_fmt(cobertura.recebiveis_livres_valor)}`);
    linhas.push(`Gap: ${_fmt(cobertura.gap)}`);
    if (cobertura.antecipacao_sugerida?.valor_liquido_recebido) {
      linhas.push('');
      linhas.push(`Antecipação spot pode cobrir: ${_fmt(cobertura.antecipacao_sugerida.valor_liquido_recebido)} líquidos`);
      linhas.push(`Custo: ${_fmt(cobertura.antecipacao_sugerida.custo_antecipacao)}`);
    }
    linhas.push('');
    linhas.push('Responda:\n*1* Comprometer livres + antecipar gap\n*2* Comprometer só os livres\n*3* Cancelar');
  }
  return linhas.join('\n');
}

function coberturaAlerta({ fornecedorNome, coberturaPct, gapDias, totalAPagar }) {
  const pctStr = `${Math.round(coberturaPct * 100)}%`;
  const linhas = [];
  linhas.push('⚠️ *Alerta de cobertura*');
  linhas.push('');
  linhas.push(`Fornecedor: ${fornecedorNome}`);
  linhas.push(`Cobertura: ${pctStr}`);
  linhas.push(`Total a pagar nos próximos 90 dias: ${_fmt(totalAPagar)}`);
  if (gapDias != null && Number.isFinite(gapDias)) {
    linhas.push(`Gap em dias: ${gapDias}`);
  }
  linhas.push('');
  linhas.push('Pode ser hora de antecipar parte dos recebíveis.');
  return linhas.join('\n');
}

module.exports = {
  insightSemanal,
  pagarFornecedorSugestao,
  coberturaAlerta
};
