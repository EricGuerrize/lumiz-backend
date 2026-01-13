/**
 * Utilitários para formatação de valores monetários
 */

/**
 * Formata valor monetário no padrão brasileiro
 * @param {number} valor - Valor numérico a ser formatado
 * @returns {string} - Valor formatado (ex: "1.234,67")
 */
function formatarValor(valor) {
  if (valor === null || valor === undefined || isNaN(valor)) {
    return '0,00';
  }
  
  return Number(valor).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Formata valor monetário com símbolo R$ no padrão brasileiro
 * @param {number} valor - Valor numérico a ser formatado
 * @returns {string} - Valor formatado com R$ (ex: "R$ 1.234,67")
 */
function formatarMoeda(valor) {
  return `R$ ${formatarValor(valor)}`;
}

module.exports = {
  formatarValor,
  formatarMoeda
};
