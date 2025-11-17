const { v4: uuidv4 } = require('uuid');
const supabase = require('../db/supabase');

const STEP_BLUEPRINT = [
  { id: 'phase1_welcome', label: 'Boas-vindas', phase: 1, optional: false },
  { id: 'phase1_name', label: 'Nome completo', phase: 1, optional: false },
  { id: 'phase1_clinic', label: 'Nome da clínica', phase: 1, optional: false },
  { id: 'phase1_email', label: 'Email', phase: 1, optional: false },
  { id: 'phase1_cnpj', label: 'CNPJ', phase: 1, optional: true },
  { id: 'phase1_team_size', label: 'Tamanho da equipe', phase: 1, optional: false },
  { id: 'phase1_volume', label: 'Volume mensal', phase: 1, optional: false },
  { id: 'phase2_mdr_question', label: 'Pergunta taxas', phase: 2, optional: false },
  { id: 'phase2_mdr_setup', label: 'Configurar MDR', phase: 2, optional: false },
  { id: 'phase3_whatsapp', label: 'Integração WhatsApp', phase: 3, optional: false },
  { id: 'phase3_finish', label: 'Concluir onboarding', phase: 3, optional: false }
];

const DEFAULT_DATA = {
  phase1: {
    contact_name: null,
    clinic_name: null,
    email: null,
    cnpj: null,
    cnpj_status: 'pending',
    team_size_range: null,
    volume_range: null
  },
  phase2: {
    question_choice: null,
    mdr_status: 'pending',
    last_mdr_config_id: null,
    reminder_scheduled: false
  },
  phase3: {
    assistant_persona: 'lumiz_whatsapp',
    pending_prompts: [],
    last_prompt_sent_at: null
  },
  realtime: {
    last_step: 'phase1_welcome',
    progress_percent: 0
  }
};

const SKIP_KEYWORDS = [
  'pular',
  'pulo',
  'prefiro nao informar agora',
  'prefiro não informar agora',
  'nao quero informar',
  'não quero informar',
  'sem cnpj',
  'depois eu informo'
];

function deepMerge(target = {}, source = {}) {
  const output = { ...target };

  Object.keys(source || {}).forEach((key) => {
    const sourceValue = source[key];
    const targetValue = output[key];

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      output[key] = deepMerge(targetValue, sourceValue);
    } else {
      output[key] = sourceValue;
    }
  });

  return output;
}

class OnboardingService {
  constructor() {
    this.stepBlueprint = STEP_BLUEPRINT;
  }

  getDefaultSteps() {
    return this.stepBlueprint.map((step, index) => ({
      ...step,
      status: index === 0 ? 'completed' : 'pending',
      metadata: {},
      updated_at: index === 0 ? new Date().toISOString() : null
    }));
  }

  getDefaultData() {
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }

