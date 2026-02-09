const cacheService = require('./cacheService');
const knowledgeService = require('./knowledgeService');
const { extractPrimaryMonetaryValue, extractInstallments } = require('../utils/moneyParser');
const { PROCEDURE_KEYWORDS, sanitizeClientName } = require('../utils/procedureKeywords');

// Constantes
const CACHE_TTL_SECONDS = 300; // 5 minutos
const MIN_CONFIDENCE = 0.7; // Confiança mínima para usar heurística ao invés de Gemini

/**
 * Serviço de heurística para detectar intents comuns sem chamar Gemini
 * Economiza ~60% das chamadas à API (economia: $500-700/mês)
 */
class IntentHeuristicService {
  constructor() {
    // Palavras-chave para intents
    this.keywords = {
      registrar_entrada: [
        'botox', 'preenchimento', 'harmonização', 'harmonizacao', 'bioestimulador',
        'fios', 'peeling', 'laser', 'paciente', 'cliente', 'procedimento',
        'fiz um', 'realizei', 'atendi', 'vendi', 'fechei', 'fiz', 'atendimento',
        'tox', 'preench', 'toxina', 'acido', 'ácido', 'hialurônico', 'hialuronico'
      ],
      registrar_saida: [
        'insumos', 'marketing', 'aluguel', 'energia', 'internet', 'material',
        'produto', 'fornecedor', 'boleto', 'conta', 'paguei', 'gastei', 'comprei',
        'pagar', 'despesa', 'custo', 'gasto', 'conta de', 'salário', 'salario'
      ],
      consultar_saldo: [
        'saldo', 'resumo', 'lucro', 'quanto tenho', 'quanto sobrou', 'sobra',
        'disponível', 'disponivel', 'caixa', 'dinheiro disponível'
      ],
      stats_hoje: [
        'vendas hoje', 'faturamento hoje', 'quanto fiz hoje', 'faturamento do dia',
        'resultado de hoje', 'como foi hoje', 'balanço de hoje', 'hoje vendi',
        'hoje faturado', 'vendas do dia'
      ],
      consultar_historico: [
        'histórico', 'historico', 'últimas', 'ultimas', 'movimentações',
        'movimentacoes', 'transações', 'transacoes', 'últimas vendas',
        'ultimas vendas', 'últimos custos', 'ultimos custos'
      ],
      relatorio_mensal: [
        'relatório', 'relatorio', 'mês', 'mes', 'mensal', 'relatório mensal',
        'relatorio mensal', 'resumo mensal', 'faturamento mensal'
      ],
      consultar_parcelas: [
        'parcelas', 'parcelado', 'cartão', 'cartao', 'receber', 'a receber',
        'parcelas pendentes', 'parcelas a receber'
      ],
      marcar_parcela_paga: [
        'recebi parcela', 'paguei parcela', 'parcela paga', 'recebeu parcela',
        'baixar parcela', 'quitar parcela', 'parcela recebida'
      ],
      consultar_agenda: [
        'agenda', 'agendamentos', 'compromissos', 'consultas marcadas', 'ver agenda',
        'próximos agendamentos', 'proximos agendamentos'
      ],
      consultar_meta: [
        'meta', 'minha meta', 'progresso', 'objetivo', 'quanto falta', 'atingir meta',
        'progresso da meta', 'quanto falta pra meta'
      ],
      insights: [
        'insights', 'dicas', 'sugestoes', 'sugestões', 'recomendacoes', 'recomendações',
        'sugestão', 'sugestao', 'recomendação', 'recomendacao'
      ],
      ajuda: [
        'ajuda', 'como usar', 'exemplos', 'o que você faz', 'como funciona',
        'help', 'comandos', 'o que posso fazer'
      ],
      saudacao: [
        'oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'e aí',
        'e ai', 'tudo bem', 'td bem'
      ],
      desfazer: [
        'cancelar', 'desfazer', 'apagar última', 'apagar ultima', 'errei',
        'deletar última', 'deletar ultima', 'voltar', 'anular'
      ],
      editar_transacao: [
        'editar última', 'editar ultima', 'corrigir última', 'corrigir ultima',
        'mudar última', 'mudar ultima', 'alterar última', 'alterar ultima'
      ],
      buscar_transacao: [
        'buscar', 'encontrar', 'procurar', 'achar', 'mostrar transação',
        'mostrar transacao', 'procurar transação', 'procurar transacao'
      ],
      definir_meta: [
        'minha meta é', 'minha meta e', 'definir meta', 'meta de', 'objetivo de',
        'quero faturar', 'meta para', 'objetivo para'
      ],
      exportar_dados: [
        'exportar', 'baixar relatório', 'baixar relatorio', 'me manda pdf',
        'excel', 'planilha', 'download', 'gerar relatório', 'gerar relatorio'
      ],
      adicionar_numero: [
        'cadastrar número', 'cadastrar numero', 'adicionar número', 'adicionar numero',
        'novo número', 'novo numero', 'registrar número', 'registrar numero',
        'vincular número', 'vincular numero', 'adicionar membro', 'cadastrar membro',
        'adicionar outro whatsapp', 'vincular outro whatsapp', 'quero adicionar',
        'preciso cadastrar um número', 'adicionar celular', 'cadastrar celular'
      ],
      listar_numeros: [
        'meus números', 'meus numeros', 'números cadastrados', 'numeros cadastrados',
        'listar números', 'listar numeros', 'ver números', 'ver numeros',
        'quem tem acesso', 'mostrar números', 'mostrar numeros', 'ver membros',
        'listar membros', 'membros cadastrados'
      ],
      remover_numero: [
        'remover número', 'remover numero', 'excluir número', 'excluir numero',
        'deletar número', 'deletar numero', 'tirar número', 'tirar numero',
        'desvincular número', 'desvincular numero', 'remover membro', 'excluir membro',
        'tirar acesso', 'remover acesso', 'revogar acesso'
      ]
    };
  }

