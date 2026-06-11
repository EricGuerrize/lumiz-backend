/**
 * Mensagens WhatsApp — estoque (Phase 4).
 * alertaEstoqueBaixo aceita array de produtos (mesmo shape de getAlertasBaixoEstoque).
 */

const { INVENTORY_CONFIRM_FOOTER } = require('./whatsappMenuMarkers');

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
    INVENTORY_CONFIRM_FOOTER
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
    '*estoque* ou *saldo botox* para consultar saldos'
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
  return baixaManualSuspensa();
}

function baixaManualSuspensa() {
  return (
    'Ainda não vou baixar estoque por comando solto.\n\n' +
    'A atualização de estoque será feita em uma etapa pós-procedimento: eu mostro os insumos, você confirma ou corrige, e só então o saldo muda.\n\n' +
    'Por enquanto, use *configurar estoque*, *entrada estoque...*, *estoque* ou *saldo botox*.'
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

// ============================================================================
// Item 23 (replanejado) — atualização de estoque pós-procedimento.
// Sem baixa automática: o bot pergunta, a secretária digita os insumos usados
// e a baixa só ocorre após confirmação explícita.
// ============================================================================

/** Pergunta opcional logo após uma venda/procedimento confirmado. */
function perguntarBaixaPosProcedimento() {
  return (
    '\n\n📦 Deseja atualizar o estoque usado nesse procedimento?\n' +
    '*1* Sim\n' +
    '*2* Não'
  );
}

/** Pede a lista de insumos usados. */
function perguntarInsumosUsados() {
  return (
    'Quais insumos foram usados? Me manda quantidade e item.\n\n' +
    'Exemplo: _1 seringa, 2 agulhas, 20 unidades de toxina_'
  );
}

/** Não conseguiu interpretar os itens digitados. */
function baixaInsumosNaoEntendi() {
  return (
    'Não consegui entender os itens 😕\n\n' +
    'Me manda assim: _quantidade + item_, separados por vírgula.\n' +
    'Exemplo: _1 seringa, 2 agulhas, 20 unidades de toxina_\n\n' +
    'Ou responda *2* para não atualizar o estoque agora.'
  );
}

/** Resumo do que será baixado, antes de confirmar. */
function resumoBaixaPosProcedimento(itens) {
  if (!itens?.length) return perguntarInsumosUsados();
  const linhas = itens.slice(0, 12).map((item) => {
    const u = item.unidade || 'unidade';
    return `• ${item.nome}: ${item.quantidade} ${u}`;
  });
  const extra = itens.length > 12 ? `\n...e mais ${itens.length - 12} item(ns).` : '';
  return (
    'Vou baixar do estoque:\n\n' +
    `${linhas.join('\n')}${extra}\n\n` +
    'Confirmar atualização?\n' +
    '*1* Confirmar\n' +
    '*2* Cancelar\n' +
    '*3* Corrigir'
  );
}

/** Resultado da baixa. */
function baixaPosProcedimentoConfirmada({ applied = [], failed = [] }) {
  const linhas = [];
  if (applied.length) {
    linhas.push('✅ Estoque atualizado:');
    applied.slice(0, 12).forEach((item) => {
      const u = item.unidade || 'unidade';
      const saldo = item.estoqueAtual != null ? ` (saldo ${item.estoqueAtual} ${u})` : '';
      linhas.push(`• ${item.nome}: -${item.quantidade} ${u}${saldo}`);
    });
  } else {
    linhas.push('Não consegui baixar nenhum item do estoque.');
  }

  if (failed.length) {
    linhas.push('');
    linhas.push(`⚠️ ${failed.length} item(ns) não foram baixados:`);
    failed.slice(0, 12).forEach((item) => {
      linhas.push(`• ${item.nome}: ${item.erro}`);
    });
    linhas.push('');
    linhas.push('Cadastre o item com *configurar estoque* se necessário.');
  }
  return linhas.join('\n');
}

/** Usuário optou por não atualizar o estoque. */
function baixaPosProcedimentoIgnorada() {
  return 'Tudo certo, não vou alterar o estoque. 👍';
}

/** Reabre a digitação após pedir correção. */
function baixaPosProcedimentoCorrigir() {
  return (
    'Sem problema. Me manda de novo os insumos usados.\n\n' +
    'Exemplo: _1 seringa, 2 agulhas, 20 unidades de toxina_'
  );
}

// ============================================================================
// Item 21 — entrada de estoque a partir de NF/documento, sob confirmação.
// A NF registra o financeiro; o estoque só é atualizado após o usuário confirmar.
// ============================================================================

function _linhaItemDoc(item) {
  const u = item.unidade || 'unidade';
  const custo = item.valor_unitario != null
    ? ` · custo R$ ${Number(item.valor_unitario).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : '';
  const validade = item.validade ? ` · val. ${item.validade}` : '';
  return `• ${item.descricao}: ${item.quantidade} ${u}${custo}${validade}`;
}

/** Pergunta anexada após confirmar o financeiro da NF. */
function perguntarEntradaEstoqueDoc(itens) {
  const n = Array.isArray(itens) ? itens.length : 0;
  if (!n) return '';
  return (
    `\n\n📦 Encontrei ${n} item(ns) na nota para o estoque.\n` +
    'Deseja dar entrada no estoque com esses itens?\n' +
    '*1* Sim\n' +
    '*2* Não'
  );
}

/** Resumo dos itens antes de aplicar a entrada. */
function resumoEntradaEstoqueDoc(itens) {
  if (!itens?.length) return 'Não há itens da nota para dar entrada.';
  const linhas = itens.slice(0, 12).map(_linhaItemDoc);
  const extra = itens.length > 12 ? `\n...e mais ${itens.length - 12} item(ns).` : '';
  return (
    'Vou dar entrada no estoque:\n\n' +
    `${linhas.join('\n')}${extra}\n\n` +
    'Confirmar entrada?\n' +
    '*1* Confirmar\n' +
    '*2* Cancelar'
  );
}

/** Resultado da entrada via NF. */
function entradaEstoqueDocConfirmada({ applied = [], failed = [] }) {
  const linhas = [];
  if (applied.length) {
    linhas.push('✅ Estoque atualizado:');
    applied.slice(0, 12).forEach((item) => {
      const u = item.unidade || 'unidade';
      const saldo = item.estoqueAtual != null ? ` (saldo ${item.estoqueAtual} ${u})` : '';
      linhas.push(`• ${item.nome}: +${item.quantidade} ${u}${saldo}`);
    });
  } else {
    linhas.push('Não consegui dar entrada em nenhum item.');
  }
  if (failed.length) {
    linhas.push('');
    linhas.push(`⚠️ ${failed.length} item(ns) não entraram:`);
    failed.slice(0, 12).forEach((item) => {
      linhas.push(`• ${item.nome}: ${item.erro}`);
    });
  }
  return linhas.join('\n');
}

/** Usuário optou por não dar entrada via NF. */
function entradaEstoqueDocIgnorada() {
  return 'Beleza, registrei só o financeiro. O estoque ficou como estava. 👍';
}

// ============================================================================
// Item 28 — inventário/conferência assistida. A contagem física informada é
// comparada com o saldo do sistema; o ajuste só ocorre após confirmação.
// ============================================================================

/** Instruções quando não consegue interpretar a contagem. */
function conferenciaEstoqueInstrucoes() {
  return (
    'Para conferir o estoque, me manda a contagem real assim:\n\n' +
    '_estoque real: toxina 8, luvas 20, seringa 50_\n\n' +
    'Eu comparo com o sistema e te mostro as diferenças antes de ajustar.'
  );
}

function _linhaDiff(d) {
  if (!d.encontrado) {
    return `• ${d.nome}: novo no estoque → ${d.novo}`;
  }
  if (d.delta === 0) {
    return `• ${d.nome}: ${d.anterior} (bate ✅)`;
  }
  const sinal = d.delta > 0 ? `+${d.delta}` : `${d.delta}`;
  return `• ${d.nome}: ${d.anterior} → ${d.novo} (${sinal})`;
}

/** Resumo das diferenças antes de aplicar. */
function resumoConferenciaEstoque(diffs) {
  if (!diffs?.length) return conferenciaEstoqueInstrucoes();
  const comMudanca = diffs.filter((d) => !d.encontrado || d.delta !== 0);
  const linhas = diffs.slice(0, 15).map(_linhaDiff);
  const extra = diffs.length > 15 ? `\n...e mais ${diffs.length - 15} item(ns).` : '';
  const rodape = comMudanca.length === 0
    ? '\n\nTudo bate com o sistema. Nada a ajustar. ✅'
    : '\n\nAplicar esse ajuste no estoque?\n*1* Confirmar\n*2* Cancelar';
  return `📋 *Conferência de estoque*\n\n${linhas.join('\n')}${extra}${rodape}`;
}

/** Resultado da conferência aplicada. */
function conferenciaEstoqueConfirmada(results) {
  const ajustados = (results || []).filter((r) => r.changed);
  if (!ajustados.length) {
    return '✅ Conferência concluída. Nenhum ajuste foi necessário.';
  }
  const linhas = ajustados.slice(0, 15).map((r) => {
    const sinal = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
    return `• ${r.nome}: ${r.novo} (${sinal})`;
  });
  return `✅ *Estoque ajustado pela contagem:*\n\n${linhas.join('\n')}`;
}

/** Conferência cancelada. */
function conferenciaEstoqueCancelada() {
  return 'Conferência cancelada. O estoque ficou como estava. 👍';
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
  perguntarBaixaPosProcedimento,
  perguntarInsumosUsados,
  baixaInsumosNaoEntendi,
  resumoBaixaPosProcedimento,
  baixaPosProcedimentoConfirmada,
  baixaPosProcedimentoIgnorada,
  baixaPosProcedimentoCorrigir,
  baixaManualSuspensa,
  perguntarEntradaEstoqueDoc,
  resumoEntradaEstoqueDoc,
  entradaEstoqueDocConfirmada,
  entradaEstoqueDocIgnorada,
  conferenciaEstoqueInstrucoes,
  resumoConferenciaEstoque,
  conferenciaEstoqueConfirmada,
  conferenciaEstoqueCancelada,
};
