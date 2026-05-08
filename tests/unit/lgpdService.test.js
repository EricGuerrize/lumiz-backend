/**
 * Fase 19 — lgpdService.
 *
 * Garantias:
 *   1. collectUserData() varre todas as tabelas com user_id + parcelas via
 *      JOIN (atendimentos.id), sem explodir em tabela com erro.
 *   2. anonymizeAuditLog() faz UPDATE zerando user_id/ip/user_agent.
 *   3. softDeleteProfile() zera PII e marca is_active=false.
 *   4. cancelSubscription() chave por clinic_id (== userId no single-tenant).
 *   5. requestDeletionToken() reaproveita token ativo recente (<60min).
 *   6. consumeDeletionToken() valida expiração e usado_em, marca como usado.
 *   7. executeDeletion() roda em sequência subscription → audit → purge → profile.
 *   8. purgeOperationalData() não inclui audit_log nem profiles.
 *   9. Service degrada graciosamente: erros de DB viram log, não rejection.
 */

// ---------------------------------------------------------------------------
// Mock chainável thenable estilo supabase-js. Cada operação modifica state
// interno e o terminal — seja await direto, .single(), .maybeSingle() ou
// .limit() — devolve Promise resolvendo com { data, error } baseado em
// behavior por tabela.
// ---------------------------------------------------------------------------

let calls;

class FakeChain {
  constructor(table, behavior) {
    this.table = table;
    this.behavior = behavior || {};
    this.op = null;
  }

  select(cols) {
    if (this.op === 'insert' || this.op === 'update' || this.op === 'delete') {
      // mantém op, só sinaliza que veio um .select() pós-mutation
    } else {
      this.op = 'select';
      calls.select.push({ table: this.table, cols });
    }
    return this;
  }

  insert(payload) {
    this.op = 'insert';
    this.payload = payload;
    calls.insert.push({ table: this.table, payload });
    return this;
  }

  update(patch) {
    this.op = 'update';
    this.patch = patch;
    calls.update.push({ table: this.table, patch });
    return this;
  }

  delete() {
    this.op = 'delete';
    calls.delete.push({ table: this.table });
    return this;
  }

  eq(col, val) {
    calls.eq.push({ table: this.table, op: this.op, col, val });
    return this;
  }

  in(col, vals) {
    calls.eq.push({ table: this.table, op: this.op, col, vals });
    return this;
  }

  is() { return this; }
  gt() { return this; }
  order() { return this; }

  limit() {
    return Promise.resolve({ data: this.behavior.tokenList || [], error: null });
  }

  single() {
    return Promise.resolve({
      data: this.op === 'insert' ? (this.behavior.insertData || null) : (this.behavior.singleData || null),
      error: this.op === 'insert' ? (this.behavior.insertError || null) : (this.behavior.singleError || null),
    });
  }

  maybeSingle() {
    return Promise.resolve({
      data: this.behavior.maybeSingleData || null,
      error: this.behavior.maybeSingleError || null,
    });
  }

  // Thenable: usado quando o caller faz `await chain` direto, sem chamar
  // single/maybeSingle/limit. Resolve com base no op final.
  then(onFulfilled, onRejected) {
    let result;
    switch (this.op) {
      case 'select':
        result = { data: this.behavior.selectData || [], error: this.behavior.selectError || null };
        break;
      case 'update':
        result = { data: this.behavior.updateData || [], error: this.behavior.updateError || null };
        break;
      case 'delete':
        result = { data: this.behavior.deleteData || [], error: this.behavior.deleteError || null };
        break;
      case 'insert':
        result = { data: this.behavior.insertData || null, error: this.behavior.insertError || null };
        break;
      default:
        result = { data: null, error: null };
    }
    return Promise.resolve(result).then(onFulfilled, onRejected);
  }
}

function _setupSupabase(perTableBehavior = {}) {
  calls = { from: [], select: [], insert: [], update: [], delete: [], eq: [] };

  const supabaseMock = {
    from: jest.fn((table) => {
      calls.from.push(table);
      return new FakeChain(table, perTableBehavior[table]);
    }),
  };
  jest.doMock('../../src/db/supabase', () => supabaseMock);
  return require('../../src/services/lgpdService');
}

