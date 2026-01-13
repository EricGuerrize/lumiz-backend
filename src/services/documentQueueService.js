/**
 * Serviço de fila para processamento assíncrono de documentos
 * Usa BullMQ para processar OCR e extração de dados em background
 * Evita bloquear a thread principal durante operações pesadas
 */

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const documentService = require('./documentService');
const evolutionService = require('./evolutionService');
const transactionController = require('../controllers/transactionController');

class DocumentQueueService {
  constructor() {
    console.log('[DOC_QUEUE] Inicializando DocumentQueueService...');
    this.queue = null;
    this.worker = null;
    this.queueEnabled = false;
    
    // Callbacks para quando o processamento terminar (usado em onboarding)
    this.completionCallbacks = new Map();

    if (process.env.REDIS_URL) {
      try {
        console.log('[DOC_QUEUE] Conectando ao Redis...');
        this.connection = new IORedis(process.env.REDIS_URL, {
          maxRetriesPerRequest: null
        });

        console.log('[DOC_QUEUE] Criando Queue document-processing...');
        this.queue = new Queue('document-processing', { connection: this.connection });

        console.log('[DOC_QUEUE] Criando Worker document-processing...');
        this.worker = new Worker('document-processing', this.processJob.bind(this), {
          connection: this.connection,
          concurrency: 3 // Processa até 3 documentos simultaneamente
        });

        this.worker.on('completed', (job, result) => {
          console.log(`[DOC_QUEUE] Job ${job.id} completado com sucesso`);
          this.handleJobCompletion(job, result);
        });

        this.worker.on('failed', (job, err) => {
          console.error(`[DOC_QUEUE] Job ${job?.id} falhou:`, err.message);
          this.handleJobFailure(job, err);
        });

        this.queueEnabled = true;
        console.log('[DOC_QUEUE] ✅ BullMQ iniciado com sucesso!');
      } catch (error) {
        console.error('[DOC_QUEUE] ❌ Falha ao iniciar BullMQ:', error.message);
      }
    } else {
      console.warn('[DOC_QUEUE] ⚠️ REDIS_URL não configurada. Fila desativada.');
    }
  }

  /**
   * Adiciona um documento para processamento assíncrono
   * @param {string} type - Tipo do job: 'ocr', 'extract_transaction', 'mdr_ocr'
   * @param {Object} data - Dados do job
   * @param {Function} onComplete - Callback quando o job completar (opcional)
   */
  async addJob(type, data, onComplete = null) {
    // Se a fila não está habilitada, processa de forma síncrona
    if (!this.queueEnabled || !this.queue) {
      console.warn('[DOC_QUEUE] Fila desativada, executando processamento inline...');
      return this.processInline(type, data, onComplete);
    }

    try {
      const jobId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const job = await this.queue.add(type, data, {
        jobId,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: true,
        removeOnFail: { count: 100 }
      });

      console.log(`[DOC_QUEUE] Job ${job.id} adicionado à fila (${type})`);

      // Salva callback se fornecido
      if (onComplete) {
        this.completionCallbacks.set(job.id, onComplete);
      }

      return {
        jobId: job.id,
        status: 'queued',
        message: '⏳ Processando documento em segundo plano...'
      };
    } catch (error) {
      console.error('[DOC_QUEUE] Erro ao adicionar job:', error);
      return this.processInline(type, data, onComplete);
    }
  }

  /**
   * Processa o job (executado pelo Worker)
   */
  async processJob(job) {
    const type = job.name || job.data.type;
    const { phone, mediaUrl, messageKey, userId, fileName } = job.data;
    
    console.log(`[DOC_QUEUE] Processando job ${job.id} - Tipo: ${type}`);

    try {
      let result;

      switch (type) {
        case 'ocr':
          // OCR simples - retorna texto extraído
          result = await documentService.processImage(mediaUrl, messageKey);
          break;

        case 'extract_transaction':
          // Extrai e opcionalmente salva transação
          result = await this.processTransactionDocument(job.data);
          break;

        case 'mdr_ocr':
          // Extrai taxas MDR
          const mdrOcrService = require('./mdrOcrService');
          result = await mdrOcrService.extractRates({
            imageUrl: mediaUrl,
            provider: job.data.provider
          });
          break;

        default:
          throw new Error(`Tipo de job desconhecido: ${type}`);
      }

      console.log(`[DOC_QUEUE] Job ${job.id} finalizado com sucesso`);
      return result;

    } catch (error) {
      console.error(`[DOC_QUEUE] Erro no processamento do job ${job.id}:`, error);

      // Na última tentativa, notifica o usuário
      if (phone && job.attemptsMade >= (job.opts?.attempts || 3) - 1) {
        try {
          await evolutionService.sendMessage(
            phone,
            '❌ Não consegui processar seu documento. Por favor, tente novamente ou digite as informações manualmente.'
          );
        } catch (msgError) {
          console.error('[DOC_QUEUE] Erro ao enviar mensagem de falha:', msgError);
        }
      }

      throw error;
    }
  }

