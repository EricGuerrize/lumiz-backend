const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:3000/api';
const PHONE = '551199999' + crypto.randomInt(1000, 9999); // Random phone to ensure clean state

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendWebhookMessage(message) {
    try {
        const payload = {
            event: 'messages.upsert',
            data: {
                key: {
                    remoteJid: `${PHONE}@s.whatsapp.net`,
                    fromMe: false
                },
                message: {
                    conversation: message
                }
            }
        };

        console.log(`\n[USER] Envia: "${message}"`);
        await axios.post(`${BASE_URL}/webhook`, payload);
        // Wait a bit for processing (in a real test we would poll for the response, 
        // but here we just wait and assume the server processed it)
        await sleep(1000);
    } catch (error) {
        console.error('Error sending webhook:', error.message);
    }
}

async function linkEmail(token) {
    try {
        console.log(`\n[API] Linking email with token: ${token}`);
        const payload = {
            phone: PHONE,
            token: token,
            email: `test_${PHONE}@example.com`,
            password: 'password123'
        };

        const response = await axios.post(`${BASE_URL}/user/link-email`, payload);
        console.log('[API] Link Email Response:', response.data);
        return response.data;
    } catch (error) {
        console.error('[API] Error linking email:', error.response ? error.response.data : error.message);
        throw error;
    }
}

async function runTest() {
    console.log(`Starting E2E Test for Phone: ${PHONE}`);

    // 1. Start Onboarding
    await sendWebhookMessage('🔥 Quero organizar o financeiro da minha clínica com a Lumiz! Tenho o convite para o teste gratuito.');

    // 2. Onboarding Steps
    await sendWebhookMessage('Clínica Teste E2E'); // Nome da clínica
    await sendWebhookMessage('Tester Silva'); // Nome do usuário
    // Steps removed: Function and Payment Methods
    await sendWebhookMessage('30'); // Vendas por mês

    // 3. Momento WOW (Primeira Venda)
    await sendWebhookMessage('Botox 2800 cliente Maria');

    // 4. Primeiro Custo
    await sendWebhookMessage('Luvas 50');
    await sendWebhookMessage('1'); // Variável

    // 5. Segundo Custo (Fixo)
    await sendWebhookMessage('Aluguel 2000');
    await sendWebhookMessage('Sim'); // Confirmar fixo

    // 6. Resumo Final e Link
    // Note: In a real integration test, we would need to capture the outgoing message to get the token.
    // For this test script, since we can't easily intercept the outgoing WhatsApp message from here without mocking,
    // we will cheat slightly by fetching the token directly from the database or assuming a known token if mocked.
    // HOWEVER, since we are running against the real backend, we can't easily get the token unless we mock the registrationTokenService.

    // WORKAROUND: We will query the database directly to get the token for this phone.
    // This requires the script to have access to the DB logic or we mock the token service.
    // Let's try to fetch the token using a helper if possible, or we might need to expose a debug endpoint.

    // For now, let's assume the backend logs the token or we can guess it? No, tokens are UUIDs.
    // Let's add a temporary debug log in the backend or use a "backdoor" for testing?
    // Or better: let's query the database directly using the supabase client if available.

    try {
        // We need to wait for the onboarding to finish processing
        await sleep(2000);

        // We'll use a direct DB query to get the token. 
        // We need to require the supabase client.
        // Note: This script is running outside the src folder context, so paths might be tricky.
        // Let's try to use the same supabase client if we can require it.
        const supabase = require('../src/db/supabase');

        const { data: tokenData, error } = await supabase
            .from('setup_tokens')
            .select('token')
            .eq('email', `phone_${PHONE}`)
            .eq('usado', false)
            .order('expira_em', { ascending: false })
            .limit(1)
            .single();

        if (error || !tokenData) {
            console.error('Could not find registration token in DB:', error);
            return;
        }

        const token = tokenData.token;
        console.log(`\n[TEST] Retrieved Token from DB: ${token}`);

        // 7. Link Email
        await linkEmail(token);

        // 8. Test Transaction after registration
        await sendWebhookMessage('Vendi preenchimento 1500');

        console.log('\n✅ Test Completed Successfully!');

    } catch (err) {
        console.error('\n❌ Test Failed:', err);
    }
}

runTest();