  /**
   * Normaliza texto para comparação
   */
  normalizeText(text) {
    return String(text || '').trim().toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // Remove acentos
  }

  /**
   * Extrai valor numérico do texto (reutiliza lógica do onboardingFlowService)
   */
  extractValue(text) {
    return extractPrimaryMonetaryValue(text);
  }

  /**
   * Extrai informações de venda do texto
   */
  extractSaleInfo(text) {
    const raw = String(text).trim();
    const lower = raw.toLowerCase();

    // Extrai nome do cliente/paciente
    let nomeCliente = null;
    const namePatterns = [
      /(?:cliente|paciente)\s+([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2})/i,
      /^([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2})\s+(?:fez|pagou|comprou|atendeu|realizou)/i,
      /(?:com|para)\s+([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2})/i
    ];

    for (const pattern of namePatterns) {
      const match = raw.match(pattern);
      if (match && match[1]) {
        nomeCliente = match[1].trim();
        break;
      }
    }

    // Extrai procedimento
    let categoria = null;
    for (const keyword of PROCEDURE_KEYWORDS) {
      if (lower.includes(keyword)) {
        categoria = keyword.charAt(0).toUpperCase() + keyword.slice(1);
        break;
      }
    }

    if (!nomeCliente && categoria) {
      const escapedKeywords = PROCEDURE_KEYWORDS.join('|');
      const leadingNamePattern = new RegExp(
        `^([A-Za-zÀ-ÿ]+(?:\\s+[A-Za-zÀ-ÿ]+){0,2})\\s+(${escapedKeywords})\\b`,
        'i'
      );
      const fallbackNameMatch = raw.match(leadingNamePattern);
      if (fallbackNameMatch && fallbackNameMatch[1]) {
        nomeCliente = fallbackNameMatch[1].trim();
      }
    }

    nomeCliente = sanitizeClientName(nomeCliente, categoria);

    // Extrai forma de pagamento
    let formaPagamento = null;
    let parcelas = null;
    let bandeiraCartao = null;

    // PRIMEIRO: Verifica se há padrão "número x" na mensagem inteira (qualquer número seguido de x = parcela)
    const installments = extractInstallments(raw);
    if (installments) {
      formaPagamento = 'parcelado';
      parcelas = installments;
    } else if (lower.includes('pix')) {
      formaPagamento = 'pix';
    } else if (lower.includes('dinheiro')) {
      formaPagamento = 'dinheiro';
    } else if (lower.includes('débito') || lower.includes('debito')) {
      formaPagamento = 'debito';
    } else if (lower.includes('cartão') || lower.includes('cartao') || lower.includes('crédito') || lower.includes('credito')) {
      if (lower.includes('à vista') || lower.includes('a vista') || lower.includes('avista') || lower.includes('1x')) {
        formaPagamento = 'credito_avista';
      } else {
        formaPagamento = 'cartao_indefinido';
      }
    }

    if (lower.includes('mastercard') || lower.includes('master')) {
      bandeiraCartao = 'mastercard';
    } else if (lower.includes('visa')) {
      bandeiraCartao = 'visa';
    } else if (lower.includes('elo')) {
      bandeiraCartao = 'elo';
    } else if (lower.includes('amex')) {
      bandeiraCartao = 'amex';
    }

    return {
      nome_cliente: nomeCliente || null,
      categoria: categoria,
      forma_pagamento: formaPagamento || null,
      parcelas: parcelas,
      bandeira_cartao: bandeiraCartao
    };
  }

