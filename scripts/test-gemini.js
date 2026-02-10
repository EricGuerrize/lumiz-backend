require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY não encontrada no .env');
        return;
    }

    console.log('--- Iniciando Teste do Gemini ---');
    console.log(`API Key: ${apiKey.substring(0, 8)}...`);

    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        console.log('\n--- Modelos Disponíveis ---');
        // A SDK v0.21.0 pode não ter listModels diretamente no genAI, mas vamos tentar via fetch ou ver se existe
        // Na verdade, vamos tentar os nomes mais comuns primeiro ou usar a API REST
        console.log('Listando via REST API...');
        const axios = require('axios');
        const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        console.log('Modelos encontrados:', response.data.models.map(m => m.name).join(', '));
    } catch (e) {
        console.error('Erro ao listar modelos:', e.message);
    }

    try {
        console.log('\n1. Testando Geração de Conteúdo (gemini-flash-latest)...');
        const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
        const result = await model.generateContent('Diga "Conexão bem sucedida!" se você estiver funcionando.');
        console.log('Resposta:', result.response.text());
        console.log('✅ Geração de conteúdo OK');
    } catch (error) {
        console.error('❌ Erro na Geração de Conteúdo:', error.message);
    }

    try {
        console.log('\n2. Testando Embeddings (gemini-embedding-001)...');
        const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
        const embResult = await embeddingModel.embedContent('Teste de embedding');
        console.log(`✅ Embedding gerado com sucesso! (Tamanho: ${embResult.embedding.values.length})`);
    } catch (error) {
        console.error('❌ Erro no Embedding:', error.message);
    }

    console.log('\n--- Teste Finalizado ---');
}

testGemini();
