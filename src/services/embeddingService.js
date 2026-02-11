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
        this.targetDimension = Number(process.env.EMBEDDING_DIMENSION || 768);
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
            return this.normalizeDimension(embedding);
        } catch (error) {
            console.error('[EMBEDDING] Erro ao gerar embedding:', error.message);
            return null;
        }
    }

    /**
     * Normaliza dimensão do embedding para bater com a coluna vector do banco.
     * - Se vier maior, corta.
     * - Se vier menor, completa com zero.
     * @param {number[]} embedding
     * @returns {number[]|null}
     */
    normalizeDimension(embedding) {
        if (!Array.isArray(embedding) || embedding.length === 0) return null;

        if (!Number.isFinite(this.targetDimension) || this.targetDimension <= 0) {
            return embedding;
        }

        if (embedding.length === this.targetDimension) return embedding;

        if (embedding.length > this.targetDimension) {
            return embedding.slice(0, this.targetDimension);
        }

        const padded = embedding.slice();
        while (padded.length < this.targetDimension) {
            padded.push(0);
        }
        return padded;
    }
}

module.exports = new EmbeddingService();
