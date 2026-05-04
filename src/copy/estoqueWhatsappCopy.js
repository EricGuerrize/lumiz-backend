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

function resumoEstoqueLinhas(itens) {
  if (!itens?.length) {
    return '📦 Não há itens com estoque configurado ainda. Defina mínimos e entradas no dashboard.';
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
    `Não achei o procedimento *${termo}* no seu cadastro.\n\n` +
    `Verifique o nome ou cadastre no app. Exemplo de entrada: _entrada estoque botox 10 unidades_.`
  );
}

function precisaQuantidadeENome() {
  return (
    'Para dar entrada no estoque, me diga o *procedimento* e a *quantidade*.\n\n' +
    'Exemplo: _entrada estoque preenchimento 5 caixas_'
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
  entradaRegistrada,
  resumoEstoqueLinhas,
  erroProcedimentoNaoEncontrado,
  precisaQuantidadeENome,
};
