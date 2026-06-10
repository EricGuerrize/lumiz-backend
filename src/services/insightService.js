const { GoogleGenerativeAI } = require('@google/generative-ai');

const supabase = require('../db/supabase');
const transactionController = require('../controllers/transactionController');
const outboundMessageService = require('./outboundMessageService');
const { formatarMoeda } = require('../utils/currency');

class InsightService {
  constructor() {
    this.model = null;
    if (process.env.GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-flash-latest' });
    } else {
      console.warn('[INSIGHTS] GEMINI_API_KEY não configurada. Insights automáticos desativados.');
    }
  }

  async generateDailyInsights() {
    if (!this.model) {
      return [];
    }

    const users = await this.fetchActiveUsers();
    const generated = [];

    for (const user of users) {
      try {
        const metrics = await this.collectMetrics(user.id);
        if (!metrics || metrics.reportCurrent.totalTransacoes === 0) {
          continue;
        }

        const payload = await this.buildInsightsPayload(user, metrics);
        if (!payload?.insights?.length) {
          continue;
        }

        const insightRecord = await this.persistInsight(user, payload, metrics);
        await this.notifyUser(user, payload);

        generated.push({
          userId: user.id,
          insights: payload.insights.length,
          insightId: insightRecord.id
        });
      } catch (error) {
        console.error(`[INSIGHTS] Falha ao gerar insight para ${user.id}:`, error.message);
      }
    }

    if (generated.length) {
      console.log(`[INSIGHTS] ${generated.length} usuários receberam insights.`);
    }

    return generated;
  }

  async fetchActiveUsers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, telefone, nome_clinica, nome_completo')
      .eq('is_active', true)
      .eq('alertas_whatsapp_ativos', true)
      .not('telefone', 'is', null);

    if (error) {
      console.error('[INSIGHTS] Erro ao buscar usuários:', error);
      return [];
    }

    return data || [];
  }

  async collectMetrics(userId) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    let previousMonth = month - 1;
    let previousYear = year;
    if (previousMonth === 0) {
      previousMonth = 12;
      previousYear -= 1;
    }

    const [reportCurrent, reportPrevious, todayStats, ranking] = await Promise.all([
      transactionController.getMonthlyReport(userId, year, month),
      transactionController.getMonthlyReport(userId, previousYear, previousMonth),
      transactionController.getTodayStats(userId),
      transactionController.getProcedureRanking(userId)
    ]);

    return {
      reportCurrent,
      reportPrevious,
      todayStats,
      ranking
    };
  }

  async buildInsightsPayload(user, metrics) {
    const prompt = `
Gere insights estratégicos para uma clínica estética.
Retorne JSON no formato:
{
  "headline": "resumo curto",
  "summary": "parágrafo curto",
  "insights": [
    { "title": "...", "description": "...", "action": "..." }
  ]
}

Nome da clínica: ${user.nome_clinica || 'Clínica'}
Dados do mês atual:
- Faturamento: ${metrics.reportCurrent.entradas.toFixed(2)}
- Custos: ${metrics.reportCurrent.saidas.toFixed(2)}
- Lucro: ${(metrics.reportCurrent.entradas - metrics.reportCurrent.saidas).toFixed(2)}
- Total de atendimentos: ${metrics.reportCurrent.totalTransacoes}

Comparativo mês anterior:
- Faturamento anterior: ${metrics.reportPrevious.entradas.toFixed(2)}
- Custos anteriores: ${metrics.reportPrevious.saidas.toFixed(2)}

Hoje:
- Faturamento hoje: ${metrics.todayStats.faturamento.toFixed(2)}
- Custos hoje: ${metrics.todayStats.custos.toFixed(2)}
- Lucro hoje: ${metrics.todayStats.lucro.toFixed(2)}

Top procedimentos: ${(metrics.ranking.ranking || []).slice(0, 3).map(item => `${item.nome} (${item.quantidade}x, ${formatarMoeda(item.valor)})`).join('; ') || 'sem dados'}

Escreva insights em tom positivo, prático, sempre sugerindo próximos passos.
`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().replace(/```json|```/g, '').trim();
      return JSON.parse(text);
    } catch (error) {
      console.error('[INSIGHTS] Erro no Gemini:', error.message);
      return null;
    }
  }

  async persistInsight(user, payload, metrics) {
    const { data, error } = await supabase
      .from('user_insights')
      .insert({
        user_id: user.id,
        phone: user.telefone,
        title: payload.headline || 'Insights Lumiz',
        summary: payload.summary || null,
        insights: payload.insights || [],
        sent_via: 'cron',
        sent_at: new Date().toISOString(),
        metadata: {
          report: metrics.reportCurrent,
          ranking: (metrics.ranking?.ranking || []).slice(0, 5)
        }
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async notifyUser(user, payload) {
    if (!user.telefone) return;
    const insights = payload.insights || [];
    let message = `📊 *Insights da ${user.nome_clinica || 'sua clínica'}*\n${payload.headline || ''}\n\n${payload.summary || ''}\n`;

    insights.slice(0, 3).forEach((item, index) => {
      message += `\n${index + 1}. *${item.title || 'Insight'}*\n${item.description || ''}`;
      if (item.action) {
        message += `\n➡️ ${item.action}`;
      }
      message += '\n';
    });

    message += `\nQuer mais detalhes? Manda "insights" novamente.`;

    try {
      await outboundMessageService.sendText(user.telefone, message.trim());
    } catch (error) {
      console.error('[INSIGHTS] Falha ao enviar WhatsApp:', error.message);
    }
  }

  async getRecentInsights(userId, limit = 3) {
    const { data, error } = await supabase
      .from('user_insights')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[INSIGHTS] Erro ao buscar insights:', error);
      return [];
    }

    return data || [];
  }

  async getInsightsMessage(userId) {
    const insights = await this.getRecentInsights(userId, 3);

    if (!insights.length) {
      return 'Ainda não gerei insights automáticos pra você. Continue registrando suas vendas que eu preparo um resumo personalizado! 💜';
    }

    const latest = insights[0];
    let message = `📊 *Insights recentes*\n${latest.title}\n\n${latest.summary || ''}\n`;

    (latest.insights || []).forEach((item, index) => {
      message += `\n${index + 1}. *${item.title || 'Insight'}*\n${item.description || ''}`;
      if (item.action) {
        message += `\n➡️ ${item.action}`;
      }
      message += '\n';
    });

    if (insights.length > 1) {
      message += `\nTenho mais ${insights.length - 1} relatório${insights.length - 1 > 1 ? 's' : ''} disponível${insights.length - 1 > 1 ? 'eis' : ''}. Manda "insights" novamente para ver.`;
    }

    return message.trim();
  }
}

module.exports = new InsightService();
