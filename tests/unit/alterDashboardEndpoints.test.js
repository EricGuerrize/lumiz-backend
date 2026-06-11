/**
 * Alter dashboard endpoints — HTTP smoke test (Onda 3).
 *
 * Cobre rotas em dashboard.routes.js (linhas ~1953–2192) e webhook Alter.
 * Padrão: supertest + jest.doMock (whoamiEndpoint / configFeaturesEndpoint).
 *
 * Garantias:
 *   - Auth guard (401 sem token)
 *   - Feature flag guard (403 quando alter_enabled=false)
 *   - Validação de body (400)
 *   - Smoke 200/201 nos endpoints felizes com services mockados
 *   - MFA nas rotas sensíveis (pass-through mockado)
 *   - Webhook Alter: fail-closed prod, assinatura inválida, aceite em test
 */

const express = require('express');
const crypto = require('crypto');
const supertest = require('supertest');

const TEST_USER = { id: 'test-user-alter' };
const AUTH = { Authorization: 'Bearer test-jwt-alter' };

describe('Alter dashboard endpoints — HTTP smoke', () => {
  const ORIGINAL_ENV = { ...process.env };

  let isEnabledMock;
  let alterRecebiveisMocks;
  let antecipacaoMocks;
  let coberturaMocks;
  let pagarMocks;
  let alterAdapterMocks;
  let auditLogMock;

  function stub(name) {
    return jest.fn().mockResolvedValue({});
  }

  function mockCommonDashboardDeps({
    alterEnabled = true,
    authUser = TEST_USER,
  } = {}) {
    jest.resetModules();

    isEnabledMock = jest.fn().mockImplementation(async (flag) => {
      if (flag === 'alter_enabled') return alterEnabled;
      return true;
    });

    jest.doMock('../../src/services/featureFlagService', () => {
      const requireFeature = (flag) => async (req, res, next) => {
        const enabled = await isEnabledMock(flag, req.user?.id || null);
        if (!enabled) {
          return res.status(403).json({
            error: 'feature_disabled',
            flag,
            message: `Feature ${flag} está desabilitada para este usuário.`,
          });
        }
        return next();
      };
      return {
        isEnabled: (...args) => isEnabledMock(...args),
        requireFeature,
        listForUser: jest.fn().mockResolvedValue({}),
      };
    });

    jest.doMock('../../src/middleware/authMiddleware', () => ({
      authenticateToken: (req, res, next) => {
        if (!req.headers.authorization) {
          return res.status(401).json({ error: 'Token de acesso requerido' });
        }
        req.user = authUser;
        return next();
      },
      authenticateFlexible: (_req, _res, next) => next(),
    }));

    jest.doMock('../../src/middleware/mfaMiddleware', () => ({
      requireMFA: (_req, _res, next) => next(),
    }));

    jest.doMock('../../src/middleware/dashboardRouteRateLimits', () => ({
      heavyDashboardReadLimiter: (_req, _res, next) => next(),
      dashboardExportLimiter: (_req, _res, next) => next(),
    }));

    jest.doMock('../../src/middleware/validationMiddleware', () => ({
      validate: () => (_req, _res, next) => next(),
    }));

    jest.doMock('../../src/validators/dashboard.validators', () => ({
      monthlyReportSchema: {},
      searchTransactionsSchema: {},
      updateTransactionSchema: {},
      deleteTransactionSchema: {},
    }));

    jest.doMock('../../src/db/supabase', () => ({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      })),
      auth: { getUser: jest.fn() },
    }));

    auditLogMock = { log: jest.fn().mockResolvedValue(undefined) };
    jest.doMock('../../src/services/auditLogService', () => auditLogMock);

    alterRecebiveisMocks = {
      list: jest.fn().mockResolvedValue([]),
      getPosicao: jest.fn().mockResolvedValue({ total_bruto: 0, total_liquido: 0 }),
      getAging: jest.fn().mockResolvedValue({
        buckets: [],
        total: 0,
        meta: { is_empty: true, hint: 'Sem recebíveis.' },
      }),
      getMix: jest.fn().mockResolvedValue({
        adquirentes: [],
        meta: { is_empty: true, hint: 'Sem mix.' },
      }),
    };
    jest.doMock('../../src/services/alter/alterRecebiveisService', () => alterRecebiveisMocks);

    antecipacaoMocks = {
      recomendar: jest.fn().mockResolvedValue({
        recomendacao: null,
        meta: { is_empty: true, hint: 'Sem sugestão.' },
      }),
      simular: jest.fn().mockResolvedValue({ valor_liquido: 5000, taxa_efetiva: 0.02 }),
      executar: jest.fn().mockResolvedValue({ antecipacao_id: 'ant-smoke-1', status: 'executed' }),
      pararAutomatica: jest.fn().mockResolvedValue({ automatica: false }),
    };
    jest.doMock('../../src/services/alter/antecipacaoService', () => antecipacaoMocks);

    coberturaMocks = {
      calcular: jest.fn().mockResolvedValue({
        fornecedores: [],
        meta: { is_empty: true, hint: 'Sem contas.' },
      }),
    };
    jest.doMock('../../src/services/alter/coberturaFornecedorService', () => coberturaMocks);

    pagarMocks = {
      sugerir: jest.fn().mockResolvedValue({
        cobertura: null,
        meta: { is_empty: true, hint: 'Sem opções.' },
      }),
      executar: jest.fn().mockResolvedValue({ status: 'executed', pagamento_id: 'pay-1' }),
    };
    jest.doMock('../../src/services/alter/pagarComRecebivelService', () => pagarMocks);

    alterAdapterMocks = {
      registerBusinessPartner: jest.fn().mockResolvedValue({ id: 'bp-smoke-1', cnpj: '12345678000199' }),
      requestOptIn: jest.fn().mockResolvedValue({ nuclea_opt_in: { status: 'pending' } }),
      getBusinessPartner: jest.fn().mockResolvedValue(null),
    };
    jest.doMock('../../src/services/alter/alterAdapter', () => alterAdapterMocks);

    // Stubs para demais imports do dashboard.routes (não exercitados neste smoke)
    jest.doMock('../../src/controllers/transactionController', () => ({
      getBalance: stub(),
      getTransactions: stub(),
      searchTransactions: stub(),
      updateTransaction: stub(),
      deleteTransaction: stub(),
    }));
    jest.doMock('../../src/controllers/userController', () => ({
      getUserCategories: jest.fn().mockResolvedValue([]),
    }));
    jest.doMock('../../src/services/cashflowService', () => ({ getCashflow: stub() }));
    jest.doMock('../../src/services/simulatorService', () => ({ run: stub() }));
    jest.doMock('../../src/services/pricingIntelligenceService', () => ({ analyze: stub() }));
    jest.doMock('../../src/services/emergencyModeService', () => ({ getStatus: stub() }));
    jest.doMock('../../src/services/exportService', () => ({ exportTransactions: stub() }));
    jest.doMock('../../src/services/estoqueService', () => ({ list: stub() }));
    jest.doMock('../../src/services/outlookService', () => ({ getOutlook: stub() }));
    jest.doMock('../../src/services/healthScoreService', () => ({ calculate: stub() }));
    jest.doMock('../../src/services/inadimplenciaService', () => ({ getResumo: stub() }));
    jest.doMock('../../src/services/sazonalidadeService', () => ({ analyze: stub() }));
    jest.doMock('../../src/services/procedimentoCustoService', () => ({ list: stub() }));
    jest.doMock('../../src/services/metaCaminhoService', () => ({ getPath: stub() }));
    jest.doMock('../../src/services/colaboradorService', () => ({ list: stub() }));
    jest.doMock('../../src/services/clientePerfilService', () => ({ list: stub() }));
    jest.doMock('../../src/services/margemAlertaService', () => ({ list: stub() }));
    jest.doMock('../../src/services/emailReportService', () => ({ send: stub() }));
    jest.doMock('../../src/services/excelService', () => ({ import: stub() }));
    jest.doMock('../../src/services/outboundMessageService', () => ({ send: stub() }));
    jest.doMock('../../src/copy/excelImportWhatsappCopy', () => ({}));
    jest.doMock('../../src/services/supplierDocumentService', () => ({ list: stub() }));
    jest.doMock('../../src/services/contasReceberService', () => ({ list: stub() }));
    jest.doMock('../../src/services/nfValidadeService', () => ({
      listarProximos: stub(),
      criar: stub(),
      remover: stub(),
    }));
    jest.doMock('../../src/services/analyticsService', () => ({ track: jest.fn() }));
  }

  function mountDashboardApp(opts = {}) {
    mockCommonDashboardDeps(opts);

    if (opts.recebiveisList !== undefined) {
      alterRecebiveisMocks.list.mockResolvedValue(opts.recebiveisList);
    }
    if (opts.recebiveisPosicao !== undefined) {
      alterRecebiveisMocks.getPosicao.mockResolvedValue(opts.recebiveisPosicao);
    }
    if (opts.businessPartner !== undefined) {
      alterAdapterMocks.getBusinessPartner.mockResolvedValue(opts.businessPartner);
    }

    const router = require('../../src/routes/dashboard.routes');
    const app = express();
    app.use(express.json());
    app.use('/api/dashboard', router);
    return app;
  }

  function mountWebhookApp() {
    jest.resetModules();
    const supabaseUpdateMock = jest.fn().mockResolvedValue({ error: null });
    jest.doMock('../../src/db/supabase', () => ({
      from: jest.fn(() => ({
        update: jest.fn(() => ({
          eq: supabaseUpdateMock,
        })),
      })),
    }));
    const router = require('../../src/routes/alterWebhooks');
    const app = express();
    // alterWebhooks usa express.raw internamente na rota
    app.use('/webhooks', router);
    return { app, supabaseUpdateMock };
  }

  function signAlterWebhook(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
    const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return {
      timestamp: String(timestamp),
      signature: `t=${timestamp},v1=${sig}`,
    };
  }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  // ── Guards ───────────────────────────────────────────────────────────────

  describe('guards', () => {
    it('sem token → 401 em qualquer rota alter', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app).get('/api/dashboard/alter/recebiveis');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/token/i);
    });

    it('alter_enabled=false → 403 feature_disabled', async () => {
      const app = mountDashboardApp({ alterEnabled: false });
      const res = await supertest(app)
        .get('/api/dashboard/alter/recebiveis')
        .set(AUTH);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        error: 'feature_disabled',
        flag: 'alter_enabled',
      });
      expect(alterRecebiveisMocks.list).not.toHaveBeenCalled();
    });
  });

  // ── GET recebíveis ─────────────────────────────────────────────────────────

  describe('GET /api/dashboard/alter/recebiveis', () => {
    it('200 com data, posicao e meta', async () => {
      const app = mountDashboardApp({
        recebiveisList: [{ id: 'r1', valor: 100 }],
        recebiveisPosicao: { total_bruto: 100 },
      });

      const res = await supertest(app)
        .get('/api/dashboard/alter/recebiveis?status=pendente&from=2026-01-01')
        .set(AUTH);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.posicao).toEqual({ total_bruto: 100 });
      expect(res.body.meta.is_empty).toBe(false);
      expect(alterRecebiveisMocks.list).toHaveBeenCalledWith(
        'test-user-alter',
        expect.objectContaining({ status: 'pendente', from: '2026-01-01' })
      );
    });

    it('200 empty state com meta.is_empty=true', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .get('/api/dashboard/alter/recebiveis')
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.meta.is_empty).toBe(true);
      expect(res.body.meta.hint).toMatch(/recebíveis/i);
    });
  });

  describe('GET /api/dashboard/alter/recebiveis/aging', () => {
    it('200 delega para alterRecebiveisService.getAging', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .get('/api/dashboard/alter/recebiveis/aging')
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.meta.is_empty).toBe(true);
      expect(alterRecebiveisMocks.getAging).toHaveBeenCalledWith('test-user-alter');
    });
  });

  describe('GET /api/dashboard/alter/recebiveis/mix', () => {
    it('200 delega para alterRecebiveisService.getMix', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .get('/api/dashboard/alter/recebiveis/mix')
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(alterRecebiveisMocks.getMix).toHaveBeenCalledWith('test-user-alter');
    });
  });

  // ── Antecipação ────────────────────────────────────────────────────────────

  describe('GET /api/dashboard/alter/antecipacao/sugestao', () => {
    it('200 com horizonte_dias default 30', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .get('/api/dashboard/alter/antecipacao/sugestao')
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(antecipacaoMocks.recomendar).toHaveBeenCalledWith(
        'test-user-alter',
        { horizonte_dias: 30 }
      );
    });

    it('200 com horizonte_dias customizado', async () => {
      const app = mountDashboardApp();
      await supertest(app)
        .get('/api/dashboard/alter/antecipacao/sugestao?horizonte_dias=60')
        .set(AUTH)
        .expect(200);
      expect(antecipacaoMocks.recomendar).toHaveBeenCalledWith(
        'test-user-alter',
        { horizonte_dias: 60 }
      );
    });
  });

  describe('POST /api/dashboard/alter/antecipacao/simular', () => {
    it('400 quando valor_alvo ausente ou inválido', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/antecipacao/simular')
        .set(AUTH)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valor_alvo/i);
      expect(antecipacaoMocks.simular).not.toHaveBeenCalled();
    });

    it('400 quando valor_alvo negativo', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/antecipacao/simular')
        .set(AUTH)
        .send({ valor_alvo: -10 });
      expect(res.status).toBe(400);
    });

    it('200 com body válido', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/antecipacao/simular')
        .set(AUTH)
        .send({ valor_alvo: 10000, horizonte_dias: 45 });
      expect(res.status).toBe(200);
      expect(res.body.valor_liquido).toBe(5000);
      expect(antecipacaoMocks.simular).toHaveBeenCalledWith('test-user-alter', {
        valor_alvo: 10000,
        horizonte_dias: 45,
      });
    });
  });

  describe('POST /api/dashboard/alter/antecipacao/executar', () => {
    it('400 sem valor_alvo nem simulacao', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/antecipacao/executar')
        .set(AUTH)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valor_alvo|simulacao/i);
    });

    it('200 com valor_alvo e audit log', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/antecipacao/executar')
        .set(AUTH)
        .send({ valor_alvo: 5000 });
      expect(res.status).toBe(200);
      expect(res.body.antecipacao_id).toBe('ant-smoke-1');
      expect(auditLogMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-alter',
          action: 'alter_antecipacao_executed',
        })
      );
    });

    it('200 com simulacao (sem valor_alvo)', async () => {
      const app = mountDashboardApp();
      const simulacao = { valor_liquido: 3000 };
      const res = await supertest(app)
        .post('/api/dashboard/alter/antecipacao/executar')
        .set(AUTH)
        .send({ simulacao });
      expect(res.status).toBe(200);
      expect(antecipacaoMocks.executar).toHaveBeenCalledWith(
        'test-user-alter',
        expect.objectContaining({ simulacao })
      );
    });
  });

  describe('POST /api/dashboard/alter/antecipacao/parar-automatica', () => {
    it('200 e audit log', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/antecipacao/parar-automatica')
        .set(AUTH)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.automatica).toBe(false);
      expect(auditLogMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'alter_antecipacao_paused' })
      );
    });
  });

  // ── Cobertura / pagar fornecedor ───────────────────────────────────────────

  describe('GET /api/dashboard/alter/cobertura', () => {
    it('200 com horizonte_dias e snapshot', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .get('/api/dashboard/alter/cobertura?horizonte_dias=60&snapshot=true')
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(coberturaMocks.calcular).toHaveBeenCalledWith('test-user-alter', {
        horizonte_dias: 60,
        persistSnapshot: true,
      });
    });
  });

  describe('POST /api/dashboard/alter/pagar-fornecedor', () => {
    it('400 sem supplier_document_id nem conta_pagar_id', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/pagar-fornecedor')
        .set(AUTH)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/supplier_document_id|conta_pagar_id/i);
    });

    it('200 com conta_pagar_id', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/pagar-fornecedor')
        .set(AUTH)
        .send({ conta_pagar_id: 'cp-1' });
      expect(res.status).toBe(200);
      expect(pagarMocks.sugerir).toHaveBeenCalledWith('test-user-alter', {
        supplier_document_id: undefined,
        conta_pagar_id: 'cp-1',
      });
    });
  });

  describe('POST /api/dashboard/alter/pagar-fornecedor/executar', () => {
    it('400 com recebiveis_ids vazio', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/pagar-fornecedor/executar')
        .set(AUTH)
        .send({ recebiveis_ids: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/recebiveis_ids/i);
    });

    it('200 com recebiveis_ids e audit log', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/pagar-fornecedor/executar')
        .set(AUTH)
        .send({ recebiveis_ids: ['r1', 'r2'], conta_pagar_id: 'cp-9' });
      expect(res.status).toBe(200);
      expect(auditLogMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'alter_pago_recebivel_executed' })
      );
    });
  });

  // ── Onboarding ─────────────────────────────────────────────────────────────

  describe('POST /api/dashboard/alter/onboarding/registrar', () => {
    it('400 sem cnpj', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/onboarding/registrar')
        .set(AUTH)
        .send({ name: 'Clínica Teste' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cnpj/i);
    });

    it('201 com cnpj', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/onboarding/registrar')
        .set(AUTH)
        .send({ name: 'Clínica', cnpj: '12345678000199', email: 'a@b.com' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe('bp-smoke-1');
      expect(alterAdapterMocks.registerBusinessPartner).toHaveBeenCalledWith(
        'test-user-alter',
        expect.objectContaining({ cnpj: '12345678000199' })
      );
    });
  });

  describe('POST /api/dashboard/alter/onboarding/opt-in', () => {
    it('200 delega para alterAdapter.requestOptIn', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .post('/api/dashboard/alter/onboarding/opt-in')
        .set(AUTH)
        .send({});
      expect(res.status).toBe(200);
      expect(alterAdapterMocks.requestOptIn).toHaveBeenCalledWith('test-user-alter');
    });
  });

  describe('GET /api/dashboard/alter/onboarding/status', () => {
    it('200 registered=false quando sem BP', async () => {
      const app = mountDashboardApp();
      const res = await supertest(app)
        .get('/api/dashboard/alter/onboarding/status')
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(false);
      expect(res.body.meta.is_empty).toBe(true);
    });

    it('200 registered=true quando BP existe', async () => {
      const app = mountDashboardApp({
        businessPartner: {
          id: 'bp-1',
          nuclea_opt_in: { status: 'active' },
        },
      });
      const res = await supertest(app)
        .get('/api/dashboard/alter/onboarding/status')
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(true);
      expect(res.body.id).toBe('bp-1');
    });
  });

  // ── Webhook Alter ──────────────────────────────────────────────────────────

  describe('POST /webhooks/alter', () => {
    it('NODE_ENV=production sem ALTER_WEBHOOK_SECRET → 503 fail-closed', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALTER_WEBHOOK_SECRET;
      const { app } = mountWebhookApp();
      const res = await supertest(app)
        .post('/webhooks/alter')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'opt_in.confirmed', data: {} }));
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('alter_webhook_secret_not_configured');
    });

    it('NODE_ENV=test sem secret → 200 (ergonomia de suite)', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.ALTER_WEBHOOK_SECRET;
      const { app } = mountWebhookApp();
      const res = await supertest(app)
        .post('/webhooks/alter')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'unknown.event' }));
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    // Nota: assinatura hex com comprimento != 64 lança RangeError em alterWebhooks.js:58
    // (timingSafeEqual) sem try/catch — documentado no relatório, não exercitado aqui.
    it('com secret e assinatura inválida (mesmo tamanho) → 401', async () => {
      process.env.NODE_ENV = 'test';
      process.env.ALTER_WEBHOOK_SECRET = 'whsec-test';
      const { app } = mountWebhookApp();
      const body = JSON.stringify({ type: 'opt_in.confirmed', data: {} });
      const ts = String(Math.floor(Date.now() / 1000));
      // 64 hex chars (32 bytes) — mesmo comprimento do HMAC-SHA256 esperado
      const wrongSig = 'a'.repeat(64);
      const res = await supertest(app)
        .post('/webhooks/alter')
        .set('Content-Type', 'application/json')
        .set('X-Alter-Timestamp', ts)
        .set('X-Alter-Signature', `v1=${wrongSig}`)
        .send(body);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_signature');
    });

    it('com secret e assinatura válida → 200', async () => {
      process.env.NODE_ENV = 'test';
      const secret = 'whsec-valid';
      process.env.ALTER_WEBHOOK_SECRET = secret;
      const { app } = mountWebhookApp();
      const body = JSON.stringify({
        type: 'opt_in.confirmed',
        data: { business_partner: { id: 'bp-webhook-1', nuclea_opt_in: { status: 'active' } } },
      });
      const { timestamp, signature } = signAlterWebhook(body, secret);
      const res = await supertest(app)
        .post('/webhooks/alter')
        .set('Content-Type', 'application/json')
        .set('X-Alter-Timestamp', timestamp)
        .set('X-Alter-Signature', signature)
        .send(body);
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });
  });
});
