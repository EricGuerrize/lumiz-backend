const cacheService = require('./cacheService');
const knowledgeService = require('./knowledgeService');
const {
  extractPrimaryMonetaryValue,
  extractInstallments,
  extractMixedPaymentSplit
} = require('../utils/moneyParser');
const { PROCEDURE_KEYWORDS, sanitizeClientName } = require('../utils/procedureKeywords');

// Constantes
const CACHE_TTL_SECONDS = 300; // 5 minutos
const MIN_CONFIDENCE = 0.7; // Confiança mínima para usar heurística ao invés de Gemini
const MONTHS_PT = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12
};

function normalizeTextForMonth(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function extractMonthYearFromText(text, now = new Date()) {
  const normalized = normalizeTextForMonth(text);
  let month = null;

  const numericMonthPatterns = [
    /\b(?:mes|mes\s+numero|mes\s+n(?:umero)?|m)\s*(?:de\s*)?(1[0-2]|0?[1-9])\b/i,
    /\b(?:relatorio|resumo|faturamento|pdf)\s+(?:do\s+)?(?:mes\s+)?(1[0-2]|0?[1-9])\b/i,
    /\b(0?[1-9]|1[0-2])\s*\/\s*(20\d{2})\b/i
  ];

  for (const pattern of numericMonthPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (value >= 1 && value <= 12) {
        month = value;
        break;
      }
    }
  }

  for (const [name, value] of Object.entries(MONTHS_PT)) {
    if (month) break;
    const nameNormalized = normalizeTextForMonth(name);
    if (new RegExp(`\\b${nameNormalized}\\b`, 'i').test(normalized)) {
      month = value;
      break;
    }
  }

  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
  return month ? { mes: month, ano: year } : null;
}

/**
 * Serviço de heurística para detectar intents comuns sem chamar Gemini
 * Economiza ~60% das chamadas à API (economia: $500-700/mês)
 */
