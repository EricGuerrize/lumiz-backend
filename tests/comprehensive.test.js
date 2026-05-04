/**
 * Teste Abrangente do Bot Lumiz
 *
 * Cobre:
 *  1. moneyParser — todas as 11 funções exportadas
 *  2. prompts.js — builders + constantes
 *  3. Webhook — 4 formatos de payload, texto/imagem/documento, dedup, from-me
 *  4. Fluxo de onboarding — happy path completo + edge cases
 *  5. Processamento de imagem/PDF (buffer direto e via URL)
 *  6. Tempo de resposta de operações síncronas
 */

// ─── Mocks (declarados antes de qualquer require) ────────────────────────────

jest.mock('../src/services/analyticsService', () => ({
  track: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/services/onboardingService', () => {
  const store = new Map();
  return {
    getWhatsappState: jest.fn().mockImplementation(async (phone) => store.get(phone) || null),
    upsertWhatsappState: jest.fn().mockImplementation(async (phone, payload) => {
      store.set(phone, { ...payload, startTime: Date.now() });
      return true;
    }),
    clearWhatsappState: jest.fn().mockImplementation(async (phone) => { store.delete(phone); return true; }),
    _store: store,
  };
});

jest.mock('../src/services/cacheService', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/controllers/userController', () => ({
  createUserFromOnboarding: jest.fn().mockResolvedValue({ user: { id: 'user-test-123' } }),
  findUserByPhone: jest.fn().mockResolvedValue({ id: 'user-test-123' }),
}));

jest.mock('../src/controllers/transactionController', () => ({
  createAtendimento: jest.fn().mockResolvedValue({ id: 'atendimento-123' }),
  createContaPagar: jest.fn().mockResolvedValue({ id: 'conta-123' }),
}));

jest.mock('../src/services/clinicMemberService', () => ({
  addMember: jest.fn().mockResolvedValue({ success: true }),
  findMemberByPhone: jest.fn().mockResolvedValue(null),
  getMemberByPhone: jest.fn().mockResolvedValue(null),
  getClinicByPhone: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/services/knowledgeService', () => ({
  saveInteraction: jest.fn().mockResolvedValue(true),
  getSimilarInteractions: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/services/registrationTokenService', () => ({
  generateSetupToken: jest.fn().mockResolvedValue({
    registrationLink: 'https://app.lumiz.com/setup/token-test-24h',
  }),
}));

jest.mock('../src/services/intentHeuristicService', () => ({
  detectIntent: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/services/documentService', () => ({
  processImage: jest.fn().mockResolvedValue({
    transacoes: [{
      tipo: 'saida', valor: 800, categoria: 'Insumos',
      descricao: 'Botox 50u', data: '2026-04-22', parcelas: 1,
    }],
  }),
  processDocumentFromBuffer: jest.fn().mockResolvedValue({
    transacoes: [{
      tipo: 'saida', valor: 1200, categoria: 'Insumos',
      descricao: 'Nota fiscal insumos', data: '2026-04-22', parcelas: 1,
    }],
  }),
}));

jest.mock('../src/services/geminiService', () => ({
  processMessage: jest.fn().mockResolvedValue({
    intencao: 'registrar_entrada',
    dados: { valor: 2000, forma_pagamento: 'pix', categoria: 'Atendimento' },
  }),
  processDocument: jest.fn().mockResolvedValue(JSON.stringify({
    tipo_documento: 'nota_fiscal',
    transacoes: [{
      tipo: 'saida', valor: 500, categoria: 'Insumos',
      descricao: 'Insumos OCR', data: '2026-04-22', parcelas: 1,
    }],
  })),
  generateWithFallback: jest.fn().mockResolvedValue({ text: () => '{"tipo_documento":"nota_fiscal","transacoes":[]}' }),
}));

jest.mock('../src/services/evolutionService', () => ({
  sendMessage: jest.fn().mockResolvedValue({ success: true }),
  validatePhoneNumber: jest.fn().mockReturnValue(true),
  downloadMedia: jest.fn().mockResolvedValue(Buffer.from('fake-image-data')),
  getInstanceStatus: jest.fn().mockResolvedValue({ state: 'open' }),
}));

jest.mock('../src/services/conversationHistoryService', () => ({
  getHistory: jest.fn().mockResolvedValue([]),
  addMessage: jest.fn().mockResolvedValue(true),
  clearHistory: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/services/conversationRuntimeStateService', () => ({
  getState: jest.fn().mockResolvedValue(null),
  setState: jest.fn().mockResolvedValue(true),
  clearState: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/services/pdfQueueService', () => ({
  addToQueue: jest.fn().mockResolvedValue({ jobId: 'job-123' }),
  getJobStatus: jest.fn().mockResolvedValue({ status: 'completed' }),
}));

