/**
 * Fase Agentic 3.2 — Learned Facts Service
 *
 * Responsabilidade:
 * - persistir fatos aprendidos sobre a clínica;
 * - gerar embeddings quando OpenAI estiver disponível;
 * - executar busca semântica com fallback textual;
 * - sincronizar o resumo de fatos no clinic_profiles.
 */

const OpenAI = require('openai');
const supabase = require('../../db/supabase');

class LearnedFactsService {
  constructor() {
    this.embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
    this.client = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;
  }

  /**
   * Gera embedding para um texto usando o mesmo modelo de toda a base.
   *
   * @param {string} text
   * @returns {Promise<number[]|null>}
   */
  async createEmbedding(text) {
    const normalized = String(text || '').trim();
    if (!normalized || !this.client) return null;

    try {
      const response = await this.client.embeddings.create({
        model: this.embeddingModel,
        input: normalized
      });
      return response?.data?.[0]?.embedding || null;
    } catch (error) {
      console.warn('[LearnedFactsService] Falha ao gerar embedding:', error.message);
      return null;
    }
  }

  /**
   * Insere ou atualiza um fato aprendido.
   *
   * @param {object} payload
   * @param {string} payload.clinicId
   * @param {string} payload.userId
   * @param {string} payload.fact
   * @param {string} [payload.factType]
   * @param {number} [payload.confidence]
   * @param {string[]} [payload.supportingRecords]
   * @param {string} [payload.source]
   * @returns {Promise<object|null>}
   */
  async upsertFact(payload) {
    const {
      clinicId,
      userId,
      fact,
      factType = 'general',
      confidence = 0.5,
      supportingRecords = [],
      source = 'inferred'
    } = payload || {};

    const normalizedFact = String(fact || '').trim();
    if (!clinicId || !normalizedFact) return null;

    const existing = await this._findExistingFact(clinicId, normalizedFact);
    const embedding = await this.createEmbedding(normalizedFact);
    const mergedSupportingRecords = this._mergeSupportingRecords(
      existing?.supporting_records || [],
      supportingRecords
    );

    if (existing) {
      const { data, error } = await supabase
        .from('learned_facts_agentic')
        .update({
          fact_type: factType,
          confidence: Math.max(Number(existing.confidence || 0), Number(confidence || 0)),
          supporting_records: mergedSupportingRecords,
          source: source || existing.source,
          embedding: existing.embedding || embedding,
          is_active: true,
          invalidated_at: null,
          invalidated_reason: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      if (userId) {
        await this.syncProfileSummary(userId, clinicId);
      }
      return data;
    }

    const { data, error } = await supabase
      .from('learned_facts_agentic')
      .insert({
        clinic_id: clinicId,
        user_id: userId || null,
        fact: normalizedFact,
        fact_type: factType,
        embedding,
        confidence: Number(confidence || 0.5),
        supporting_records: mergedSupportingRecords,
        source
      })
      .select()
      .single();

    if (error) throw error;
    if (userId) {
      await this.syncProfileSummary(userId, clinicId);
    }
    return data;
  }

  /**
   * Busca fatos semanticamente parecidos; cai para keyword search se necessário.
   *
   * @param {object} payload
   * @param {string} payload.clinicId
   * @param {string} payload.query
   * @param {number} [payload.matchThreshold]
   * @param {number} [payload.matchCount]
   * @returns {Promise<object[]>}
   */
  async searchFacts(payload) {
    const {
      clinicId,
      query,
      matchThreshold = 0.78,
      matchCount = 5
    } = payload || {};

    const normalizedQuery = String(query || '').trim();
    if (!clinicId || !normalizedQuery) return [];

    const embedding = await this.createEmbedding(normalizedQuery);
    if (embedding) {
      try {
        const { data, error } = await supabase.rpc('match_learned_facts_agentic', {
          query_embedding: embedding,
          match_threshold: matchThreshold,
          match_count: matchCount,
          p_clinic_id: clinicId
        });

        if (error) throw error;
        if (Array.isArray(data) && data.length > 0) {
          await this._touchFacts(data.map((item) => item.id));
          return data;
        }
      } catch (error) {
        console.warn('[LearnedFactsService] Busca vetorial falhou, usando fallback textual:', error.message);
      }
    }

    return this.keywordSearch(clinicId, normalizedQuery, matchCount);
  }

  /**
   * Recria o resumo de fatos no clinic_profiles.
   *
   * @param {string} userId
   * @param {string} clinicId
   * @returns {Promise<object[]>}
   */
  async syncProfileSummary(userId, clinicId) {
    if (!userId || !clinicId) return [];

    const { data, error } = await supabase
      .from('learned_facts_agentic')
      .select('fact, confidence, learned_at, supporting_records')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('confidence', { ascending: false })
      .order('learned_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    const summary = (data || []).map((item) => ({
      fact: item.fact,
      confidence: item.confidence,
      learned_at: item.learned_at,
      supporting_records: item.supporting_records || []
    }));

    const { error: updateError } = await supabase
      .from('clinic_profiles')
      .update({ learned_facts_summary: summary })
      .eq('id', clinicId)
      .eq('user_id', userId);

    if (updateError) throw updateError;
    return summary;
  }