  /**
   * Extrai informações de custo do texto
   */
  extractCostInfo(text) {
    const lower = String(text).toLowerCase();

    let categoria = null;
    const costKeywords = {
      'Insumos / materiais': ['insumo', 'material', 'produto'],
      'Aluguel': ['aluguel'],
      'Salários': ['salário', 'salario', 'salarios', 'salários'],
      'Marketing': ['marketing', 'publicidade', 'anúncio', 'anuncio'],
      'Impostos': ['imposto', 'taxa', 'tributo'],
      'Energia': ['energia', 'luz', 'eletricidade'],
      'Internet': ['internet', 'wi-fi', 'wifi'],
      'Fornecedor': ['fornecedor', 'compra', 'comprei']
    };

    for (const [cat, keywords] of Object.entries(costKeywords)) {
      if (keywords.some(kw => lower.includes(kw))) {
        categoria = cat;
        break;
      }
    }

    return {
      categoria: categoria || 'Outros'
    };
  }

  /**
   * Detecta intent usando heurística
   * @param {string} message - Mensagem do usuário
   * @returns {Object|null} - Intent detectado ou null se não conseguir
   */
  async detectIntent(message) {
    if (!message || typeof message !== 'string') {
      return null;
    }

    const normalized = this.normalizeText(message);
    const original = String(message).trim();

    // 1. Tenta Busca Semântica primeiro (Aprendizado Autônomo)
    try {
      const similarInteractions = await knowledgeService.searchSimilarity(original, null, 0.95);
      if (similarInteractions && similarInteractions.length > 0) {
        const bestMatch = similarInteractions[0];
        console.log(`[HEURISTIC] Aprendizado encontrado: "${bestMatch.content}" -> ${bestMatch.intent_name}`);
        return {
          intencao: bestMatch.intent_name,
          dados: { ...bestMatch.metadata, learned: true },
          confidence: bestMatch.similarity,
          source: 'learned'
        };
      }
    } catch (e) {
      console.error('[HEURISTIC] Erro na busca semântica:', e.message);
    }

    // 2. Verifica cache de heurística tradicional
    const cacheKey = `intent:${normalized}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }


    // Detecta "apenas_valor" primeiro (só número)
    const apenasValorMatch = original.trim().match(/^\d+([.,]\d+)?\s*$/);
    if (apenasValorMatch) {
      const valor = this.extractValue(original);
      if (valor) {
        return {
          intencao: 'apenas_valor',
          dados: { valor: valor },
          confidence: 0.9,
          source: 'heuristic'
        };
      }
    }

    // Detecta intent por palavras-chave
    let detectedIntent = null;
    let confidence = 0;

    for (const [intent, keywords] of Object.entries(this.keywords)) {
      const matches = keywords.filter(kw => normalized.includes(kw));
      if (matches.length > 0) {
        // Confiança baseada no número de matches e especificidade
        const matchRatio = matches.length / keywords.length;
        const baseConfidence = Math.min(0.5 + (matchRatio * 0.4), 0.9);

        // Aumenta confiança se tiver valor numérico para transações
        if ((intent === 'registrar_entrada' || intent === 'registrar_saida') && this.extractValue(original)) {
          confidence = Math.min(baseConfidence + 0.2, 0.95);
        } else {
          confidence = baseConfidence;
        }

        detectedIntent = intent;
        break; // Primeira match vence
      }
    }

    // Se não detectou, retorna null (fallback para Gemini)
    if (!detectedIntent || confidence < MIN_CONFIDENCE) {
      return null;
    }

    // Extrai dados baseado no intent
    const dataHoje = new Date().toISOString().split('T')[0];
    let dados = {
      data: dataHoje
    };

    if (detectedIntent === 'registrar_entrada') {
      const valor = this.extractValue(original);
      if (!valor) {
        // Sem valor, confiança baixa - melhor chamar Gemini
        return null;
      }
      const saleInfo = this.extractSaleInfo(original);
      dados = {
        tipo: 'entrada',
        valor: valor,
        categoria: saleInfo.categoria || 'Procedimento',
        forma_pagamento: saleInfo.forma_pagamento || null,
        parcelas: saleInfo.parcelas || null,
        bandeira_cartao: saleInfo.bandeira_cartao || null,
        nome_cliente: saleInfo.nome_cliente || null,
        data: dataHoje
      };
      confidence = 0.85; // Alta confiança para vendas com valor
    } else if (detectedIntent === 'registrar_saida') {
      const valor = this.extractValue(original);
      if (!valor) {
        return null;
      }
      const costInfo = this.extractCostInfo(original);
      dados = {
        tipo: 'saida',
        valor: valor,
        categoria: costInfo.categoria || 'Outros',
        data: dataHoje
      };
      confidence = 0.85; // Alta confiança para custos com valor
    }
    // apenas_valor já foi tratado acima (detectado antes do loop)

    const result = {
      intencao: detectedIntent,
      dados: dados,
      confidence: confidence,
      source: 'heuristic'
    };

    // Cacheia resultado
    await cacheService.set(cacheKey, result, CACHE_TTL_SECONDS);

    return result;
  }

  /**
   * Limpa cache de intents (útil para testes ou invalidação)
   */
  async clearCache() {
    // Não implementado - cache expira automaticamente
    // Se necessário, pode adicionar invalidação por padrão
  }
}

module.exports = new IntentHeuristicService();
