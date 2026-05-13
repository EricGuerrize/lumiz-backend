
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { withTimeout, retryWithBackoff } = require('../utils/timeout');
const {
  buildIntentClassificationPrompt,
  buildAgenticSystemPrompt
} = require('../config/prompts');
const {
  toolRegistry,
  conversationContextService
} = require('./agentic');
const { safeAgenticTrack } = require('./agenticTelemetryService');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Timeout para chamadas do Gemini (55 segundos — acima disto a Evolution já terá reenviado,
// mas a deduplicação em webhook.js garante que a mensagem não será processada duas vezes)
const GEMINI_TIMEOUT_MS = 55000;

class GeminiService {
  constructor() {
    const configuredModel = process.env.GEMINI_MODEL;
    // Ordem: modelo configurado via env → modelos estáveis conhecidos
    // 'gemini-flash-latest' removido: alias inválido que causava timeouts
    const fallbackModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
    this.modelCandidates = [configuredModel, ...fallbackModels]
      .filter(Boolean)
      .filter((model, index, self) => self.indexOf(model) === index);
  }

  async generateWithFallback(payload) {
    let lastError = null;

    for (const modelName of this.modelCandidates) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          generationConfig: { responseMimeType: "application/json" }
        });
        const result = await retryWithBackoff(
          () => withTimeout(
            model.generateContent(payload),
            GEMINI_TIMEOUT_MS,
            `Timeout ao processar com ${modelName} (${GEMINI_TIMEOUT_MS / 1000}s)`
          ),
          2,
          500
        );
        return result;
      } catch (error) {
        lastError = error;
        const message = String(error?.message || '').toLowerCase();
        const modelNotFound = message.includes('not found') || message.includes('not supported');
        const isRateLimit = error?.status === 429 || message.includes('429') || message.includes('resource exhausted') || message.includes('too many requests');
        if (modelNotFound || isRateLimit) {
          console.warn(`[GEMINI] Modelo ${modelName} indisponível (${isRateLimit ? 'rate limit' : 'não encontrado'}), tentando próximo fallback...`);
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error('Nenhum modelo Gemini disponível');
  }

  async processMessage(message, context = {}) {
    // Contexto histórico (se fornecido)
    let contextSection = '';
    if (context.recentMessages && context.recentMessages.length > 0) {
      contextSection = `\n\nCONTEXTO HISTÓRICO (últimas conversas do usuário):\n${context.recentMessages.map((m, i) =>
        `${i + 1}. Usuário: "${m.user_message}"\n   Bot: "${m.bot_response}"`
      ).join('\n\n')}\n\nUse este contexto para entender melhor a intenção atual.`;
    }

    // Exemplos similares (RAG) - se fornecido
    let ragSection = '';
    if (context.similarExamples && context.similarExamples.length > 0) {
      ragSection = `\n\nEXEMPLOS SIMILARES QUE FUNCIONARAM (use como referência):\n${context.similarExamples.map((ex, i) =>
        `${i + 1}. Usuário: "${ex.user_message}"\n   Intenção: ${ex.intent}\n   Resposta do bot: "${ex.bot_response.substring(0, 100)}..."`
      ).join('\n\n')}\n\nUse estes exemplos para entender melhor a intenção da mensagem atual. Se a mensagem atual for similar a algum exemplo, use a mesma intenção.`;
    }

    const prompt = [
      buildIntentClassificationPrompt(message, context),
      contextSection,
      ragSection
    ].filter(Boolean).join('\n\n');

    try {
      // Adiciona timeout e retry para chamadas do Gemini
      const result = await this.generateWithFallback(prompt);

      const response = await result.response;
      const text = response.text();

      const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      return JSON.parse(jsonText);
    } catch (error) {
      console.error('[GEMINI] Erro ao processar mensagem:', error.message);
      if (error.message.includes('Timeout')) {
        console.error('[GEMINI] Timeout excedido após 30 segundos');
      }
      return {
        intencao: 'erro',
        dados: {}
      };
    }
  }

  async generateAgenticContentWithFallback(request, modelOptions = {}) {
    let lastError = null;

    for (const modelName of this.modelCandidates) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          ...modelOptions
        });

        const result = await retryWithBackoff(
          () => withTimeout(
            model.generateContent(request),
            GEMINI_TIMEOUT_MS,
            `Timeout ao processar com ${modelName} (${GEMINI_TIMEOUT_MS / 1000}s)`
          ),
          2,
          500
        );

        return result;
      } catch (error) {
        lastError = error;
        const message = String(error?.message || '').toLowerCase();
        const modelNotFound = message.includes('not found') || message.includes('not supported');
        const isRateLimit = error?.status === 429 || message.includes('429') || message.includes('resource exhausted') || message.includes('too many requests');
        if (modelNotFound || isRateLimit) {
          console.warn(`[GEMINI] Modelo ${modelName} indisponível (${isRateLimit ? 'rate limit' : 'não encontrado'}), tentando próximo fallback...`);
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error('Nenhum modelo Gemini disponível');
  }

  extractFunctionCalls(response) {
    const candidate = response?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    return parts
      .filter((part) => part?.functionCall?.name)
      .map((part) => ({
        name: part.functionCall.name,
        args: part.functionCall.args || {}
      }));
  }

  extractResponseText(response) {
    try {
      const text = response?.text?.();
      if (text && String(text).trim()) {
        return String(text).trim();
      }
    } catch (err) {
      // Resposta pode ser apenas functionCall, sem texto.
    }

    const candidate = response?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    return parts
      .filter((part) => typeof part?.text === 'string' && part.text.trim())
      .map((part) => part.text.trim())
      .join('\n')
      .trim();
  }

  async processAgenticMessage(message, options = {}) {
    const toolDeclarations = toolRegistry.getGeminiFunctionDeclarations();
    const context = options.context || await conversationContextService.buildContext({
      phone: options.phone,
      user: options.user,
      message,
      intent: options.intent || null
    });
    const contextSummary = conversationContextService.formatForPrompt(context);
    const systemInstruction = buildAgenticSystemPrompt({
      contextSummary,
      tools: toolRegistry.list()
    });

    const contents = [
      {
        role: 'user',
        parts: [{ text: message }]
      }
    ];

    try {
      let firstToolLogged = false;
      let result = await this.generateAgenticContentWithFallback({ contents }, {
        systemInstruction,
        tools: [{ functionDeclarations: toolDeclarations }],
        toolConfig: {
          functionCallingConfig: {
            mode: 'AUTO'
          }
        }
      });

      let response = await result.response;

      for (let round = 0; round < 4; round += 1) {
        const functionCalls = this.extractFunctionCalls(response);
        if (!functionCalls.length) {
          return {
            mode: 'reply',
            text: this.extractResponseText(response) || 'Não consegui concluir a resposta agora.',
            context
          };
        }

        const functionResponses = [];
        for (const call of functionCalls) {
          if (!firstToolLogged) {
            firstToolLogged = true;
            safeAgenticTrack('agentic_first_tool_invoked', {
              phone: options.phone,
              userId: options.user?.id,
              properties: { tool_name: call.name, round }
            });
          }
          const execution = await toolRegistry.execute(call.name, call.args, {
            userId: options.user?.id || options.userId,
            clinicId: context?.clinic?.id || context?.clinicProfile?.id || null,
            phone: options.phone,
            userConfirmed: options.userConfirmed === true
          });

          if (execution.requiresConfirmation) {
            return {
              mode: 'requires_confirmation',
              function_call: call,
              confirmation: execution.confirmationMessage,
              context
            };
          }

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: execution.success
                ? { success: true, result: execution.result }
                : { success: false, error: execution.error }
            }
          });
        }

        contents.push({
          role: 'model',
          parts: functionCalls.map((call) => ({
            functionCall: {
              name: call.name,
              args: call.args
            }
          }))
        });
        contents.push({
          role: 'user',
          parts: functionResponses
        });

        result = await this.generateAgenticContentWithFallback({ contents }, {
          systemInstruction,
          tools: [{ functionDeclarations: toolDeclarations }],
          toolConfig: {
            functionCallingConfig: {
              mode: 'AUTO'
            }
          }
        });

        response = await result.response;
      }

      return {
        mode: 'reply',
        text: this.extractResponseText(response) || 'Consegui executar as tools, mas não gerei uma resposta final em texto.',
        context
      };
    } catch (error) {
      console.error('[GEMINI] Erro no fluxo agentic:', error.message);
      return {
        mode: 'error',
        text: 'Tive um problema para decidir a próxima ação agora.',
        error: error.message,
        context
      };
    }
  }

  /**
   * Extrai JSON estruturado da primeira venda (onboarding Ato 2) em texto livre PT-BR.
   * Usado quando `agentic_onboarding_enabled` está ativo e o parser regex não bateu.
   *
   * @param {string} message
   * @returns {Promise<{ valor: number, categoria: string, cliente: string|null }|null>}
   */
  async extractOnboardingSaleJson(message) {
    const text = String(message || '').trim();
    if (!text || text.length > 2000) return null;

    const prompt = [
      'Você extrai um único objeto JSON da mensagem do usuário sobre uma venda/procedimento em clínica de estética.',
      'Retorne SEMPRE JSON válido neste formato exato (sem markdown, sem texto extra):',
      '{"valor": number|null, "categoria": string|null, "cliente": string|null}',
      '- valor: valor em reais (número). Ex.: "R$ 350" → 350, "350,50" → 350.5, "1.200" → 1200',
      '- categoria: nome do procedimento/serviço se inferível; senão null',
      '- cliente: nome do paciente se mencionado; senão null',
      'Se não houver valor monetário claro, retorne {"valor":null,"categoria":null,"cliente":null}.',
      `Mensagem: ${JSON.stringify(text)}`
    ].join('\n');

    try {
      const result = await this.generateWithFallback(prompt);
      const response = await result.response;
      const raw = response
        .text()
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      const parsed = JSON.parse(raw);
      let valor = parsed.valor;
      if (typeof valor === 'string') {
        valor = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
      }
      if (!Number.isFinite(valor) || valor <= 0) return null;

      const categoria =
        typeof parsed.categoria === 'string' && parsed.categoria.trim()
          ? parsed.categoria.trim()
          : 'Procedimento';
      const cliente =
        typeof parsed.cliente === 'string' && parsed.cliente.trim()
          ? parsed.cliente.trim()
          : null;

      return { valor, categoria, cliente };
    } catch (e) {
      console.warn('[GEMINI] extractOnboardingSaleJson:', e?.message || e);
      return null;
    }
  }

  async processDocument(buffer, mimeType, prompt) {
    try {

      const parts = [
        { text: prompt },
        {
          inlineData: {
            mimeType: mimeType,
            data: buffer.toString('base64')
          }
        }
      ];

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout ao processar documento (${GEMINI_TIMEOUT_MS / 1000}s)`)), GEMINI_TIMEOUT_MS)
      );

      const result = await Promise.race([
        retryWithBackoff(() => this.generateWithFallback(parts), 3, 2000),
        timeoutPromise
      ]);

      const response = await result.response;
      const text = response.text();
      const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      return JSON.parse(jsonText);
    } catch (error) {
      console.error('[GEMINI] Erro ao processar documento:', error.message);
      throw error;
    }
  }
}

module.exports = new GeminiService();