  /**
   * Busca textual simples para ambientes sem embeddings.
   *
   * @param {string} clinicId
   * @param {string} query
   * @param {number} limit
   * @returns {Promise<object[]>}
   */
  async keywordSearch(clinicId, query, limit = 5) {
    const keywords = this.extractKeywords(query);
    const { data, error } = await supabase
      .from('learned_facts_agentic')
      .select('id, fact, fact_type, confidence')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('confidence', { ascending: false })
      .limit(50);

    if (error) throw error;

    const scored = (data || [])
      .map((item) => ({
        ...item,
        similarity: this._keywordSimilarity(item.fact, keywords)
      }))
      .filter((item) => item.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity || b.confidence - a.confidence)
      .slice(0, limit);

    await this._touchFacts(scored.map((item) => item.id));
    return scored;
  }

  /**
   * Extrai palavras-chave relevantes.
   *
   * @param {string} text
   * @returns {string[]}
   */
  extractKeywords(text) {
    const stopwords = new Set([
      'de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'a', 'o', 'as', 'os',
      'no', 'na', 'em', 'por', 'para', 'com', 'sem', 'uma', 'um',
      'que', 'como', 'foi', 'sera', 'será', 'esta', 'está', 'esse', 'essa'
    ]);

    return [...new Set(
      String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 2 && !stopwords.has(token))
    )];
  }

  async _findExistingFact(clinicId, fact) {
    const { data, error } = await supabase
      .from('learned_facts_agentic')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .limit(50);

    if (error) throw error;

    return (data || []).find(
      (item) => String(item.fact || '').trim().toLowerCase() === fact.toLowerCase()
    ) || null;
  }

  _mergeSupportingRecords(existing, incoming) {
    return [...new Set([...(existing || []), ...(incoming || [])].filter(Boolean))];
  }

  _keywordSimilarity(fact, keywords) {
    const haystack = String(fact || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    return (keywords || []).reduce((score, keyword) => (
      haystack.includes(keyword) ? score + 1 : score
    ), 0);
  }

  async _touchFacts(ids) {
    const validIds = (ids || []).filter(Boolean);
    if (!validIds.length) return;

    for (const id of validIds) {
      try {
        const { data, error } = await supabase
          .from('learned_facts_agentic')
          .select('use_count')
          .eq('id', id)
          .single();

        if (error) continue;

        await supabase
          .from('learned_facts_agentic')
          .update({
            use_count: Number(data?.use_count || 0) + 1,
            last_used_at: new Date().toISOString()
          })
          .eq('id', id);
      } catch (error) {
        // Uso é métrica secundária; não deve quebrar a busca.
      }
    }
  }
}

module.exports = new LearnedFactsService();
module.exports.LearnedFactsService = LearnedFactsService;
