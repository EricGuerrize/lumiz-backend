/**
 * Configuração centralizada de prompts para IA
 * 
 * Todos os prompts usados para processamento de documentos, mensagens e OCR
 * devem ser definidos aqui para facilitar manutenção e consistência.
 */

/**
 * Retorna a data de hoje formatada para uso nos prompts
 */
function getDataHoje() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Persona base da Lumiz
 */
const PERSONA = {
  nome: 'LUMIZ',
  descricao: 'assistente financeira para clínicas de estética e odontologia',
  tom: 'Direto, profissional e gentil. Evite "economês" e termos técnicos.',
  vocabulario: ['entrou', 'saiu', 'sobrou', 'lucro', 'custos', 'receitas'],
  emojis: ['✅', '💸', '📊', '💜', '📋', '🎯', '📈'],
  regra_ouro: 'Nunca invente dados. Se faltar info, assuma defaults seguros.'
};

/**
 * Tipos de documentos suportados
 */
const TIPOS_DOCUMENTO = [
  { id: 'boleto', nome: 'BOLETO', descricao: 'código de barras, valor, vencimento, beneficiário' },
  { id: 'extrato', nome: 'EXTRATO BANCÁRIO', descricao: 'lista de transações com datas e valores' },
  { id: 'comprovante_pix', nome: 'COMPROVANTE PIX', descricao: 'transferência PIX com valor, data, remetente/destinatário' },
  { id: 'comprovante', nome: 'COMPROVANTE DE PAGAMENTO', descricao: 'valor pago, data, destinatário' },
  { id: 'nota_fiscal', nome: 'NOTA FISCAL', descricao: 'valor total, fornecedor, data, itens, CNPJ' },
  { id: 'fatura', nome: 'FATURA DE CARTÃO', descricao: 'valor total, parcelas, vencimento, bandeira' },
  { id: 'recibo', nome: 'RECIBO', descricao: 'valor, serviço prestado, data' }
];

/**
 * Regras comuns para extração de documentos
 */
const REGRAS_EXTRACAO = `
REGRAS IMPORTANTES:
- Para BOLETO/NOTA FISCAL/FATURA: sempre é SAÍDA (custo a pagar)
- Para COMPROVANTE PIX:
  * Identifique seções "De" (remetente) e "Para" (destinatário)
  * Se você RECEBEU = tipo "entrada"
  * Se você ENVIOU = tipo "saida"
  * Para Mercado Pago/Nubank: assuma que quem envia o comprovante FEZ a transferência (saída)
- Para NOTA FISCAL (DANFE, NFe):
  * SEMPRE é tipo "saida" (você comprou algo)
  * Extraia: nome do fornecedor, valor total, data, número da NF
- Para EXTRATO: cada linha é uma transação (crédito=entrada, débito=saída)
- SEMPRE extraia pelo menos uma transação se identificar o documento
- Valores SEMPRE positivos
- Data no formato YYYY-MM-DD
`.trim();

/**
 * Formato de resposta JSON para documentos
 */
const FORMATO_RESPOSTA_DOCUMENTO = `
RETORNE APENAS JSON NO SEGUINTE FORMATO:
{
  "tipo_documento": "boleto" | "extrato" | "comprovante_pix" | "comprovante" | "nota_fiscal" | "fatura" | "recibo" | "nao_identificado",
  "transacoes": [
    {
      "tipo": "entrada" | "saida",
      "valor": 1234.56,
      "categoria": "Nome da categoria",
      "data": "YYYY-MM-DD",
      "descricao": "Descrição detalhada"
    }
  ]
}
`.trim();

/**
 * Prompt para extração de dados de documentos (imagem/PDF)
 * @param {string} dataHoje - Data atual no formato YYYY-MM-DD
 * @param {string} textoExtraido - Texto extraído do documento (opcional, para OCR)
 */