  /**
   * Processa documento para extração de transação
   */
  async processTransactionDocument(data) {
    const { phone, mediaUrl, messageKey, userId, autoSave } = data;

    // Processa o documento
    const result = await documentService.processImage(mediaUrl, messageKey);

    // Se autoSave e tem transações, salva automaticamente
    if (autoSave && userId && result.transacoes && result.transacoes.length > 0) {
      for (const transacao of result.transacoes) {
        try {
          await transactionController.createTransaction({
            user_id: userId,
            tipo: transacao.tipo,
            valor: transacao.valor,
            categoria: transacao.categoria,
            descricao: transacao.descricao,
            data: transacao.data || new Date().toISOString().split('T')[0],
            origem: 'document_queue'
          });
          
          transacao.saved = true;
        } catch (error) {
          console.error('[DOC_QUEUE] Erro ao salvar transação:', error);
          transacao.saved = false;
          transacao.saveError = error.message;
        }
      }
    }

    // Notifica o usuário com o resultado
    if (phone) {
      const summary = documentService.formatDocumentSummary(result);
      await evolutionService.sendMessage(phone, summary);
    }

    return result;
  }

  /**
   * Callback quando o job completa
   */
  handleJobCompletion(job, result) {
    const callback = this.completionCallbacks.get(job.id);
    if (callback) {
      try {
        callback(null, result);
      } catch (e) {
        console.error('[DOC_QUEUE] Erro no callback de completion:', e);
      }
      this.completionCallbacks.delete(job.id);
    }
  }

  /**
   * Callback quando o job falha
   */
  handleJobFailure(job, error) {
    const callback = this.completionCallbacks.get(job?.id);
    if (callback) {
      try {
        callback(error, null);
      } catch (e) {
        console.error('[DOC_QUEUE] Erro no callback de failure:', e);
      }
      this.completionCallbacks.delete(job.id);
    }
  }

  /**
   * Fallback para processamento síncrono
   */
  async processInline(type, data, onComplete = null) {
    console.log('[DOC_QUEUE] Executando processamento inline (sem fila)...');
    
    try {
      const fakeJob = {
        id: 'inline-' + Date.now(),
        name: type,
        data,
        attemptsMade: 0,
        opts: { attempts: 1 }
      };

      const result = await this.processJob(fakeJob);

      if (onComplete) {
        onComplete(null, result);
      }

      return {
        jobId: fakeJob.id,
        status: 'completed',
        result
      };
    } catch (error) {
      console.error('[DOC_QUEUE] Erro no processamento inline:', error);
      
      if (onComplete) {
        onComplete(error, null);
      }

      throw error;
    }
  }

  /**
   * Verifica status de um job
   */
  async getJobStatus(jobId) {
    if (!this.queueEnabled || !this.queue) {
      return { status: 'unknown', message: 'Fila não disponível' };
    }

    try {
      const job = await this.queue.getJob(jobId);
      if (!job) {
        return { status: 'not_found' };
      }

      const state = await job.getState();
      return {
        status: state,
        progress: job.progress,
        attemptsMade: job.attemptsMade
      };
    } catch (error) {
      console.error('[DOC_QUEUE] Erro ao obter status do job:', error);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Obtém estatísticas da fila
   */
  async getQueueStats() {
    if (!this.queueEnabled || !this.queue) {
      return { enabled: false };
    }

    try {
      const [waiting, active, completed, failed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount()
      ]);

      return {
        enabled: true,
        waiting,
        active,
        completed,
        failed
      };
    } catch (error) {
      console.error('[DOC_QUEUE] Erro ao obter estatísticas:', error);
      return { enabled: true, error: error.message };
    }
  }
}

module.exports = new DocumentQueueService();
