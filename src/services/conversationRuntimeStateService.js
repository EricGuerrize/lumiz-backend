const supabase = require('../db/supabase');
const { normalizePhone } = require('../utils/phone');

class ConversationRuntimeStateService {
  normalizePhoneKey(phone) {
    return normalizePhone(phone) || phone;
  }

  normalizeFlow(flow) {
    return String(flow || '').trim();
  }

  toExpiresAt(ttlMs) {
    const ttl = Number(ttlMs);
    const safeTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : 5 * 60 * 1000;
    return new Date(Date.now() + safeTtl).toISOString();
  }

  async upsert(phone, flow, payload = {}, ttlMs = 5 * 60 * 1000) {
    const normalizedPhone = this.normalizePhoneKey(phone);
    const normalizedFlow = this.normalizeFlow(flow);
    if (!normalizedPhone || !normalizedFlow) return false;

    try {
      const record = {
        phone: normalizedPhone,
        flow: normalizedFlow,
        payload: payload || {},
        expires_at: this.toExpiresAt(ttlMs),
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('conversation_runtime_states')
        .upsert(record, { onConflict: 'phone,flow' });

      if (error) {
        console.warn('[RUNTIME_STATE] Falha ao persistir estado:', error.message);
        return false;
      }

      return true;
    } catch (error) {
      console.warn('[RUNTIME_STATE] Exceção ao persistir estado:', error.message);
      return false;
    }
  }

  async get(phone, flow) {
    const normalizedPhone = this.normalizePhoneKey(phone);
    const normalizedFlow = this.normalizeFlow(flow);
    if (!normalizedPhone || !normalizedFlow) return null;

    try {
      const { data, error } = await supabase
        .from('conversation_runtime_states')
        .select('phone, flow, payload, expires_at, created_at, updated_at')
        .eq('phone', normalizedPhone)
        .eq('flow', normalizedFlow)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.warn('[RUNTIME_STATE] Falha ao ler estado:', error.message);
        return null;
      }
      if (!data) return null;

      const expiresAt = new Date(data.expires_at).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        await this.clear(normalizedPhone, normalizedFlow);
        return null;
      }

      return data;
    } catch (error) {
      console.warn('[RUNTIME_STATE] Exceção ao ler estado:', error.message);
      return null;
    }
  }

  async getAllActive(phone) {
    const normalizedPhone = this.normalizePhoneKey(phone);
    if (!normalizedPhone) return [];

    try {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('conversation_runtime_states')
        .select('phone, flow, payload, expires_at, created_at, updated_at')
        .eq('phone', normalizedPhone)
        .gt('expires_at', nowIso);

      if (error) {
        console.warn('[RUNTIME_STATE] Falha ao listar estados ativos:', error.message);
        return [];
      }

      // Limpeza best-effort de expirados para este telefone
      await supabase
        .from('conversation_runtime_states')
        .delete()
        .eq('phone', normalizedPhone)
        .lte('expires_at', nowIso);

      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.warn('[RUNTIME_STATE] Exceção ao listar estados ativos:', error.message);
      return [];
    }
  }

  async clear(phone, flow) {
    const normalizedPhone = this.normalizePhoneKey(phone);
    const normalizedFlow = this.normalizeFlow(flow);
    if (!normalizedPhone || !normalizedFlow) return false;

    try {
      const { error } = await supabase
        .from('conversation_runtime_states')
        .delete()
        .eq('phone', normalizedPhone)
        .eq('flow', normalizedFlow);

      if (error) {
        console.warn('[RUNTIME_STATE] Falha ao limpar estado:', error.message);
        return false;
      }

      return true;
    } catch (error) {
      console.warn('[RUNTIME_STATE] Exceção ao limpar estado:', error.message);
      return false;
    }
  }

  async clearAll(phone) {
    const normalizedPhone = this.normalizePhoneKey(phone);
    if (!normalizedPhone) return false;

    try {
      const { error } = await supabase
        .from('conversation_runtime_states')
        .delete()
        .eq('phone', normalizedPhone);

      if (error) {
        console.warn('[RUNTIME_STATE] Falha ao limpar todos os estados:', error.message);
        return false;
      }

      return true;
    } catch (error) {
      console.warn('[RUNTIME_STATE] Exceção ao limpar todos os estados:', error.message);
      return false;
    }
  }

  /**
   * Remove estados de conversa expirados em lote, preservando estados ativos.
   * @param {number} [limit=1000] - Quantidade máxima de registros por execução.
   * @returns {Promise<{deleted: number, error: string|null}>}
   */
  async cleanupExpired(limit = 1000) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
    const nowIso = new Date().toISOString();

    try {
      const { data: expiredRows, error: selectError } = await supabase
        .from('conversation_runtime_states')
        .select('id')
        .lte('expires_at', nowIso)
        .limit(safeLimit);

      if (selectError) {
        console.warn('[RUNTIME_STATE] Falha ao buscar estados expirados:', selectError.message);
        return { deleted: 0, error: selectError.message };
      }

      const ids = (expiredRows || []).map((row) => row.id).filter(Boolean);
      if (!ids.length) return { deleted: 0, error: null };

      const { error: deleteError } = await supabase
        .from('conversation_runtime_states')
        .delete()
        .in('id', ids);

      if (deleteError) {
        console.warn('[RUNTIME_STATE] Falha ao limpar estados expirados:', deleteError.message);
        return { deleted: 0, error: deleteError.message };
      }

      return { deleted: ids.length, error: null };
    } catch (error) {
      console.warn('[RUNTIME_STATE] Exceção ao limpar estados expirados:', error.message);
      return { deleted: 0, error: error.message };
    }
  }
}

module.exports = new ConversationRuntimeStateService();
