const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

class EmbeddingService {
    constructor() {
        if (!process.env.GEMINI_API_KEY) {
            console.warn('[EMBEDDING] GEMINI_API_KEY não configurada. Serviço de embeddings desativado.');
            return;
        }
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    }

    /**
     * Gera embedding para um texto
     * @param {string} text 
     * @returns {Promise<number[]|null>}
     */
    async generate(text) {
        if (!this.model) return null;

        try {
            const result = await this.model.embedContent(text);
            const embedding = result.embedding.values;
            return embedding;
        } catch (error) {
            console.error('[EMBEDDING] Erro ao gerar embedding:', error.message);
            return null;
        }
    }
}

module.exports = new EmbeddingService();