function buildDocumentExtractionPrompt(textoExtraido = null) {
  const dataHoje = getDataHoje();
  
  const tiposDoc = TIPOS_DOCUMENTO
    .map((t, i) => `${i + 1}. ${t.nome}: ${t.descricao}`)
    .join('\n');

  let basePrompt = `
TAREFA: Analisar este documento financeiro e extrair informações estruturadas.

DATA DE HOJE: ${dataHoje}

TIPOS DE DOCUMENTO:
${tiposDoc}

EXTRAÇÃO:
- tipo_documento: tipo identificado
- transacoes: array de transações encontradas:
  - tipo: "entrada" (recebi dinheiro) ou "saida" (paguei dinheiro)
  - valor: número (positivo)
  - categoria: CATEGORIA DE NEGÓCIO (use uma destas: "Aluguel", "Salários", "Insumos", "Fornecedores", "Internet / Telefone", "Água / Luz / Gás", "Impostos", "Marketing", "Equipamentos", "Serviços", "Outros") — NUNCA use nomes de pessoas ou empresas como categoria
  - data: YYYY-MM-DD
  - descricao: detalhes adicionais (pode incluir nome do fornecedor/destinatário aqui)

${REGRAS_EXTRACAO}

${FORMATO_RESPOSTA_DOCUMENTO}
`.trim();

  // Se temos texto extraído (OCR), adiciona ao prompt
  if (textoExtraido) {
    basePrompt = `
TAREFA: Analisar este texto extraído de um documento financeiro e extrair informações estruturadas.

TEXTO EXTRAÍDO DO DOCUMENTO:
${textoExtraido}

DATA DE HOJE: ${dataHoje}

TIPOS DE DOCUMENTO:
${tiposDoc}

EXTRAÇÃO:
- tipo_documento: tipo identificado
- transacoes: array de transações encontradas:
  - tipo: "entrada" (recebi dinheiro) ou "saida" (paguei dinheiro)
  - valor: número (positivo)
  - categoria: CATEGORIA DE NEGÓCIO (use uma destas: "Aluguel", "Salários", "Insumos", "Fornecedores", "Internet / Telefone", "Água / Luz / Gás", "Impostos", "Marketing", "Equipamentos", "Serviços", "Outros") — NUNCA use nomes de pessoas ou empresas como categoria
  - data: YYYY-MM-DD
  - descricao: detalhes adicionais (pode incluir nome do fornecedor/destinatário aqui)

${REGRAS_EXTRACAO}

${FORMATO_RESPOSTA_DOCUMENTO}
`.trim();
  }

  return basePrompt;
}

/**
 * Prompt para extração de taxas MDR de maquininhas
 * @param {string} provider - Nome do provider (opcional)
 */
function buildMdrExtractionPrompt(provider = null) {
  const providers = provider
    ? [provider]
    : ['Stone', 'PagSeguro', 'Rede', 'Cielo', 'GetNet', 'Mercado Pago'];

  return `
Você é um especialista em adquirência. Leia o print de taxas da maquininha e devolva APENAS um JSON com o seguinte formato:
{
  "provider": "nome encontrado ou sugerido",
  "bandeiras": [
    {
      "nome": "Visa",
      "debito_percent": 1.45,
      "credito_avista_percent": 3.19,
      "parcelado_percent": {
        "2x": 4.29,
        "3x": 4.99,
        "...": 0
      }
    }
  ],
  "tiposVenda": {
    "debito": {
      "liquidacao": "D+1",
      "taxa_media": 1.45
    },
    "credito_avista": {
      "liquidacao": "D+30",
      "taxa_media": 3.19
    },
    "parcelado": {
      "liquidacao": "D+30",
      "tabela": {
        "2x": 4.29,
        "3x": 4.99,
        "4x": 5.69,
        "5x": 6.39,
        "6x": 6.99,
        "7x": 7.59,
        "8x": 8.19,
        "9x": 8.79,
        "10x": 9.39,
        "11x": 9.99,
        "12x": 10.59
      }
    }
  },
  "observacoes": "comentários importantes"
}

REGRAS:
- Se algum campo não estiver no print, use null.
- Valores sempre em porcentagem com duas casas decimais.
- Informe o provider detectado ou o mais provável (entre ${providers.join(', ')}).
- NÃO retorne texto fora do JSON.
`.trim();
}

/**
 * Prompt para classificação de intenção de mensagens
 * @param {string} message - Mensagem do usuário
 * @param {Object} context - Contexto adicional
 */
