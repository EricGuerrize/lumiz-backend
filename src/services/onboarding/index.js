/**
 * Módulo de handlers do onboarding
 * 
 * Exporta todos os handlers organizados por fase para uso no onboardingFlowService
 */

const { profileHandlers, isYes, isNo, normalizeText, MIN_NAME_LENGTH, MIN_CLINIC_NAME_LENGTH } = require('./profileHandlers');
const { contextHandlers } = require('./contextHandlers');
const { ahaRevenueHandlers, parseBrazilianNumber, extractSimpleSale, MAX_TRANSACTION_VALUE, MIN_TRANSACTION_VALUE } = require('./ahaRevenueHandlers');
const { ahaCostsHandlers, COST_CATEGORIES } = require('./ahaCostsHandlers');
const { summaryHandlers } = require('./summaryHandlers');
const { mdrHandlers } = require('./mdrHandlers');

/**
 * Combina todos os handlers em um único objeto
 */
const allHandlers = {
  // Profile phase
  handleStart: profileHandlers.handleStart,
  handleConsent: profileHandlers.handleConsent,
  handleProfileName: profileHandlers.handleProfileName,
  handleProfileClinic: profileHandlers.handleProfileClinic,
  handleProfileRole: profileHandlers.handleProfileRole,
  
  // Context phase
  handleContextWhy: contextHandlers.handleContextWhy,
  handleContextHow: contextHandlers.handleContextHow,
  
  // AHA Revenue phase
  handleAhaRevenue: ahaRevenueHandlers.handleAhaRevenue,
  handleAhaRevenueConfirm: ahaRevenueHandlers.handleAhaRevenueConfirm,
  
  // AHA Costs phase
  handleAhaCostsIntro: ahaCostsHandlers.handleAhaCostsIntro,
  handleAhaCostsUpload: ahaCostsHandlers.handleAhaCostsUpload,
  handleAhaCostsDocumentType: ahaCostsHandlers.handleAhaCostsDocumentType,
  handleAhaCostsCategory: ahaCostsHandlers.handleAhaCostsCategory,
  handleAhaCostsConfirm: ahaCostsHandlers.handleAhaCostsConfirm,
  
  // Summary phase
  handleAhaSummary: summaryHandlers.handleAhaSummary,
  handleHandoffToDailyUse: summaryHandlers.handleHandoffToDailyUse,
  
  // MDR phase
  handleMdrSetupIntro: mdrHandlers.handleMdrSetupIntro,
  handleMdrSetupQuestion: mdrHandlers.handleMdrSetupQuestion,
  handleMdrSetupUpload: mdrHandlers.handleMdrSetupUpload,
  handleMdrSetupComplete: mdrHandlers.handleMdrSetupComplete
};

module.exports = {
  // Handlers combinados
  allHandlers,
  
  // Handlers por fase
  profileHandlers,
  contextHandlers,
  ahaRevenueHandlers,
  ahaCostsHandlers,
  summaryHandlers,
  mdrHandlers,
  
  // Funções utilitárias
  isYes,
  isNo,
  normalizeText,
  parseBrazilianNumber,
  extractSimpleSale,
  
  // Constantes
  MIN_NAME_LENGTH,
  MIN_CLINIC_NAME_LENGTH,
  MAX_TRANSACTION_VALUE,
  MIN_TRANSACTION_VALUE,
  COST_CATEGORIES
};
