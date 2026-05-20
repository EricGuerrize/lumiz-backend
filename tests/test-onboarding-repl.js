/**
 * REPL interativo para testar o fluxo de onboarding localmente.
 * Sem banco, sem Evolution API, sem Gemini.
 *
 * Uso:
 *   node tests/test-onboarding-repl.js
 *
 * Comandos especiais durante o chat:
 *   /restart   — reinicia o onboarding do zero
 *   /step      — mostra o step atual e os dados coletados
 *   /sair      — encerra
 */

'use strict';

process.env.ONBOARDING_V2 = process.env.ONBOARDING_V2 ?? 'true';

// ─── Mocks antes de qualquer require do projeto ──────────────────────────────
const Module = require('module');
const _orig = Module.prototype.require;

const inMemoryState = new Map();

Module.prototype.require = function (...args) {
    const m = args[0];

    if (m.includes('analyticsService') || m.includes('posthogService')) {
        return { track: async () => {}, identify: async () => {} };
    }
    if (m.includes('onboardingService') && !m.includes('onboardingFlowService') && !m.includes('onboardingUtils')) {
        return {
            getWhatsappState: async (phone) => inMemoryState.get(phone) ?? null,
            upsertWhatsappState: async (phone, state) => { inMemoryState.set(phone, state); return true; },
            clearWhatsappState: async (phone) => { inMemoryState.delete(phone); return true; }
        };
    }
    if (m.includes('consentService')) {
        return { recordConsent: async () => true, hasConsent: async () => true };
    }
    if (m.includes('cacheService')) {
        return { get: async () => null, set: async () => true, delete: async () => true };
    }
    if (m.includes('db/supabase')) {
        return { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }) };
    }
    if (m.includes('userController')) {
        return {
            createUserFromOnboarding: async () => ({ user: { id: 'local-user-001' } }),
            findUserByPhone: async () => ({ id: 'local-user-001' })
        };
    }
    if (m.includes('transactionController')) {
        return {
            createAtendimento: async () => ({ id: 'tx-001', valor_total: 0 }),
            createContaPagar: async () => ({ id: 'cp-001', valor: 0 })
        };
    }
    if (m.includes('documentService')) {
        return {
            processImage: async () => ({ transacoes: [] }),
            processDocumentFromBuffer: async () => ({ transacoes: [] })
        };
    }
    if (m.includes('knowledgeService')) {
        return { saveInteraction: async () => true };
    }
    if (m.includes('registrationTokenService')) {
        return {
            generateSetupToken: async () => ({
                registrationLink: 'https://lumiz-financeiro.vercel.app/setup-account?phone=LOCAL&token=DEMO'
            })
        };
    }
    if (m.includes('trialAccountService')) {
        return {
            trialAccountService: { getTrialSummary: async () => null, activateTrial: async () => null },
            buildForwardSummary: () => '(resumo de encaminhamento)',
            computeGhostSummary: () => null
        };
    }
    if (m.includes('clinicMemberService')) {
        return { addMember: async () => ({ success: true }) };
    }
    if (m.includes('intentHeuristicService')) {
        return { detectIntent: async () => null };
    }
    if (m.includes('evolutionService')) {
        return { sendText: async () => true, sendMedia: async () => true };
    }
    if (m.includes('subscriptionService')) {
        return { getStatus: async () => ({ plan: 'trial', active: true }) };
    }
    if (m.includes('subscriptionCopy')) {
        return { trialCta: () => '(CTA de assinatura)' };
    }

    return _orig.apply(this, args);
};
// ─────────────────────────────────────────────────────────────────────────────

const readline = require('readline');
const onboardingFlow = require('../src/services/onboardingFlowService');

const PHONE = '5565900000001';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function limpa() {
    // Remove estado in-memory do service
    onboardingFlow.onboardingStates?.delete(PHONE);
    if (onboardingFlow.persistTimers) {
        const t = onboardingFlow.persistTimers.get(PHONE);
        if (t) { clearTimeout(t); onboardingFlow.persistTimers.delete(PHONE); }
    }
    inMemoryState.delete(PHONE);
}

function printBot(msg) {
    if (!msg) return;
    const linhas = msg.split('\n');
    console.log('\n\x1b[36m[LUMIZ]\x1b[0m');
    for (const l of linhas) console.log('  ' + l);
    console.log();
}

function printInfo(msg) {
    console.log('\x1b[33m' + msg + '\x1b[0m');
}

async function start() {
    limpa();
    const resp = await onboardingFlow.startIntroFlow(PHONE);
    printBot(resp);
}

async function loop() {
    console.log('\x1b[1m');
    console.log('════════════════════════════════════════');
    console.log('  Lumiz — Teste local de onboarding');
    console.log('  /restart  /step  /sair');
    console.log('════════════════════════════════════════');
    console.log('\x1b[0m');
    printInfo(`Fluxo ativo: ${process.env.ONBOARDING_V2 === 'true' ? 'V2 (5 Atos)' : 'V1 (legado)'}`);
    console.log();

    await start();

    const prompt = () => {
        rl.question('\x1b[32m[VOCÊ]\x1b[0m ', async (input) => {
            const msg = input.trim();

            if (!msg) { prompt(); return; }

            if (msg === '/sair') {
                console.log('\nEncerrando.');
                rl.close();
                process.exit(0);
            }

            if (msg === '/restart') {
                printInfo('↺ Reiniciando onboarding...\n');
                await start();
                prompt();
                return;
            }

            if (msg === '/step') {
                const st = onboardingFlow.onboardingStates?.get(PHONE);
                printInfo(`Step: ${st?.step ?? '(não iniciado)'}`);
                printInfo(`Dados: ${JSON.stringify(st?.data ?? {}, null, 2)}`);
                console.log();
                prompt();
                return;
            }

            try {
                const resp = await onboardingFlow.processOnboarding(PHONE, msg);
                if (Array.isArray(resp)) {
                    for (const r of resp) printBot(r);
                } else {
                    printBot(resp);
                }
            } catch (e) {
                console.error('\x1b[31m[ERRO]\x1b[0m', e.message);
            }

            prompt();
        });
    };

    prompt();
}

loop().catch(e => { console.error(e); process.exit(1); });
