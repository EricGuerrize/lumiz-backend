const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const supabase = require('../db/supabase');
const mdrOcrService = require('./mdrOcrService');
const evolutionService = require('./evolutionService');
const onboardingService = require('./onboardingService');

class MdrService {
  constructor() {
    console.log('[MDR_QUEUE] Inicializando MdrService...');
    this.queue = null;
    this.worker = null;
    this.queueEnabled = false;

    console.log('[MDR_QUEUE] REDIS_URL:', process.env.REDIS_URL ? 'configurada' : 'não configurada');

    if (process.env.REDIS_URL) {
      try {
        console.log('[MDR_QUEUE] Conectando ao Redis...');
        // BullMQ requer maxRetriesPerRequest: null
        this.connection = new IORedis(process.env.REDIS_URL, {
          maxRetriesPerRequest: null
        });
        console.log('[MDR_QUEUE] Redis conectado, criando Queue...');
        this.queue = new Queue('mdr-ocr', { connection: this.connection });
        console.log('[MDR_QUEUE] Queue criada, criando Worker...');
        this.worker = new Worker('mdr-ocr', this.processQueueJob.bind(this), {
          connection: this.connection
        });
        console.log('[MDR_QUEUE] Worker criado, adicionando event listeners...');
        
        this.worker.on('completed', (job) => {
          console.log(`[MDR_QUEUE] Job ${job.id} completado`);
        });
        
        this.worker.on('failed', (job, err) => {
          console.error(`[MDR_QUEUE] Job ${job?.id} falhou:`, err.message);
        });
        
        this.queueEnabled = true;
        console.log('[MDR_QUEUE] ✅ BullMQ iniciado com sucesso!');
      } catch (error) {
        console.error('[MDR_QUEUE] ❌ Falha ao iniciar BullMQ:', error.message);
        console.error('[MDR_QUEUE] Stack:', error.stack);
      }
    } else {
      console.warn('[MDR_QUEUE] ⚠️ REDIS_URL não configurada. OCR será síncrono.');
    }
  }

