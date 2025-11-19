const supabase = require('../db/supabase');

class ConversationHistoryService {
  /**
   * Busca histórico recente de conversas do usuário
   */
  async getRecentHistory(userId, limit = 5) {
    try {
      // Por enquanto, vamos armazenar em memória (Map)
      // Depois pode migrar para banco se necessário
      // Por enquanto retorna vazio - será implementado quando tivermos tabela
      return [];
    } catch (error) {
      console.error('[CONV_HIST] Erro ao buscar histórico:', error);
      return [];
    }
  }

  /**
   * Armazena uma conversa no histórico
   */
  async saveConversation(userId, userMessage, botResponse, intent) {
    try {
      // Por enquanto, apenas log
      // Depois implementar armazenamento no banco
      console.log(`[CONV_HIST] ${userId}: "${userMessage}" → "${botResponse.substring(0, 50)}..."`);
    } catch (error) {
      console.error('[CONV_HIST] Erro ao salvar conversa:', error);
    }
  }
}

module.exports = new ConversationHistoryService();