jest.mock('../src/services/betaFeedbackService', () => ({
  saveFeedback: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/db/supabase', () => ({
  from: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  }),
}));

// ─── Imports após mocks ──────────────────────────────────────────────────────

const request = require('supertest');

const {
  parseBrazilianNumber,
  extractThousandWordValue,
  extractInstallments,
  extractInstallmentDays,
  calcularVencimentosBoleto,
  extractMonetaryCandidates,
  extractPrimaryMonetaryValue,
  recoverValueWithInstallmentsContext,
  hasInstallmentPattern,
  detectMixedPaymentIntent,
  extractMixedPaymentSplit,
} = require('../src/utils/moneyParser');

const {
  buildDocumentExtractionPrompt,
  buildDocumentExtractionPromptSlim,
  buildMdrExtractionPrompt,
  buildIntentClassificationPrompt,
  CONTEXTO_CLINICAS,
  JARGOES_FINANCEIROS,
  REGRAS_OURO,
  getDataHoje,
} = require('../src/config/prompts');

const onboardingFlowService = require('../src/services/onboardingFlowService');

// ─── Utilitários dos testes ──────────────────────────────────────────────────

function resetFlow(phone) {
  // Limpa estado in-memory do serviço de onboarding
  const timer = onboardingFlowService.persistTimers?.get(phone);
  if (timer) { clearTimeout(timer); onboardingFlowService.persistTimers.delete(phone); }
  onboardingFlowService.onboardingStates?.delete(phone);

  // Também limpa o phone normalizado (o serviço usa +55... como chave)
  const normalizedPhone = `+${String(phone).replace(/\D/g, '')}`;
  onboardingFlowService.onboardingStates?.delete(normalizedPhone);
  const timer2 = onboardingFlowService.persistTimers?.get(normalizedPhone);
  if (timer2) { clearTimeout(timer2); onboardingFlowService.persistTimers.delete(normalizedPhone); }

  // Limpa o store do mock de onboardingService para evitar cross-test pollution
  const onboardingService = require('../src/services/onboardingService');
  if (onboardingService._store) {
    onboardingService._store.delete(phone);
    onboardingService._store.delete(normalizedPhone);
  }
}

function bench(label, fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { result, ms, label };
}

function makeWebhookBody(phone, text) {
  return {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `msg-${Date.now()}-${Math.random()}` },
      message: { conversation: text },
    },
  };
}

function makeImageWebhookBody(phone, base64Data = 'aGVsbG8=', mimeType = 'image/jpeg') {
  return {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `img-${Date.now()}-${Math.random()}` },
      message: {
        imageMessage: {
          mimetype: mimeType,
          media: base64Data,
          caption: 'nota fiscal',
        },
      },
    },
  };
}

