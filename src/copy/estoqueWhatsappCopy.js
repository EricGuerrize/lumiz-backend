/**
 * Mensagens WhatsApp — estoque (Phase 4).
 * alertaEstoqueBaixo aceita array de produtos (mesmo shape de getAlertasBaixoEstoque).
 */

function _fmtDias(d) {
  if (d == null || Number.isNaN(d)) return '—';
  return String(Math.round(d * 10) / 10);
}

/** Lista agregada (vários itens no mesmo dia) */
function alertaEstoqueBaixo(produtos) {
  if (!produtos?.length) {
    return '⚠️ Atenção ao estoque. Confira os níveis no dashboard.';
  }
  const linhas = produtos.map((p) => {
    const dias = _fmtDias(p.diasSuprimento);
    const crit = p.status === 'critico' ? ' (CRÍTICO)' : '';
    return `• *${p.nome}*: ${p.estoqueAtual} ${p.unidade || 'ml'} (~${dias} dias)${crit}`;
  });
  return (
    '⚠️ *Estoque baixo!*\n\n' +
    `${linhas.join('\n')}\n\n` +
    `Digite *estoque* para ver o resumo ou use o dashboard para sugestões de reposição.`
  );
}

/** Um único item crítico (< 50% do mínimo) */
function alertaEstoqueCritico(p) {
  const u = p.unidade || 'ml';
  const dias = _fmtDias(p.diasSuprimento);
  return (
    '🚨 *Estoque CRÍTICO*\n\n' +
    `*${p.nome}*\n` +
    `Atual: ${p.estoqueAtual} ${u}\n` +
    `Mínimo: ${p.estoqueMinimo} ${u}\n` +
    `~${dias} dias de suprimento\n\n` +
    'Repita o quanto antes. Veja sugestões de compra no dashboard.'
  );
}

function entradaRegistrada(nomeProcedimento, quantidade, novoTotal, unidade) {
  const u = unidade || 'ml';
  return (
    `✅ Entrada de estoque registrada\n\n` +
    `*${nomeProcedimento}* +${quantidade} ${u}\n` +
    `Saldo agora: ${novoTotal} ${u}`
  );
}

function saidaRegistrada(nomeProcedimento, quantidade, novoTotal, unidade) {
  const u = unidade || 'ml';
  return (
    `✅ Baixa de estoque registrada\n\n` +
    `*${nomeProcedimento}* -${quantidade} ${u}\n` +
    `Saldo agora: ${novoTotal} ${u}`
  );
}

function configurarEstoqueInstrucoes() {
  return (
    'Vamos montar seu inventário inicial.\n\n' +
    'Envie uma lista com um item por linha neste formato:\n\n' +
    'Botox 100UI | 3 frascos | validade 10/2026 | custo 780 | mínimo 1\n' +
    'Ácido hialurônico Voluma | 8 seringas | validade 05/2027\n' +
    'Luvas nitrílicas | 12 caixas | mínimo 2\n\n' +
    'Depois eu te mostro um resumo para confirmar antes de salvar.'
  );
}

