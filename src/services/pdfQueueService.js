
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const pdfService = require('./pdfService');
const evolutionService = require('./evolutionService');
const excelService = require('./excelService');

class PdfQueueService {
    constructor() {
        console.log('[PDF_QUEUE] Inicializando PdfQueueService...');
        this.queue = null;
        this.worker = null;
        this.queueEnabled = false;
        this._lastErrorLogAt = 0;
        this.maxReconnectAttempts = Number(process.env.REDIS_MAX_RECONNECT_ATTEMPTS || 5);
        this.redisQueueFeatureEnabled = this.readFlag('REDIS_QUEUE_ENABLED', !!process.env.REDIS_URL);

        if (!this.redisQueueFeatureEnabled) {
            console.warn('[PDF_QUEUE] ⚠️ REDIS_QUEUE_ENABLED=false. Fila de PDF desabilitada (modo degradado).');
            return;
        }

        if (process.env.REDIS_URL) {
            try {
                console.log('[PDF_QUEUE] Conectando ao Redis...');
                // BullMQ requer maxRetriesPerRequest: null
                this.connection = new IORedis(process.env.REDIS_URL, {
                    maxRetriesPerRequest: null,
                    connectTimeout: 5000,
                    enableOfflineQueue: false,
                    retryStrategy: (times) => {
                        if (times > this.maxReconnectAttempts) {
                            this.queueEnabled = false;
                            this.logRedisError('[PDF_QUEUE] ❌ Limite de reconexão atingido. Fila desativada.');
                            return null;
                        }
                        return Math.min(times * 100, 3000);
                    }
                });

                this.connection.on('ready', () => {
                    if (this.queue && this.worker) {
                        this.queueEnabled = true;
                    }
                    console.log('[PDF_QUEUE] ✅ Redis pronto');
                });
                this.connection.on('error', (err) => {
                    this.logRedisError(`[PDF_QUEUE] ❌ Erro Redis: ${err.message}`);
                    this.queueEnabled = false;
                });
                this.connection.on('close', () => {
                    this.logRedisError('[PDF_QUEUE] ⚠️ Conexão Redis fechada. Fila em modo degradado.');
                    this.queueEnabled = false;
                });

                console.log('[PDF_QUEUE] Criando Queue pdf-generation...');
                this.queue = new Queue('pdf-generation', { connection: this.connection });

                console.log('[PDF_QUEUE] Criando Worker pdf-generation...');
                this.worker = new Worker('pdf-generation', this.processJob.bind(this), {
                    connection: this.connection,
                    concurrency: 2 // Processa até 2 PDFs simultaneamente
                });

                this.queue.on('error', (err) => {
                    this.logRedisError(`[PDF_QUEUE] ❌ Queue error: ${err.message}`);
                    this.queueEnabled = false;
                });

                this.worker.on('error', (err) => {
                    this.logRedisError(`[PDF_QUEUE] ❌ Worker error: ${err.message}`);
                    this.queueEnabled = false;
                });

                this.worker.on('completed', (job) => {
                    console.log(`[PDF_QUEUE] Job ${job.id} completado com sucesso`);
                });

                this.worker.on('failed', (job, err) => {
                    console.error(`[PDF_QUEUE] Job ${job?.id} falhou:`, err.message);
                });

                this.queueEnabled = true;
                console.log('[PDF_QUEUE] ✅ BullMQ iniciado com sucesso!');
            } catch (error) {
                console.error('[PDF_QUEUE] ❌ Falha ao iniciar BullMQ:', error.message);
            }
        } else {
            console.warn('[PDF_QUEUE] ⚠️ REDIS_URL não configurada. Fila desativada.');
        }
    }

    readFlag(name, defaultValue) {
        const raw = process.env[name];
        if (raw === undefined || raw === null || raw === '') return defaultValue;
        const normalized = String(raw).trim().toLowerCase();
        if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
        return defaultValue;
    }

    logRedisError(message) {
        const now = Date.now();
        if (now - this._lastErrorLogAt > 15000) {
            console.error(message);
            this._lastErrorLogAt = now;
        }
    }

    /**
     * Adiciona um job de geração de relatório à fila
     */
    async addJob(type, data) {
        if (!this.queueEnabled || !this.queue) {
            console.warn('[PDF_QUEUE] Fila desativada, executando processamento inline (fallback)...');
            // Fallback para execução direta se Redis não estiver disponível
            return this.processInline(type, data);
        }

        try {
            const job = await this.queue.add(type, data, {
                attempts: 3, // Tenta 3 vezes em caso de falha
                backoff: {
                    type: 'exponential',
                    delay: 2000 // 2s, 4s, 8s
                },
                removeOnComplete: true, // Limpa jobs completados
                removeOnFail: { count: 100 } // Mantém últimos 100 falhados para debug
            });

            console.log(`[PDF_QUEUE] Job ${job.id} adicionado à fila (${type})`);
            return job;
        } catch (error) {
            console.error('[PDF_QUEUE] Erro ao adicionar job:', error);
            // Fallback
            return this.processInline(type, data);
        }
    }

