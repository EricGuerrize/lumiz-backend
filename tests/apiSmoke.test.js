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
    const res = await request(app).get('/health').expect(200);
    if (res.body.status !== 'ok') {
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

  console.log('\n🎉 Smoke tests finalizados com sucesso!');
  process.exit(0);
}

run().catch((error) => {
  console.error('❌ Falha nos testes de API:', error.message);
  process.exit(1);
});

