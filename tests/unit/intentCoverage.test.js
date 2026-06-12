/**
 * Golden Dataset — Cobertura de Intents
 *
 * A heurística captura frases com ALTA confiança (>= 0.7) para economizar
 * chamadas ao Gemini. Frases com baixa confiança caem no Gemini por design.
 *
 * Este arquivo testa duas coisas:
 *  1. HEURISTIC: frases que devem ser capturadas sem chamar Gemini
 *  2. FALLBACK: frases que devem cair no Gemini (retorna null)
 *
 * Como adicionar casos:
 *   heuristic: { msg, intent } — espera confiança >= 0.7
 *   fallback:  { msg }         — espera null (vai pro Gemini)
 *
 * Rodar: npx jest tests/unit/intentCoverage.test.js
 */

jest.mock('../../src/services/cacheService', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/services/knowledgeService', () => ({
  searchSimilarInteractions: jest.fn().mockResolvedValue([]),
  searchSimilarity: jest.fn().mockResolvedValue([]),
}));

const heuristic = require('../../src/services/intentHeuristicService');

const MIN_CONFIDENCE = 0.7;

// ─── Casos capturados pela heurística (sem Gemini) ───────────────────────────
// A heurística aplica +0.2 de bônus quando há valor numérico na frase +
// keyword de receita/custo. Logo, frases com valor monetário têm prioridade.
// exportar_dados tem regex própria de alta confiança (0.93).

const HEURISTIC_CASES = [
  // Receitas com valor → bônus garante >= 0.7
  { msg: 'Botox 2800 pix hoje',                  intent: 'registrar_entrada' },
  { msg: 'Venda de preenchimento 1200',           intent: 'registrar_entrada' },
  { msg: 'Atendimento limpeza de pele 350',       intent: 'registrar_entrada' },
  { msg: 'Receita de procedimento 800',           intent: 'registrar_entrada' },

  // Custos com valor → bônus garante >= 0.7
  { msg: 'Paguei 800 pro fornecedor',            intent: 'registrar_saida' },
  { msg: 'Aluguel 2000 hoje',                    intent: 'registrar_saida' },
  { msg: 'Comprei insumos 600',                  intent: 'registrar_saida' },
  { msg: 'Conta de luz 340',                     intent: 'registrar_saida' },
  { msg: 'Gastei 1200 com material',             intent: 'registrar_saida' },
  { msg: 'Paguei funcionária 1800',              intent: 'registrar_saida' },

  // Exportação — regex especial de alta confiança
  { msg: 'Me manda o PDF do mês',               intent: 'exportar_dados' },
  { msg: 'Gerar relatório em PDF',               intent: 'exportar_dados' },
  { msg: 'Baixar relatório em planilha',         intent: 'exportar_dados' },

  // Apenas valor numérico isolado
  { msg: '1500',                                 intent: 'apenas_valor' },
  { msg: '2800,50',                              intent: 'apenas_valor' },

  // Valor + forma de pagamento → heurística detecta como entrada
  { msg: 'Recebi 1500 no pix',                  intent: 'registrar_entrada' },
];

// ─── Casos que devem cair no Gemini (retorna null) ──────────────────────────
// Consultas abertas têm confiança < 0.7 porque correspondem a apenas 1 keyword
// de uma lista longa. Isso é correto: o Gemini é mais preciso para esses casos.

const FALLBACK_CASES = [
  { msg: 'Quanto entrou esse mês?' },       // "mês" → relatorio_mensal, confiança 0.53
  { msg: 'Qual meu saldo?' },               // "saldo" → consultar_saldo, confiança 0.53
  { msg: 'Mostra minhas últimas vendas' },  // "últimas" → consultar_historico, 0.57
  { msg: 'Oi tudo bem?' },
  { msg: 'Quero saber mais sobre a Lumiz' },
  { msg: 'Como funciona o financeiro?' },
];

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('intentHeuristicService — capturadas sem Gemini', () => {
  test.each(HEURISTIC_CASES)('"%s" → $intent', async ({ msg, intent }) => {
    const result = await heuristic.detectIntent(msg);

    expect(result).not.toBeNull();
    expect(result.intencao ?? result.intentName ?? result.intent).toBe(intent);
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });
});

describe('intentHeuristicService — caem no Gemini por design', () => {
  test.each(FALLBACK_CASES)('"%s" → null (vai pro Gemini)', async ({ msg }) => {
    const result = await heuristic.detectIntent(msg);
    const highConfidence = result != null && result.confidence >= MIN_CONFIDENCE;
    expect(highConfidence).toBe(false);
  });
});

describe('intentHeuristicService — cobertura mínima de intents críticos', () => {
  const CRITICAL_INTENTS = [
    'registrar_entrada',
    'registrar_saida',
    'exportar_dados',
  ];

  test.each(CRITICAL_INTENTS)('ao menos 3 frases cobrem "%s"', async (intent) => {
    const cases = HEURISTIC_CASES.filter((c) => c.intent === intent);
    expect(cases.length).toBeGreaterThanOrEqual(3);

    const results = await Promise.all(cases.map((c) => heuristic.detectIntent(c.msg)));
    const hits = results.filter(
      (r) => r && (r.intencao ?? r.intentName ?? r.intent) === intent && r.confidence >= MIN_CONFIDENCE
    );
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });
});