  async saveManualConfig({ phone, userId, bandeiras, tiposVenda, parcelas, provider }) {
    const payload = {
      phone,
      user_id: userId,
      source: 'manual',
      provider: provider ? provider.toLowerCase() : null,
      bandeiras: bandeiras || [],
      tipos_venda: tiposVenda || {},
      parcelas: parcelas || {},
      raw_payload: {
        bandeiras,
        tiposVenda,
        parcelas
      },
      status: 'pending_confirmation'
    };

    const { data, error } = await supabase
      .from('mdr_configs')
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async requestOcr({ phone, userId, imageUrl, provider }) {
    const initialStatus = this.queueEnabled ? 'queued' : 'processing';

    const { data: job, error: jobError } = await supabase
      .from('ocr_jobs')
      .insert({
        phone,
        user_id: userId,
        provider: provider ? provider.toLowerCase() : null,
        source_url: imageUrl,
        status: initialStatus
      })
      .select()
      .single();

    if (jobError) {
      throw jobError;
    }

    if (this.queueEnabled && this.queue) {
      await this.queue.add('mdr-ocr', {
        jobId: job.id,
        phone,
        userId,
        imageUrl,
        provider
      });

      return { job, status: 'queued' };
    }

    const result = await this.processOcrInline(job, { phone, userId, imageUrl, provider });
    return { ...result, status: 'completed' };
  }

  async confirmConfig(configId, payload = {}) {
    const updatePayload = {
      status: 'confirmed',
      updated_at: new Date().toISOString()
    };

    if (payload.rawPayload) {
      updatePayload.raw_payload = payload.rawPayload;
    }

    const { data, error } = await supabase
      .from('mdr_configs')
      .update(updatePayload)
      .eq('id', configId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async getLatestConfig(phone, userId) {
    let query = supabase
      .from('mdr_configs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      query = query.eq('phone', phone);
    }

    const { data, error } = await query.maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data || null;
  }

  async getJobs(phone, userId) {
    let query = supabase
      .from('ocr_jobs')
      .select('*')
      .order('created_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      query = query.eq('phone', phone);
    }

    const { data, error } = await query;

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data || [];
  }

  async getMetrics() {
    const { count: confirmed } = await supabase
      .from('mdr_configs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'confirmed');

    return {
      confirmed: confirmed || 0
    };
  }

  async processOcrInline(job, payload) {
    try {
      const { extraction, config } = await this.extractAndCreateConfig(payload);

      await supabase
        .from('ocr_jobs')
        .update({
          status: 'completed',
          extracted_data: extraction,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);

      return { job, extraction, config };
    } catch (error) {
      await supabase
        .from('ocr_jobs')
        .update({
          status: 'failed',
          error: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);

      throw error;
    }
  }

  async processQueueJob(job) {
    const { jobId, phone, userId, imageUrl, provider } = job.data;
    console.log(`[MDR_QUEUE] Processando job ${jobId}`);

    await supabase
      .from('ocr_jobs')
      .update({
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    try {
      const { extraction, config } = await this.extractAndCreateConfig({ phone, userId, imageUrl, provider });

      await supabase
        .from('ocr_jobs')
        .update({
          status: 'completed',
          extracted_data: extraction,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId);

      await this.syncOnboardingState(phone, config.id);
      await this.notifySuccess(phone, extraction);

      return { configId: config.id };
    } catch (error) {
      console.error(`[MDR_QUEUE] Erro job ${jobId}:`, error.message);
      await supabase
        .from('ocr_jobs')
        .update({
          status: 'failed',
          error: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId);

      await this.notifyFailure(phone);
      throw error;
    }
  }

  async extractAndCreateConfig({ phone, userId, imageUrl, provider }) {
    const extraction = await mdrOcrService.extractRates({ imageUrl, provider });

    const { data: config, error: configError } = await supabase
      .from('mdr_configs')
      .insert({
        phone,
        user_id: userId,
        provider: extraction.provider,
        source: 'ocr',
        bandeiras: extraction.bandeiras,
        tipos_venda: extraction.tiposVenda,
        parcelas: extraction.parcelas,
        raw_payload: extraction,
        status: 'pending_review'
      })
      .select()
      .single();

    if (configError) {
      throw configError;
    }

    return { extraction, config };
  }

  async syncOnboardingState(phone, configId) {
    try {
      await onboardingService.savePhaseData(phone, 'phase2', {
        mdr_status: 'pending_review',
        last_mdr_config_id: configId
      });
      await onboardingService.updateStepStatus(phone, 'phase2_mdr_setup', 'pending', {
        source: 'ocr',
        config_id: configId
      });
    } catch (error) {
      console.error('[MDR_QUEUE] Erro ao sincronizar onboarding:', error.message);
    }
  }

  async notifySuccess(phone, extraction) {
    if (!phone) return;
    const provider = extraction.provider ? extraction.provider.toUpperCase() : 'sua maquininha';
    const message = `Prontinho! Extraí as taxas da ${provider}. ✅\n\nResponde \"revisar taxas\" ou me manda um \"sim\" pra confirmar e já deixar tudo automático.`;
    try {
      await evolutionService.sendMessage(phone, message);
    } catch (error) {
      console.error('[MDR_QUEUE] Falha ao notificar sucesso OCR:', error.message);
    }
  }

  async notifyFailure(phone) {
    if (!phone) return;
    const message = 'Não consegui ler o print da maquininha 😕\n\nTenta enviar outra imagem mais nítida ou digita os valores manualmente que eu te ajudo.';
    try {
      await evolutionService.sendMessage(phone, message);
    } catch (error) {
      console.error('[MDR_QUEUE] Falha ao notificar erro OCR:', error.message);
    }
  }
}

module.exports = new MdrService();

