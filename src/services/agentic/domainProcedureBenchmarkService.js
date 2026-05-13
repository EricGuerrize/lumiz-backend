/**
 * Catálogo global de benchmarks de procedimentos (Anexo A — referência de mercado).
 * Usado pelo agente via conversationContextService.
 */

const supabase = require('../db/supabase');

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { rows: null, expiresAt: 0 };

async function listActiveForPrompt() {
  if (cache.rows && Date.now() < cache.expiresAt) {
    return cache.rows;
  }

  try {
    const { data, error } = await supabase
      .from('domain_procedure_benchmarks')
      .select('nome, categoria, preco_min_brl, preco_max_brl, insumo_pct_min, insumo_pct_max, margem_tipica, tempo_medio_min')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .limit(50);

    if (error) {
      if (error.code === '42P01') {
        return [];
      }
      console.warn('[DOMAIN_BENCHMARKS] Falha ao listar:', error.message);
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    cache = { rows, expiresAt: Date.now() + CACHE_TTL_MS };
    return rows;
  } catch (e) {
    console.warn('[DOMAIN_BENCHMARKS]', e?.message || e);
    return [];
  }
}

/**
 * @param {Array<object>} rows
 * @returns {string}
 */
function formatBenchmarkBlock(rows) {
  if (!rows || rows.length === 0) return '';
  const lines = rows.map((r) => {
    const preco =
      r.preco_min_brl != null && r.preco_max_brl != null
        ? `R$ ${Number(r.preco_min_brl)}–${Number(r.preco_max_brl)}`
        : '';
    const ins =
      r.insumo_pct_min != null && r.insumo_pct_max != null
        ? `insumo ~${Math.round(Number(r.insumo_pct_min) * 100)}–${Math.round(Number(r.insumo_pct_max) * 100)}%`
        : '';
    const bits = [r.categoria, preco, ins, r.margem_tipica].filter(Boolean);
    return `- ${r.nome}${bits.length ? ` (${bits.join('; ')})` : ''}`;
  });
  return `## Referência de mercado (procedimentos típicos — faixas indicativas)\n${lines.join('\n')}`;
}

module.exports = {
  listActiveForPrompt,
  formatBenchmarkBlock
};
