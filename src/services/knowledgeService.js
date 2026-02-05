const supabase = require('../db/supabase');
const embeddingService = require('./embeddingService');

class KnowledgeService {
    /**
     * Salva um novo conhecimento a partir de uma interação confirmada
     * @param {string} content - Texto original da mensagem
     * @param {string} intentName - Nome do intent (ex: registrar_receita)
     * @param {Object} metadata - Metadados (categoria, etc)
     * @param {string} clinicId - ID da clínica (opcional)
     */
    async saveInteraction(content, intentName, metadata = {}, clinicId = null) {
        try {
            const embedding = await embeddingService.generate(content);
            if (!embedding) return null;

            const { data, error } = await supabase
                .from('learned_knowledge')
                .insert([{
                    content,
                    embedding,
                    intent_name: intentName,
                    metadata: typeof metadata === 'object' ? metadata : {},
                    clinic_id: clinicId,
                    is_global: !clinicId // Se não tem clinicId, é global (aprendizado comum)
                }])
                .select()
                .maybeSingle();

            if (error) {
                console.error('[KNOWLEDGE] Erro ao salvar interação:', error.message);
                return null;
            }

            return data;
        } catch (error) {
            console.error('[KNOWLEDGE] Erro inesperado ao salvar:', error.message);
            return null;
        }
    }

    /**
     * Busca conhecimentos similares
     * @param {string} text - Texto para buscar
     * @param {string} clinicId - ID da clínica para restringir escopo
     * @param {number} threshold - Similaridade mínima (0 a 1)
     * @returns {Promise<Array>}
     */
    async searchSimilarity(text, clinicId = null, threshold = 0.8) {
        try {
            const embedding = await embeddingService.generate(text);
            if (!embedding) return [];

            // Chama a função RPC match_learned_knowledge que criamos no SQL
            const { data, error } = await supabase.rpc('match_learned_knowledge', {
                query_embedding: embedding,
                match_threshold: threshold,
                match_count: 3,
                p_clinic_id: clinicId
            });

            if (error) {
                console.error('[KNOWLEDGE] Erro ao buscar similaridade:', error.message);
                return [];
            }

            return data || [];
        } catch (error) {
            console.error('[KNOWLEDGE] Erro inesperado na busca:', error.message);
            return [];
        }
    }
}

module.exports = new KnowledgeService();
