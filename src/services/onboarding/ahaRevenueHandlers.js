/**
 * Handlers para a fase AHA de receita do onboarding
 * Etapas: AHA_REVENUE, AHA_REVENUE_CONFIRM
 */

const onboardingCopy = require('../../copy/onboardingWhatsappCopy');
const analyticsService = require('../analyticsService');
const userController = require('../../controllers/userController');
const transactionController = require('../../controllers/transactionController');
const { isYes, isNo } = require('./profileHandlers');

// Constantes
const MAX_TRANSACTION_VALUE = 10000000; // R$ 10 milhões
const MIN_TRANSACTION_VALUE = 0.01;

/**
 * Parseia números no formato brasileiro
 */
function parseBrazilianNumber(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  const cleaned = str.replace(/r\$\s*/gi, '').replace(/\s/g, '');

  if (/\d+\.\d{3}(?:\.\d{3})*,\d{2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  if (/\d{1,3}(?:\.\d{3})+$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, ''));
  }
  if (/^\d+,\d{1,2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(',', '.'));
  }
  if (/\d+mil$/i.test(cleaned)) {
    return parseFloat(cleaned.replace(/mil$/i, '')) * 1000;
  }
  const numbers = cleaned.match(/[\d.,]+/g);
  if (numbers && numbers.length > 0) {
    const lastNumber = numbers[numbers.length - 1];
    return parseBrazilianNumber(lastNumber);
  }
  return null;
}

/**
 * Extrai dados de uma mensagem de venda simples
 */
function extractSimpleSale(message) {
  // Extrai valor
  const valor = parseBrazilianNumber(message);
  if (!valor) return null;

  // Tenta extrair categoria (procedimento)
  const categoriaPatterns = [
    /^([\wÀ-ÿ\s]+)\s+(?:r?\$?\s*)[\d.,]+/i,   // "Botox 500"
    /[\d.,]+\s+(?:r?\$?\s*)?([\wÀ-ÿ\s]+)$/i   // "500 Botox"
  ];
  
  let categoria = null;
  for (const pattern of categoriaPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      categoria = match[1].trim();
      if (categoria.length >= 2) break;
    }
  }

  // Tenta extrair cliente
  const clientePattern = /(?:cliente|paciente)\s+([\wÀ-ÿ\s]+)/i;
  const clienteMatch = message.match(clientePattern);
  const cliente = clienteMatch ? clienteMatch[1].trim() : null;

  return {
    valor,
    categoria: categoria || 'Procedimento',
    cliente,
    tipo: 'entrada'
  };
}

/**
 * Handlers da fase AHA de receita
 */
const ahaRevenueHandlers = {
  /**
   * Handler: AHA_REVENUE
   * Registra a primeira venda
   */
  async handleAhaRevenue(onboarding, messageTrimmed, respond) {
    // Tenta extrair dados de venda da mensagem
    const extracted = extractSimpleSale(messageTrimmed);
    
    if (!extracted || !extracted.valor) {
      // Tenta só extrair valor
      const valor = parseBrazilianNumber(messageTrimmed);
      if (!valor) {
        return await respond(onboardingCopy.invalidRevenue());
      }
      
      onboarding.data.primeiraVenda = {
        valor,
        categoria: 'Procedimento',
        cliente: null,
        raw: messageTrimmed
      };
    } else {
      // Valida valor
      if (extracted.valor < MIN_TRANSACTION_VALUE || extracted.valor > MAX_TRANSACTION_VALUE) {
        return await respond(`Valor inválido. Por favor, informe um valor entre R$ ${MIN_TRANSACTION_VALUE.toFixed(2)} e R$ ${MAX_TRANSACTION_VALUE.toLocaleString('pt-BR')}.`);
      }
      
      onboarding.data.primeiraVenda = {
        ...extracted,
        raw: messageTrimmed
      };
    }

    onboarding.step = 'AHA_REVENUE_CONFIRM';
    
    const venda = onboarding.data.primeiraVenda;
    return await respond(onboardingCopy.revenueConfirmation(
      venda.valor,
      venda.categoria,
      venda.cliente
    ), true);
  },

  /**
   * Handler: AHA_REVENUE_CONFIRM
   * Confirma e registra a primeira venda
   */
  async handleAhaRevenueConfirm(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear) {
    if (isNo(messageTrimmed)) {
      // Usuário quer corrigir
      onboarding.step = 'AHA_REVENUE';
      return await respond(onboardingCopy.revenueCorrection());
    }

    if (!isYes(messageTrimmed)) {
      return await respond(onboardingCopy.invalidChoice());
    }

    try {
      // Cria ou busca usuário
      let user = await userController.findUserByPhone(normalizedPhone);
      
      if (!user) {
        user = await userController.createUserFromOnboarding(normalizedPhone, {
          nome: onboarding.data.nome,
          clinica: onboarding.data.clinica,
          cargo: onboarding.data.cargo,
          motivo: onboarding.data.motivo,
          como_controla: onboarding.data.como_controla
        });
      }

      if (!user || !user.id) {
        throw new Error('Falha ao criar/buscar usuário');
      }

      // Salva userId para uso posterior
      onboarding.data.userId = user.id;

      // Registra a venda
      const venda = onboarding.data.primeiraVenda;
      await transactionController.createTransaction({
        user_id: user.id,
        tipo: 'entrada',
        valor: venda.valor,
        categoria: venda.categoria,
        descricao: venda.cliente ? `Cliente: ${venda.cliente}` : null,
        data: new Date().toISOString().split('T')[0],
        origem: 'onboarding_whatsapp'
      });

      await analyticsService.track('onboarding_first_sale', {
        phone: normalizedPhone,
        source: 'whatsapp',
        properties: {
          valor: venda.valor,
          categoria: venda.categoria
        }
      });

      // Avança para fase de custos
      onboarding.step = 'AHA_COSTS_INTRO';
      return await respond(onboardingCopy.revenueSaved(venda.valor) + '\n\n' + onboardingCopy.ahaCostsIntro(), true);

    } catch (error) {
      console.error('[ONBOARDING] Erro ao registrar primeira venda:', error);
      return await respond('Ops! Tive um probleminha ao registrar a venda. Vamos tentar de novo?\n\nQual foi o procedimento e o valor?');
    }
  }
};

module.exports = { 
  ahaRevenueHandlers,
  parseBrazilianNumber,
  extractSimpleSale,
  MAX_TRANSACTION_VALUE,
  MIN_TRANSACTION_VALUE
};
