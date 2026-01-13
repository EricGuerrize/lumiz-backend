const supabase = require('../../db/supabase');

/**
 * Handler para agenda e agendamentos
 */
class ScheduleHandler {
  /**
   * Consulta agenda
   */
  async handleSchedule(user) {
    try {
      const hoje = new Date().toISOString().split('T')[0];
      const { data: agendamentos, error } = await supabase
        .from('agendamentos')
        .select('*')
        .eq('user_id', user.id)
        .gte('data', hoje)
        .order('data', { ascending: true })
        .limit(10);

      if (error) {
        throw error;
      }

      if (!agendamentos || agendamentos.length === 0) {
        return `Não tem agendamentos futuros 📅\n\nPara criar um agendamento, me diga:\n_"Agendar cliente Maria dia 20/12 às 14h"_`;
      }

      let response = `*AGENDA*\n\n`;

      // Agrupa por data
      const porData = {};
      agendamentos.forEach(ag => {
        const dataKey = ag.data;
        if (!porData[dataKey]) {
          porData[dataKey] = [];
        }
        porData[dataKey].push(ag);
      });

      Object.entries(porData).forEach(([data, ags]) => {
        const dataFormatada = new Date(data).toLocaleDateString('pt-BR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long'
        });
        response += `📅 *${dataFormatada}*\n`;

        ags.forEach(ag => {
          const hora = ag.hora || 'Sem horário';
          response += `  ${hora} - ${ag.cliente_nome || 'Cliente'}\n`;
          if (ag.observacoes) {
            response += `    ${ag.observacoes}\n`;
          }
        });
        response += `\n`;
      });

      return response.trim();
    } catch (error) {
      console.error('Erro ao buscar agenda:', error);
      return 'Erro ao buscar agenda. Tente novamente.';
    }
  }
}

module.exports = ScheduleHandler;


