const supabase = require('../db/supabase');

class ConversationHistoryService {
  /**
   * Busca exemplos similares de conversas bem-sucedidas (para RAG)
   * Versão simples: busca por texto similar usando LIKE
   */
  async findSimilarExamples(userMessage, userId, limit = 3) {
    try {
      if (!userMessage || userMessage.length < 3) {
        return [];
      }

      // Extrai palavras-chave da mensagem (remove palavras comuns)
      const keywords = this.extractKeywords(userMessage);
      if (keywords.length === 0) {
        return [];
      }

      // Busca conversas com feedback positivo que contenham palavras similares
      let query = supabase
        .from('conversation_history')
        .select('user_message, bot_response, intent, context')
        .eq('user_id', userId)
        .eq('feedback', 'positive')
        .order('created_at', { ascending: false })
        .limit(limit * 2); // Busca mais para filtrar depois

      // Filtra por palavras-chave usando ILIKE (case-insensitive)
      const conditions = keywords.map(keyword => `user_message.ilike.%${keyword}%`);
      
      // Busca conversas que contenham pelo menos uma palavra-chave
      const { data, error } = await query;

      if (error) {
        console.error('[RAG] Erro ao buscar exemplos:', error);
        return [];
      }

      if (!data || data.length === 0) {
        return [];
      }

      // Filtra e ordena por similaridade (quantas palavras-chave aparecem)
      const scored = data.map(conv => ({
        ...conv,
        score: this.calculateSimilarity(userMessage, conv.user_message, keywords)
      }))
      .filter(conv => conv.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

      console.log(`[RAG] Encontrados ${scored.length} exemplos similares para: "${userMessage}"`);
      
      return scored;
    } catch (error) {
      console.error('[RAG] Erro ao buscar exemplos similares:', error);
      return [];
    }
  }

  /**
   * Extrai palavras-chave da mensagem (remove stopwords)
   */
  extractKeywords(message) {
    const stopwords = ['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 
                      'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'sem', 'que',
                      'é', 'são', 'foi', 'ser', 'ter', 'tem', 'ter', 'está', 'estou',
                      'me', 'te', 'se', 'ele', 'ela', 'nós', 'você', 'vocês'];
    
    const words = message.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopwords.includes(word));
    
    return [...new Set(words)]; // Remove duplicatas
  }

  /**
   * Calcula similaridade entre duas mensagens
   * Retorna score baseado em quantas palavras-chave aparecem
   */
  calculateSimilarity(message1, message2, keywords) {
    const msg1Lower = message1.toLowerCase();
    const msg2Lower = message2.toLowerCase();
    
    let score = 0;
    keywords.forEach(keyword => {
      if (msg2Lower.includes(keyword)) {
        score += 1;
      }
    });

    // Bônus se mensagens são muito similares em tamanho
    const lengthDiff = Math.abs(message1.length - message2.length) / Math.max(message1.length, message2.length);
    if (lengthDiff < 0.3) {
      score += 0.5;
    }

    return score;
  }

  /**
   * Busca histórico recente de conversas do usuário (últimas N)
   */
  async getRecentHistory(userId, limit = 5) {
    try {
      const { data, error } = await supabase
        .from('conversation_history')
        .select('user_message, bot_response, intent')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[CONV_HIST] Erro ao buscar histórico:', error);
        return [];
      }

      return (data || []).reverse(); // Mais antiga primeiro para contexto
    } catch (error) {
      console.error('[CONV_HIST] Erro ao buscar histórico:', error);
      return [];
    }
  }

  /**
   * Armazena uma conversa no histórico
   */
  async saveConversation(userId, userMessage, botResponse, intent, context = {}) {
    try {
      if (!userId) {
        return;
      }

      const { error } = await supabase
        .from('conversation_history')
        .insert({
          user_id: userId,
          user_message: userMessage,
          bot_response: botResponse,
          intent: intent,
          context: context,
          feedback: null // Será preenchido depois se usuário der feedback
        });

      if (error) {
        if (error.code === '23503') {
          console.warn(`[CONV_HIST] user_id sem profile válido (${userId}). Histórico ignorado para evitar falha.`);
          return;
        }
        console.error('[CONV_HIST] Erro ao salvar conversa:', error);
      } else {
        console.log(`[CONV_HIST] ✅ Conversa salva: ${userId} - "${userMessage.substring(0, 30)}..."`);
      }
    } catch (error) {
      console.error('[CONV_HIST] Erro ao salvar conversa:', error);
    }
  }

  /**
   * Registra feedback do usuário sobre uma conversa
   */
  async recordFeedback(userId, conversationId, feedback) {
    try {
      const { error } = await supabase
        .from('conversation_history')
        .update({ feedback: feedback })
        .eq('id', conversationId)
        .eq('user_id', userId);

      if (error) {
        console.error('[CONV_HIST] Erro ao registrar feedback:', error);
      } else {
        console.log(`[CONV_HIST] ✅ Feedback registrado: ${feedback} para conversa ${conversationId}`);
      }
    } catch (error) {
      console.error('[CONV_HIST] Erro ao registrar feedback:', error);
    }
  }
}

module.exports = new ConversationHistoryService();