  async ensureState(phone, userId = null, options = {}) {
    if (!phone) {
      throw new Error('PHONE_REQUIRED');
    }

    const existing = await this.getRawState(phone);
    if (existing) {
      if (userId && !existing.user_id) {
        return await this.updateRecord(existing.id, {
          user_id: userId,
          updated_at: new Date().toISOString()
        });
      }
      return this.decorate(existing);
    }

    const initialState = {
      id: uuidv4(),
      phone,
      user_id: userId || null,
      stage: options.stage || 'phase1',
      phase: options.phase || 1,
      steps: this.getDefaultSteps(),
      data: this.getDefaultData(),
      progress_percent: 9,
      ab_variant: options.abVariant || 'default',
      resume_token: uuidv4(),
      completed: false,
      completed_at: null,
      meta: {
        channel: options.channel || 'whatsapp',
        created_by: 'backend'
      },
      nps_score: null,
      nps_feedback: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('onboarding_progress')
      .insert(initialState)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return this.decorate(data);
  }

  async getState(phone) {
    const existing = await this.getRawState(phone);
    if (!existing) return null;
    return this.decorate(existing);
  }

  async getRawState(phone) {
    if (!phone) return null;

    const { data, error } = await supabase
      .from('onboarding_progress')
      .select('*')
      .eq('phone', phone)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data || null;
  }

  computeProgress(steps = []) {
    if (!steps.length) return 0;
    const mandatory = steps.filter((step) => !step.optional);
    if (!mandatory.length) return 0;
    const completed = mandatory.filter((step) => step.status === 'completed').length;
    return Math.min(100, Math.round((completed / mandatory.length) * 100));
  }

  renderProgressBar(percent, slots = 10) {
    const filledSlots = Math.round((percent / 100) * slots);
    const filled = '▓'.repeat(filledSlots);
    const empty = '░'.repeat(slots - filledSlots);

    return `${filled}${empty}`;
  }

  decorate(record) {
    if (!record) return null;
    const progress = record.progress_percent ?? this.computeProgress(record.steps);
    return {
      ...record,
      progress_percent: progress,
      progress_label: `Progresso: ${this.renderProgressBar(progress)} ${progress}%`,
      resumable: !record.completed,
      pending_fields: this.getPendingFields(record)
    };
  }

  getPendingFields(record) {
    const pending = [];
    const data = record?.data || {};

    if (!data?.phase1?.cnpj && data?.phase1?.cnpj_status !== 'skipped') {
      pending.push('cnpj');
    }
    if (!data?.phase1?.team_size_range) {
      pending.push('team_size');
    }
    if (!data?.phase1?.volume_range) {
      pending.push('volume');
    }
    if (!record?.completed && (data?.phase2?.mdr_status === 'pending' || !data?.phase2?.mdr_status)) {
      pending.push('mdr_config');
    }

    return pending;
  }

  async updateRecord(id, updates) {
    const { data, error } = await supabase
      .from('onboarding_progress')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return this.decorate(data);
  }

  normalizeSteps(existingSteps = []) {
    const map = new Map(existingSteps.map((step) => [step.id, step]));

    const normalized = this.stepBlueprint.map((blueprint, index) => {
      if (map.has(blueprint.id)) {
        return {
          ...blueprint,
          ...map.get(blueprint.id)
        };
      }

      return {
        ...blueprint,
        status: index === 0 ? 'completed' : 'pending',
        metadata: {},
        updated_at: index === 0 ? new Date().toISOString() : null
      };
    });

    return normalized;
  }

  async updateStepStatus(phone, stepId, status = 'completed', metadata = {}) {
    const state = await this.ensureState(phone);
    const steps = this.normalizeSteps(state.steps);

    const updatedSteps = steps.map((step) => {
      if (step.id !== stepId) return step;
      return {
        ...step,
        status,
        metadata: {
          ...step.metadata,
          ...metadata
        },
        updated_at: new Date().toISOString()
      };
    });

    const progress = this.computeProgress(updatedSteps);

    return await this.updateRecord(state.id, {
      steps: updatedSteps,
      progress_percent: progress,
      data: deepMerge(state.data, {
        realtime: {
          last_step: stepId,
          progress_percent: progress
        }
      })
    });
  }

  async savePhaseData(phone, phaseKey, payload = {}) {
    const state = await this.ensureState(phone);
    const newData = deepMerge(state.data, {
      [phaseKey]: payload
    });

    return await this.updateRecord(state.id, {
      data: newData
    });
  }

  async updateState(phone, updates = {}) {
    const state = await this.ensureState(phone, updates.userId);
    const data = updates.data ? deepMerge(state.data, updates.data) : state.data;
    const steps = updates.steps ? updates.steps : state.steps;
    let completed = state.completed;
    let completed_at = state.completed_at;
    let progress = updates.progress_percent ?? this.computeProgress(steps);

    if (updates.completed && !state.completed) {
      completed = true;
      completed_at = new Date().toISOString();
      progress = 100;
    }

    return await this.updateRecord(state.id, {
      stage: updates.stage || state.stage,
      phase: updates.phase || state.phase,
      steps,
      data,
      progress_percent: progress,
      completed,
      completed_at,
      ab_variant: updates.abVariant || state.ab_variant,
      meta: deepMerge(state.meta || {}, updates.meta || {})
    });
  }

  async markCompleted(phone) {
    const state = await this.ensureState(phone);
    if (state.completed) return state;

    await this.updateStepStatus(phone, 'phase3_finish', 'completed', { channel: 'whatsapp' });

    return await this.updateRecord(state.id, {
      completed: true,
      stage: 'completed',
      phase: 3,
      progress_percent: 100,
      completed_at: new Date().toISOString()
    });
  }

  async getProgressSummaryByPhone(phone) {
    const state = await this.getState(phone);
    if (!state) return null;
    return this.getProgressSummary(state);
  }

  getProgressSummary(state) {
    if (!state) return null;
    const percent = state.progress_percent ?? this.computeProgress(state.steps);
    const bar = this.renderProgressBar(percent);
    const mandatorySteps = state.steps?.filter((s) => !s.optional) || [];
    const completedSteps = mandatorySteps.filter((s) => s.status === 'completed').length;

    return {
      percent,
      bar,
      label: `Progresso: ${bar} ${percent}%`,
      completedSteps,
      totalSteps: mandatorySteps.length
    };
  }

  async getProgressLabel(phone) {
    const summary = await this.getProgressSummaryByPhone(phone);
    return summary ? summary.label : null;
  }

  isSkipResponse(message) {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return SKIP_KEYWORDS.some((keyword) => normalized.includes(keyword));
  }

  async recordNps(phone, { score, feedback }) {
    const state = await this.ensureState(phone);
    return await this.updateRecord(state.id, {
      nps_score: typeof score === 'number' ? score : null,
      nps_feedback: feedback || state.nps_feedback
    });
  }

  async getAssistantPrompts(phone) {
    const state = await this.ensureState(phone);
    const pending = state.pending_fields || [];
    const prompts = [];

    if (pending.includes('cnpj')) {
      prompts.push({
        focus: 'cnpj',
        message: 'Vi que ainda não cadastramos o CNPJ da clínica. Quer me passar agora? Eu deixo anotadinho e adianta a integração fiscal 😉'
      });
    }

    if (pending.includes('team_size')) {
      prompts.push({
        focus: 'team_size',
        message: 'Quantas pessoas estão na operação hoje? Com esse dado eu consigo sugerir metas personalizadas pra equipe.'
      });
    }

    if (pending.includes('volume')) {
      prompts.push({
        focus: 'volume',
        message: 'Qual o volume médio de atendimentos/mês? Pode ser uma faixa aproximada, tipo 20+. Isso me ajuda a destravar relatórios automáticos.'
      });
    }

    if (pending.includes('mdr_config')) {
      prompts.push({
        focus: 'mdr_config',
        message: 'Vamos cadastrar as taxas da sua maquininha? Assim calculo automaticamente os custos de cartão em cada venda. Leva menos de 3 min ✨'
      });
    }

    if (!prompts.length) {
      prompts.push({
        focus: 'celebration',
        message: 'Onboarding concluído! Quer que eu revise algum ponto ou já partimos pro próximo passo do crescimento da clínica?'
      });
    }

    return {
      prompts,
      state: this.decorate(state)
    };
  }

  async getMetrics() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const summary = {
      total: 0,
      completed: 0,
      completion_rate: 0,
      avg_duration_minutes: null,
      avg_current_duration_minutes: null,
      phase_breakdown: {
        phase1: 0,
        phase2: 0,
        phase3: 0,
        completed: 0
      },
      mdr_conversion_rate: 0,
      nps_avg: null
    };

    const { data, error } = await supabase
      .from('onboarding_progress')
      .select('id, stage, phase, completed, created_at, completed_at, data, progress_percent, nps_score')
      .gte('created_at', startOfMonth);

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!data || !data.length) {
      return summary;
    }

