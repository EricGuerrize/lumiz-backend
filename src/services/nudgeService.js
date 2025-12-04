const supabase = require('../db/supabase');
const evolutionService = require('./evolutionService');

const HOURS = {
  phase1Stalled: 12,
  phase2Followup: 24,
  phase2Pending: 18,
  welcome: 24
};

class NudgeService {
  async checkAndSendNudges() {
    const now = new Date();
    const states = await this.fetchOnboardingStates();
    const results = [];

    for (const state of states) {
      const nudges = this.evaluateState(state, now);

      for (const nudge of nudges) {
        // Verifica se já foi enviado
        const existing = await this.getExistingNudge(state.phone, nudge.type);

        if (existing && existing.status === 'sent') {
          continue;
        }

        // Verifica cooldown/agendamento
        if (existing?.last_attempt_at) {
          const hoursSinceAttempt = (now - new Date(existing.last_attempt_at)) / 36e5;
          if (hoursSinceAttempt < nudge.cooldownHours) {
            continue;
          }
        }

        // Lógica específica para retenção: verificar se houve atividade
        if (nudge.type === 'retention_24h') {
          const hasActivity = await this.checkUserActivity(state.phone, state.completed_at);
          if (hasActivity) {
            console.log(`[NUDGE] Usuário ${state.phone} tem atividade, pulando retenção.`);
            // Marca como "ignorado" ou "sent" para não verificar de novo?
            // Vamos marcar como sent para não processar mais
            await this.recordAttempt(existing, state.phone, nudge.type, { skipped: true, reason: 'has_activity' });
            await this.markSent(state.phone, nudge.type);
            continue;
          }
        }

        await this.recordAttempt(existing, state.phone, nudge.type, nudge.metadata);

        try {
          await evolutionService.sendMessage(state.phone, nudge.message);
          await this.markSent(state.phone, nudge.type);
          results.push({
            phone: state.phone,
            type: nudge.type,
            status: 'sent'
          });
        } catch (error) {
          console.error(`[NUDGE] Erro ao enviar ${nudge.type} para ${state.phone}:`, error.message);
          await this.markError(state.phone, nudge.type, error.message);
        }
      }
    }

    if (results.length > 0) {
      console.log(`[NUDGE] ${results.length} lembretes enviados.`);
    }

    return results;
  }

  async checkUserActivity(phone, since) {
    // Busca usuário pelo telefone (precisamos do ID do usuário para buscar transações)
    // Assumindo que o telefone está na tabela profiles ou que podemos buscar transações pelo telefone se houver join
    // Mas o onboarding_progress tem o telefone. O profiles tem telefone.

    // 1. Buscar ID do usuário
    const { data: user } = await supabase
      .from('profiles')
      .select('id')
      .eq('telefone', phone)
      .single();

    if (!user) return false;

    // 2. Buscar transações (atendimentos) criadas após 'since'
    const { count } = await supabase
      .from('atendimentos')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gt('created_at', since);

    return count > 0;
  }

  async fetchOnboardingStates() {
    const { data, error } = await supabase
      .from('onboarding_progress')
      .select('*');

    if (error) {
      console.error('[NUDGE] Erro ao buscar progresso:', error);
      return [];
    }

    return data || [];
  }

