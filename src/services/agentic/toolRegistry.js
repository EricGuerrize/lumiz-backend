/**
 * Fase Agentic 1.3 — Tool Registry
 * 
 * Registro central de tools disponíveis para o agente.
 * Cada tool tem schema JSON, função de execução e metadados.
 * Suporta validação de parâmetros e logging de execução.
 */

const crypto = require('crypto');
const Ajv = require('ajv');
const supabase = require('../../db/supabase');
const { safeAgenticTrack } = require('../agenticTelemetryService');

const ajv = new Ajv({ allErrors: true, useDefaults: true });

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.executionLog = [];
  }

  /**
   * Registra uma nova tool.
   * 
   * @param {object} toolDef
   * @param {string} toolDef.name - Nome único da tool
   * @param {string} toolDef.description - Descrição para o LLM
   * @param {object} toolDef.parameters - JSON Schema dos parâmetros
   * @param {function} toolDef.execute - Função de execução
   * @param {boolean} [toolDef.requiresConfirmation=false] - Se precisa confirmar
   * @param {string} [toolDef.category='general'] - Categoria da tool
   * @param {string} [toolDef.version='1.0'] - Versão da tool
   */
  register(toolDef) {
    const { name, description, parameters, execute, requiresConfirmation = false, category = 'general', version = '1.0' } = toolDef;

    if (!name || typeof name !== 'string') {
      throw new Error('Tool name is required and must be a string');
    }
    if (!description || typeof description !== 'string') {
      throw new Error('Tool description is required');
    }
    if (!parameters || typeof parameters !== 'object') {
      throw new Error('Tool parameters schema is required');
    }
    if (!execute || typeof execute !== 'function') {
      throw new Error('Tool execute function is required');
    }

    const validator = ajv.compile(parameters);

    this.tools.set(name, {
      name,
      description,
      parameters,
      execute,
      validator,
      requiresConfirmation,
      category,
      version,
      registeredAt: new Date().toISOString()
    });

    console.log(`[ToolRegistry] Registered tool: ${name} v${version}`);
  }

  /**
   * Remove uma tool do registro.
   */
  unregister(name) {
    return this.tools.delete(name);
  }

  /**
   * Retorna uma tool pelo nome.
   */
  get(name) {
    return this.tools.get(name);
  }

  /**
   * Verifica se uma tool existe.
   */
  has(name) {
    return this.tools.has(name);
  }

  /**
   * Lista todas as tools registradas.
   */
  list() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      category: t.category,
      version: t.version,
      requiresConfirmation: t.requiresConfirmation
    }));
  }

  /**
   * Retorna as tools no formato esperado pelo LLM (function calling).
   */
  getToolsForLLM() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
  }

  /**
   * Retorna function declarations no formato esperado pelo Gemini.
   */
  getGeminiFunctionDeclarations() {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: this._toGeminiSchema(tool.parameters)
    }));
  }

  /**
   * Valida os parâmetros de uma tool.
   */
  validate(name, params) {
    const tool = this.tools.get(name);
    if (!tool) {
      return { valid: false, errors: [{ message: `Tool '${name}' not found` }] };
    }

    const valid = tool.validator(params);
    return {
      valid,
      errors: valid ? null : tool.validator.errors
    };
  }

  /**
   * Executa uma tool.
   * 
   * @param {string} name - Nome da tool
   * @param {object} params - Parâmetros validados
   * @param {object} context - Contexto de execução (user, clinic, etc.)
   * @returns {Promise<{success: boolean, result?: any, error?: string, executionId: string}>}
   */
  async execute(name, params, context = {}) {
    const executionId = crypto.randomUUID();
    const startTime = Date.now();
    
    const logEntry = {
      executionId,
      toolName: name,
      params: this._sanitizeParams(params),
      context: {
        userId: context.userId,
        clinicId: context.clinicId,
        phone: context.phone
      },
      startedAt: new Date().toISOString(),
      status: 'executing'
    };

    this.executionLog.push(logEntry);

    const tool = this.tools.get(name);
    if (!tool) {
      logEntry.status = 'failed';
      logEntry.error = `Tool '${name}' not found`;
      logEntry.completedAt = new Date().toISOString();
      logEntry.executionTimeMs = Date.now() - startTime;
      safeAgenticTrack('agentic_tool_not_found', {
        phone: context.phone,
        userId: context.userId,
        properties: { tool_name: name }
      });
      return { success: false, error: logEntry.error, executionId };
    }

    const validation = this.validate(name, params);
    if (!validation.valid) {
      logEntry.status = 'failed';
      logEntry.error = `Validation failed: ${JSON.stringify(validation.errors)}`;
      logEntry.completedAt = new Date().toISOString();
      logEntry.executionTimeMs = Date.now() - startTime;
      safeAgenticTrack('agentic_tool_validation_failed', {
        phone: context.phone,
        userId: context.userId,
        properties: { tool_name: name }
      });
      return { success: false, error: logEntry.error, executionId, validationErrors: validation.errors };
    }

    if (tool.requiresConfirmation && !context.userConfirmed) {
      logEntry.status = 'requires_confirmation';
      logEntry.completedAt = new Date().toISOString();
      logEntry.executionTimeMs = Date.now() - startTime;

      safeAgenticTrack('agentic_tool_requires_confirmation', {
        phone: context.phone,
        userId: context.userId,
        properties: { tool_name: name }
      });

      return {
        success: false,
        requiresConfirmation: true,
        confirmationMessage: this._buildConfirmationMessage(tool, params, context),
        executionId
      };
    }

    try {
      const result = await tool.execute(params, context);
      
      logEntry.status = 'success';
      logEntry.result = this._sanitizeResult(result);
      logEntry.completedAt = new Date().toISOString();
      logEntry.executionTimeMs = Date.now() - startTime;

      await this._persistToolCall(logEntry);

      safeAgenticTrack('agentic_tool_executed', {
        phone: context.phone,
        userId: context.userId,
        properties: {
          tool_name: name,
          success: true,
          execution_time_ms: logEntry.executionTimeMs
        }
      });

      return { success: true, result, executionId };
    } catch (err) {
      logEntry.status = 'failed';
      logEntry.error = err.message;
      logEntry.errorCode = err.code;
      logEntry.completedAt = new Date().toISOString();
      logEntry.executionTimeMs = Date.now() - startTime;

      await this._persistToolCall(logEntry);

      safeAgenticTrack('agentic_tool_executed', {
        phone: context.phone,
        userId: context.userId,
        properties: {
          tool_name: name,
          success: false,
          execution_time_ms: logEntry.executionTimeMs,
          error_code: logEntry.errorCode || null
        }
      });

      console.error(`[ToolRegistry] Execution failed for ${name}:`, err.message);
      return { success: false, error: err.message, executionId };
    }
  }

  /**
   * Sanitiza parâmetros para logging (remove dados sensíveis).
   */
  _sanitizeParams(params) {
    if (!params) return {};
    const sanitized = { ...params };
    const sensitiveKeys = ['password', 'token', 'secret', 'cpf', 'cnpj'];
    sensitiveKeys.forEach(key => {
      if (sanitized[key]) sanitized[key] = '***';
    });
    return sanitized;
  }

  /**
   * Sanitiza resultado para logging.
   */
  _sanitizeResult(result) {
    if (!result) return null;
    const str = JSON.stringify(result);
    if (str.length > 10000) {
      return { _truncated: true, _size: str.length };
    }
    return result;
  }

  /**
   * Constrói mensagem de confirmação para o usuário.
   */
  _buildConfirmationMessage(tool, params, context) {
    return {
      toolName: tool.name,
      description: tool.description,
      params,
      message: `Confirma a execução de ${tool.name}?`
    };
  }

  /**
   * Converte JSON Schema simples para o subset aceito pelo Gemini.
   */
  _toGeminiSchema(schema) {
    if (!schema || typeof schema !== 'object') {
      return {
        type: 'object',
        properties: {}
      };
    }

    const result = {};
    if (schema.type) result.type = schema.type;
    if (schema.description) result.description = schema.description;
    if (Array.isArray(schema.required)) result.required = schema.required;
    if (Array.isArray(schema.enum)) result.enum = schema.enum;
    if (schema.nullable === true) result.nullable = true;

    if (schema.properties && typeof schema.properties === 'object') {
      result.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [key, this._toGeminiSchema(value)])
      );
    }

    if (schema.items && typeof schema.items === 'object') {
      result.items = this._toGeminiSchema(schema.items);
    }

    return result;
  }

  /**
   * Persiste a chamada de tool no banco de dados.
   */
  async _persistToolCall(logEntry) {
    try {
      const { error } = await supabase
        .from('agentic_tool_calls')
        .insert({
          user_id: logEntry.context?.userId,
          clinic_id: logEntry.context?.clinicId,
          phone: logEntry.context?.phone,
          tool_name: logEntry.toolName,
          tool_version: this.tools.get(logEntry.toolName)?.version || '1.0',
          input_params: logEntry.params,
          output_result: logEntry.result,
          status: logEntry.status,
          error_message: logEntry.error,
          error_code: logEntry.errorCode,
          required_confirmation: logEntry.status === 'requires_confirmation',
          execution_time_ms: logEntry.executionTimeMs,
          completed_at: logEntry.completedAt
        });

      if (error) {
        console.warn('[ToolRegistry] Failed to persist tool call:', error.message);
      }
    } catch (err) {
      console.warn('[ToolRegistry] Exception persisting tool call:', err.message);
    }
  }

  /**
   * Retorna estatísticas de execução.
   */
  getStats() {
    const total = this.executionLog.length;
    if (total === 0) return { total: 0 };

    const byTool = {};
    const byStatus = {};
    let totalTime = 0;

    this.executionLog.forEach(entry => {
      byTool[entry.toolName] = (byTool[entry.toolName] || 0) + 1;
      byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
      totalTime += entry.executionTimeMs || 0;
    });

    return {
      total,
      byTool,
      byStatus,
      avgExecutionTimeMs: Math.round(totalTime / total),
      toolCount: this.tools.size
    };
  }

  /**
   * Limpa o log de execução em memória.
   */
  clearLog() {
    this.executionLog = [];
  }
}

module.exports = new ToolRegistry();
