/**
 * Fase 15 — Vendor Classification Service
 *
 * Responsabilidade: resolver categoria de um fornecedor a partir da tabela
 * `vendor_classifications` (registros globais + aprendizados por usuário),
 * evitando chamada ao LLM quando o fornecedor já é conhecido.
 *
 * @module vendorClassificationService
 */

const supabase = require('../db/supabase');

/**
 * Tenta classificar um fornecedor pelo nome consultando a tabela
 * `vendor_classifications`. Prefere classificação do usuário sobre global.
 *
 * @param {string} vendorName - Nome do fornecedor (texto livre do documento).
 * @param {string} userId - UUID do usuário autenticado.
 * @returns {Promise<string|null>} Categoria encontrada ou null.
 */
async function classifyVendor(vendorName, userId) {
  if (!vendorName) return null;
  const nameStr = typeof vendorName === 'string' ? vendorName : String(vendorName);
  const normalized = nameStr.toLowerCase().trim();

  const { data, error } = await supabase
    .from('vendor_classifications')
    .select('category, is_global')
    .or(userId ? `user_id.eq.${userId},is_global.eq.true` : 'is_global.eq.true')
    .ilike('vendor_name_normalized', `%${normalized}%`)
    .order('is_global', { ascending: true }) // false (usuário) antes de true (global)
    .limit(1);

  if (error) {
    console.warn('[VENDOR_CLASSIFICATION] Erro ao consultar tabela:', error.message);
    return null;
  }

  return data?.[0]?.category ?? null;
}

/**
 * Persiste uma classificação aprendida durante a conversa para o usuário
 * específico. Não sobrescreve registros globais.
 *
 * @param {string} vendorName - Nome original do fornecedor.
 * @param {string} category - Categoria aprendida (deve ser válida).
 * @param {string} userId - UUID do usuário.
 * @returns {Promise<void>}
 */
async function learnVendorClassification(vendorName, category, userId) {
  if (!vendorName || !category || !userId) return;

  const validCategories = ['insumos', 'aluguel', 'pessoal', 'marketing', 'cartao', 'imposto', 'estrutura', 'outro'];
  if (!validCategories.includes(category)) {
    console.warn(`[VENDOR_CLASSIFICATION] Categoria inválida ignorada: ${category}`);
    return;
  }

  const { error } = await supabase
    .from('vendor_classifications')
    .upsert(
      {
        vendor_name: vendorName,
        category,
        user_id: userId,
        is_global: false
      },
      { onConflict: 'vendor_name_normalized,user_id' }
    );

  if (error) {
    console.warn('[VENDOR_CLASSIFICATION] Erro ao salvar classificação aprendida:', error.message);
  }
}

module.exports = { classifyVendor, learnVendorClassification };