describe('Fase 19 — lgpdService', () => {
  let lgpdService;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // collectUserData
  // ===========================================================================
  describe('collectUserData()', () => {
    it('coleta profile + tabelas com user_id + parcelas via atendimentos', async () => {
      lgpdService = _setupSupabase({
        profiles: { maybeSingleData: { id: 'u1', nome_completo: 'Maria' } },
        atendimentos: { selectData: [{ id: 'a1', user_id: 'u1' }, { id: 'a2', user_id: 'u1' }] },
        contas_pagar: { selectData: [{ id: 'c1', user_id: 'u1' }] },
        parcelas: { selectData: [{ id: 'p1', atendimento_id: 'a1' }] },
      });

      const dump = await lgpdService.collectUserData('u1');

      expect(dump.user_id).toBe('u1');
      expect(dump.schema_version).toBe('1.0');
      expect(dump.tables.profiles).toEqual([{ id: 'u1', nome_completo: 'Maria' }]);
      expect(dump.tables.atendimentos).toEqual([
        { id: 'a1', user_id: 'u1' },
        { id: 'a2', user_id: 'u1' },
      ]);
      expect(dump.tables.contas_pagar).toEqual([{ id: 'c1', user_id: 'u1' }]);
      expect(dump.tables.parcelas).toEqual([{ id: 'p1', atendimento_id: 'a1' }]);
      expect(dump.summary.profiles).toBe(1);
      expect(dump.summary.atendimentos).toBe(2);
      expect(dump.summary.parcelas).toBe(1);
    });

    it('retorna summary com TODAS as tabelas (mesmo as vazias) para deixar inspeção explícita', async () => {
      lgpdService = _setupSupabase({});
      const dump = await lgpdService.collectUserData('u1');
      for (const t of lgpdService.EXPORT_TABLES) {
        expect(dump.tables[t]).toBeDefined();
        expect(Array.isArray(dump.tables[t])).toBe(true);
      }
      expect(dump.tables.parcelas).toEqual([]);
    });

    it('lança se userId for vazio', async () => {
      lgpdService = _setupSupabase({});
      await expect(lgpdService.collectUserData(null)).rejects.toThrow('userId é obrigatório');
      await expect(lgpdService.collectUserData('')).rejects.toThrow('userId é obrigatório');
    });

    it('degrada graciosamente quando uma tabela retorna erro (não derruba o dump inteiro)', async () => {
      lgpdService = _setupSupabase({
        atendimentos: { selectError: { message: 'permission denied' } },
        contas_pagar: { selectData: [{ id: 'c1' }] },
      });
      const dump = await lgpdService.collectUserData('u1');
      expect(dump.tables.atendimentos).toEqual([]);
      expect(dump.tables.contas_pagar).toEqual([{ id: 'c1' }]);
    });
  });

  // ===========================================================================
  // anonymizeAuditLog
  // ===========================================================================
  describe('anonymizeAuditLog()', () => {
    it('zera user_id, ip_address, user_agent na tabela audit_log', async () => {
      lgpdService = _setupSupabase({
        audit_log: { updateData: [{ id: 'a1' }, { id: 'a2' }] },
      });
      const out = await lgpdService.anonymizeAuditLog('u1');
      expect(out.rowsAffected).toBe(2);

      const updateCall = calls.update.find(c => c.table === 'audit_log');
      expect(updateCall.patch).toEqual({
        user_id: null,
        ip_address: null,
        user_agent: null,
      });
      const eqCall = calls.eq.find(c => c.table === 'audit_log' && c.op === 'update');
      expect(eqCall.col).toBe('user_id');
      expect(eqCall.val).toBe('u1');
    });

    it('não lança quando o supabase retorna erro; reporta error e rowsAffected=0', async () => {
      lgpdService = _setupSupabase({
        audit_log: { updateError: { message: 'db down' } },
      });
      const out = await lgpdService.anonymizeAuditLog('u1');
      expect(out.rowsAffected).toBe(0);
      expect(out.error).toBe('db down');
    });
  });

  // ===========================================================================
  // softDeleteProfile
  // ===========================================================================
  describe('softDeleteProfile()', () => {
    it('zera PII e marca is_active=false; deactivated_at vira ISO recente', async () => {
      lgpdService = _setupSupabase({ profiles: {} });
      const before = Date.now();
      const out = await lgpdService.softDeleteProfile('11111111-1111-1111-1111-111111111111');
      const after = Date.now();
      expect(out.ok).toBe(true);

      const updateCall = calls.update.find(c => c.table === 'profiles');
      expect(updateCall.patch.is_active).toBe(false);
      expect(updateCall.patch.nome_completo).toBe('[Conta excluída]');
      expect(updateCall.patch.nome_clinica).toBe('[Conta excluída]');
      expect(updateCall.patch.cidade).toBeNull();
      expect(updateCall.patch.email).toMatch(/^deleted-.*@lumiz\.deleted$/);
      expect(updateCall.patch.telefone).toMatch(/^\+0deleted/);
      const t = new Date(updateCall.patch.deactivated_at).getTime();
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(after);
    });

    it('reporta error quando update falha (não lança)', async () => {
      lgpdService = _setupSupabase({ profiles: { updateError: { message: 'rls violation' } } });
      const out = await lgpdService.softDeleteProfile('u1');
      expect(out.ok).toBe(false);
      expect(out.error).toBe('rls violation');
    });
  });

  // ===========================================================================
  // cancelSubscription
  // ===========================================================================
  describe('cancelSubscription()', () => {
    it('atualiza status=cancelled em subscriptions usando clinic_id (== userId no single-tenant)', async () => {
      lgpdService = _setupSupabase({ subscriptions: { updateData: [{ id: 's1' }] } });
      const out = await lgpdService.cancelSubscription('u1');
      expect(out.ok).toBe(true);
      expect(out.rowsAffected).toBe(1);

      const updateCall = calls.update.find(c => c.table === 'subscriptions');
      expect(updateCall.patch).toEqual({ status: 'cancelled' });
      const eqCall = calls.eq.find(c => c.table === 'subscriptions');
      expect(eqCall.col).toBe('clinic_id');
      expect(eqCall.val).toBe('u1');
    });

    it('rejeita rapidamente quando userId vazio', async () => {
      lgpdService = _setupSupabase({});
      const out = await lgpdService.cancelSubscription('');
      expect(out.ok).toBe(false);
    });
  });

  // ===========================================================================
  // purgeOperationalData
  // ===========================================================================
  describe('purgeOperationalData()', () => {
    it('NÃO inclui audit_log (anonimizado, não deletado) nem profiles (soft-delete)', async () => {
      lgpdService = _setupSupabase({});
      await lgpdService.purgeOperationalData('u1');

      const purgedTables = calls.delete.map(c => c.table);
      expect(purgedTables).not.toContain('audit_log');
      expect(purgedTables).not.toContain('profiles');
      expect(purgedTables).toContain('atendimentos');
      expect(purgedTables).toContain('contas_pagar');
      expect(purgedTables).toContain('feature_flags');
    });

    it('continua mesmo se uma tabela falhar e reporta erro por tabela', async () => {
      lgpdService = _setupSupabase({
        atendimentos: { deleteError: { message: 'fk constraint' } },
        contas_pagar: { deleteData: [{ id: 'c1' }, { id: 'c2' }] },
      });
      const out = await lgpdService.purgeOperationalData('u1');
      expect(out.atendimentos.error).toBe('fk constraint');
      expect(out.atendimentos.rowsAffected).toBe(0);
      expect(out.contas_pagar.rowsAffected).toBe(2);
    });
  });

  // ===========================================================================
  // requestDeletionToken
  // ===========================================================================
  describe('requestDeletionToken()', () => {
    it('cria token novo quando não há token ativo recente', async () => {
      lgpdService = _setupSupabase({
        account_deletion_tokens: {
          tokenList: [],
          insertData: { id: 't1', token: 'token-uuid-1', expira_em: '2099-01-01T00:00:00Z' },
        },
      });
      const out = await lgpdService.requestDeletionToken('u1', { ip: '127.0.0.1', headers: { 'user-agent': 'tester' } });
      expect(out.token).toBe('token-uuid-1');
      expect(out.reused).toBe(false);

      const insertCall = calls.insert.find(c => c.table === 'account_deletion_tokens');
      expect(insertCall.payload.user_id).toBe('u1');
      expect(insertCall.payload.requested_ip).toBe('127.0.0.1');
      expect(insertCall.payload.requested_user_agent).toBe('tester');
    });

    it('reaproveita token existente criado há menos de 60 minutos', async () => {
      const recentCreatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      lgpdService = _setupSupabase({
        account_deletion_tokens: {
          tokenList: [{
            id: 't-old',
            token: 'reused-token',
            expira_em: '2099-01-01T00:00:00Z',
            created_at: recentCreatedAt,
          }],
        },
      });
      const out = await lgpdService.requestDeletionToken('u1');
      expect(out.token).toBe('reused-token');
      expect(out.reused).toBe(true);

      const insertCall = calls.insert.find(c => c.table === 'account_deletion_tokens');
      expect(insertCall).toBeUndefined();
    });

    it('lança quando userId vazio', async () => {
      lgpdService = _setupSupabase({});
      await expect(lgpdService.requestDeletionToken('')).rejects.toThrow('userId é obrigatório');
    });
  });

  // ===========================================================================
  // consumeDeletionToken
  // ===========================================================================
  describe('consumeDeletionToken()', () => {
    it('rejeita TOKEN_MISSING quando token vazio', async () => {
      lgpdService = _setupSupabase({});
      await expect(lgpdService.consumeDeletionToken(null)).rejects.toMatchObject({ code: 'TOKEN_MISSING' });
    });

    it('rejeita TOKEN_INVALID quando o token não existe no banco', async () => {
      lgpdService = _setupSupabase({
        account_deletion_tokens: { maybeSingleData: null },
      });
      await expect(lgpdService.consumeDeletionToken('xyz')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    });

    it('rejeita TOKEN_USED quando usado_em != null', async () => {
      lgpdService = _setupSupabase({
        account_deletion_tokens: {
          maybeSingleData: {
            id: 't1',
            user_id: 'u1',
            expira_em: '2099-01-01T00:00:00Z',
            usado_em: '2026-01-01T00:00:00Z',
          },
        },
      });
      await expect(lgpdService.consumeDeletionToken('xyz')).rejects.toMatchObject({ code: 'TOKEN_USED' });
    });

    it('rejeita TOKEN_EXPIRED quando expira_em é passado', async () => {
      lgpdService = _setupSupabase({
        account_deletion_tokens: {
          maybeSingleData: {
            id: 't1',
            user_id: 'u1',
            expira_em: '2020-01-01T00:00:00Z',
            usado_em: null,
          },
        },
      });
      await expect(lgpdService.consumeDeletionToken('xyz')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    });

    it('aceita token válido e marca como usado', async () => {
      lgpdService = _setupSupabase({
        account_deletion_tokens: {
          maybeSingleData: {
            id: 't1',
            user_id: 'u-ok',
            expira_em: '2099-01-01T00:00:00Z',
            usado_em: null,
          },
        },
      });
      const out = await lgpdService.consumeDeletionToken('valid-token');
      expect(out.userId).toBe('u-ok');

      const updateCall = calls.update.find(c => c.table === 'account_deletion_tokens');
      expect(updateCall.patch.usado_em).toBeTruthy();
    });
  });

  // ===========================================================================
  // executeDeletion
  // ===========================================================================
  describe('executeDeletion()', () => {
    it('roda subscription → audit_log → purge → profile e devolve relatório consolidado', async () => {
      lgpdService = _setupSupabase({
        subscriptions: { updateData: [{ id: 's1' }] },
        audit_log: { updateData: [{ id: 'a1' }] },
        atendimentos: { deleteData: [{ id: 'x1' }] },
        profiles: {},
      });
      const report = await lgpdService.executeDeletion('u1');
      expect(report.user_id).toBe('u1');
      expect(report.steps.subscription.ok).toBe(true);
      expect(report.steps.audit_log.rowsAffected).toBe(1);
      expect(report.steps.purge.atendimentos.rowsAffected).toBe(1);
      expect(report.steps.profile.ok).toBe(true);
      expect(report.started_at).toBeTruthy();
      expect(report.finished_at).toBeTruthy();
    });
  });
});