  evaluateState(state, now) {
    const nudges = [];
    const hoursSinceUpdate = (now - new Date(state.updated_at || state.created_at)) / 36e5;

    if (!state.completed) {
      if (state.stage === 'phase1' && hoursSinceUpdate >= HOURS.phase1Stalled) {
        nudges.push({
          type: 'phase1_stalled',
          cooldownHours: HOURS.phase1Stalled,
          metadata: { stage: state.stage, progress: state.progress_percent },
          message: this.buildPhase1Message(state)
        });
      }

      if (state.stage === 'phase2') {
        const choice = state.data?.phase2?.question_choice;
        const mdrStatus = state.data?.phase2?.mdr_status;

        if (choice === 'lembrar_mais_tarde' && hoursSinceUpdate >= HOURS.phase2Followup) {
          nudges.push({
            type: 'phase2_followup',
            cooldownHours: HOURS.phase2Followup,
            metadata: { stage: state.stage, choice },
            message: this.buildPhase2FollowupMessage(state)
          });
        }

        if (
          (!choice || choice === 'configurar_agora') &&
          ['pending', 'pending_review'].includes(mdrStatus || 'pending') &&
          hoursSinceUpdate >= HOURS.phase2Pending
        ) {
          nudges.push({
            type: 'phase2_pending_mdr',
            cooldownHours: HOURS.phase2Pending,
            metadata: { stage: state.stage, mdr_status: mdrStatus },
            message: this.buildPhase2PendingMessage(state)
          });
        }
      }
    } else if (state.completed_at) {
      const hoursSinceCompletion = (now - new Date(state.completed_at)) / 36e5;

      // Retention Nudge (24h after completion)
      if (hoursSinceCompletion >= 24) {
        nudges.push({
          type: 'retention_24h',
          cooldownHours: 24, // Tenta a cada 24h se falhar? Ou só uma vez? O check de 'sent' impede repetição.
          metadata: { completed_at: state.completed_at },
          message: this.buildRetentionMessage(state)
        });
      }
    }

    return nudges;
  }

  buildPhase1Message(state) {
    const firstName = state.data?.phase1?.contact_name?.split(' ')[0] || 'Oi';
    return `${firstName}, posso te ajudar a finalizar seu cadastro na Lumiz? 💜\n\nFaltam só alguns detalhes pra liberar todos os recursos da sua clínica.\n\nMe manda uma mensagem por aqui quando puder que a gente conclui rapidinho!`;
  }

  buildPhase2FollowupMessage() {
    return `Vamos cadastrar as taxas da sua maquininha e deixar os cálculos automáticos? 💳\n\nLeva menos de 3 min e você pode editar sempre que quiser.\n\nMe diz "configurar agora" que eu te guio passo a passo.`;
  }

  buildPhase2PendingMessage() {
    return `Recebi seus dados de cartão e só falta confirmar as taxas para ativar os cálculos automáticos. 🔄\n\nQuer que eu te mostre o resumo pra revisar agora?`;
  }

  buildWelcomeMessage(state) {
    const clinic = state.data?.phase1?.clinic_name || 'sua clínica';
    return `🎉 Onboarding concluído!\n\n${clinic} já pode usar a Lumiz no WhatsApp!\n\nQuer uma dica do que fazer agora? Manda "insights" ou registra sua próxima venda 🙂`;
  }

  buildRetentionMessage(state) {
    const firstName = state.data?.nome_completo?.split(' ')[0] || 'Oi';
    return `Oi ${firstName}! 👋 Como está o movimento na clínica hoje? Se tiver feito alguma venda, já me manda aqui pra não acumular!`;
  }

  async getExistingNudge(phone, type) {
    const { data } = await supabase
      .from('onboarding_nudges')
      .select('*')
      .eq('phone', phone)
      .eq('type', type)
      .maybeSingle();

    return data || null;
  }

  async recordAttempt(existing, phone, type, metadata = {}) {
    const payload = {
      metadata,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (existing) {
      await supabase
        .from('onboarding_nudges')
        .update(payload)
        .eq('id', existing.id);
    } else {
      await supabase
        .from('onboarding_nudges')
        .insert({
          phone,
          type,
          status: 'pending',
          metadata,
          scheduled_at: new Date().toISOString(),
          last_attempt_at: payload.last_attempt_at,
          updated_at: payload.updated_at
        });
    }
  }

  async markSent(phone, type) {
    await supabase
      .from('onboarding_nudges')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error: null
      })
      .eq('phone', phone)
      .eq('type', type);
  }

  async markError(phone, type, errorMessage) {
    await supabase
      .from('onboarding_nudges')
      .update({
        status: 'pending',
        error: errorMessage,
        updated_at: new Date().toISOString()
      })
      .eq('phone', phone)
      .eq('type', type);
  }
}

module.exports = new NudgeService();

