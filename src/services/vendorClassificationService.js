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

const CATEGORY_STORAGE_TO_DISPLAY = {
  insumos: 'Insumos',
  aluguel: 'Aluguel',
  pessoal: 'Salários',
  marketing: 'Marketing',
  cartao: 'Cartão / taxas',
  imposto: 'Impostos',
  estrutura: 'Estrutura',
  outro: 'Outros'
};

const DISPLAY_TO_STORAGE_RULES = [
  { storage: 'insumos', patterns: ['insumo', 'material', 'fornecedor', 'injetavel', 'botox', 'toxina', 'preenchimento', 'equipamento'] },
  { storage: 'aluguel', patterns: ['aluguel', 'locacao', 'locação', 'imovel', 'imóvel'] },
  { storage: 'pessoal', patterns: ['salario', 'salário', 'pessoal', 'folha', 'equipe', 'prolabore'] },
  { storage: 'marketing', patterns: ['marketing', 'publicidade', 'trafego', 'tráfego', 'ads'] },
  { storage: 'cartao', patterns: ['cartao', 'cartão', 'taxa', 'taxas', 'maquininha', 'stone', 'cielo'] },
  { storage: 'imposto', patterns: ['imposto', 'impostos', 'das', 'contador', 'tributo'] },
  { storage: 'estrutura', patterns: ['internet', 'utilitario', 'utilitário', 'energia', 'luz', 'agua', 'água', 'estrutura', 'servico', 'serviço'] }
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Converte categoria de exibição (WhatsApp/contas_pagar) para chave da tabela.
 * @param {string} displayCategory
 * @returns {string|null}
 */
function normalizeCategoryForStorage(displayCategory) {
  if (!displayCategory) return null;
  const normalized = normalizeText(displayCategory);
  if (!normalized) return null;

  const direct = Object.entries(CATEGORY_STORAGE_TO_DISPLAY)
    .find(([, label]) => normalizeText(label) === normalized);
  if (direct) return direct[0];

  for (const rule of DISPLAY_TO_STORAGE_RULES) {
    if (rule.patterns.some((pattern) => normalized.includes(normalizeText(pattern)))) {
      return rule.storage;
    }
  }

  if (normalized === 'outros' || normalized === 'outro') return 'outro';
  return null;
}

/**
 * Converte chave da tabela para categoria de exibição.
 * @param {string} storageCategory
 * @returns {string|null}
 */
function normalizeCategoryForDisplay(storageCategory) {
  if (!storageCategory) return null;
  const normalized = normalizeText(storageCategory);
  return CATEGORY_STORAGE_TO_DISPLAY[normalized] || storageCategory;
}

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

  const storageCategory = normalizeCategoryForStorage(category) || normalizeText(category);
  const validCategories = ['insumos', 'aluguel', 'pessoal', 'marketing', 'cartao', 'imposto', 'estrutura', 'outro'];
  if (!validCategories.includes(storageCategory)) {
    console.warn(`[VENDOR_CLASSIFICATION] Categoria inválida ignorada: ${category}`);
    return;
  }

  const { error } = await supabase
    .from('vendor_classifications')
    .upsert(
      {
        vendor_name: vendorName,
        category: storageCategory,
        user_id: userId,
        is_global: false
      },
      { onConflict: 'vendor_name_normalized,user_id' }
    );

  if (error) {
    console.warn('[VENDOR_CLASSIFICATION] Erro ao salvar classificação aprendida:', error.message);
  }
}

module.exports = {
  classifyVendor,
  learnVendorClassification,
  normalizeCategoryForStorage,
  normalizeCategoryForDisplay
};
