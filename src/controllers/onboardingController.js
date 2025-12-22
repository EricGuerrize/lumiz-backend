const onboardingService = require('../services/onboardingService');
const mdrService = require('../services/mdrService');
const { normalizePhone } = require('../utils/phone');

const resolveContext = (req) => {
  const rawPhone =
    req.user?.telefone ||
    req.headers['x-user-phone'] ||
    req.body.phone ||
    req.query.phone;

  const phone = normalizePhone(rawPhone) || rawPhone;

  if (!phone) {
    const error = new Error('PHONE_REQUIRED');
    error.status = 400;
    throw error;
  }

  const userId = req.user?.id || req.body.userId || null;
  return { phone, userId };
};

const sanitizeStepStatus = (status) => {
  const allowed = ['pending', 'completed', 'skipped'];
  return allowed.includes(status) ? status : 'completed';
};

class OnboardingController {
  async getState(req, res) {
    try {
      const { phone, userId } = resolveContext(req);
      const state = await onboardingService.ensureState(phone, userId, {
        abVariant: req.query.variant,
        channel: req.query.channel
      });
      res.json(state);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }

  async updateState(req, res) {
    try {
      const { phone, userId } = resolveContext(req);
      const state = await onboardingService.updateState(phone, {
        userId,
        stage: req.body.stage,
        phase: req.body.phase,
        data: req.body.data,
        steps: req.body.steps,
        abVariant: req.body.abVariant,
        completed: req.body.completed,
        meta: req.body.meta,
        progress_percent: req.body.progress_percent
      });

      res.json(state);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }

  async recordStep(req, res) {
    try {
      const { phone } = resolveContext(req);
      const { stepId, status, metadata } = req.body;

      if (!stepId) {
        return res.status(400).json({ error: 'stepId é obrigatório' });
      }

      const state = await onboardingService.updateStepStatus(
        phone,
        stepId,
        sanitizeStepStatus(status || 'completed'),
        metadata || {}
      );

      res.json(state);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }

  async saveManualMdr(req, res) {
    try {
      const { phone, userId } = resolveContext(req);
      const { bandeiras, tiposVenda, parcelas, provider } = req.body;

      if (!bandeiras || !Array.isArray(bandeiras) || !bandeiras.length) {
        return res.status(400).json({ error: 'bandeiras é obrigatório' });
      }

      const config = await mdrService.saveManualConfig({
        phone,
        userId,
        bandeiras,
        tiposVenda,
        parcelas,
        provider
      });

      await onboardingService.savePhaseData(phone, 'phase2', {
        question_choice: 'configurar_agora',
        mdr_status: 'configured',
        last_mdr_config_id: config.id
      });
      await onboardingService.updateStepStatus(phone, 'phase2_mdr_setup', 'completed', {
        source: 'manual'
      });

      res.status(201).json({
        message: 'Taxas registradas com sucesso',
        config
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }

  async requestOcr(req, res) {
    try {
      const { phone, userId } = resolveContext(req);
      const { imageUrl, provider } = req.body;

      if (!imageUrl) {
        return res.status(400).json({ error: 'imageUrl é obrigatório' });
      }

      const result = await mdrService.requestOcr({
        phone,
        userId,
        imageUrl,
        provider
      });

      const mdrStatus = result.status === 'queued' ? 'pending' : 'pending_review';
      const lastConfigId = result.config?.id || null;

      await onboardingService.savePhaseData(phone, 'phase2', {
        question_choice: 'configurar_agora',
        mdr_status: mdrStatus,
        last_mdr_config_id: lastConfigId
      });
      await onboardingService.updateStepStatus(phone, 'phase2_mdr_setup', 'pending', {
        source: 'ocr',
        config_id: lastConfigId
      });

      const responsePayload = {
        jobId: result.job.id,
        status: result.status
      };

      if (result.extraction) {
        responsePayload.extraction = result.extraction;
      }

      if (result.config) {
        responsePayload.config = result.config;
      }

      res.status(result.status === 'queued' ? 202 : 200).json(responsePayload);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }

  async confirmMdrConfig(req, res) {
    try {
      const { phone } = resolveContext(req);
      const { configId } = req.params;

      if (!configId) {
        return res.status(400).json({ error: 'configId é obrigatório' });
      }

      const config = await mdrService.confirmConfig(configId, req.body || {});

      await onboardingService.savePhaseData(phone, 'phase2', {
        mdr_status: 'configured',
        last_mdr_config_id: configId
      });
      await onboardingService.updateStepStatus(phone, 'phase2_mdr_setup', 'completed', {
        source: 'ocr'
      });

      res.json({
        message: 'Configuração confirmada',
        config
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }

  async getMdrConfig(req, res) {
    try {
      const { phone, userId } = resolveContext(req);
      const config = await mdrService.getLatestConfig(phone, userId);
      const jobs = await mdrService.getJobs(phone, userId);

      res.json({
        config,
        jobs
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }

  async getAssistantPrompts(req, res) {
    try {
      const { phone } = resolveContext(req);
      const data = await onboardingService.getAssistantPrompts(phone);
      res.json(data);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }

  async getMetrics(req, res) {
    try {
      const summary = await onboardingService.getMetrics();
      const mdrMetrics = await mdrService.getMetrics();

      res.json({
        ...summary,
        mdr_confirmed: mdrMetrics.confirmed
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }

  async recordNps(req, res) {
    try {
      const { phone } = resolveContext(req);
      const { score, feedback } = req.body || {};

      if (typeof score !== 'number') {
        return res.status(400).json({ error: 'score deve ser numérico' });
      }

      const state = await onboardingService.recordNps(phone, { score, feedback });

      res.json({
        message: 'NPS registrado',
        state
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }
}

module.exports = new OnboardingController();

