const IORedis = require('ioredis');

/**
 * Cache service using Redis
 * Provides caching for frequently accessed data like user configs and profiles
 */
class CacheService {
  constructor() {
    this.client = null;
    this.enabled = false;
    this.defaultTTL = 3600; // 1 hour default TTL
    this._lastErrorLogAt = 0;
    this.maxReconnectAttempts = Number(process.env.REDIS_MAX_RECONNECT_ATTEMPTS || 5);
    this.cacheFeatureEnabled = this.readFlag('REDIS_CACHE_ENABLED', true);

    if (!this.cacheFeatureEnabled) {
      console.warn('[CACHE] ⚠️ REDIS_CACHE_ENABLED=false. Cache Redis desabilitado (modo degradado).');
      return;
    }

    if (process.env.REDIS_URL) {
      try {
        this.client = new IORedis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          connectTimeout: 5000,
          enableOfflineQueue: false,
          retryStrategy: (times) => {
            if (times > this.maxReconnectAttempts) {
              this.enabled = false;
              this.logRedisError('[CACHE] ❌ Limite de reconexão do Redis atingido. Cache desativado.');
              return null;
            }
            const delay = Math.min(times * 50, 2000);
            return delay;
          }
        });

        this.client.on('connect', () => {
          console.log('[CACHE] ✅ Redis conectado');
          this.enabled = true;
        });

        this.client.on('error', (err) => {
          this.logRedisError(`[CACHE] ❌ Erro no Redis: ${err.message}`);
          this.enabled = false;
        });

        this.client.on('close', () => {
          this.logRedisError('[CACHE] ⚠️ Conexão Redis fechada');
          this.enabled = false;
        });
      } catch (error) {
        console.error('[CACHE] ❌ Falha ao conectar Redis:', error.message);
        this.enabled = false;
      }
    } else {
      console.warn('[CACHE] ⚠️ REDIS_URL não configurada. Cache desabilitado.');
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
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any|null>} - Cached value or null
   */
  async get(key) {
    if (!this.enabled || !this.client) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      if (value) {
        return JSON.parse(value);
      }
      return null;
    } catch (error) {
      console.error(`[CACHE] Erro ao buscar chave ${key}:`, error.message);
      return null;
    }
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {Promise<boolean>} - Success status
   */
  async set(key, value, ttl = null) {
    if (!this.enabled || !this.client) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      const seconds = ttl || this.defaultTTL;
      
      await this.client.setex(key, seconds, serialized);
      return true;
    } catch (error) {
      console.error(`[CACHE] Erro ao salvar chave ${key}:`, error.message);
      return false;
    }
  }

  /**
   * Delete value from cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} - Success status
   */
  async delete(key) {
    if (!this.enabled || !this.client) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error(`[CACHE] Erro ao deletar chave ${key}:`, error.message);
      return false;
    }
  }

  /**
   * Delete multiple keys matching a pattern
   * @param {string} pattern - Pattern to match (e.g., 'user:*')
   * @returns {Promise<number>} - Number of keys deleted
   */
  async deletePattern(pattern) {
    if (!this.enabled || !this.client) {
      return 0;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }
      return await this.client.del(...keys);
    } catch (error) {
      console.error(`[CACHE] Erro ao deletar padrão ${pattern}:`, error.message);
      return 0;
    }
  }

  /**
   * Get or set pattern: get from cache, or compute and cache if missing
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Function to fetch data if not in cache
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {Promise<any>} - Cached or fetched value
   */
  async getOrSet(key, fetchFn, ttl = null) {
    // Try to get from cache first
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    // If not in cache, fetch and cache it
    const value = await fetchFn();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * Invalidate cache for a user
   * @param {string} userId - User ID
   */
  async invalidateUser(userId) {
    if (!userId) return;
    
    await Promise.all([
      this.delete(`user:${userId}`),
      this.delete(`user:profile:${userId}`),
      this.delete(`user:config:${userId}`),
      this.deletePattern(`user:${userId}:*`)
    ]);
  }

  /**
   * Invalidate cache for a phone
   * @param {string} phone - Phone number
   */
  async invalidatePhone(phone) {
    if (!phone) return;
    
    await Promise.all([
      this.delete(`phone:${phone}`),
      this.delete(`phone:profile:${phone}`),
      this.delete(`phone:onboarding:${phone}`),
      this.deletePattern(`phone:${phone}:*`),
      this.deletePattern(`phone:profile:${phone}:*`)
    ]);
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.client) {
      await this.client.quit();
      this.enabled = false;
    }
  }
}

// Export singleton instance
// Exporta tanto a classe quanto uma instância singleton
// Permite injeção de dependências em testes
const instance = new CacheService();
module.exports = instance;
module.exports.CacheService = CacheService;
