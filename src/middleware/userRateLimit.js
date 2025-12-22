const rateLimit = require('express-rate-limit');

/**
 * Rate limiting por usuário (além de IP)
 * Usa Redis para armazenar contadores por userId
 */
class UserRateLimit {
  constructor() {
    this.redisClient = null;
    this.enabled = false;

    // Tenta conectar ao Redis se disponível
    if (process.env.REDIS_URL) {
      try {
        const IORedis = require('ioredis');
        this.redisClient = new IORedis(process.env.REDIS_URL, {
          maxRetriesPerRequest: null
        });
        this.enabled = true;
        console.log('[RATE_LIMIT] ✅ Redis conectado para rate limiting por usuário');
      } catch (error) {
        console.warn('[RATE_LIMIT] ⚠️ Redis não disponível para rate limiting por usuário:', error.message);
      }
    }
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
   * Limpa rate limit de um usuário (útil para testes ou admin)
   */
  async resetUser(userId) {
    if (!this.enabled || !this.redisClient) {
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
}

// Exporta instância singleton
module.exports = new UserRateLimit();