class IntentHeuristicService {
  constructor() {
    // Palavras-chave para intents
    this.keywords = {
      configurar_estoque: [
        'configurar estoque',
        'cadastrar estoque',
        'montar estoque',
        'inventario inicial',
        'inventário inicial',
        'configurar inventario',
        'configurar inventário',
        'cadastrar inventario',
        'cadastrar inventário',
      ],
      estoque_entrada: [
        'entrada no estoque',
        'entrada de estoque',
        'dar entrada no estoque',
        'recebimento de insumo',
        'compra para estoque',
        'material chegou',
        'estoque entrada',
        'repor estoque',
        'recebimento estoque',
      ],
      estoque_saida: [
        'baixa estoque',
        'baixar estoque',
        'dar baixa',
        'saida estoque',
        'saída estoque',
        'usei estoque',
        'consumi estoque',
        'tirar do estoque',
      ],
      consultar_estoque: [
        'meu estoque',
        'como está o estoque',
        'como esta o estoque',
        'inventário',
        'inventario',
        'resumo estoque',
        'saldo estoque',
        'saldo produto',
        'quanto tem de',
        'quanto tenho de',
        'falta no estoque',
        'situação do estoque',
        'situacao do estoque',
      ],
      consultar_saldo: [
        'saldo', 'resumo', 'lucro', 'quanto tenho', 'quanto sobrou', 'sobra',
        'disponível', 'disponivel', 'caixa', 'dinheiro disponível',
        'balanço', 'balanco', 'resultado', 'fechamento', 'como estou', 'como tá', 'como ta'
      ],
      consultar_gap_caixa: [
        'gap de caixa',
        'risco de caixa',
        'caixa futuro',
        'projecao de caixa',
        'projeção de caixa',
        'caixa projetado',
        'vou ficar negativo',
        'vai faltar caixa',
        'falta dinheiro',
      ],
      briefing_diario: [
        'briefing',
        'resumo do dia',
        'bom dia financeiro',
        'agenda financeira de hoje',
        'o que preciso ver hoje',
        'prioridades de hoje',
      ],
      consultar_historico: [
        'histórico', 'historico', 'últimas', 'ultimas', 'movimentações',
        'movimentacoes', 'transações', 'transacoes', 'últimas vendas',
        'ultimas vendas', 'últimos custos', 'ultimos custos'
      ],
      relatorio_mensal: [
        'relatório', 'relatorio', 'mês', 'mes', 'mensal', 'relatório mensal',
        'relatorio mensal', 'resumo mensal', 'faturamento mensal', 'pdf do mês',
        'pdf do mes', 'relatório pdf', 'relatorio pdf'
      ],
      stats_hoje: [
        'vendas hoje', 'faturamento hoje', 'quanto fiz hoje', 'faturamento do dia',
        'resultado de hoje', 'como foi hoje', 'balanço de hoje', 'hoje vendi',
        'hoje faturado', 'vendas do dia'
      ],
      buscar_transacao: [
        'buscar', 'encontrar', 'procurar', 'achar', 'mostrar transação',
        'mostrar transacao', 'procurar transação', 'procurar transacao'
      ],
      registrar_entrada: [
        'botox', 'preenchimento', 'harmonização', 'harmonizacao', 'bioestimulador',
        'fios', 'peeling', 'laser', 'paciente', 'cliente', 'procedimento',
        'fiz um', 'realizei', 'atendi', 'vendi', 'fechei', 'fiz', 'atendimento',
        'tox', 'preench', 'toxina', 'acido', 'ácido', 'hialurônico', 'hialuronico',
        'apliquei', 'bichectomia', 'rinoplastia', 'limpeza de pele', 'hidratacao',
        'hidratação', 'micropigmentacao', 'micropigmentação', 'massagem', 'drenagem',
        'entrada de', 'recebi de', 'venda de', 'receita de'
      ],
      registrar_saida: [
        'insumos', 'marketing', 'aluguel', 'energia', 'internet', 'material',
        'produto', 'fornecedor', 'boleto', 'conta', 'paguei', 'gastei', 'comprei',
        'pagar', 'despesa', 'custo', 'gasto', 'conta de', 'salário', 'salario',
        'luz', 'agua', 'água', 'telefone', 'celular', 'gas', 'gás', 'condominio',
        'condomínio', 'manutencao', 'manutenção',
        'transferi', 'farmácia', 'farmacia', 'deposito', 'depósito', 'frete',
        'equipamento', 'reparo', 'conserto', 'limpeza', 'seguro', 'licença', 'licenca',
        'saida de', 'saída de', 'paguei o', 'paguei a', 'gastei com'
      ],
      consultar_contas_pagar: [
        'contas a pagar', 'contas pagar', 'ver contas', 'minhas contas',
        'vencimentos', 'calendario de vencimentos', 'calendário de vencimentos',
        'boletos a pagar', 'o que tenho pra pagar', 'o que vence', 'contas do mês'
      ],
      consultar_parcelas: [
        'parcelas', 'parcelado', 'cartão', 'cartao', 'receber', 'a receber',
        'parcelas pendentes', 'parcelas a receber', 'recebiveis', 'recebíveis',
        'recebiveis de cartao', 'recebíveis de cartão'
      ],
      consultar_inadimplencia: [
        'inadimplencia',
        'inadimplência',
        'clientes em atraso',
        'cliente em atraso',
        'recebiveis vencidos',
        'recebíveis vencidos',
        'parcelas vencidas',
        'parcelas atrasadas',
        'quem esta devendo',
        'quem está devendo',
        'cobranca pendente',
        'cobrança pendente'
      ],
      consultar_validade: [
        'validade', 'validades', 'vencimento de lote', 'lote vencendo',
        'produto vencendo', 'produtos vencendo', 'itens vencendo',
        'itens com validade', 'validade estoque'
      ],
      marcar_parcela_paga: [
        'recebi parcela', 'paguei parcela', 'parcela paga', 'recebeu parcela',
        'baixar parcela', 'quitar parcela', 'parcela recebida'
      ],
      consultar_agenda: [
        'agenda', 'agendamentos', 'compromissos', 'consultas marcadas', 'ver agenda',
        'próximos agendamentos', 'proximos agendamentos'
      ],
      definir_meta: [
        'minha meta e', 'minha meta é', 'definir meta', 'meta de faturamento',
        'objetivo de faturamento', 'quero faturar', 'meta para', 'objetivo para'
      ],
      consultar_meta: [
        'ver meta', 'minha meta', 'progresso', 'quanto falta', 'atingir meta',
        'progresso da meta', 'quanto falta pra meta', 'qual minha meta'
      ],
      insights: [
        'insights', 'dicas', 'sugestoes', 'sugestões', 'recomendacoes', 'recomendações',
        'sugestão', 'sugestao', 'recomendação', 'recomendacao'
      ],
      ver_dashboard: [
        'dashboard', 'link', 'qual o link', 'acesso', 'painel', 'site', 'app',
        'abrir dashboard', 'link do dashboard', 'como acesso', 'como entro'
      ],
      ajuda: [
        'ajuda', 'como usar', 'exemplos', 'o que você faz', 'como funciona',
        'help', 'comandos', 'o que posso fazer'
      ],
      saudacao: [
        'oi', 'oii', 'oiii', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite',
        'hey', 'e aí', 'e ai', 'tudo bem', 'td bem', 'na vdd', 'na verdade',
        'opa', 'eai', 'salve', 'alo', 'alô'
      ],
      desfazer: [
        'cancelar', 'desfazer', 'apagar última', 'apagar ultima', 'errei',
        'deletar última', 'deletar ultima', 'apagar último lançamento',
        'apagar ultimo lancamento', 'isso foi teste', 'voltar', 'anular'
      ],
      editar_transacao: [
        'editar última', 'editar ultima', 'corrigir última', 'corrigir ultima',
        'corrigir último lançamento', 'corrigir ultimo lancamento',
        'mudar última', 'mudar ultima', 'alterar última', 'alterar ultima'
      ],
      exportar_dados: [
        'exportar', 'baixar relatório', 'baixar relatorio', 'me manda pdf', 'mandar pdf',
        'excel', 'planilha', 'download', 'gerar relatório', 'gerar relatorio', 'gerar pdf'
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

  /** Quantidade física (ml, caixas) — não valor monetário */
  _extractStockQuantity(text) {
    const t = String(text);
    const m1 = t.match(/(\d+(?:[.,]\d+)?)\s*(?:ml|m[lL]|un|unid|unidades|und|caix|caixas|frasco|frascos)\b/i);
    if (m1) return parseFloat(m1[1].replace(',', '.'));
    const m2 = t.match(/\b(\d{1,6})\s*$/);
    if (m2) return parseFloat(m2[1]);
    return null;
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

    const paymentSplit = extractMixedPaymentSplit(raw, this.extractValue(raw));

    return {
      nome_cliente: nomeCliente || null,
      categoria: categoria,
      forma_pagamento: formaPagamento || null,
      parcelas: parcelas,
      bandeira_cartao: bandeiraCartao,
      payment_split: paymentSplit?.splits || null,
      valor_total: paymentSplit?.total || null
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
      'Energia': ['energia', 'luz', 'eletricidade', 'agua', 'água', 'gas', 'gás'],
      'Internet': ['internet', 'wi-fi', 'wifi', 'telefone', 'celular'],
      'Fornecedor': ['fornecedor', 'compra', 'comprei'],
      'Outros': ['condominio', 'condomínio', 'manutencao', 'manutenção']
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
   * @param {string|null} clinicId - ID da clínica para busca semântica
   * @returns {Object|null} - Intent detectado ou null se não conseguir
   */
  async detectIntent(message, clinicId = null) {
    if (!message || typeof message !== 'string') {
      return null;
    }

    const normalized = this.normalizeText(message);
    const original = String(message).trim();

    // 1. Verifica cache (instantâneo — evita qualquer processamento redundante)
    const cacheKey = `intent:${normalized}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    if (/^(configurar|cadastrar|montar)\s+(estoque|invent[aá]rio)\b/i.test(original) || /^invent[aá]rio inicial\b/i.test(original)) {
      const out = {
        intencao: 'configurar_estoque',
        dados: { itens_texto: original },
        confidence: 0.96,
        source: 'heuristic'
      };
      await cacheService.set(cacheKey, out, CACHE_TTL_SECONDS);
      return out;
    }

    // Comandos consultivos específicos precisam vencer palavras genéricas como "conta" e "pagar".
    const accountsPayableShortcuts = [
      'contas a pagar',
      'contas pagar',
      'vencimentos',
      'calendario de vencimentos',
      'boletos a pagar'
    ];
    if (accountsPayableShortcuts.some((kw) => normalized === kw || normalized.includes(kw))) {
      const out = {
        intencao: 'consultar_contas_pagar',
        dados: {},
        confidence: 0.95,
        source: 'heuristic'
      };
      await cacheService.set(cacheKey, out, CACHE_TTL_SECONDS);
      return out;
    }

    if (/\b(inadimplencia|inadimplência|clientes? em atraso|recebiveis vencidos|recebíveis vencidos|parcelas vencidas|parcelas atrasadas|quem esta devendo|quem está devendo|cobranca pendente|cobrança pendente)\b/i.test(original)) {
      const out = {
        intencao: 'consultar_inadimplencia',
        dados: {},
        confidence: 0.95,
        source: 'heuristic'
      };
      await cacheService.set(cacheKey, out, CACHE_TTL_SECONDS);
      return out;
    }

    if (/\b(gap de caixa|risco de caixa|caixa futuro|projecao de caixa|projeção de caixa|caixa projetado|vou ficar negativo|vai faltar caixa|falta dinheiro)\b/i.test(original)) {
      const out = {
        intencao: 'consultar_gap_caixa',
        dados: {},
        confidence: 0.95,
        source: 'heuristic'
      };
      await cacheService.set(cacheKey, out, CACHE_TTL_SECONDS);
      return out;
    }

    if (/\b(briefing|resumo do dia|bom dia financeiro|agenda financeira de hoje|prioridades de hoje|o que preciso ver hoje)\b/i.test(original)) {
      const out = {
        intencao: 'briefing_diario',
        dados: {},
        confidence: 0.95,
        source: 'heuristic'
      };
      await cacheService.set(cacheKey, out, CACHE_TTL_SECONDS);
      return out;
    }

    const looksLikeProductBalance =
      /^saldo\s+.+/i.test(normalized) &&
      !/\b(caixa|dinheiro|financeiro|mes|mês|geral|total)\b/i.test(normalized);
    if (looksLikeProductBalance) {
      const out = {
        intencao: 'consultar_estoque',
        dados: { produto: this._extractProdutoFromStockText(original) },
        confidence: 0.92,
        source: 'heuristic'
      };
      await cacheService.set(cacheKey, out, CACHE_TTL_SECONDS);
      return out;
    }

    // Detecta "apenas_valor" primeiro (só número)
    // IMPORTANTE: não tratar tokens de opção (1/2/3/4) como valor isolado.
    const apenasValorMatch = original.trim().match(/^\d+([.,]\d+)?\s*$/);
    if (apenasValorMatch) {
      if (['1', '2', '3', '4'].includes(original.trim())) {
        return null;
      }
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

    // Exportação PDF/Excel do relatório (antes do loop — evita confusão com outras intents)
    const exportRel =
      /(?:relat[oó]rio|relatorio|mensal).*(?:pdf|planilha|excel)|(?:pdf|planilha|excel).*(?:relat[oó]rio|relatorio|mensal)|\b(?:gerar|baixar)\s+(?:o\s+)?(?:relat[oó]rio|relatorio).*(?:pdf|planilha|excel)/i;
    const mandaPdf =
      /\b(?:me\s+)?(?:manda|mande|envia|envie)\s+(?:o\s+)?pdf\b/i.test(normalized) ||
      /\bgerar\s+pdf\b/i.test(normalized) ||
      /\brelat[oó]rio\s+em\s+pdf\b/i.test(normalized) ||
      /\brelatorio\s+em\s+pdf\b/i.test(normalized);
    if (exportRel.test(original) || mandaPdf) {
      const formato = /excel|planilha|xlsx|csv/i.test(original) ? 'excel' : 'pdf';
      const monthYear = extractMonthYearFromText(original);
      const out = {
        intencao: 'exportar_dados',
        dados: { formato, ...(monthYear || {}) },
        confidence: 0.93,
        source: 'heuristic'
      };
      await cacheService.set(cacheKey, out, CACHE_TTL_SECONDS);
      return out;
    }

    const isMonthlyReportWithMonth =
      /\b(relat[oó]rio|relatorio|resumo|faturamento)\b/i.test(original) &&
      extractMonthYearFromText(original);
    if (isMonthlyReportWithMonth) {
      const out = {
        intencao: 'relatorio_mensal',
        dados: extractMonthYearFromText(original),
        confidence: 0.94,
        source: 'heuristic'
      };
      await cacheService.set(cacheKey, out, CACHE_TTL_SECONDS);
      return out;
    }

    // Detecta intent por palavras-chave
    let detectedIntent = null;
    let confidence = 0;

    for (const [intent, keywords] of Object.entries(this.keywords)) {
      const matches = keywords.filter(kw => normalized.includes(kw));
      if (matches.length > 0) {
        // Verifica se é um match exato (a mensagem é exatamente uma das palavras-chave)
        const isExactMatch = keywords.some(kw => normalized === kw);
        
        // Confiança baseada no número de matches e especificidade
        const matchRatio = matches.length / keywords.length;
        let baseConfidence = isExactMatch ? 0.95 : Math.min(0.5 + (matchRatio * 0.4), 0.9);

        // Aumenta confiança se tiver valor numérico para transações e definição de meta
        if ((intent === 'registrar_entrada' || intent === 'registrar_saida' || intent === 'definir_meta') && this.extractValue(original)) {
          confidence = Math.min(baseConfidence + 0.2, 0.95);
        } else {
          confidence = baseConfidence;
        }

        detectedIntent = intent;
        console.log(`[HEURISTIC] Match encontrado: ${intent} (confiança: ${confidence})`);
        break; // Primeira match vence
      }
    }

    // Se não detectou com confiança suficiente, tenta busca semântica (Aprendizado Autônomo)
    // Feito APÓS keyword matching para não penalizar msgs que já têm match rápido
    if (!detectedIntent || confidence < MIN_CONFIDENCE) {
      try {
        const similarInteractions = await knowledgeService.searchSimilarity(original, clinicId, 0.95);
        if (similarInteractions && similarInteractions.length > 0) {
          const bestMatch = similarInteractions[0];
          console.log('[KNOWLEDGE][LEARNED_HIT]', {
            clinicId: clinicId || null,
            intentName: bestMatch.intent_name,
            similarity: bestMatch.similarity
          });
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
        valor: saleInfo.valor_total || valor,
        categoria: saleInfo.categoria || 'Procedimento',
        forma_pagamento: saleInfo.forma_pagamento || null,
        parcelas: saleInfo.parcelas || null,
        bandeira_cartao: saleInfo.bandeira_cartao || null,
        payment_split: saleInfo.payment_split || null,
        valor_total: saleInfo.valor_total || null,
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
    } else if (detectedIntent === 'estoque_entrada') {
      const saleInfo = this.extractSaleInfo(original);
      const q = this._extractStockQuantity(original);
      const categoria = saleInfo.categoria || null;
      dados = { categoria, quantidade: q, data: dataHoje };
      if (!categoria || !q || q <= 0) {
        return null;
      }
      confidence = 0.88;
    } else if (detectedIntent === 'estoque_saida') {
      const saleInfo = this.extractSaleInfo(original);
      const q = this._extractStockQuantity(original);
      const categoria = saleInfo.categoria || this._extractProdutoFromStockText(original);
      dados = { categoria, produto: categoria, quantidade: q, data: dataHoje };
      if (!categoria || !q || q <= 0) {
        return null;
      }
      confidence = 0.88;
    } else if (detectedIntent === 'consultar_estoque') {
      dados = { data: dataHoje, produto: this._extractProdutoFromStockText(original) };
      confidence = 0.9;
    } else if (detectedIntent === 'consultar_gap_caixa' || detectedIntent === 'briefing_diario' || detectedIntent === 'consultar_inadimplencia') {
      dados = { data: dataHoje };
      confidence = 0.9;
    } else if (detectedIntent === 'consultar_validade') {
      const daysMatch = original.match(/\b(\d{1,3})\s*(?:dias|dia|d)\b/i);
      dados = {
        data: dataHoje,
        dias: daysMatch ? Math.min(Math.max(Number(daysMatch[1]) || 90, 1), 365) : 90
      };
      confidence = 0.9;
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

  _extractProdutoFromStockText(text) {
    const raw = String(text || '').trim();
    const cleaned = raw
      .replace(/\b(?:meu|minha|estoque|inventario|inventário|resumo|saldo|produto|quanto|tenho|tem|de|do|da|baixar|baixa|dar|saida|saída|usei|consumi|tirar|no|na)\b/gi, ' ')
      .replace(/\d+(?:[.,]\d+)?\s*(?:ml|un|unid|unidades|caixas?|frascos?)?\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || null;
  }
}

module.exports = new IntentHeuristicService();
