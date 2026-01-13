/**
 * Handlers para a fase AHA de custos do onboarding
 * Etapas: AHA_COSTS_INTRO, AHA_COSTS_UPLOAD, AHA_COSTS_DOCUMENT_TYPE, 
 *         AHA_COSTS_CATEGORY, AHA_COSTS_CONFIRM
 */

const onboardingCopy = require('../../copy/onboardingWhatsappCopy');
const analyticsService = require('../analyticsService');
const transactionController = require('../../controllers/transactionController');
const documentService = require('../documentService');
const { isYes, isNo } = require('./profileHandlers');
const { parseBrazilianNumber, MAX_TRANSACTION_VALUE, MIN_TRANSACTION_VALUE } = require('./ahaRevenueHandlers');

/**
 * Categorias de custos válidas
 */
const COST_CATEGORIES = {
  '1': 'Aluguel',
  '2': 'Insumos',
  '3': 'Marketing',
  '4': 'Funcionários',
  '5': 'Energia/Água',
  '6': 'Internet/Telefone',
  '7': 'Equipamentos',
  '8': 'Outro'
};

/**
 * Handlers da fase AHA de custos
 */
const ahaCostsHandlers = {
  /**
   * Handler: AHA_COSTS_INTRO
   * Introdução à fase de custos
   */
  async handleAhaCostsIntro(onboarding, messageTrimmed, respond) {
    const normalized = messageTrimmed.toLowerCase();
    
    if (normalized.includes('sim') || normalized === '1' || normalized === 's') {
      onboarding.step = 'AHA_COSTS_UPLOAD';
      onboarding.data.custos = [];
      return await respond(onboardingCopy.ahaCostsUpload());
    }
    
    if (normalized.includes('não') || normalized.includes('nao') || normalized === '2' || normalized === 'n') {
      // Pula fase de custos
      onboarding.step = 'AHA_SUMMARY';
      return await respond(onboardingCopy.ahaCostsSkipped() + '\n\n' + onboardingCopy.ahaSummary(onboarding.data));
    }
    
    return await respond(onboardingCopy.invalidChoice());
  },

  /**
   * Handler: AHA_COSTS_UPLOAD
   * Processa upload de documento ou entrada manual de custo
   */
  async handleAhaCostsUpload(onboarding, messageTrimmed, mediaUrl, fileName, respond) {
    // Se usuário quer pular
    const normalized = messageTrimmed.toLowerCase();
    if (normalized.includes('pular') || normalized.includes('não') || normalized === 'n') {
      onboarding.step = 'AHA_SUMMARY';
      return await respond(onboardingCopy.ahaSummary(onboarding.data));
    }

    // Se é uma imagem/documento
    if (mediaUrl) {
      try {
        const result = await documentService.processImage(mediaUrl, null);
        
        if (result.transacoes && result.transacoes.length > 0) {
          // Documento processado com sucesso
          const transacao = result.transacoes[0];
          onboarding.data.pendingCost = {
            valor: transacao.valor,
            categoria: transacao.categoria || transacao.descricao,
            descricao: transacao.descricao,
            fromDocument: true
          };
          onboarding.step = 'AHA_COSTS_CONFIRM';
          return await respond(onboardingCopy.costDocumentFound(transacao.valor, transacao.categoria || transacao.descricao));
        } else {
          // Não conseguiu extrair do documento
          return await respond(onboardingCopy.costDocumentFailed());
        }
      } catch (error) {
        console.error('[ONBOARDING] Erro ao processar documento de custo:', error);
        return await respond(onboardingCopy.costDocumentFailed());
      }
    }

    // Entrada manual de texto
    const valor = parseBrazilianNumber(messageTrimmed);
    
    if (valor) {
      if (valor < MIN_TRANSACTION_VALUE || valor > MAX_TRANSACTION_VALUE) {
        return await respond(`Valor inválido. Por favor, informe um valor entre R$ ${MIN_TRANSACTION_VALUE.toFixed(2)} e R$ ${MAX_TRANSACTION_VALUE.toLocaleString('pt-BR')}.`);
      }
      
      onboarding.data.pendingCost = { valor };
      onboarding.step = 'AHA_COSTS_DOCUMENT_TYPE';
      return await respond(onboardingCopy.costCategoryQuestion());
    }

    return await respond(onboardingCopy.invalidCost());
  },

  /**
   * Handler: AHA_COSTS_DOCUMENT_TYPE
   * Coleta tipo do documento (não mais usado, redirecionado para categoria)
   */
  async handleAhaCostsDocumentType(onboarding, messageTrimmed, respond) {
    // Redirecionado para categoria diretamente
    onboarding.step = 'AHA_COSTS_CATEGORY';
    return await respond(onboardingCopy.costCategoryQuestion());
  },

  /**
   * Handler: AHA_COSTS_CATEGORY
   * Coleta a categoria do custo
   */
  async handleAhaCostsCategory(onboarding, messageTrimmed, respond) {
    const categoria = COST_CATEGORIES[messageTrimmed] || messageTrimmed;
    
    if (!categoria || categoria.length < 2) {
      return await respond(onboardingCopy.invalidCategory());
    }
    
    onboarding.data.pendingCost.categoria = categoria;
    onboarding.step = 'AHA_COSTS_CONFIRM';
    
    return await respond(onboardingCopy.costConfirmation(
      onboarding.data.pendingCost.valor,
      categoria
    ));
  },

  /**
   * Handler: AHA_COSTS_CONFIRM
   * Confirma e registra o custo
   */
  async handleAhaCostsConfirm(onboarding, messageTrimmed, normalizedPhone, respond) {
    if (isNo(messageTrimmed)) {
      // Usuário quer corrigir
      onboarding.step = 'AHA_COSTS_UPLOAD';
      onboarding.data.pendingCost = null;
      return await respond(onboardingCopy.costCorrection());
    }

    if (!isYes(messageTrimmed)) {
      return await respond(onboardingCopy.invalidChoice());
    }

    try {
      const cost = onboarding.data.pendingCost;
      const userId = onboarding.data.userId;

      if (!userId) {
        throw new Error('Usuário não encontrado no estado');
      }

      // Registra o custo
      await transactionController.createTransaction({
        user_id: userId,
        tipo: 'saida',
        valor: cost.valor,
        categoria: cost.categoria,
        descricao: cost.descricao || null,
        data: new Date().toISOString().split('T')[0],
        origem: 'onboarding_whatsapp'
      });

      // Adiciona ao array de custos registrados
      if (!onboarding.data.custos) {
        onboarding.data.custos = [];
      }
      onboarding.data.custos.push(cost);
      onboarding.data.pendingCost = null;

      await analyticsService.track('onboarding_cost_recorded', {
        phone: normalizedPhone,
        source: 'whatsapp',
        properties: {
          valor: cost.valor,
          categoria: cost.categoria,
          total_custos: onboarding.data.custos.length
        }
      });

      // Pergunta se quer adicionar mais custos
      onboarding.step = 'AHA_COSTS_UPLOAD';
      return await respond(onboardingCopy.costSaved(cost.valor) + '\n\n' + onboardingCopy.costAddMore());

    } catch (error) {
      console.error('[ONBOARDING] Erro ao registrar custo:', error);
      return await respond('Ops! Tive um probleminha ao registrar o custo. Vamos tentar de novo?');
    }
  }
};

module.exports = { 
  ahaCostsHandlers,
  COST_CATEGORIES
};