    /**
     * Processa o job (executado pelo Worker)
     */
    async processJob(job) {
        // BullMQ usa job.name como o tipo do job. 
        // Fallback para job.data.type para suportar processamento inline.
        const type = job.name || job.data.type;
        const { userId, phone, params } = job.data;
        console.log(`[PDF_QUEUE] Processando job ${job.id} - Tipo: ${type}, User: ${userId}`);

        try {
            // Notifica início (opcional, pode ser muito spam)
            // await evolutionService.sendMessage(phone, '⏳ Iniciando geração do arquivo...');

            if (type === 'monthly_report_pdf') {
                await this.generateAndSendMonthlyPDF(userId, phone, params);
            } else if (type === 'export_data_excel') {
                await this.generateAndSendExcel(userId, phone, params);
            } else if (type === 'export_data_pdf') {
                // Reutiliza a lógica do relatório mensal por enquanto
                await this.generateAndSendMonthlyPDF(userId, phone, params);
            } else {
                throw new Error(`Tipo de job desconhecido: ${type}`);
            }

            console.log(`[PDF_QUEUE] Job ${job.id} finalizado com sucesso`);
            return { success: true };
        } catch (error) {
            console.error(`[PDF_QUEUE] Erro no processamento do job ${job.id}:`, error);

            // Notifica usuário sobre o erro na última tentativa
            if (job.attemptsMade >= job.opts.attempts - 1) {
                try {
                    await evolutionService.sendMessage(
                        phone,
                        '❌ Ocorreu um erro ao gerar seu relatório. Por favor, tente novamente em alguns instantes.'
                    );
                } catch (msgError) {
                    console.error('[PDF_QUEUE] Erro ao enviar mensagem de falha:', msgError);
                }
            }

            throw error;
        }
    }

    /**
     * Lógica de geração do PDF Mensal
     */
    async generateAndSendMonthlyPDF(userId, phone, params) {
        const now = new Date();
        let year = now.getFullYear();
        let month = now.getMonth() + 1;

        // Detecta período customizado
        if (params?.mes || params?.ano) {
            month = params.mes || month;
            year = params.ano || year;
        } else if (params?.periodo) {
            // Lógica simplificada de parsing de período (pode ser melhorada ou reutilizada do controller)
            const periodo = params.periodo.toLowerCase();
            if (periodo.includes('janeiro')) { month = 1; }
            else if (periodo.includes('fevereiro')) { month = 2; }
            else if (periodo.includes('março') || periodo.includes('marco')) { month = 3; }
            else if (periodo.includes('abril')) { month = 4; }
            else if (periodo.includes('maio')) { month = 5; }
            else if (periodo.includes('junho')) { month = 6; }
            else if (periodo.includes('julho')) { month = 7; }
            else if (periodo.includes('agosto')) { month = 8; }
            else if (periodo.includes('setembro')) { month = 9; }
            else if (periodo.includes('outubro')) { month = 10; }
            else if (periodo.includes('novembro')) { month = 11; }
            else if (periodo.includes('dezembro')) { month = 12; }
        }

        console.log(`[PDF_QUEUE] Gerando PDF para ${month}/${year}...`);

        await evolutionService.sendMessage(
            phone,
            '📄 Gerando seu relatório em PDF...\n\nIsso pode levar alguns segundos! ⏳'
        );

        const pdfBuffer = await pdfService.generateMonthlyReportPDF(userId, year, month);
        const base64Pdf = pdfBuffer.toString('base64');

        const mesNome = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
        const fileName = `Relatorio_${mesNome}_${year}.pdf`;

        console.log(`[PDF_QUEUE] Enviando PDF (${pdfBuffer.length} bytes)...`);
        await evolutionService.sendDocument(phone, base64Pdf, fileName, 'application/pdf');

        await evolutionService.sendMessage(
            phone,
            '✅ *Relatório exportado com sucesso!*\n\nSeu PDF está pronto acima 📊'
        );
    }

    /**
     * Lógica de geração do Excel/CSV
     */
    async generateAndSendExcel(userId, phone, params) {
        const formato = params.formato || 'excel';
        const now = new Date();
        let year = now.getFullYear();
        let month = now.getMonth() + 1;

        if (params?.mes) month = parseInt(params.mes);
        if (params?.ano) year = parseInt(params.ano);

        console.log(`[PDF_QUEUE] Gerando ${formato.toUpperCase()} para ${month}/${year}...`);

        await evolutionService.sendMessage(
            phone,
            `📊 Gerando sua planilha ${formato.toUpperCase()}...\n\nIsso pode levar alguns segundos! ⏳`
        );

        let fileBuffer;
        let fileName;
        let mimeType;

        if (formato === 'csv') {
            fileBuffer = await excelService.generateCSVReport(userId, year, month);
            const mesNome = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
            fileName = `Relatorio_${mesNome}_${year}.csv`;
            mimeType = 'text/csv';
        } else {
            fileBuffer = await excelService.generateExcelReport(userId, year, month);
            const mesNome = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
            fileName = `Relatorio_${mesNome}_${year}.xlsx`;
            mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        }

        const base64File = fileBuffer.toString('base64');

        console.log(`[PDF_QUEUE] Enviando arquivo (${fileBuffer.length} bytes)...`);
        await evolutionService.sendDocument(phone, base64File, fileName, mimeType);

        await evolutionService.sendMessage(
            phone,
            `✅ *Planilha exportada com sucesso!*\n\nSeu arquivo ${formato.toUpperCase()} está pronto acima 📊`
        );
    }

    /**
     * Fallback para processamento síncrono (se Redis falhar)
     */
    async processInline(type, data) {
        console.log('[PDF_QUEUE] Executando processamento inline (sem fila)...');
        try {
            await this.processJob({ data: { type, ...data }, id: 'inline-' + Date.now() });
            return { id: 'inline', status: 'completed' };
        } catch (error) {
            console.error('[PDF_QUEUE] Erro no processamento inline:', error);
            throw error;
        }
    }
}

module.exports = new PdfQueueService();
