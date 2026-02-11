const rateLimit = require('express-rate-limit');

/**
 * Rate limiting por usuário e telefone (além de IP)
 * Usa Redis para armazenar contadores por userId/phone
 * 
 * Limites por telefone são essenciais para evitar abuse de custos
 * (processamento de imagens, chamadas à API Gemini, etc.)
 */
class UserRateLimit {
  constructor() {
    this.redisClient = null;
    this.enabled = false;

    // Fallback em memória quando Redis não está disponível
    this.memoryStore = new Map();
    this.memoryCleanupInterval = null;

    // Tenta conectar ao Redis se disponível
    if (process.env.REDIS_URL) {
      try {
        const IORedis = require('ioredis');
        this.redisClient = new IORedis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          connectTimeout: 5000,
          enableOfflineQueue: false,
          retryStrategy: (times) => {
            if (times > 5) return null;
            return Math.min(times * 100, 2000);
          }
        });
        this.redisClient.on('ready', () => {
          this.enabled = true;
          console.log('[RATE_LIMIT] ✅ Redis conectado para rate limiting');
        });
        this.redisClient.on('error', (err) => {
          this.enabled = false;
          console.warn('[RATE_LIMIT] ⚠️ Redis indisponível no rate limiting:', err.message);
          this.startMemoryCleanup();
        });
        this.redisClient.on('close', () => {
          this.enabled = false;
          console.warn('[RATE_LIMIT] ⚠️ Conexão Redis do rate limiting fechada, fallback em memória ativo.');
          this.startMemoryCleanup();
        });
      } catch (error) {
        console.warn('[RATE_LIMIT] ⚠️ Redis não disponível, usando fallback em memória:', error.message);
        this.startMemoryCleanup();
      }
    } else {
      console.log('[RATE_LIMIT] ℹ️ Redis não configurado, usando fallback em memória');
      this.startMemoryCleanup();
    }
  }

  /**
   * Limpa entradas expiradas do store em memória
   */
  startMemoryCleanup() {
    if (this.memoryCleanupInterval) return;
    
    this.memoryCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.memoryStore.entries()) {
        if (value.expiresAt < now) {
          this.memoryStore.delete(key);
        }
      }
    }, 60 * 1000); // Limpa a cada 1 minuto
  }

  /**
   * Middleware de rate limiting por usuário
   */
  middleware(options = {}) {
    const {
      windowMs = 15 * 60 * 1000, // 15 minutos
      max = 100, // máximo 100 requisições por usuário
      message = 'Muitas requisições. Tente novamente em alguns minutos.',
      skipSuccessfulRequests = false,
      skipFailedRequests = false
    } = options;

    return async (req, res, next) => {
      // Se não tem usuário autenticado, pula (deixa o rate limit por IP funcionar)
      if (!req.user || !req.user.id) {
        return next();
      }

      // Se Redis não está disponível, pula (fallback para rate limit por IP)
      if (!this.enabled || !this.redisClient) {
        return next();
      }

      const userId = req.user.id;
      const key = `rate_limit:user:${userId}`;
      const window = Math.floor(Date.now() / windowMs);

      try {
        // Incrementa contador no Redis
        const count = await this.redisClient.incr(`${key}:${window}`);
        
        // Define TTL na primeira requisição da janela
        if (count === 1) {
          await this.redisClient.expire(`${key}:${window}`, Math.ceil(windowMs / 1000));
        }

        // Verifica limite
        if (count > max) {
          const retryAfter = Math.ceil(windowMs / 1000);
          res.set('Retry-After', retryAfter);
          return res.status(429).json({
            error: 'Too Many Requests',
            message,
            retryAfter
          });
        }

        // Adiciona headers informativos
        res.set({
          'X-RateLimit-Limit': max,
          'X-RateLimit-Remaining': Math.max(0, max - count),
          'X-RateLimit-Reset': new Date((window + 1) * windowMs).toISOString()
        });

        next();
      } catch (error) {
        // Se Redis falhar, permite a requisição (fail open)
        console.error('[RATE_LIMIT] Erro ao verificar rate limit por usuário:', error.message);
        next();
      }
    };
  }

  /**
   * Verifica e incrementa rate limit por telefone
   * Retorna { allowed: boolean, remaining: number, resetAt: Date, count: number }
   */
  async checkPhoneLimit(phone, options = {}) {
    const {
      windowMs = 60 * 1000, // 1 minuto por padrão
      max = 30 // 30 mensagens por minuto por telefone
    } = options;

    const window = Math.floor(Date.now() / windowMs);
    const key = `rate_limit:phone:${phone}:${window}`;

    // Usar Redis se disponível
    if (this.enabled && this.redisClient) {
      try {
        const count = await this.redisClient.incr(key);
        if (count === 1) {
          await this.redisClient.expire(key, Math.ceil(windowMs / 1000));
        }
        return {
          allowed: count <= max,
          remaining: Math.max(0, max - count),
          resetAt: new Date((window + 1) * windowMs),
          count
        };
      } catch (error) {
        console.error('[RATE_LIMIT] Erro ao verificar rate limit por telefone (Redis):', error.message);
        // Fallback para memória
      }
    }

    // Fallback em memória
    const memKey = key;
    const now = Date.now();
    const entry = this.memoryStore.get(memKey) || { count: 0, expiresAt: now + windowMs };
    
    if (entry.expiresAt < now) {
      entry.count = 0;
      entry.expiresAt = now + windowMs;
    }
    
    entry.count++;
    this.memoryStore.set(memKey, entry);

    return {
      allowed: entry.count <= max,
      remaining: Math.max(0, max - entry.count),
      resetAt: new Date(entry.expiresAt),
      count: entry.count
    };
  }

  /**
   * Rate limiting especial para operações caras (OCR, AI)
   * Limites mais restritivos: 10 por minuto, 50 por hora
   */
  async checkExpensiveOperationLimit(phone, operation = 'ocr') {
    const limits = {
      ocr: { perMinute: 10, perHour: 50 },
      ai: { perMinute: 20, perHour: 100 },
      document: { perMinute: 5, perHour: 30 }
    };

    const limit = limits[operation] || limits.ocr;
    
    // Verifica limite por minuto
    const minuteCheck = await this.checkPhoneLimit(`${phone}:${operation}:min`, {
      windowMs: 60 * 1000,
      max: limit.perMinute
    });

    if (!minuteCheck.allowed) {
      return {
        allowed: false,
        reason: 'minute_limit',
        message: `Limite de ${limit.perMinute} operações por minuto atingido`,
        resetAt: minuteCheck.resetAt
      };
    }

    // Verifica limite por hora
    const hourCheck = await this.checkPhoneLimit(`${phone}:${operation}:hour`, {
      windowMs: 60 * 60 * 1000,
      max: limit.perHour
    });

    if (!hourCheck.allowed) {
      return {
        allowed: false,
        reason: 'hour_limit',
        message: `Limite de ${limit.perHour} operações por hora atingido`,
        resetAt: hourCheck.resetAt
      };
    }

    return {
      allowed: true,
      remaining: {
        minute: minuteCheck.remaining,
        hour: hourCheck.remaining
      }
    };
  }

  /**
   * Middleware para rate limit por telefone em webhooks
   */
  phoneRateLimitMiddleware(options = {}) {
    const {
      windowMs = 60 * 1000,
      max = 30,
      message = 'Muitas mensagens enviadas. Aguarde um momento.',
      extractPhone = (req) => {
        // Extrai telefone do body do webhook
        const phone = req.body?.data?.key?.remoteJid?.split('@')[0];
        return phone;
      }
    } = options;

    return async (req, res, next) => {
      const phone = extractPhone(req);
      
      // Se não conseguiu extrair telefone, deixa passar (rate limit por IP vai pegar)
      if (!phone) {
        return next();
      }

      const result = await this.checkPhoneLimit(phone, { windowMs, max });

      // Adiciona headers informativos
      res.set({
        'X-RateLimit-Phone-Limit': max,
        'X-RateLimit-Phone-Remaining': result.remaining,
        'X-RateLimit-Phone-Reset': result.resetAt.toISOString()
      });

      if (!result.allowed) {
        console.warn(`[RATE_LIMIT] Telefone ${phone} atingiu limite: ${result.count}/${max}`);
        return res.status(429).json({
          error: 'Too Many Requests',
          message,
          retryAfter: Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
        });
      }

      next();
    };
  }

  /**
   * Limpa rate limit de um usuário (útil para testes ou admin)
   */
  async resetUser(userId) {
    if (!this.enabled || !this.redisClient) {
      // Limpa do store em memória
      for (const key of this.memoryStore.keys()) {
        if (key.includes(`:user:${userId}:`)) {
          this.memoryStore.delete(key);
        }
      }
      return;
    }

    try {
      const pattern = `rate_limit:user:${userId}:*`;
      const keys = await this.redisClient.keys(pattern);
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
      }
    } catch (error) {
      console.error('[RATE_LIMIT] Erro ao resetar rate limit:', error);
    }
  }

  /**
   * Limpa rate limit de um telefone (útil para testes ou admin)
   */
  async resetPhone(phone) {
    if (!this.enabled || !this.redisClient) {
      // Limpa do store em memória
      for (const key of this.memoryStore.keys()) {
        if (key.includes(`:phone:${phone}:`)) {
          this.memoryStore.delete(key);
        }
      }
      return;
    }

    try {
      const pattern = `rate_limit:phone:${phone}:*`;
      const keys = await this.redisClient.keys(pattern);
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
      }
    } catch (error) {
      console.error('[RATE_LIMIT] Erro ao resetar rate limit de telefone:', error);
    }
  }
}

// Exporta instância singleton
module.exports = new UserRateLimit();