function buildIntentClassificationPrompt(message, context = {}) {
  const dataHoje = getDataHoje();

  return `
TAREFA: Analisar mensagem e retornar JSON com intenção e dados extraídos.

CONTEXTO: Clínica de estética.
DATA DE HOJE: ${dataHoje}

SYSTEM INSTRUCTIONS:
- Você é a ${PERSONA.nome}, uma ${PERSONA.descricao}.
- TOM DE VOZ: ${PERSONA.tom}
- VOCABULÁRIO: Use "${PERSONA.vocabulario.join('", "')}".
- FORMATAÇÃO: Use quebras de linha e emojis pontuais (${PERSONA.emojis.join(', ')}) para clareza visual.
- REGRA DE OURO: ${PERSONA.regra_ouro}

REGRA PRINCIPAL DE CLASSIFICAÇÃO:
- Palavras que indicam VENDA (registrar_entrada): botox, preenchimento, harmonização, bioestimulador, fios, peeling, laser, paciente, cliente, procedimento, fiz um, realizei, atendi, vendi, fechei, fiz, atendimento, tox, preench
- Palavras que indicam CUSTO (registrar_saida): insumos, marketing, aluguel, energia, internet, material, produto, fornecedor, boleto, conta, paguei, gastei, comprei, pagar

MENSAGEM ATUAL: "${message}"

INTENÇÕES:
- registrar_entrada: tem palavra de VENDA (com ou sem valor)
- registrar_saida: tem palavra de CUSTO (com ou sem valor)
- consultar_saldo: saldo, resumo, lucro, quanto tenho
- consultar_historico: histórico, últimas, movimentações
- relatorio_mensal: relatório, mês, mensal
- comparar_meses: comparar, comparação, versus, vs, mês passado
- consultar_parcelas: parcelas, parcelado, cartão, a receber
- stats_hoje: vendas hoje, faturamento hoje, quanto fiz hoje
- ranking_procedimentos: qual mais vendido, procedimento mais vendido, ranking
- marcar_parcela_paga: recebi parcela, paguei parcela, parcela paga
- exportar_dados: exportar, baixar relatório, pdf, excel, planilha
- consultar_agenda: agenda, agendamentos, compromissos
- consultar_meta: meta, minha meta, progresso, objetivo
- insights: insights, dicas, sugestões, recomendações
- ajuda: ajuda, como usar, exemplos, como funciona
- saudacao: oi, olá, bom dia, boa tarde, boa noite
- desfazer: cancelar, desfazer, apagar última, errei
- editar_transacao: editar última, corrigir última, mudar última
- buscar_transacao: buscar, encontrar, procurar, achar
- definir_meta: minha meta é, definir meta, meta de
- enviar_documento: boleto, extrato, nota fiscal, comprovante, documento, pdf
- codigo_boleto: sequência longa de dígitos (44-48 números)
- apenas_valor: SÓ um número isolado (até 6 dígitos)
- apenas_procedimento: SÓ nome de procedimento/produto, sem valor
- mensagem_ambigua: não conseguiu identificar

EXTRAÇÃO:
- VALOR: números (1500, 2.800, 3mil = 3000). Se não houver, retorne null.
- CATEGORIA: nome do procedimento ou tipo de custo
- DESCRICAO: paciente, marca, forma de pagamento
- DATA: "${dataHoje}" por padrão. Calcule datas relativas (ontem, anteontem, segunda, etc.)

RETORNE JSON:
{
  "intencao": "...",
  "dados": {
    "valor": null | number,
    "categoria": null | string,
    "descricao": null | string,
    "data": "YYYY-MM-DD",
    "cliente": null | string,
    "formas_pagamento": null | [{ "tipo": "pix|dinheiro|cartao_debito|cartao_credito", "valor": number, "parcelas": number }],
    "codigo_boleto": null | string,
    "mes_referencia": null | "YYYY-MM"
  },
  "confianca": 0.0-1.0,
  "resposta_sugerida": null | string
}
`.trim();
}

module.exports = {
  PERSONA,
  TIPOS_DOCUMENTO,
  REGRAS_EXTRACAO,
  FORMATO_RESPOSTA_DOCUMENTO,
  buildDocumentExtractionPrompt,
  buildMdrExtractionPrompt,
  buildIntentClassificationPrompt,
  getDataHoje
};