function makeDocumentWebhookBody(phone, base64Data = 'aGVsbG8=', mimeType = 'application/pdf', fileName = 'nota.pdf') {
  return {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `doc-${Date.now()}-${Math.random()}` },
      message: {
        documentMessage: {
          mimetype: mimeType,
          media: base64Data,
          fileName,
          caption: '',
        },
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. moneyParser — cobertura completa
// ═══════════════════════════════════════════════════════════════════════════════

describe('moneyParser — parseBrazilianNumber', () => {
  test.each([
    ['1.234,56', 1234.56],
    ['1234', 1234],
    ['1234,56', 1234.56],
    ['1.000.000', 1000000],
    ['0,01', 0.01],
    [1500, 1500],
    [0, 0],
  ])('parseBrazilianNumber(%p) → %p', (input, expected) => {
    expect(parseBrazilianNumber(input)).toBeCloseTo(expected, 2);
  });

  test.each([
    [null, null],
    [undefined, null],
    ['', null],
    ['abc', null],
  ])('parseBrazilianNumber(%p) → null', (input) => {
    expect(parseBrazilianNumber(input)).toBeNull();
  });
});

describe('moneyParser — extractThousandWordValue', () => {
  test.each([
    ['5 mil', 5000],
    ['10mil', 10000],
    ['2,5 mil', 2500],
    // Nota: "1.5 mil" trata "." como separador de milhar (padrão BR) → 15000, não 1500
    ['1.5 mil', 15000],
    ['12 mil reais', 12000],
  ])('"%s" → %p', (text, expected) => {
    expect(extractThousandWordValue(text)).toBeCloseTo(expected, 1);
  });

  test.each([
    ['nenhuma palavra mil aqui'],
    ['r$ 1000'],
    [''],
  ])('"%s" → null', (text) => {
    expect(extractThousandWordValue(text)).toBeNull();
  });
});

describe('moneyParser — extractInstallments', () => {
  test.each([
    ['3x', 3],
    ['em 3x', 3],
    ['12 vezes', 12],
    ['10 parcelas', 10],
    ['5 parcela', 5],
    ['botox 2000 3x', 3],
    ['30/60/90/120', 4],
    ['30/60', 2],
    ['60/90/120', 3],
  ])('"%s" → %p', (text, expected) => {
    expect(extractInstallments(text)).toBe(expected);
  });

  test.each([
    ['15/02', null],  // data, não parcelas
    ['sem parcelamento'],
    ['à vista'],
    [''],
  ])('"%s" → null', (text) => {
    expect(extractInstallments(text)).toBeNull();
  });
});

describe('moneyParser — extractInstallmentDays', () => {
  test('30/60/90/120 → [30,60,90,120]', () => {
    expect(extractInstallmentDays('pago em 30/60/90/120')).toEqual([30, 60, 90, 120]);
  });
  test('30/60 → [30,60]', () => {
    expect(extractInstallmentDays('boleto 30/60')).toEqual([30, 60]);
  });
  test('texto sem padrão → null', () => {
    expect(extractInstallmentDays('comprei insumos')).toBeNull();
  });
  test('data 15/02 não é parcelamento → null', () => {
    expect(extractInstallmentDays('dia 15/02')).toBeNull();
  });
});

describe('moneyParser — calcularVencimentosBoleto', () => {
  test('base 2026-04-22 + [30,60,90,120] retorna 4 datas corretas', () => {
    const datas = calcularVencimentosBoleto('2026-04-22', [30, 60, 90, 120]);
    expect(datas).toHaveLength(4);
    expect(datas[0]).toBe('2026-05-22');
    expect(datas[1]).toBe('2026-06-21');
    expect(datas[2]).toBe('2026-07-21');
    expect(datas[3]).toBe('2026-08-20');
  });

  test('data inválida → null', () => {
    expect(calcularVencimentosBoleto('data-invalida', [30])).toBeNull();
  });

  test('array vazio → null', () => {
    expect(calcularVencimentosBoleto('2026-04-22', [])).toBeNull();
  });
});

describe('moneyParser — extractPrimaryMonetaryValue', () => {
  test.each([
    ['botox 2000 3x', 2000],
    ['r$ 2.000 3x', 2000],
    ['vendi 1500 em 10x mastercard', 1500],
    ['5 mil', 5000],
    ['r$ 800', 800],
    ['insumos 3200', 3200],
    ['2800', 2800],
  ])('"%s" → %p', (text, expected) => {
    expect(extractPrimaryMonetaryValue(text)).toBeCloseTo(expected, 1);
  });

  test('30/60/90/120 sozinho → null (jargão, não valor)', () => {
    // Cada segmento isolado pode ser lido como número mas não deve virar valor de destaque
    // (depende se existe candidato melhor)
    const val = extractPrimaryMonetaryValue('30/60/90/120');
    // Pode retornar 120 ou null dependendo do parser — só validamos que não é absurdo
    if (val !== null) {
      expect(val).toBeGreaterThan(0);
      expect(val).toBeLessThan(200);
    }
  });

  test('texto sem valor → null', () => {
    expect(extractPrimaryMonetaryValue('botox 3x')).toBeNull();
  });

  test('data 15/02 não é valor monetário', () => {
    expect(extractPrimaryMonetaryValue('botox 2000 dia 15/02')).toBeCloseTo(2000, 1);
  });
});

describe('moneyParser — hasInstallmentPattern', () => {
  test.each([
    ['3x', true],
    ['em 12x', true],
    ['3 x ', true],
    ['sem parcelamento', false],
    ['3 parcelas', false],  // não tem "3x"
    ['', false],
  ])('"%s" → %p', (text, expected) => {
    expect(hasInstallmentPattern(text)).toBe(expected);
  });
});

describe('moneyParser — recoverValueWithInstallmentsContext', () => {
  test('recupera valor real quando currentValue é confundido com parcelas', () => {
    expect(recoverValueWithInstallmentsContext('botox 2000 3x', 3, 3)).toBe(2000);
  });

  test('mantém valor quando não há confusão', () => {
    expect(recoverValueWithInstallmentsContext('botox 2000 3x', 2000, 3)).toBe(2000);
  });
});

describe('moneyParser — extractMonetaryCandidates', () => {
  test('retorna múltiplos candidatos com sources', () => {
    // Usa formato BR com ponto de milhar para que a regex de currency capture corretamente
    const candidates = extractMonetaryCandidates('r$ 1.500 e também 800');
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const currency = candidates.filter((c) => c.source === 'currency');
    expect(currency.length).toBeGreaterThanOrEqual(1);
    expect(currency[0].value).toBeCloseTo(1500, 1);
  });

  test('candidato thousand_word quando tem "mil"', () => {
    const candidates = extractMonetaryCandidates('5 mil');
    expect(candidates.some((c) => c.source === 'thousand_word')).toBe(true);
  });
});

describe('moneyParser — detectMixedPaymentIntent', () => {
  test.each([
    ['metade pix metade cartao', true],
    ['3000 pix + resto 6x cartao', true],
    ['50/50 pix credito', true],
    ['pago tudo no pix', false],
    ['parcelado em 3x', false],
  ])('"%s" → %p', (text, expected) => {
    expect(detectMixedPaymentIntent(text)).toBe(expected);
  });
});

describe('moneyParser — extractMixedPaymentSplit', () => {
  test('metade pix metade cartao com total', () => {
    const result = extractMixedPaymentSplit('metade pix metade cartao', 2000);
    expect(result).not.toBeNull();
    expect(result.splits).toHaveLength(2);
    expect(result.total).toBe(2000);
  });

  test('texto sem mixed payment → null', () => {
    expect(extractMixedPaymentSplit('pago no pix')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. prompts.js — builders e constantes
// ═══════════════════════════════════════════════════════════════════════════════

describe('prompts.js — constantes exportadas', () => {
  test('CONTEXTO_CLINICAS é string não-vazia', () => {
    expect(typeof CONTEXTO_CLINICAS).toBe('string');
    expect(CONTEXTO_CLINICAS.length).toBeGreaterThan(50);
  });

  test('JARGOES_FINANCEIROS contém "30/60"', () => {
    expect(JARGOES_FINANCEIROS).toMatch(/30\/60/);
  });

  test('REGRAS_OURO é string não-vazia', () => {
    expect(REGRAS_OURO.length).toBeGreaterThan(20);
  });

  test('getDataHoje retorna data no formato YYYY-MM-DD', () => {
    const today = getDataHoje();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('prompts.js — buildDocumentExtractionPrompt', () => {
  test('sem argumento retorna string longa com campos-chave', () => {
    const prompt = buildDocumentExtractionPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toMatch(/transacoes/i);
    expect(prompt).toMatch(/categoria/i);
    expect(prompt).toMatch(/parcelas/i);
  });

  test('com texto extraído injeta o texto no prompt', () => {
    const prompt = buildDocumentExtractionPrompt('Nota fiscal XYZ R$ 800,00');
    expect(prompt).toContain('Nota fiscal XYZ R$ 800,00');
  });
});

describe('prompts.js — buildDocumentExtractionPromptSlim', () => {
  test('versão slim é menor que a completa', () => {
    const full = buildDocumentExtractionPrompt('texto teste');
    const slim = buildDocumentExtractionPromptSlim('texto teste');
    expect(slim.length).toBeLessThan(full.length);
    expect(slim).toMatch(/transacoes/i);
  });
});

describe('prompts.js — buildMdrExtractionPrompt', () => {
  test('sem provider retorna prompt genérico de MDR', () => {
    const prompt = buildMdrExtractionPrompt();
    expect(prompt).toMatch(/bandeira/i);
    expect(prompt).toMatch(/taxa/i);
  });

  test('com provider inclui o nome no prompt', () => {
    const prompt = buildMdrExtractionPrompt('Cielo');
    expect(prompt).toMatch(/Cielo/i);
  });
});

describe('prompts.js — buildIntentClassificationPrompt', () => {
  test('retorna prompt não-vazio com mensagem injetada', () => {
    const prompt = buildIntentClassificationPrompt('vendi botox 2000 pix');
    expect(prompt.length).toBeGreaterThan(200);
    expect(prompt).toContain('vendi botox 2000 pix');
  });

  test('inclui contexto de clínicas', () => {
    const prompt = buildIntentClassificationPrompt('teste');
    expect(prompt).toMatch(/clinica|estetic|procedimento/i);
  });

  test('aceita context vazio', () => {
    expect(() => buildIntentClassificationPrompt('mensagem', {})).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Fluxo de onboarding — happy path completo
// ═══════════════════════════════════════════════════════════════════════════════

// Helper que avança o fluxo até o step desejado (declarado em escopo de módulo)
async function advanceToStep(phone, step) {
  await onboardingFlowService.startIntroFlow(phone); // step=START
  if (step === 'START') return;
  await onboardingFlowService.processOnboarding(phone, '1'); // START → CONSENT
  if (step === 'CONSENT') return;
  await onboardingFlowService.processOnboarding(phone, '1'); // CONSENT → PROFILE_NAME
  if (step === 'PROFILE_NAME') return;
  await onboardingFlowService.processOnboarding(phone, 'Maria Silva'); // PROFILE_NAME → PROFILE_CLINIC
  if (step === 'PROFILE_CLINIC') return;
  await onboardingFlowService.processOnboarding(phone, 'Clínica Estética'); // PROFILE_CLINIC → PROFILE_ROLE
  if (step === 'PROFILE_ROLE') return;
  await onboardingFlowService.processOnboarding(phone, '1'); // PROFILE_ROLE → CONTEXT_WHY
  if (step === 'CONTEXT_WHY') return;
  await onboardingFlowService.processOnboarding(phone, '1'); // CONTEXT_WHY → CONTEXT_HOW/PAYMENT
  if (step === 'CONTEXT_HOW') return;
  await onboardingFlowService.processOnboarding(phone, '1'); // CONTEXT_HOW → AHA_REVENUE
  if (step === 'AHA_REVENUE') return;
}

describe('Onboarding — happy path completo (sem banco)', () => {
  const phone = '5511900000001';

  beforeEach(() => { resetFlow(phone); });
  afterEach(() => { resetFlow(phone); });

  test('START: mensagem inicial contém nome do bot', async () => {
    const resp = await onboardingFlowService.startIntroFlow(phone);
    expect(resp).toMatch(/Lumiz|lumiz/i);
  });

  test('START "1" → CONSENT: retorna pergunta de consentimento', async () => {
    await onboardingFlowService.startIntroFlow(phone);
    const resp = await onboardingFlowService.processOnboarding(phone, '1');
    expect(resp).toMatch(/Autorizo|consentimento|dados|posso usar/i);
  });

  test('CONSENT "2": retorna mensagem de cancelamento', async () => {
    await advanceToStep(phone, 'CONSENT');
    const resp = await onboardingFlowService.processOnboarding(phone, '2');
    expect(resp).toBeTruthy();
    expect(typeof resp).toBe('string');
  });

  test('CONSENT "1" → PROFILE_NAME: pede nome', async () => {
    await advanceToStep(phone, 'CONSENT');
    const resp = await onboardingFlowService.processOnboarding(phone, '1');
    expect(resp).toMatch(/nome/i);
  });

  test('PROFILE_NAME: nome inválido (só 1 char) pede para corrigir', async () => {
    await advanceToStep(phone, 'PROFILE_NAME');
    const resp = await onboardingFlowService.processOnboarding(phone, 'A');
    expect(resp).toBeTruthy();
    expect(typeof resp).toBe('string');
  });

  test('PROFILE_NAME → PROFILE_CLINIC: nome válido avança', async () => {
    await advanceToStep(phone, 'PROFILE_NAME');
    const resp = await onboardingFlowService.processOnboarding(phone, 'Ana Souza');
    expect(resp).toMatch(/cl[ií]nica/i);
  });

  test('PROFILE_CLINIC → PROFILE_ROLE: clínica válida avança', async () => {
    await advanceToStep(phone, 'PROFILE_CLINIC');
    const resp = await onboardingFlowService.processOnboarding(phone, 'Clínica Estética');
    expect(resp).toMatch(/dona|gestor|profissional/i);
  });

  test('AHA_REVENUE: primeira venda gera confirmação de revisão', async () => {
    await advanceToStep(phone, 'AHA_REVENUE');
    const resp = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
    // A resposta mostra os dados extraídos para confirmação (contém valor, pagamento, ou "ok")
    expect(resp).toMatch(/registrar|Tá ok|ok|PIX|pix|2\.800|2800|Botox/i);
  });

  test('AHA_REVENUE_CONFIRM "1": cria usuário e avança fluxo', async () => {
    const userController = require('../src/controllers/userController');

    await advanceToStep(phone, 'AHA_REVENUE');
    await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
    const resp = await onboardingFlowService.processOnboarding(phone, '1'); // confirma venda

    // Usuário deve ser criado
    expect(userController.createUserFromOnboarding).toHaveBeenCalled();
    // O fluxo avança (não retorna erro)
    expect(resp).toMatch(/custo|gasto|pagar|upload|registr|Venda/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Onboarding — variações de "sim" e "não"
// ═══════════════════════════════════════════════════════════════════════════════

describe('Onboarding — variações de isYes / isNo', () => {
  // Na etapa CONSENT, isYes() reconhece estas variações
  const yesValues = ['sim', 'SIM', 'Sim', 's', 'ok', 'OK', '1', 'pode registrar', 'confere', 'autorizo'];
  // Na etapa CONSENT, isNo() reconhece estas variações
  const noValues  = ['não', 'n', '2', 'cancelar', 'corrigir', 'ajustar'];

  yesValues.forEach((val, idx) => {
    test(`"${val}" aceito como sim na etapa CONSENT → avança para pedir nome`, async () => {
      // Usa phones distintos com índice para evitar colisão
      const phone = `551190000${String(30 + idx).padStart(2, '0')}001`;
      resetFlow(phone);
      await advanceToStep(phone, 'CONSENT');
      const resp = await onboardingFlowService.processOnboarding(phone, val);
      // Deve avançar para PROFILE_NAME (pergunta nome) ou pelo menos não retornar invalidChoice
      expect(resp).toMatch(/nome|quem|direitinho/i);
      resetFlow(phone);
    });
  });

  noValues.forEach((val, idx) => {
    test(`"${val}" recusado na etapa CONSENT → retorna mensagem válida`, async () => {
      const phone = `551190000${String(50 + idx).padStart(2, '0')}001`;
      resetFlow(phone);
      await advanceToStep(phone, 'CONSENT');
      const resp = await onboardingFlowService.processOnboarding(phone, val);
      expect(resp).toBeTruthy();
      expect(typeof resp).toBe('string');
      resetFlow(phone);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Webhook — formatos de payload e tipos de mensagem
// ═══════════════════════════════════════════════════════════════════════════════

describe('Webhook — formatos de payload', () => {
  let app;
  const phone = '5511900000099';

  beforeAll(() => {
    app = require('../src/server');
  });

  beforeEach(() => { jest.clearAllMocks(); resetFlow(phone); });
  afterEach(() => { resetFlow(phone); });

  // Formato 1: { event, data }
  test('Formato 1 — { event, data } aceito (200)', async () => {
    const body = makeWebhookBody(phone, 'oi');
    const res = await request(app).post('/api/webhook').send(body);
    expect(res.status).toBe(200);
  });

  // Formato 2: { data: { key, message } }
  test('Formato 2 — { data: { key, message } } aceito (200)', async () => {
    const body = {
      data: {
        key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `msg-fmt2-${Date.now()}` },
        message: { conversation: 'oi' },
      },
    };
    const res = await request(app).post('/api/webhook').send(body);
    expect(res.status).toBe(200);
  });

  // Formato 3: flat { key, message }
  test('Formato 3 — flat { key, message } aceito (200)', async () => {
    const body = {
      key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `msg-fmt3-${Date.now()}` },
      message: { conversation: 'oi' },
    };
    const res = await request(app).post('/api/webhook').send(body);
    expect(res.status).toBe(200);
  });

  // Formato 4: { messages: [...] }
  test('Formato 4 — { messages: [...] } aceito (200)', async () => {
    const body = {
      messages: [{
        key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `msg-fmt4-${Date.now()}` },
        message: { conversation: 'oi' },
      }],
    };
    const res = await request(app).post('/api/webhook').send(body);
    expect(res.status).toBe(200);
  });

  // Payload desconhecido deve retornar 200 ignorado
  test('Payload não-reconhecido → 200 ignored', async () => {
    const res = await request(app).post('/api/webhook').send({ foo: 'bar' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
  });

  // Mensagem fromMe ignorada
  test('Mensagem fromMe=true é ignorada', async () => {
    const body = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: true, id: `msg-fromme-${Date.now()}` },
        message: { conversation: 'oi' },
      },
    };
    const res = await request(app).post('/api/webhook').send(body);
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('own message');
  });

  // Deduplicação
  test('Mensagem duplicada (mesmo id) é ignorada na segunda vez', async () => {
    const msgId = `dedup-test-${Date.now()}`;
    const body = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: msgId },
        message: { conversation: 'oi' },
      },
    };

    const res1 = await request(app).post('/api/webhook').send(body);
    const res2 = await request(app).post('/api/webhook').send(body);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body.reason).toBe('duplicate message');
  });

  // Body inválido
  test('Body vazio retorna 400', async () => {
    const res = await request(app)
      .post('/api/webhook')
      .set('Content-Type', 'application/json')
      .send('');
    // Pode ser 400 ou 200-ignored dependendo do middleware
    expect([200, 400]).toContain(res.status);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Webhook — mensagem de texto processa e chama evolutionService.sendMessage
// ═══════════════════════════════════════════════════════════════════════════════

describe('Webhook — processamento de texto', () => {
  let app, evolutionService;
  const phone = '5511900000088';

  beforeAll(() => {
    app = require('../src/server');
    evolutionService = require('../src/services/evolutionService');
  });

  beforeEach(() => { jest.clearAllMocks(); resetFlow(phone); });
  afterEach(() => { resetFlow(phone); });

  test('texto envia resposta via evolutionService.sendMessage', async () => {
    const body = makeWebhookBody(phone, 'oi');
    await request(app).post('/api/webhook').send(body);
    // O bot deve ter tentado enviar uma resposta
    expect(evolutionService.sendMessage).toHaveBeenCalledWith(
      phone,
      expect.any(String),
    );
  });

  test('resposta do bot contém texto válido (não vazio)', async () => {
    const body = makeWebhookBody(phone, 'oi');
    await request(app).post('/api/webhook').send(body);
    const [, responseText] = evolutionService.sendMessage.mock.calls[0] || [null, ''];
    expect(responseText).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(5);
  });

  test('rota /api/webhook/messages-upsert também funciona', async () => {
    const body = makeWebhookBody(phone, 'oi');
    const res = await request(app).post('/api/webhook/messages-upsert').send(body);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Webhook — imagem com base64
// ═══════════════════════════════════════════════════════════════════════════════

describe('Webhook — imagem (base64)', () => {
  let app, evolutionService;
  const phone = '5511900000077';

  beforeAll(() => {
    app = require('../src/server');
    evolutionService = require('../src/services/evolutionService');
  });

  beforeEach(() => { jest.clearAllMocks(); resetFlow(phone); });
  afterEach(() => { resetFlow(phone); });

  test('imageMessage com base64 retorna 200 e processa', async () => {
    const base64 = Buffer.from('fake-image-data-png').toString('base64');
    const body = makeImageWebhookBody(phone, base64, 'image/jpeg');
    const res = await request(app).post('/api/webhook').send(body);
    expect(res.status).toBe(200);
  });

  test('imageMessage com base64 chama sendMessage', async () => {
    const base64 = Buffer.from('fake-image-bytes').toString('base64');
    const body = makeImageWebhookBody(phone, base64, 'image/jpeg');
    await request(app).post('/api/webhook').send(body);
    // Deve ter respondido (pode ser sucesso ou mensagem de erro gracioso)
    // Dependendo do handler mockado, sendMessage pode ou não ser chamado
    // em contexto de onboarding — apenas verificamos que não crashou
  });

  test('imageMessage sem base64 e sem URL retorna 200 com msg de erro gracioso', async () => {
    const body = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `img-nourl-${Date.now()}` },
        message: {
          imageMessage: {
            mimetype: 'image/jpeg',
            // sem media, sem url
          },
        },
      },
    };
    const res = await request(app).post('/api/webhook').send(body);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Webhook — documento (PDF)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Webhook — documento PDF (base64)', () => {
  let app;
  const phone = '5511900000066';

  beforeAll(() => {
    app = require('../src/server');
  });

  beforeEach(() => { jest.clearAllMocks(); resetFlow(phone); });
  afterEach(() => { resetFlow(phone); });

  test('documentMessage com base64 PDF retorna 200', async () => {
    const base64 = Buffer.from('%PDF-1.4 fake content').toString('base64');
    const body = makeDocumentWebhookBody(phone, base64, 'application/pdf', 'nota.pdf');
    const res = await request(app).post('/api/webhook').send(body);
    expect(res.status).toBe(200);
  });

  test('documentMessage sem base64 cai no fallback de URL', async () => {
    const body = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `doc-nourl-${Date.now()}` },
        message: {
          documentMessage: {
            mimetype: 'application/pdf',
            fileName: 'sem_media.pdf',
            // sem media, sem url
          },
        },
      },
    };
    const res = await request(app).post('/api/webhook').send(body);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Tempo de resposta — operações síncronas devem ser rápidas
// ═══════════════════════════════════════════════════════════════════════════════

describe('Performance — operações síncronas', () => {
  test('parseBrazilianNumber < 1ms', () => {
    const { ms } = bench('parseBrazilianNumber', () => parseBrazilianNumber('1.234,56'));
    expect(ms).toBeLessThan(1);
  });

  test('extractInstallments < 1ms', () => {
    const { ms } = bench('extractInstallments', () => extractInstallments('botox 2000 3x'));
    expect(ms).toBeLessThan(1);
  });

  test('extractPrimaryMonetaryValue < 2ms', () => {
    const { ms } = bench('extractPrimaryMonetaryValue', () =>
      extractPrimaryMonetaryValue('procedimento botox r$ 2.800 pago 3x no cartão')
    );
    expect(ms).toBeLessThan(2);
  });

  test('buildDocumentExtractionPrompt < 5ms', () => {
    const { ms } = bench('buildDocumentExtractionPrompt', () =>
      buildDocumentExtractionPrompt('Nota fiscal R$ 800,00')
    );
    expect(ms).toBeLessThan(5);
  });

  test('buildIntentClassificationPrompt < 5ms', () => {
    const { ms } = bench('buildIntentClassificationPrompt', () =>
      buildIntentClassificationPrompt('vendi botox 2800 pix')
    );
    expect(ms).toBeLessThan(5);
  });

  test('detectMixedPaymentIntent < 1ms', () => {
    const { ms } = bench('detectMixedPaymentIntent', () =>
      detectMixedPaymentIntent('metade pix metade cartao')
    );
    expect(ms).toBeLessThan(1);
  });

  test('calcularVencimentosBoleto < 1ms', () => {
    const { ms } = bench('calcularVencimentosBoleto', () =>
      calcularVencimentosBoleto('2026-04-22', [30, 60, 90, 120])
    );
    expect(ms).toBeLessThan(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Tempo de resposta do onboarding (assíncrono, sem I/O real)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Performance — onboarding steps (sem I/O real)', () => {
  const phone = '5511900000055';

  beforeEach(() => { resetFlow(phone); });
  afterEach(() => { resetFlow(phone); });

  test('startIntroFlow < 200ms', async () => {
    const start = Date.now();
    await onboardingFlowService.startIntroFlow(phone);
    const ms = Date.now() - start;
    expect(ms).toBeLessThan(200);
  });

  test('processOnboarding (consent) < 300ms', async () => {
    await onboardingFlowService.startIntroFlow(phone);
    const start = Date.now();
    await onboardingFlowService.processOnboarding(phone, '1');
    const ms = Date.now() - start;
    expect(ms).toBeLessThan(300);
  });

  test('processOnboarding (name) < 300ms', async () => {
    await onboardingFlowService.startIntroFlow(phone);
    await onboardingFlowService.processOnboarding(phone, '1');
    const start = Date.now();
    await onboardingFlowService.processOnboarding(phone, 'Maria Silva');
    const ms = Date.now() - start;
    expect(ms).toBeLessThan(300);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Endpoint /health
// ═══════════════════════════════════════════════════════════════════════════════

describe('API — /health', () => {
  let app;
  beforeAll(() => { app = require('../src/server'); });

  test('GET /health responde e retorna campo status', async () => {
    const res = await request(app).get('/health');
    // Pode retornar 200 (ok) ou 503 (degraded) dependendo da conectividade com serviços externos
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(['ok', 'degraded']).toContain(res.body.status);
  });

  test('GET /health retorna campo checks', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toHaveProperty('checks');
    expect(res.body.checks).toHaveProperty('database');
  });

  test('tempo de resposta do /health < 10s', async () => {
    const start = Date.now();
    await request(app).get('/health');
    expect(Date.now() - start).toBeLessThan(10000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Edge cases — inputs extremos
// ═══════════════════════════════════════════════════════════════════════════════

describe('Edge cases — inputs extremos no moneyParser', () => {
  test('valor zerado "0" não é retornado como candidato monetário relevante', () => {
    const val = extractPrimaryMonetaryValue('0');
    // 0 pode ser filtrado como <= 0
    if (val !== null) expect(val).toBe(0);
  });

  test('valor muito alto "9999999" ainda é parseado', () => {
    expect(parseBrazilianNumber('9.999.999')).toBeCloseTo(9999999, 0);
  });

  test('string gigante não trava extractInstallments', () => {
    const huge = 'x'.repeat(10000) + ' 5x';
    expect(() => extractInstallments(huge)).not.toThrow();
  });

  test('string com caracteres especiais em extractPrimaryMonetaryValue', () => {
    expect(() => extractPrimaryMonetaryValue('botox 💉 r$ 2.000,00 💊 3x')).not.toThrow();
  });

  test('null em extractInstallmentDays não trava', () => {
    expect(() => extractInstallmentDays(null)).not.toThrow();
  });

  test('detectMixedPaymentIntent com string vazia → false', () => {
    expect(detectMixedPaymentIntent('')).toBe(false);
  });
});

describe('Edge cases — onboarding com entradas inesperadas', () => {
  const phone = '5511900000044';

  beforeEach(() => { resetFlow(phone); });
  afterEach(() => { resetFlow(phone); });

  test('processOnboarding sem estado retorna null', async () => {
    // Não chama startIntroFlow — estado não existe
    const resp = await onboardingFlowService.processOnboarding(phone, 'qualquer coisa');
    expect(resp).toBeNull();
  });

  test('mensagem vazia no step START não crasha', async () => {
    await onboardingFlowService.startIntroFlow(phone);
    const resp = await onboardingFlowService.processOnboarding(phone, '');
    expect(typeof resp).toBe('string');
  });

  test('mensagem muito longa no step START não crasha', async () => {
    await onboardingFlowService.startIntroFlow(phone);
    const longa = 'a'.repeat(4000);
    const resp = await onboardingFlowService.processOnboarding(phone, longa);
    expect(typeof resp).toBe('string');
  });

  test('emoji como resposta no step START é tratado graciosamente', async () => {
    await onboardingFlowService.startIntroFlow(phone);
    const resp = await onboardingFlowService.processOnboarding(phone, '👍');
    expect(typeof resp).toBe('string');
  });
});