function confirmarInventarioInicial(itens) {
  if (!itens?.length) return configurarEstoqueInstrucoes();
  const linhas = itens.slice(0, 12).map((item, index) => {
    const validade = item.validade ? ` · validade ${item.validade}` : '';
    const minimo = item.estoque_minimo ? ` · mín. ${item.estoque_minimo}` : '';
    const custo = item.custo_unitario ? ` · custo R$ ${Number(item.custo_unitario).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '';
    return `${index + 1}. ${item.nome} — ${item.quantidade} ${item.unidade || 'unidade'}${validade}${minimo}${custo}`;
  });
  const extra = itens.length > 12 ? `\n...e mais ${itens.length - 12} item(ns).` : '';
  return (
    '📦 *Inventário inicial*\n\n' +
    `${linhas.join('\n')}${extra}\n\n` +
    'Responda:\n' +
    '1 Confirmar\n' +
    '2 Cancelar\n' +
    '3 Corrigir'
  );
}

function inventarioConfirmado({ applied = [], failed = [] }) {
  const linhas = [
    `✅ Inventário salvo: ${applied.length} item(ns).`
  ];
  if (failed.length) {
    linhas.push(`⚠️ ${failed.length} item(ns) não foram salvos. Revise o formato e envie novamente se necessário.`);
  }
  linhas.push('');
  linhas.push('Para consultar: *estoque*');
  linhas.push('Para um item: *saldo botox*');
  return linhas.join('\n');
}

function inventarioCancelado() {
  return 'Inventário cancelado. Nada foi salvo.';
}

function inventarioCorrigir() {
  return (
    'Envie a lista corrigida com um item por linha.\n\n' +
    'Exemplo:\n' +
    'Botox 100UI | 3 frascos | validade 10/2026 | custo 780 | mínimo 1'
  );
}

function configurarConsumoInstrucoes() {
  return (
    'A atualização de estoque pós-procedimento ainda está em desenho.\n\n' +
    'Por enquanto, use:\n' +
    '*configurar estoque* para montar o inventário inicial\n' +
    '*entrada estoque botox 3 frascos* para dar entrada manual\n' +
    '*baixar estoque botox 1 frasco* para dar baixa manual'
  );
}

function consumoConfigurado({ procedimento, applied = [], failed = [] }) {
  const linhas = [
    `✅ Consumo padrão salvo para *${procedimento?.nome || 'procedimento'}*.`
  ];

  if (applied.length) {
    linhas.push('');
    applied.slice(0, 8).forEach((item) => {
      linhas.push(`• ${item.produtoNome}: ${item.quantidade} ${item.unidade || 'unidade'} por venda`);
    });
  }

  if (failed.length) {
    linhas.push('');
    linhas.push(`⚠️ ${failed.length} item(ns) não foram vinculados. Verifique se o nome existe no inventário.`);
  }

  linhas.push('');
  linhas.push('Observação: nenhuma venda vai baixar estoque automaticamente neste momento.');
  return linhas.join('\n');
}

function consumoConfigFalhou(errorMessage) {
  return (
    `Não consegui configurar o consumo: ${errorMessage}\n\n` +
    'Use assim:\n' +
    'configurar consumo botox: Botox 100UI 0,25 frasco; Luvas nitrílicas 1 par'
  );
}

function baixaAutomaticaResumo(consumption) {
  return '';
}

function saldoProduto(item) {
  if (!item) {
    return 'Não achei esse item no estoque. Tente pelo nome do procedimento/produto cadastrado.';
  }
  const dias =
    item.diasSuprimento == null
      ? '—'
      : String(Math.round(item.diasSuprimento * 10) / 10);
  const u = item.unidade || 'ml';
  const status = item.status === 'critico'
    ? 'crítico'
    : item.status === 'baixo'
      ? 'baixo'
      : item.status === 'excesso'
        ? 'acima do teto'
        : 'ok';

  return (
    `📦 *${item.nome}*\n\n` +
    `Saldo: ${item.estoqueAtual} ${u}\n` +
    `Mínimo: ${item.estoqueMinimo || 0} ${u}\n` +
    `Status: ${status}\n` +
    `Cobertura estimada: ${dias} dia(s)`
  );
}

function resumoEstoqueLinhas(itens) {
  if (!itens?.length) {
    return '📦 Não há itens com estoque configurado ainda. Digite *configurar estoque* para cadastrar o inventário inicial.';
  }
  const linhas = itens.slice(0, 8).map((it) => {
    const dias =
      it.diasSuprimento == null
        ? '—'
        : String(Math.round(it.diasSuprimento * 10) / 10);
    const tag =
      it.status === 'critico' ? ' 🚨' : it.status === 'baixo' ? ' ⚠️' : it.status === 'excesso' ? ' 📈' : '';
    return `• ${it.nome}: ${it.estoqueAtual} ${it.unidade || 'ml'} (${dias} d)${tag}`;
  });
  return `📦 *Seu estoque*\n\n${linhas.join('\n')}`;
}

function erroProcedimentoNaoEncontrado(termo) {
  return (
    `Não achei *${termo}* no seu estoque.\n\n` +
    `Verifique o nome ou cadastre com *configurar estoque*. Exemplo: _entrada estoque botox 10 unidades_.`
  );
}

function precisaQuantidadeENome() {
  return (
    'Para dar entrada no estoque, me diga o *item* e a *quantidade*.\n\n' +
    'Exemplo: _entrada estoque preenchimento 5 caixas_'
  );
}

function precisaQuantidadeSaida() {
  return (
    'Para dar baixa no estoque, me diga o *item* e a *quantidade*.\n\n' +
    'Exemplo: _baixar estoque botox 10 unidades_'
  );
}

/** Acima de `estoque_maximo` (quando definido) */
function alertaEstoqueExcesso(produtos) {
  if (!produtos?.length) {
    return '📈 Revise níveis máximos de estoque no dashboard.';
  }
  const linhas = produtos.map((p) => {
    const u = p.unidade || 'ml';
    const max = p.estoqueMaximo != null ? p.estoqueMaximo : '—';
    return `• *${p.nome}*: ${p.estoqueAtual} ${u} (teto ${max} ${u})`;
  });
  return (
    '📈 *Estoque acima do teto*\n\n' +
    `${linhas.join('\n')}\n\n` +
    'Confirme se o máximo ainda faz sentido ou ajuste no dashboard.'
  );
}

module.exports = {
  alertaEstoqueBaixo,
  alertaEstoqueCritico,
  alertaEstoqueExcesso,
  configurarEstoqueInstrucoes,
  confirmarInventarioInicial,
  inventarioConfirmado,
  inventarioCancelado,
  inventarioCorrigir,
  configurarConsumoInstrucoes,
  consumoConfigurado,
  consumoConfigFalhou,
  baixaAutomaticaResumo,
  entradaRegistrada,
  saidaRegistrada,
  saldoProduto,
  resumoEstoqueLinhas,
  erroProcedimentoNaoEncontrado,
  precisaQuantidadeENome,
  precisaQuantidadeSaida,
};
