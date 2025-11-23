const axios = require('axios');

async function testLinkEmail() {
    try {
        console.log('Testing /api/user/link-email...');

        // Dados de teste
        const payload = {
            phone: '5511999999999',
            token: 'test-token',
            email: 'test@example.com',
            password: 'password123'
        };

        // Tenta chamar o endpoint (espera-se erro 404 pois o usuário não existe no banco real)
        // Mas se retornar 404 com mensagem "Usuário não encontrado", significa que o endpoint existe e a lógica rodou.
        // Se retornar 404 do Express (Cannot POST), então a rota não foi montada.

        const response = await axios.post('http://localhost:3000/api/user/link-email', payload);
        console.log('Success:', response.data);
    } catch (error) {
        if (error.response) {
            console.log('Response Error:', error.response.status, error.response.data);
        } else {
            console.log('Error:', error.message);
        }
    }
}

testLinkEmail();
