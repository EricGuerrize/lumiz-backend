const supabase = require('../../db/supabase');
const transactionController = require('../transactionController');
const { formatarMoeda } = require('../../utils/currency');
const { extractPrimaryMonetaryValue } = require('../../utils/moneyParser');

/**
 * Handler para metas e objetivos
 */
class GoalHandler {
  /**
   * Define meta mensal
   */
  async handleDefineGoal(user, phone, intent, rawMessage) {
    try {
      let valor = intent.dados?.valor || intent.dados?.meta;
      // Fallback: heurística não extrai valor, tenta direto da mensagem
      if (!valor || valor <= 0) {
        valor = extractPrimaryMonetaryValue(rawMessage || '');
      }

      if (!valor || valor <= 0) {
        return 'Qual é a sua meta de faturamento?\n\nExemplos:\n• "minha meta é R$ 50000"\n• "definir meta R$ 50k"\n• "objetivo de R$ 50000"';
      }

      // Salva meta no perfil do usuário
      const { error } = await supabase
        .from('profiles')
        .update({
          meta_mensal: parseFloat(valor),
          meta_atualizada_em: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) {
        console.error('Erro ao salvar meta:', error);
        return 'Erro ao definir meta. Tente novamente.';
      }

      return `✅ Meta de ${formatarMoeda(parseFloat(valor))} definida!\n\nManda "meta" a qualquer momento pra ver seu progresso.`;
    } catch (error) {
      console.error('Erro ao definir meta:', error);
      return 'Erro ao definir meta. Tente novamente.';
    }
  }

  /**
   * Mostra progresso da meta
   */
  async handleGoalProgress(user) {
    try {
      // Busca meta do perfil
      const { data: profile } = await supabase
        .from('profiles')
        .select('meta_mensal, meta_atualizada_em')
        .eq('id', user.id)
        .single();

      if (!profile || !profile.meta_mensal) {
        return 'Você ainda não definiu uma meta mensal 📊\n\nPara definir, digite: "minha meta é R$ 50000"';
      }

      // Busca faturamento do mês atual
      const now = new Date();
      const report = await transactionController.getMonthlyReport(user.id, now.getFullYear(), now.getMonth() + 1);
      
      const faturamentoAtual = report.entradas;
      const meta = parseFloat(profile.meta_mensal);
      const progresso = (faturamentoAtual / meta) * 100;
      const faltam = Math.max(0, meta - faturamentoAtual);

      let response = `*PROGRESSO DA META*\n\n`;
      response += `Meta mensal: ${formatarMoeda(meta)}\n`;
      response += `Faturamento atual: ${formatarMoeda(faturamentoAtual)}\n`;
      response += `Progresso: ${progresso.toFixed(1)}%\n\n`;

      // Barra de progresso visual
      const barras = Math.min(10, Math.floor(progresso / 10));
      const vazias = 10 - barras;
      response += `[${'▓'.repeat(barras)}${'░'.repeat(vazias)}]\n\n`;

      if (faltam > 0) {
        response += `Faltam: ${formatarMoeda(faltam)} para atingir a meta! 💪`;
      } else {
        response += `🎉 *Meta atingida!* Parabéns!`;
      }

      return response;
    } catch (error) {
      console.error('Erro ao buscar progresso da meta:', error);
      return 'Erro ao buscar progresso. Tente novamente.';
    }
  }
}

module.exports = GoalHandler;


