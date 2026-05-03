/**
 * Simple smoke tests to validate core endpoints.
 * Requires Supabase credentials because onboarding persistence hits the DB.
 */
require('dotenv').config();
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const missingSupabaseEnv = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

if (missingSupabaseEnv) {
  console.warn('⚠️  SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não definidos. Pulando testes de API.');
  process.exit(0);
}

const request = require('supertest');
const app = require('../src/server');

const TEST_PHONE = process.env.TEST_ONBOARDING_PHONE || '5599999999999';

async function runStep(label, fn) {
  const start = Date.now();
  await fn();
  const duration = Date.now() - start;
  console.log(`✅ ${label} (${duration}ms)`);
}

async function run() {
  await runStep('GET /health', async () => {
    // 503 is acceptable locally when Evolution API / Redis are unreachable
    const res = await request(app).get('/health');
    if (![200, 503].includes(res.status)) {
      throw new Error(`Unexpected status ${res.status}`);
    }
    if (!res.body.status) {
      throw new Error('Resposta inesperada do /health');
    }
  });

  await runStep('GET /api/onboarding/state', async () => {
    const res = await request(app)
      .get('/api/onboarding/state')
      .set('x-user-phone', TEST_PHONE)
      .expect(200);

    if (!res.body || !res.body.progress_label) {
      throw new Error('Resposta inválida ao buscar estado do onboarding');
    }
  });

  await runStep('PATCH /api/onboarding/state', async () => {
    const res = await request(app)
      .patch('/api/onboarding/state')
      .set('x-user-phone', TEST_PHONE)
      .send({
        meta: { source: 'apiSmokeTest' }
      })
      .expect(200);

    if (!res.body.meta || res.body.meta.source !== 'apiSmokeTest') {
      throw new Error('Meta não atualizada no onboarding');
    }
  });

  await runStep('POST /api/onboarding/steps', async () => {
    const res = await request(app)
      .post('/api/onboarding/steps')
      .set('x-user-phone', TEST_PHONE)
      .send({
        stepId: 'phase1_name',
        status: 'completed',
        metadata: { from: 'apiSmokeTest' }
      })
      .expect(200);

    if (!res.body.progress_label) {
      throw new Error('Progress label ausente após atualizar step');
    }
  });

  await runStep('GET /api/onboarding/assistant/prompts', async () => {
    const res = await request(app)
      .get('/api/onboarding/assistant/prompts')
      .set('x-user-phone', TEST_PHONE)
      .expect(200);

    if (!res.body || !Array.isArray(res.body.prompts)) {
      throw new Error('Prompts inválidos');
    }
  });

  await runStep('GET /api/dashboard/contas-a-pagar', async () => {
    const res = await request(app)
      .get('/api/dashboard/contas-a-pagar')
      .set('x-user-phone', TEST_PHONE)
      .expect(200);
    if (!res.body.hasOwnProperty('total') || !Array.isArray(res.body.items)) {
      throw new Error('Shape inválida: esperado { total, valorTotal, items[] }');
    }
  });

  await runStep('GET /api/dashboard/cashflow/projection', async () => {
    const res = await request(app)
      .get('/api/dashboard/cashflow/projection?days=30')
      .set('x-user-phone', TEST_PHONE)
      .expect(200);
    const { saldoAtual, summary, days } = res.body;
    if (typeof saldoAtual !== 'number' || !summary || !Array.isArray(days)) {
      throw new Error('Shape inválida: esperado { saldoAtual, summary, days[] }');
    }
    const expected = saldoAtual + summary.totalEntradas - summary.totalSaidas;
    if (Math.abs(summary.saldoFinal - expected) > 0.01) {
      throw new Error(`saldoFinal incorreto: ${summary.saldoFinal} !== ${expected}`);
    }
  });

  await runStep('GET /api/dashboard/calendar', async () => {
    const res = await request(app)
      .get('/api/dashboard/calendar')
      .set('x-user-phone', TEST_PHONE)
      .expect(200);
    if (!res.body.period || !res.body.summary || !res.body.events) {
      throw new Error('Shape inválida: esperado { period, summary, events }');
    }
  });

  // --- Phase 3 ---

  await runStep('GET /api/dashboard/simulator/scenario (baseline)', async () => {
    const res = await request(app)
      .get('/api/dashboard/simulator/scenario')
      .set('x-user-phone', TEST_PHONE)
      .expect(200);
    const { baseline, projection, scenario } = res.body;
    if (typeof baseline?.entradas !== 'number') throw new Error('baseline.entradas ausente ou não numérico');
    if (typeof projection?.lucro !== 'number') throw new Error('projection.lucro ausente ou não numérico');
    if (typeof projection?.margem !== 'number') throw new Error('projection.margem ausente');
    if (!scenario) throw new Error('scenario ausente');
  });

  await runStep('GET /api/dashboard/simulator/scenario (extra_revenue=5000)', async () => {
    const res = await request(app)
      .get('/api/dashboard/simulator/scenario?extra_revenue=5000')
      .set('x-user-phone', TEST_PHONE)
      .expect(200);
    const { baseline, projection } = res.body;
    if (projection.entradas - baseline.entradas !== 5000) {
      throw new Error(`extra_revenue não aplicado: baseline=${baseline.entradas} projection=${projection.entradas}`);
    }
    if (projection.deltaLucro !== 5000) {
      throw new Error(`deltaLucro deveria ser 5000, recebeu ${projection.deltaLucro}`);
    }
  });

  await runStep('GET /api/dashboard/insights/pricing', async () => {
    const res = await request(app)
      .get('/api/dashboard/insights/pricing')
      .set('x-user-phone', TEST_PHONE)
      .expect(200);
    const { procedures, summary, period } = res.body;
    if (!Array.isArray(procedures)) throw new Error('procedures não é array');
    if (typeof summary?.abaixoMercado !== 'number') throw new Error('summary.abaixoMercado ausente');
    if (!period?.since) throw new Error('period.since ausente');
    // Validate shape of each procedure
    for (const p of procedures) {
      if (typeof p.avgTicket !== 'number') throw new Error(`avgTicket inválido em: ${p.procedimento}`);
      if (!p.benchmark) throw new Error(`benchmark ausente em: ${p.procedimento}`);
    }
  });

  await runStep('GET /api/dashboard/emergency/status', async () => {
    const res = await request(app)
      .get('/api/dashboard/emergency/status')
      .set('x-user-phone', TEST_PHONE)
      .expect(200);
    const { alert, saldoAtual, saldoMinimo, diasAnalisados } = res.body;
    if (typeof alert !== 'boolean') throw new Error('alert deve ser boolean');
    if (typeof saldoAtual !== 'number') throw new Error('saldoAtual ausente');
    if (typeof saldoMinimo !== 'number') throw new Error('saldoMinimo ausente');
    if (diasAnalisados !== 30) throw new Error(`diasAnalisados deveria ser 30, recebeu ${diasAnalisados}`);
    // Invariante: saldoMinimo <= saldoAtual
    if (saldoMinimo > saldoAtual) throw new Error(`saldoMinimo (${saldoMinimo}) não pode ser maior que saldoAtual (${saldoAtual})`);
    // alert=true implica saldoMinimo < 0
    if (alert && saldoMinimo >= 0) throw new Error('alert=true mas saldoMinimo >= 0');
  });

  await runStep('GET /api/dashboard/export/report?format=csv', async () => {
    const res = await request(app)
      .get('/api/dashboard/export/report?format=csv')
      .set('x-user-phone', TEST_PHONE)
      .expect(200);
    if (!res.headers['content-type'].includes('text/csv')) {
      throw new Error(`Content-Type errado: ${res.headers['content-type']}`);
    }
    const lines = res.text.trim().split('\n');
    // First line must be the header row
    if (!lines[0].includes('tipo')) throw new Error('CSV sem header row');
    // Must have TOTAL ENTRADAS footer
    if (!res.text.includes('TOTAL ENTRADAS')) throw new Error('CSV sem footer de totais');
  });

  await runStep('GET /api/dashboard/export/report?format=pdf', async () => {
    const res = await request(app)
      .get('/api/dashboard/export/report?format=pdf')
      .set('x-user-phone', TEST_PHONE)
      .expect(200);
    if (!res.headers['content-type'].includes('application/pdf')) {
      throw new Error(`Content-Type errado: ${res.headers['content-type']}`);
    }
    // PDF magic bytes: %PDF
    if (!res.body.toString('utf8', 0, 4).startsWith('%PDF') && !res.text?.startsWith('%PDF')) {
      // Try buffer check
      const buf = Buffer.from(res.body);
      if (buf.slice(0, 4).toString() !== '%PDF') throw new Error('Resposta não é um PDF válido');
    }
  });

  console.log('\n🎉 Smoke tests finalizados com sucesso!');
  process.exit(0);
}

run().catch((error) => {
  console.error('❌ Falha nos testes de API:', error.message);
  process.exit(1);
});

