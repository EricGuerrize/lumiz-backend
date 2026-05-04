const rateLimit = require('express-rate-limit');

/** Leituras pesadas (agregações, relatórios, simulador). */
exports.heavyDashboardReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.id || req.ip}:dash-heavy`,
  message: { error: 'Too Many Requests', message: 'Muitas consultas pesadas por minuto. Aguarde um momento.' },
});

/** Export PDF/CSV — mais restritivo. */
exports.dashboardExportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.id || req.ip}:dash-export`,
  message: { error: 'Too Many Requests', message: 'Limite de exportações atingido. Tente mais tarde.' },
});
