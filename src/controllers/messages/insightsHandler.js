const insightService = require('../../services/insightService');

/**
 * Handler para insights e análises
 */
class InsightsHandler {
  /**
   * Mostra insights do usuário
   */
  async handleInsights(user) {
    try {
      const insights = await insightService.getUserInsights(user.id);

      if (!insights || insights.length === 0) {
        return `Ainda não tenho insights para você 📊\n\nContinue registrando suas vendas e custos que eu vou gerar análises automáticas!`;
      }

      const maisRecente = insights[0];

      let response = `*INSIGHTS PARA VOCÊ*\n\n`;
      response += `📊 ${maisRecente.title || 'Análise Financeira'}\n\n`;
      response += `${maisRecente.summary || 'Sem resumo disponível'}\n\n`;

      if (maisRecente.insights && Array.isArray(maisRecente.insights) && maisRecente.insights.length > 0) {
        response += `*Principais pontos:*\n`;
        maisRecente.insights.slice(0, 3).forEach((insight, index) => {
          response += `${index + 1}. ${insight}\n`;
        });
      }

      if (insights.length > 1) {
        response += `\n\n_Tenho mais ${insights.length - 1} insight(s) para você. Quer ver? Digite "insights todos"_.`;
      }

      return response;
    } catch (error) {
      console.error('Erro ao buscar insights:', error);
      return 'Erro ao buscar insights. Tente novamente.';
    }
  }
}

module.exports = InsightsHandler;