    summary.total = data.length;
    const completedRecords = data.filter((item) => item.completed);
    summary.completed = completedRecords.length;
    summary.completion_rate = parseFloat(((summary.completed / summary.total) * 100).toFixed(1));

    const durations = completedRecords
      .filter((item) => item.completed_at)
      .map((item) => {
        const end = new Date(item.completed_at).getTime();
        const start = new Date(item.created_at).getTime();
        return Math.max(0, (end - start) / 60000);
      });

    if (durations.length) {
      summary.avg_duration_minutes = parseFloat(
        (durations.reduce((acc, cur) => acc + cur, 0) / durations.length).toFixed(1)
      );
    }

    const inProgressDurations = data
      .filter((item) => !item.completed)
      .map((item) => {
        const nowTs = Date.now();
        const start = new Date(item.created_at).getTime();
        return Math.max(0, (nowTs - start) / 60000);
      });

    if (inProgressDurations.length) {
      summary.avg_current_duration_minutes = parseFloat(
        (inProgressDurations.reduce((acc, cur) => acc + cur, 0) / inProgressDurations.length).toFixed(1)
      );
    }

    data.forEach((item) => {
      if (item.completed) {
        summary.phase_breakdown.completed += 1;
      } else if (item.stage === 'phase3') {
        summary.phase_breakdown.phase3 += 1;
      } else if (item.stage === 'phase2') {
        summary.phase_breakdown.phase2 += 1;
      } else {
        summary.phase_breakdown.phase1 += 1;
      }
    });

    const mdrDone = data.filter((item) => item.data?.phase2?.mdr_status === 'configured').length;
    summary.mdr_conversion_rate = summary.total
      ? parseFloat(((mdrDone / summary.total) * 100).toFixed(1))
      : 0;

    const npsScores = data
      .map((item) => item.nps_score)
      .filter((score) => typeof score === 'number');
    if (npsScores.length) {
      summary.nps_avg = parseFloat(
        (npsScores.reduce((acc, cur) => acc + cur, 0) / npsScores.length).toFixed(1)
      );
    }

    return summary;
  }
}

module.exports = new OnboardingService();

